import type { LlFace } from "./llmesh.ts";

type V3 = readonly [number, number, number];

export interface ColladaInput {
  /** Used for the geometry, controller and material ids. Letters, digits, `-` and `_` only. */
  name: string;
  /** One face; positions/normals in Second Life space (x forward, y left, z up). */
  face: LlFace;
  /** Joints the mesh is weighted to; `face.influences` index into this list. */
  joints: string[];
  /** World position of each of `joints` at bind (SL space). */
  bindPositions: V3[];
  /** The skeleton: every joint with its parent (null for the root) and local offset. Only used joints and their ancestors are written. */
  hierarchy: { name: string; parent: string | null; position: V3 }[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => (Object.is(n, -0) ? "0" : String(n));
const list = (a: ArrayLike<number>) => Array.from(a, num).join(" ");

/**
 * Write a COLLADA 1.4.1 document in the shape Second Life's uploader reads (indra `lldaeloader.cpp`):
 *  - Z_UP, metre units, so no axis or unit conversion is applied to the vertices or joints;
 *  - one skin controller with an identity bind shape matrix, `JOINT` names that are SL joint names, row-major `INV_BIND_MATRIX`
 *    entries (translation in elements 3, 7, 11), and up to four weights per vertex (the loader keeps the strongest four);
 *  - joint nodes named after the SL joints, each with a `<translate sid="location">` — the uploader takes only that translation
 *    as the joint's position override. No `<skeleton>` element is written: the loader then walks the scene's nodes for joints
 *    instead of resolving sid paths from a root, which is the more forgiving path.
 */
export function buildCollada(input: ColladaInput): string {
  const { face, joints } = input;
  const nv = face.positions.length / 3;
  const nt = face.indices.length / 3;
  const inf = face.influences;
  if (!inf) throw new Error("buildCollada: the face needs joint influences");
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(input.name)) throw new Error(`buildCollada: bad name "${input.name}"`);
  if (input.bindPositions.length !== joints.length) throw new Error("buildCollada: one bind position per joint");
  const n = input.name;

  // Per-vertex weights: non-zero influences only, strongest first.
  const vcount: number[] = [], v: number[] = [], weights: number[] = [];
  for (let i = 0; i < nv; i++) {
    const row: [number, number][] = [];
    for (let k = 0; k < 4; k++) { const w = inf.weights[i * 4 + k]!; if (w > 0) row.push([inf.joints[i * 4 + k]!, w]); }
    row.sort((a, b) => b[1] - a[1]);
    if (row.length === 0) throw new Error(`buildCollada: vertex ${i} has no joint influence`);
    for (const [j, w] of row) {
      if (j >= joints.length) throw new Error(`buildCollada: vertex ${i} references joint ${j} of ${joints.length}`);
      v.push(j, weights.length);
      weights.push(w);
    }
    vcount.push(row.length);
  }

  // Skeleton nodes: used joints plus ancestors, children nested under their parents.
  const byName = new Map(input.hierarchy.map((h) => [h.name, h]));
  const keep = new Set<string>();
  for (const j of joints) {
    if (!byName.has(j)) throw new Error(`buildCollada: unknown joint ${j}`);
    for (let c: string | null = j; c !== null && !keep.has(c); c = byName.get(c)!.parent) keep.add(c);
  }
  const kids = new Map<string | null, string[]>();
  for (const h of input.hierarchy) if (keep.has(h.name)) { const a = kids.get(h.parent) ?? []; a.push(h.name); kids.set(h.parent, a); }
  const node = (name: string, depth: number): string => {
    const h = byName.get(name)!;
    const pad = "  ".repeat(depth);
    const inner = (kids.get(name) ?? []).map((c) => node(c, depth + 1)).join("");
    return `${pad}<node id="${esc(name)}" name="${esc(name)}" sid="${esc(name)}" type="JOINT">\n${pad}  <translate sid="location">${list(h.position)}</translate>\n${inner}${pad}</node>\n`;
  };
  const skeleton = (kids.get(null) ?? []).map((r) => node(r, 3)).join("");

  const invBind = input.bindPositions.map((p) => `1 0 0 ${num(-p[0])} 0 1 0 ${num(-p[1])} 0 0 1 ${num(-p[2])} 0 0 0 1`).join(" ");
  const floatSource = (id: string, arr: ArrayLike<number>, stride: number, params: string) =>
    `      <source id="${id}">\n        <float_array id="${id}-array" count="${arr.length}">${list(arr)}</float_array>\n        <technique_common><accessor source="#${id}-array" count="${arr.length / stride}" stride="${stride}">${params}</accessor></technique_common>\n      </source>\n`;

  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <contributor><authoring_tool>CharMorph Designer</authoring_tool></contributor>
    <unit name="meter" meter="1"/>
    <up_axis>Z_UP</up_axis>
  </asset>
  <library_effects>
    <effect id="${n}-effect"><profile_COMMON><technique sid="common"><lambert><diffuse><color>0.8 0.8 0.8 1</color></diffuse></lambert></technique></profile_COMMON></effect>
  </library_effects>
  <library_materials>
    <material id="${n}-material" name="${n}"><instance_effect url="#${n}-effect"/></material>
  </library_materials>
  <library_geometries>
    <geometry id="${n}-mesh" name="${n}">
      <mesh>
${floatSource(`${n}-positions`, face.positions, 3, '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>')}${face.normals ? floatSource(`${n}-normals`, face.normals, 3, '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>') : ""}${face.uvs ? floatSource(`${n}-uvs`, face.uvs, 2, '<param name="S" type="float"/><param name="T" type="float"/>') : ""}      <vertices id="${n}-vertices"><input semantic="POSITION" source="#${n}-positions"/></vertices>
      <triangles material="${n}-material" count="${nt}">
        <input semantic="VERTEX" source="#${n}-vertices" offset="0"/>
${face.normals ? `        <input semantic="NORMAL" source="#${n}-normals" offset="0"/>\n` : ""}${face.uvs ? `        <input semantic="TEXCOORD" source="#${n}-uvs" offset="0" set="0"/>\n` : ""}        <p>${list(face.indices)}</p>
      </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_controllers>
    <controller id="${n}-skin" name="${n}">
      <skin source="#${n}-mesh">
        <bind_shape_matrix>1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</bind_shape_matrix>
        <source id="${n}-joints">
          <Name_array id="${n}-joints-array" count="${joints.length}">${joints.map(esc).join(" ")}</Name_array>
          <technique_common><accessor source="#${n}-joints-array" count="${joints.length}" stride="1"><param name="JOINT" type="name"/></accessor></technique_common>
        </source>
        <source id="${n}-bind-poses">
          <float_array id="${n}-bind-poses-array" count="${joints.length * 16}">${invBind}</float_array>
          <technique_common><accessor source="#${n}-bind-poses-array" count="${joints.length}" stride="16"><param name="TRANSFORM" type="float4x4"/></accessor></technique_common>
        </source>
        <source id="${n}-weights">
          <float_array id="${n}-weights-array" count="${weights.length}">${list(weights)}</float_array>
          <technique_common><accessor source="#${n}-weights-array" count="${weights.length}" stride="1"><param name="WEIGHT" type="float"/></accessor></technique_common>
        </source>
        <joints>
          <input semantic="JOINT" source="#${n}-joints"/>
          <input semantic="INV_BIND_MATRIX" source="#${n}-bind-poses"/>
        </joints>
        <vertex_weights count="${nv}">
          <input semantic="JOINT" source="#${n}-joints" offset="0"/>
          <input semantic="WEIGHT" source="#${n}-weights" offset="1"/>
          <vcount>${vcount.join(" ")}</vcount>
          <v>${v.join(" ")}</v>
        </vertex_weights>
      </skin>
    </controller>
  </library_controllers>
  <library_visual_scenes>
    <visual_scene id="scene" name="scene">
${skeleton}      <node id="${n}-node" name="${n}">
        <instance_controller url="#${n}-skin">
          <bind_material><technique_common><instance_material symbol="${n}-material" target="#${n}-material"/></technique_common></bind_material>
        </instance_controller>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}
