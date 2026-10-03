import { describe, expect, it } from "vitest";
import { parseObj, parseTarget } from "./obj.ts";

describe("parseObj", () => {
  const obj = `# c\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\ng body\nf 1/1 2/2 3/3 4/4\ng helper\nf 1/1/1 2/2/1 3/3/1\nf 1//1 2//1 3//1\n`;
  it("reads vertices, uvs and per-group faces (0-based), handling v/vt/vn and v//vn", () => {
    const o = parseObj(obj);
    expect(o.v).toHaveLength(12);
    expect(o.vt).toHaveLength(8);
    expect(o.groups.get("body")).toEqual([[{ v: 0, vt: 0 }, { v: 1, vt: 1 }, { v: 2, vt: 2 }, { v: 3, vt: 3 }]]);
    expect(o.groups.get("helper")![0]![2]).toEqual({ v: 2, vt: 2 });
    expect(o.groups.get("helper")![1]![0]).toEqual({ v: 0, vt: -1 }); // v//vn has no uv
  });
  it("rejects negative indices and degenerate faces", () => {
    expect(() => parseObj("v 0 0 0\nf -1 -1 -1")).toThrow(/unsupported/);
    expect(() => parseObj("v 0 0 0\nf 1 2")).toThrow(/fewer than 3/);
  });
});

describe("parseTarget", () => {
  it("skips comments, sorts by vertex and flattens deltas", () => {
    const t = parseTarget("# hi\n5 .1 0 -.2\n2 0 1 0\n\n", "x");
    expect(t.indices).toEqual([2, 5]);
    expect(t.deltas).toEqual([0, 1, 0, 0.1, 0, -0.2]);
  });
  it("rejects malformed lines and duplicate vertices", () => {
    expect(() => parseTarget("3 1 2", "x")).toThrow(/bad target line/);
    expect(() => parseTarget("3 1 2 x", "x")).toThrow(/bad target line/);
    expect(() => parseTarget("3 1 2 3\n3 0 0 0", "x")).toThrow(/duplicate/);
  });
});
