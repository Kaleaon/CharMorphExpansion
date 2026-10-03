import { Color, MeshPhysicalMaterial } from "three";

export interface SkinOptions {
  color?: number;
  roughness?: number;
}

/** Baseline PBR skin: dielectric with a soft sheen and a faint clearcoat for oil. SSS approximation arrives in M7. */
export function createSkinMaterial(opts: SkinOptions = {}): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color(opts.color ?? 0xd9a891),
    roughness: opts.roughness ?? 0.55,
    metalness: 0,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new Color(0xffd9c8),
    clearcoat: 0.08,
    clearcoatRoughness: 0.45,
  });
}

export function createClothMaterial(color = 0x3b5b92): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ color, roughness: 0.85, metalness: 0, sheen: 1, sheenRoughness: 0.8, sheenColor: new Color(color).multiplyScalar(1.6) });
}

/** Material parameters sliders may drive (see `MaterialBinding` in @charmorph/core). Unknown names are ignored. */
export interface MaterialParams {
  /** 0..~1+; scales the normal-map detail (wrinkles/folds). No effect until the material has a normal map. */
  wrinkleNormalStrength?: number;
}

/** Strength at 0 → this fraction of the authored normal detail. Wrinkles never vanish entirely; tight skin still has pores. */
const BASE_NORMAL_SCALE = 0.25;

/**
 * Apply slider-driven material params to a material. Params absent from `params` reset to their authored baseline,
 * so calling this with `{}` restores the default look.
 */
export function applyMaterialParams(material: MeshPhysicalMaterial, params: Readonly<Record<string, number>>): void {
  const s = params.wrinkleNormalStrength ?? 0;
  const scale = BASE_NORMAL_SCALE + (1 - BASE_NORMAL_SCALE) * Math.min(1, Math.max(0, s));
  material.normalScale.set(scale, scale);
}
