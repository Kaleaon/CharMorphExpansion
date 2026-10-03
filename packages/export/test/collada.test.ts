import { DOMParser, type Document as XDoc, type Element as XEl } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { SL_SKELETON_DATA } from "../../skeleton/src/index.ts";
import { loadBody } from "../../rig/test/helpers.ts";
import { buildCollada, exportBodyCollada, exportBodyMesh } from "../src/index.ts";

const { mesh, rig, frame } = loadBody();
const f = frame();
const out = exportBodyCollada(f, rig, mesh);
const doc = new DOMParser({ onError: (_l, m) => { throw new Error(m); } }).parseFromString(out.xml, "text/xml");

const all = (tag: string, from: XEl | XDoc = doc) => Array.from(from.getElementsByTagName(tag)) as unknown as XEl[];
const one = (tag: string, from: XEl | XDoc = doc) => { const e = all(tag, from); expect(e).toHaveLength(1); return e[0]!; };
const nums = (e: XEl) => (e.textContent ?? "").trim().split(/\s+/).map(Number);

describe("exportBodyCollada on the MakeHuman body", () => {
  it("is well-formed COLLADA 1.4.1, Z_UP in metres", () => {
    expect(doc.documentElement!.getAttribute("version")).toBe("1.4.1");
    expect(one("up_axis").textContent).toBe("Z_UP");
    expect(one("unit").getAttribute("meter")).toBe("1");
  });

  it("writes the same mesh the LL mesh export does", () => {
    const tris = one("triangles");
    expect(Number(tris.getAttribute("count"))).toBe(out.triangles);
    expect(nums(one("p", tris))).toHaveLength(out.triangles * 3);
    const pos = nums(all("float_array").find((a) => a.getAttribute("id") === "body-positions-array")!);
    expect(pos).toHaveLength(out.vertices * 3);
    const ll = exportBodyMesh(f, rig, mesh, { lods: "high" });
    expect(out.vertices).toBe(ll.vertices);
    expect(out.joints).toEqual(ll.joints);
  });

  it("reads the inverse binds the way the uploader does: translation in elements 3, 7, 11, equal to minus the bind position", () => {
    const m = nums(all("float_array").find((a) => a.getAttribute("id") === "body-bind-poses-array")!);
    expect(m).toHaveLength(out.joints.length * 16);
    // joint world positions rebuilt from the node hierarchy's translations
    const world = new Map<string, number[]>();
    const walk = (e: XEl, parent: number[]) => {
      for (const c of Array.from(e.childNodes) as unknown as XEl[]) {
        if (c.nodeName !== "node" || c.getAttribute("type") !== "JOINT") continue;
        const t = nums(Array.from(c.childNodes).find((x) => (x as unknown as XEl).nodeName === "translate") as unknown as XEl);
        const w = [parent[0]! + t[0]!, parent[1]! + t[1]!, parent[2]! + t[2]!];
        world.set(c.getAttribute("name")!, w);
        walk(c, w);
      }
    };
    walk(one("visual_scene"), [0, 0, 0]);
    out.joints.forEach((j, i) => {
      const w = world.get(j)!;
      expect(w, j).toBeDefined();
      for (let a = 0; a < 3; a++) expect(m[i * 16 + 3 + a * 4]).toBeCloseTo(-w[a]!, 5);
      expect(m.slice(i * 16, i * 16 + 3)).toEqual([1, 0, 0]);
    });
  });

  it("names joints with SL joint names, keeps parents above children, and writes translate sid=location", () => {
    const names = new Set(SL_SKELETON_DATA.joints.map((j) => j.name));
    const nodes = all("node").filter((n) => n.getAttribute("type") === "JOINT");
    expect(nodes.length).toBeGreaterThanOrEqual(out.joints.length);
    for (const n of nodes) {
      const name = n.getAttribute("name")!;
      expect(names.has(name)).toBe(true);
      const parent = SL_SKELETON_DATA.joints.find((j) => j.name === name)!.parent;
      const pe = n.parentNode as unknown as XEl;
      if (parent) expect(pe.getAttribute("name")).toBe(parent); else expect(pe.nodeName).toBe("visual_scene");
      expect((Array.from(n.childNodes) as unknown as XEl[]).find((c) => c.nodeName === "translate")!.getAttribute("sid")).toBe("location");
    }
    expect(all("skeleton")).toHaveLength(0);
  });

  it("gives every vertex 1–4 positive weights that reference real joints", () => {
    const vw = one("vertex_weights");
    const vc = nums(one("vcount", vw)), v = nums(one("v", vw));
    expect(vc).toHaveLength(out.vertices);
    expect(vc.every((c) => c >= 1 && c <= 4)).toBe(true);
    expect(v).toHaveLength(vc.reduce((a, b) => a + b, 0) * 2);
    const w = nums(all("float_array").find((a) => a.getAttribute("id") === "body-weights-array")!);
    for (let i = 0; i < v.length; i += 2) { expect(v[i]).toBeLessThan(out.joints.length); expect(w[v[i + 1]!]).toBeGreaterThan(0); }
  });

  it("writes stock joint positions when overrides are off", () => {
    const plain = new DOMParser().parseFromString(exportBodyCollada(f, rig, mesh, { jointOverrides: false }).xml, "text/xml");
    const pelvis = (Array.from(plain.getElementsByTagName("node")) as unknown as XEl[]).find((n) => n.getAttribute("name") === "mPelvis")!;
    const t = nums(Array.from(pelvis.childNodes).find((x) => (x as unknown as XEl).nodeName === "translate") as unknown as XEl);
    expect(t).toEqual([...SL_SKELETON_DATA.joints.find((j) => j.name === "mPelvis")!.pos]);
  });
});

describe("buildCollada validation", () => {
  const face = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint16Array([0, 1, 2]), influences: { joints: new Uint8Array(12), weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]) } };
  const base = { name: "t", face, joints: ["mPelvis"], bindPositions: [[0, 0, 1] as const], hierarchy: [{ name: "mPelvis", parent: null, position: [0, 0, 1] as const }] };
  it("builds a minimal document and escapes names", () => {
    expect(buildCollada(base)).toContain('<node id="mPelvis"');
  });
  it("rejects bad input", () => {
    expect(() => buildCollada({ ...base, name: "bad name" })).toThrow(/bad name/);
    expect(() => buildCollada({ ...base, joints: ["mNope"], bindPositions: [[0, 0, 0]] })).toThrow(/unknown joint/);
    expect(() => buildCollada({ ...base, face: { ...face, influences: { joints: new Uint8Array(12), weights: new Float32Array(12) } } })).toThrow(/no joint influence/);
    expect(() => buildCollada({ ...base, bindPositions: [] })).toThrow(/bind position/);
  });
});
