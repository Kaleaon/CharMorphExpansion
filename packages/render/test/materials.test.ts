import { describe, expect, it } from "vitest";
import { applyMaterialParams, createSkinMaterial } from "../src/materials.ts";

describe("applyMaterialParams", () => {
  it("scales normal detail with wrinkleNormalStrength and resets when absent", () => {
    const m = createSkinMaterial();
    applyMaterialParams(m, { wrinkleNormalStrength: 1 });
    expect(m.normalScale.x).toBeCloseTo(1);
    applyMaterialParams(m, { wrinkleNormalStrength: 0.5 });
    expect(m.normalScale.x).toBeCloseTo(0.625);
    applyMaterialParams(m, {});
    expect(m.normalScale.x).toBeCloseTo(0.25);
  });
  it("clamps out-of-range strength and ignores unknown params", () => {
    const m = createSkinMaterial();
    applyMaterialParams(m, { wrinkleNormalStrength: 5, bogus: 3 });
    expect(m.normalScale.x).toBeCloseTo(1);
    applyMaterialParams(m, { wrinkleNormalStrength: -2 });
    expect(m.normalScale.x).toBeCloseTo(0.25);
  });
});
