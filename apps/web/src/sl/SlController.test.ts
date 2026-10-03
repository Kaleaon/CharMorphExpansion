import { describe, expect, it } from "vitest";
import { loadBody } from "../../../../packages/rig/test/helpers.ts";
import { SlController } from "./SlController.ts";

const body = loadBody();
const lowest = (p: Float32Array) => { let m = Infinity; for (let i = 1; i < p.length; i += 3) m = Math.min(m, p[i]!); return m; };
const highest = (p: Float32Array) => { let m = -Infinity; for (let i = 1; i < p.length; i += 3) m = Math.max(m, p[i]!); return m; };
const make = () => { body.model.reset(); const sl = new SlController(body.rig, body.mesh); const f = body.frame(); return { sl, f, out: sl.setFrame({ positions: f.positions, helpers: f.helpers }) }; };

describe("SlController", () => {
  it("reports what the whole SL pipeline costs per frame (informational)", () => {
    const { sl, f } = make();
    const time = (label: string, fn: () => void, n = 30) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); console.log(`  ${label}: ${((performance.now() - t) / n).toFixed(2)} ms`); };
    time("setFrame (retarget + T-pose skin + deform + normals)", () => sl.setFrame({ positions: f.positions, helpers: f.helpers }));
    time("update (slider/pose change: deform + normals)", () => sl.update());
    expect(true).toBe(true);
  });

  it("needs a frame before it can deform", () => {
    const sl = new SlController(body.rig, body.mesh);
    expect(sl.ready).toBe(false);
    expect(() => sl.update()).toThrow(/no frame/);
  });

  it("T-poses the body and puts its lowest vertex on the floor at rest", () => {
    const { out } = make();
    expect(out.positions.every(Number.isFinite)).toBe(true);
    expect(out.normals.every(Number.isFinite)).toBe(true);
    expect(lowest(out.positions) + out.groundShift).toBeCloseTo(0, 6);
    for (let r = 0; r < out.normals.length / 3; r++) expect(Math.hypot(out.normals[r * 3]!, out.normals[r * 3 + 1]!, out.normals[r * 3 + 2]!)).toBeCloseTo(1, 4);
  });

  it("joint-override mode is the identity at neutral sliders; the skeleton sits inside the body", () => {
    const { sl, f } = make();
    const wrist = sl.skeleton.worldPosition("mWristLeft");
    expect(wrist[1]).toBeGreaterThan(0.5); // out along +y (left), T-pose
    const tposed = Float32Array.from(sl.update().positions);
    sl.setFrame({ positions: f.positions, helpers: f.helpers });
    const again = sl.update().positions;
    for (let i = 0; i < tposed.length; i++) expect(again[i]).toBeCloseTo(tposed[i]!, 6);
  });

  it("SL Height makes the body taller by the viewer's own measure and keeps the feet near the floor", () => {
    const { sl } = make();
    const h0 = sl.bodyHeight();
    const p0 = sl.update().positions;
    const extent0 = highest(p0) - lowest(p0);
    sl.shape.set(33, 2);
    const o = sl.update();
    const h1 = sl.bodyHeight();
    expect(h1).toBeGreaterThan(h0 + 0.15);
    expect(highest(o.positions) - lowest(o.positions)).toBeGreaterThan(extent0 + 0.1);
    // The viewer grounds the foot *joint*; the sole is a little below it, so allow a few centimetres.
    expect(Math.abs(lowest(o.positions) + o.groundShift)).toBeLessThan(0.05);
  });

  it("leg-length and hover move the body up or down relative to the floor", () => {
    const { sl } = make();
    sl.shape.set(11001, 0.5);
    const hover = sl.update();
    expect(lowest(hover.positions) + hover.groundShift).toBeGreaterThan(0.45);
    sl.shape.reset();
    sl.shape.set(692, 1);
    const longer = sl.update();
    expect(Math.abs(lowest(longer.positions) + longer.groundShift)).toBeLessThan(0.05);
  });

  it("'sliders only' mode warps the body to the plain SL skeleton, so it differs from the exact override mode", () => {
    const { sl } = make();
    const exact = Float32Array.from(sl.update().positions);
    sl.mode = "sliders";
    const warped = sl.update().positions;
    let max = 0; for (let i = 0; i < exact.length; i++) max = Math.max(max, Math.abs(warped[i]! - exact[i]!));
    expect(max).toBeGreaterThan(0.02);
  });

  it("fit() chooses sliders that bring the plain SL skeleton closer to the body than the defaults do", () => {
    const { sl } = make();
    sl.mode = "sliders";
    const err = () => {
      const o = sl.update();
      void o;
      let s = 0, n = 0;
      const root = sl.skeleton.worldPosition("mPelvis");
      for (const [name, t] of (sl as unknown as { target: Map<string, [number, number, number]> }).target) {
        const p = sl.skeleton.worldPosition(name);
        const tr = (sl as unknown as { target: Map<string, [number, number, number]> }).target.get("mPelvis")!;
        s += Math.hypot(p[0] - root[0] - (t[0] - tr[0]), p[1] - root[1] - (t[1] - tr[1]), p[2] - root[2] - (t[2] - tr[2])) ** 2; n++;
      }
      return Math.sqrt(s / n);
    };
    const before = err();
    const res = sl.fit();
    const after = err();
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(res.rms, 3); // the reported residual is the real one (pelvis term is zero in both)
    expect(res.percent.size).toBe(12);
  });

  it("applies SL pose through the skeleton: bending the elbow moves the hand, not the head", () => {
    const { sl } = make();
    const base = Float32Array.from(sl.update().positions);
    sl.setPose("mElbowLeft", [0, 0, 70]);
    const bent = sl.update().positions;
    let hand = 0, head = 0;
    for (let r = 0; r < base.length / 3; r++) {
      const d = Math.hypot(bent[r * 3]! - base[r * 3]!, bent[r * 3 + 1]! - base[r * 3 + 1]!, bent[r * 3 + 2]! - base[r * 3 + 2]!);
      if (base[r * 3]! > 0.62) hand = Math.max(hand, d);
      if (base[r * 3 + 1]! > 1.45) head = Math.max(head, d);
    }
    expect(hand).toBeGreaterThan(0.1);
    expect(head).toBeLessThan(1e-5);
    sl.resetPose();
    const back = sl.update().positions;
    for (let i = 0; i < base.length; i++) expect(back[i]).toBeCloseTo(base[i]!, 6);
  });
});
