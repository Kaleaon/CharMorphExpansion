import { describe, expect, it } from "vitest";
import { advanceTurntable, fitDistance, sphericalPosition } from "../src/framing.ts";
import { BACKGROUND_PRESETS, LIGHTING_PRESETS } from "../src/presets.ts";

describe("fitDistance", () => {
  it("fits a unit sphere in a square 90° view at distance margin*√2", () => {
    expect(fitDistance(1, 90, 1, 1)).toBeCloseTo(Math.SQRT2, 6);
  });
  it("backs off further for portrait (narrow) aspects", () => {
    expect(fitDistance(1, 32, 0.5)).toBeGreaterThan(fitDistance(1, 32, 1.5));
  });
  it("is unaffected by wide aspects (vertical fit dominates)", () => {
    expect(fitDistance(1, 32, 2)).toBeCloseTo(fitDistance(1, 32, 3), 6);
  });
  it("rejects bad input", () => {
    expect(() => fitDistance(0, 32, 1)).toThrow();
    expect(() => fitDistance(1, 32, 0)).toThrow();
  });
});

describe("advanceTurntable", () => {
  it("advances proportionally and wraps", () => {
    expect(advanceTurntable(0, 1, 90)).toBeCloseTo(Math.PI / 2);
    expect(advanceTurntable(Math.PI * 2 - 0.1, 1, 360 / (2 * Math.PI) * 0.2)).toBeCloseTo(0.1, 6);
  });
  it("handles reverse rotation without going negative", () => {
    const a = advanceTurntable(0.1, 1, -90);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(Math.PI * 2);
  });
});

describe("sphericalPosition", () => {
  it("places az=0,el=0 on +Z and el=90 straight up", () => {
    const [x, y, z] = sphericalPosition(0, 0, 5);
    expect([x, y, z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 5]);
    expect(sphericalPosition(0, 90, 5)[1]).toBeCloseTo(5);
  });
  it("preserves distance", () => {
    const p = sphericalPosition(37, 22, 6);
    expect(Math.hypot(...p)).toBeCloseTo(6);
  });
});

describe("presets", () => {
  it("have unique ids and each lighting preset has a shadow-casting key", () => {
    const ids = [...LIGHTING_PRESETS, ...BACKGROUND_PRESETS].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of LIGHTING_PRESETS.filter((x) => x.id !== "flat")) {
      expect(p.lights.some((l) => l.role === "key" && l.castShadow)).toBe(true);
    }
  });
});
