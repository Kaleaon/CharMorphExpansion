import { describe, expect, it } from "vitest";
import { createSlSkeleton, SL_SKELETON_DATA, SL_TO_THREE, slToThree, Skeleton, SkeletonError, validateSkeletonData } from "../src/index.ts";

const d = SL_SKELETON_DATA;
const near = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, -Math.log10(eps)));

describe("generated SL skeleton table (counts from avatar_skeleton.xml)", () => {
  it("has 133 joints and 26 collision volumes", () => {
    expect(d.joints).toHaveLength(133);
    expect(d.collisionVolumes).toHaveLength(26);
  });
  it("splits into 26 classic (base) and 107 Bento (extended) joints; all collision volumes are base", () => {
    expect(d.joints.filter((j) => j.support === "base")).toHaveLength(26);
    expect(d.joints.filter((j) => j.support === "extended")).toHaveLength(107);
    expect(d.collisionVolumes.every((c) => c.support === "base")).toBe(true);
  });
  it("passes structural validation and records provenance", () => {
    expect(validateSkeletonData(d)).toEqual([]);
    expect(d.source?.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(d.source?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is rooted at mPelvis, aliased 'hip'", () => {
    expect(d.joints[0]).toMatchObject({ name: "mPelvis", parent: null });
    expect(d.joints[0]!.aliases).toContain("hip");
    expect(d.joints.filter((j) => j.parent === null)).toHaveLength(1);
  });
  it("has the documented spine chain", () => {
    const chain = ["mPelvis", "mSpine1", "mSpine2", "mTorso", "mSpine3", "mSpine4", "mChest", "mNeck", "mHead"];
    chain.slice(1).forEach((n, i) => expect(d.joints.find((j) => j.name === n)!.parent).toBe(chain[i]));
  });
  it("classic skeleton contains exactly the pre-Bento bones", () => {
    const base = d.joints.filter((j) => j.support === "base").map((j) => j.name).sort();
    expect(base).toEqual([
      "mAnkleLeft", "mAnkleRight", "mChest", "mCollarLeft", "mCollarRight", "mElbowLeft", "mElbowRight", "mEyeLeft", "mEyeRight",
      "mFootLeft", "mFootRight", "mHead", "mHipLeft", "mHipRight", "mKneeLeft", "mKneeRight", "mNeck", "mPelvis", "mShoulderLeft",
      "mShoulderRight", "mSkull", "mToeLeft", "mToeRight", "mTorso", "mWristLeft", "mWristRight",
    ]);
  });
  it("has the 26 documented collision volumes", () => {
    expect(d.collisionVolumes.map((c) => c.name).sort()).toEqual([
      "BELLY", "BUTT", "CHEST", "HEAD", "LEFT_HANDLE", "LEFT_PEC", "LOWER_BACK", "L_CLAVICLE", "L_FOOT", "L_HAND", "L_LOWER_ARM",
      "L_LOWER_LEG", "L_UPPER_ARM", "L_UPPER_LEG", "NECK", "PELVIS", "RIGHT_HANDLE", "RIGHT_PEC", "R_CLAVICLE", "R_FOOT", "R_HAND",
      "R_LOWER_ARM", "R_LOWER_LEG", "R_UPPER_ARM", "R_UPPER_LEG", "UPPER_BACK",
    ]);
  });
  it("rest data facts the rest of the code relies on: zero rotation, unit scale, pos == pivot (except toes)", () => {
    for (const j of d.joints) {
      expect(j.rot, j.name).toEqual([0, 0, 0]);
      expect(j.scale, j.name).toEqual([1, 1, 1]);
      if (!j.name.startsWith("mToe")) near(j.pivot, j.pos, 1e-3);
    }
  });
  it("is left/right mirror symmetric in rest pose", () => {
    const s = createSlSkeleton();
    let pairs = 0;
    for (const n of s.names) {
      if (!n.endsWith("Left")) continue;
      const r = n.replace(/Left$/, "Right");
      if (s.indexOf(r) < 0) continue;
      const [lx, ly, lz] = s.worldPosition(n);
      const [rx, ry, rz] = s.worldPosition(r);
      near([lx, ly, lz], [rx, -ry, rz], 1e-2); // a few Bento bones are intentionally off by <1cm
      pairs++;
    }
    expect(pairs).toBeGreaterThan(40);
  });
});

describe("Skeleton rest pose", () => {
  const s = createSlSkeleton();
  it("matches the human proportions of a standing T-pose avatar", () => {
    near(s.worldPosition("mPelvis"), [0, 0, 1.067], 1e-3);
    expect(s.worldPosition("mHead")[2]).toBeGreaterThan(1.6);
    expect(s.worldPosition("mSkull")[2]).toBeLessThan(2.0);
    expect(s.worldPosition("mFootLeft")[2]).toBeLessThan(0.05);
    expect(s.worldPosition("mWristLeft")[1]).toBeGreaterThan(0.5); // arms out to the avatar's left (+Y)
    expect(s.worldPosition("mWristRight")[1]).toBeLessThan(-0.5);
    expect(s.worldPosition("mToeLeft")[0]).toBeGreaterThan(s.worldPosition("mAnkleLeft")[0]); // feet point to +X (forward)
  });
  it("resolves aliases and reports unknown names", () => {
    expect(s.indexOf("hip")).toBe(0);
    expect(s.indexOf("avatar_mPelvis")).toBe(0);
    expect(s.indexOf("nope")).toBe(-1);
    expect(() => s.worldPosition("nope")).toThrow(SkeletonError);
  });
  it("places collision volumes relative to their parent bones", () => {
    const i = s.cvIndexOf("PELVIS");
    const m = s.cvWorld.subarray(i * 16 + 12, i * 16 + 15);
    near([m[0]!, m[1]!, m[2]!], [-0.01, 0, 1.067 - 0.02], 1e-6);
  });
});

describe("Skeleton posing and shape deltas", () => {
  it("rotating the left shoulder 90° about X swings the wrist (FK) without touching the right arm", () => {
    const s = createSlSkeleton();
    const before = s.worldPosition("mWristLeft");
    const right = s.worldPosition("mWristRight");
    s.setPoseEuler("mShoulderLeft", [90, 0, 0]);
    s.update();
    const after = s.worldPosition("mWristLeft");
    const sh = s.worldPosition("mShoulderLeft");
    // distance from shoulder preserved, direction changed
    const len = (v: number[]) => Math.hypot(v[0]! - sh[0], v[1]! - sh[1], v[2]! - sh[2]);
    expect(len(after)).toBeCloseTo(len(before), 6);
    expect(Math.abs(after[2] - before[2])).toBeGreaterThan(0.3);
    near(s.worldPosition("mWristRight"), right, 1e-9);
    s.resetPose();
    s.update();
    near(s.worldPosition("mWristLeft"), before, 1e-9);
  });
  it("offset deltas move a joint and its descendants by exactly the offset", () => {
    const s = createSlSkeleton();
    const head = s.worldPosition("mHead");
    s.setDeltas({ mNeck: { offset: [0, 0, 0.05] } });
    s.update();
    near(s.worldPosition("mHead"), [head[0], head[1], head[2] + 0.05], 1e-9);
  });
  it("scale deltas are additive on the rest scale and lengthen child offsets (leg length)", () => {
    const s = createSlSkeleton();
    const ankle0 = s.worldPosition("mAnkleLeft");
    const hip = s.worldPosition("mHipLeft");
    s.setDeltas({ mHipLeft: { scale: [0, 0, 0.1] } }); // +10% along Z
    s.update();
    const ankle1 = s.worldPosition("mAnkleLeft");
    expect(hip[2] - ankle1[2]).toBeCloseTo((hip[2] - ankle0[2]) * 1.1, 6);
  });
  it("clearing deltas restores rest; unknown joints throw", () => {
    const s = createSlSkeleton();
    const p0 = s.worldPosition("mHead");
    s.setDeltas({ mNeck: { offset: [0, 0, 1] } });
    s.setDeltas({});
    s.update();
    near(s.worldPosition("mHead"), p0, 1e-12);
    expect(() => s.setDeltas({ mBogus: {} })).toThrow(SkeletonError);
  });
});

describe("validateSkeletonData / constructor", () => {
  it("rejects child-before-parent, duplicates, and orphaned collision volumes", () => {
    const j = (name: string, parent: string | null) => ({ ...d.joints[0]!, name, parent, aliases: [] });
    const bad = { version: "x", joints: [j("a", null), j("b", "c"), j("c", "a"), j("a", "a")], collisionVolumes: [{ ...d.collisionVolumes[0]!, parent: "zzz" }] };
    const problems = validateSkeletonData(bad).join("|");
    expect(problems).toContain("listed after child");
    expect(problems).toContain("duplicate joint name a");
    expect(problems).toContain("unknown parent zzz");
    expect(() => new Skeleton(bad)).toThrow(SkeletonError);
  });
});

describe("coordinate conversion", () => {
  it("SL_TO_THREE agrees with slToThree and is a proper rotation", () => {
    const v: [number, number, number] = [0.3, -0.7, 1.9];
    const m = SL_TO_THREE;
    const out = [m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2], m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2], m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2]];
    near(out, slToThree(v));
    const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
    expect(det).toBe(1);
  });
  it("maps forward→+Z, left→+X, up→+Y", () => {
    expect(slToThree([1, 0, 0])).toEqual([0, 0, 1]);
    expect(slToThree([0, 1, 0])).toEqual([1, 0, 0]);
    expect(slToThree([0, 0, 1])).toEqual([0, 1, 0]);
  });
});
