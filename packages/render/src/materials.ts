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
