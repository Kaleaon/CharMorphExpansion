import { describe, expect, it } from "vitest";
import { computeBodyHeight, pelvisToFoot, createSlShape, createSlSkeleton, drivenWeight, SL_SHAPE_DATA, SL_SKELETON_DATA, ShapeError, SlShape, type ShapeData } from "../src/index.ts";

const near = (a: number[], b: number[], eps = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(eps));

describe("generated shape table", () => {
  it("has the expected shape of data", () => {
    expect(SL_SHAPE_DATA.params.length).toBe(186);
    expect(SL_SHAPE_DATA.params.filter((p) => p.bones?.length)).toHaveLength(82);
    expect(SL_SHAPE_DATA.params.filter((p) => p.volumes?.length)).toHaveLength(30);
    expect(SL_SHAPE_DATA.source?.ref).toMatch(/^[0-9a-f]{40}$/);
  });
  it("only references joints and collision volumes that exist (constructor validates)", () => {
    expect(() => createSlShape()).not.toThrow();
  });
  it("includes the tweakable body sliders under their viewer ids", () => {
    const s = createSlShape();
    for (const [id, name] of [[33, "Height"], [34, "Thickness"], [36, "Shoulders"], [37, "Hip Width"], [38, "Torso Length"], [692, "Leg Length"], [693, "Arm Length"], [756, "Neck Length"], [675, "Hand Size"], [842, "Hip Length"]] as const) {
      expect(s.param(id).name).toBe(name);
      expect(s.param(id).group).toBe(0);
    }
    expect(s.param(33)).toMatchObject({ min: -2.3, max: 2 });
  });
});

describe("drivenWeight (trapezoid from lldriverparam.cpp)", () => {
  const driver = { min: 0, max: 1 }, driven = { min: -1, max: 3 };
  const e = { id: 1, min1: 0.2, max1: 0.4, max2: 0.6, min2: 0.8 };
  it("ramps up, holds, ramps down, and falls to min beyond", () => {
    expect(drivenWeight(e, 0.1, driver, driven)).toBe(-1);
    expect(drivenWeight(e, 0.3, driver, driven)).toBeCloseTo(1, 12); // halfway up: -1 + 0.5*4
    expect(drivenWeight(e, 0.5, driver, driven)).toBe(3);
    expect(drivenWeight(e, 0.7, driver, driven)).toBeCloseTo(1, 12); // halfway down
    expect(drivenWeight(e, 0.95, driver, driven)).toBe(-1);
  });
  it("default entry (max2 = min2 = max1 = driver max) ramps over the whole driver range and then stays at max", () => {
    const d = { id: 1, min1: 0, max1: 1, max2: 1, min2: 1 };
    expect(drivenWeight(d, 0, driver, driven)).toBe(-1);
    expect(drivenWeight(d, 0.25, driver, driven)).toBeCloseTo(0, 12);
    expect(drivenWeight(d, 1, driver, driven)).toBe(3);
  });
  it("step ramps: min1 == max1 at the driver's minimum selects the driven maximum", () => {
    const step = { id: 1, min1: 0, max1: 0, max2: 1, min2: 1 };
    expect(drivenWeight(step, 0, driver, driven)).toBe(3);
    expect(drivenWeight({ ...step, min1: 0.5, max1: 0.5 }, 0.2, driver, driven)).toBe(-1);
  });
});

describe("SlShape on the real SL data", () => {
  const baseline = () => { const s = createSlShape(); return { s, d0: s.evaluate().deltas }; };

  it("adds exactly weight × (scale|offset) per bone (differential test on Height)", () => {
    const { s, d0 } = baseline();
    const height = s.param(33);
    s.set(33, 1.5);
    const d1 = s.evaluate().deltas;
    for (const b of height.bones!) {
      const before = d0[b.name]?.scale ?? [0, 0, 0], after = d1[b.name]!.scale ?? [0, 0, 0];
      near(after, before.map((v, i) => v + 1.5 * (b.scale?.[i] ?? 0)));
      if (b.offset) near(d1[b.name]!.offset!, (d0[b.name]?.offset ?? [0, 0, 0]).map((v, i) => v + 1.5 * b.offset![i]!));
    }
  });

  it("clamps weights to the parameter range and rejects bad input", () => {
    const { s } = baseline();
    s.set(33, 99); expect(s.get(33)).toBe(2);
    s.set("Height", -99); expect(s.get(33)).toBe(-2.3);
    expect(() => s.set(33, NaN)).toThrow(RangeError);
    expect(() => s.param(-5)).toThrow(ShapeError);
    expect(() => s.param("No such param")).toThrow(ShapeError);
  });

  it("refuses ambiguous names (the viewer has two Lip_Thickness params) but accepts their ids", () => {
    const { s } = baseline();
    expect(() => s.param("Lip_Thickness")).toThrow(/ambiguous/);
  });

  it("parameters with a non-zero default are applied at rest (Arm Length defaults to 0.6)", () => {
    const { s, d0 } = baseline();
    expect(s.param(693).default).toBe(0.6);
    const arm = s.param(693).bones!.find((b) => b.scale)!;
    s.reset();
    s.set(693, 0);
    const without = s.evaluate().deltas;
    const diff = (d0[arm.name]?.scale ?? [0, 0, 0]).map((v, i) => v - (without[arm.name]?.scale?.[i] ?? 0));
    near(diff, arm.scale!.map((v) => 0.6 * v));
  });

  it("collision volumes under a scaled bone inherit restScale ⊙ boneScaleDelta (inheritScale)", () => {
    const { s, d0 } = baseline();
    s.set(33, 1);
    const d1 = s.evaluate().deltas;
    let checked = 0;
    for (const b of s.param(33).bones!) {
      if (!b.scale) continue;
      for (const cv of SL_SKELETON_DATA.collisionVolumes.filter((c) => c.parent === b.name)) {
        const before = d0[cv.name]?.scale ?? [0, 0, 0], after = d1[cv.name]!.scale!;
        near(after.map((v, i) => v - before[i]!), cv.scale.map((v, i) => v * b.scale![i]!));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it("drivers move volume morphs: driving 'Big_Belly_Torso' (104) deforms BELLY and PELVIS", () => {
    const { s, d0 } = baseline();
    const driver = SL_SHAPE_DATA.params.find((p) => p.driven?.some((x) => x.id === 104))!;
    expect(driver, "a driver of param 104").toBeTruthy();
    s.set(driver.id, driver.max);
    const r = s.evaluate();
    const w104 = r.weights.get(104)!;
    expect(w104).toBeGreaterThan(0);
    const belly = SL_SHAPE_DATA.params.find((p) => p.id === 104)!.volumes!.find((v) => v.name === "BELLY")!;
    near(r.deltas["BELLY"]!.scale!.map((v, i) => v - (d0["BELLY"]?.scale?.[i] ?? 0)), belly.scale!.map((v) => v * w104));
    near(r.deltas["BELLY"]!.offset!.map((v, i) => v - (d0["BELLY"]?.offset?.[i] ?? 0)), belly.pos!.map((v) => v * w104));
  });

  it("applies to the skeleton: Height lifts the head; Leg Length pushes the feet down (the pelvis stays put)", () => {
    const sk = createSlSkeleton();
    const s = createSlShape();
    const at = (n: string) => { sk.setDeltas(s.evaluate().deltas); sk.update(); return sk.worldPosition(n)[2]; };
    const head0 = at("mHead"), foot0 = at("mAnkleLeft");
    s.set(33, 1);
    expect(at("mHead")).toBeGreaterThan(head0);
    s.reset(); s.set(692, 1);
    expect(at("mAnkleLeft")).toBeLessThan(foot0);
    expect(at("mPelvis")).toBeCloseTo(1.067, 9);
    s.reset(); s.set(11001, 1.5);
    expect(s.evaluate().hover).toBe(1.5);
  });
});

describe("sex gating and fixture behaviour", () => {
  const skel = SL_SKELETON_DATA;
  const fixture = (extra: Partial<ShapeData> = {}): ShapeData => ({
    params: [
      { id: 80, name: "male", group: 0, min: 0, max: 1, default: 0 },
      { id: 1, name: "FemaleOnly", group: 0, min: 0, max: 1, default: 0, sex: "female", volumes: [{ name: "BELLY", scale: [1, 0, 0] }] },
      { id: 2, name: "Always", group: 0, min: 0, max: 1, default: 0.25, volumes: [{ name: "PELVIS", scale: [0, 1, 0] }] },
    ],
    ...extra,
  });
  it("applies a sex-limited parameter only to its sex; otherwise uses its default weight", () => {
    const s = new SlShape(fixture(), skel);
    s.set(1, 1);
    expect(s.evaluate().deltas["BELLY"]?.scale).toEqual([1, 0, 0]); // male = 0 → female
    s.set(80, 1);
    expect(s.evaluate().deltas["BELLY"]).toBeUndefined(); // male: default weight 0 → no effect
  });
  it("applies a non-zero default for unset parameters", () => {
    const s = new SlShape(fixture(), skel);
    expect(s.evaluate().deltas["PELVIS"]?.scale).toEqual([0, 0.25, 0]);
  });
  it("rejects data that points at joints/volumes that do not exist", () => {
    const bad = fixture({ params: [{ id: 5, name: "x", group: 0, min: 0, max: 1, default: 0, bones: [{ name: "mNope", scale: [1, 1, 1] }] }] });
    expect(() => new SlShape(bad, skel)).toThrow(/unknown joint/);
    const bad2 = fixture({ params: [{ id: 5, name: "x", group: 0, min: 0, max: 1, default: 0, driven: [{ id: 9, min1: 0, max1: 1, max2: 1, min2: 1 }] }] });
    expect(() => new SlShape(bad2, skel)).toThrow(/unknown param/);
  });
});

describe("computeBodyHeight (viewer's computeBodySize)", () => {
  it("equals the formula evaluated straight from the rest data when no shape is applied", () => {
    const j = (n: string) => SL_SKELETON_DATA.joints.find((x) => x.name === n)!.pos[2];
    const expected = j("mHipLeft") - j("mKneeLeft") - j("mAnkleLeft") - j("mFootLeft") + Math.SQRT2 * j("mSkull") + j("mHead") + j("mNeck") + j("mChest") + j("mTorso");
    expect(computeBodyHeight(createSlSkeleton())).toBeCloseTo(expected, 12);
  });
  it("grows with Height and Leg Length and shrinks when Height is reduced", () => {
    const sk = createSlSkeleton();
    const s = createSlShape();
    const h = () => { sk.setDeltas(s.evaluate().deltas); sk.update(); return computeBodyHeight(sk); };
    const h0 = h();
    expect(h0).toBeGreaterThan(1.5);
    expect(h0).toBeLessThan(2.2);
    s.set(33, 2); const tall = h();
    s.set(33, -2); const short = h();
    expect(tall).toBeGreaterThan(h0 + 0.1);
    expect(short).toBeLessThan(h0 - 0.1);
    s.reset(); s.set(692, 1);
    expect(h()).toBeGreaterThan(h0);
  });
  it("pelvisToFoot is what keeps the feet on the ground: after lifting the pelvis by it, the ankle height is unchanged", () => {
    const sk = createSlSkeleton();
    const s = createSlShape();
    const ground = () => { sk.setDeltas(s.evaluate().deltas); sk.update(); return pelvisToFoot(sk) + sk.worldPosition("mAnkleLeft")[2] - sk.worldPosition("mPelvis")[2]; };
    const g0 = ground();
    s.set(692, 1); s.set(33, 0.5);
    expect(ground()).toBeCloseTo(g0, 6); // the ankle sits the same height above the sole however long the leg is
  });
});
