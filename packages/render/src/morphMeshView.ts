import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, type Material } from "three";
import type { MorphMesh } from "@charmorph/morph";
import { createSkinMaterial } from "./materials.ts";

/** A mesh whose positions/normals are replaced wholesale by frames from the morph engine (render-vertex order). */
export class MorphMeshView extends Mesh<BufferGeometry, Material> {
  private readonly pos: BufferAttribute;
  private readonly nor: BufferAttribute;

  constructor(mesh: MorphMesh, material: Material = createSkinMaterial()) {
    const rv = mesh.renderToMorph.length;
    const g = new BufferGeometry();
    const positions = new Float32Array(rv * 3);
    for (let r = 0; r < rv; r++) {
      const m = mesh.renderToMorph[r]!;
      positions[r * 3] = mesh.positions[m * 3]!;
      positions[r * 3 + 1] = mesh.positions[m * 3 + 1]!;
      positions[r * 3 + 2] = mesh.positions[m * 3 + 2]!;
    }
    const pos = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage);
    const nor = new BufferAttribute(new Float32Array(rv * 3), 3).setUsage(DynamicDrawUsage);
    g.setAttribute("position", pos);
    g.setAttribute("normal", nor);
    g.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
    g.setIndex(new BufferAttribute(rv <= 65535 ? Uint16Array.from(mesh.indices) : mesh.indices, 1));
    super(g, material);
    this.pos = pos;
    this.nor = nor;
    this.name = mesh.name;
    this.castShadow = true;
    this.receiveShadow = true;
    // Bounds change with every morph; the mesh is always in view, so skip culling instead of recomputing spheres.
    this.frustumCulled = false;
  }

  applyFrame(positions: Float32Array, normals: Float32Array): void {
    this.pos.array.set(positions);
    this.nor.array.set(normals);
    this.pos.needsUpdate = true;
    this.nor.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
