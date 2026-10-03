import { CapsuleGeometry, Group, Mesh, SphereGeometry, type Material } from "three";
import { createClothMaterial, createSkinMaterial } from "./materials.ts";

/**
 * Procedural stand-in figure (~1.75 m tall, feet on y=0) used until real base meshes land in M4.
 * Purely generated, so it carries no third-party license.
 */
export function createTestMannequin(skin: Material = createSkinMaterial(), cloth: Material = createClothMaterial()): Group {
  const g = new Group();
  g.name = "test-mannequin";
  const add = (geo: CapsuleGeometry | SphereGeometry, mat: Material, x: number, y: number, z = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  add(new SphereGeometry(0.105, 48, 32), skin, 0, 1.64); // head
  add(new CapsuleGeometry(0.045, 0.08, 8, 16), skin, 0, 1.52); // neck
  add(new CapsuleGeometry(0.15, 0.36, 12, 24), cloth, 0, 1.2); // torso
  add(new CapsuleGeometry(0.16, 0.12, 12, 24), cloth, 0, 0.92); // pelvis
  for (const s of [-1, 1]) {
    add(new CapsuleGeometry(0.045, 0.52, 8, 16), skin, s * 0.2, 1.17, 0, s * 0.12); // arm
    add(new CapsuleGeometry(0.07, 0.38, 8, 16), skin, s * 0.09, 0.58); // thigh
    add(new CapsuleGeometry(0.055, 0.36, 8, 16), skin, s * 0.09, 0.2); // shin
  }
  return g;
}
