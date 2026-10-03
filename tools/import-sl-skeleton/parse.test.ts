import { describe, expect, it } from "vitest";
import { parseSkeletonXml } from "./parse.ts";

const fixture = `<?xml version="1.0"?>
<linden_skeleton num_bones="3" num_collision_volumes="1" version="2.0">
  <bone aliases="hip a_root" connected="false" end="0 0 .1" group="Torso" name="mRoot" pivot="0 0 1" pos="0 0 1" rot="0 0 0" scale="1 1 1" support="base">
    <collision_volume end="0 0 0" group="Collision" name="CV1" pos="0 0 -.1" rot="0 8 0" scale=".1 .2 .3" support="base"/>
    <bone connected="true" end="0 0 .1" group="Spine" name="mChild" pivot="0 0 .1" pos="0 0 .1" rot="0 0 0" scale="1 1 1" support="extended">
      <bone connected="true" end="0 0 .1" group="Spine" name="mGrand" pivot="0 0 .1" pos="0 0 .1" rot="0 0 0" scale="1 1 1" support="extended"/>
    </bone>
  </bone>
</linden_skeleton>`;

describe("parseSkeletonXml", () => {
  it("flattens bones parent-first and attaches collision volumes to their bone", () => {
    const r = parseSkeletonXml(fixture);
    expect(r.joints.map((j) => [j.name, j.parent])).toEqual([["mRoot", null], ["mChild", "mRoot"], ["mGrand", "mChild"]]);
    expect(r.joints[0]!.aliases).toEqual(["hip", "a_root"]);
    expect(r.joints[1]!.support).toBe("extended");
    expect(r.joints[1]!.connected).toBe(true);
    expect(r.collisionVolumes[0]).toMatchObject({ name: "CV1", parent: "mRoot", rot: [0, 8, 0], scale: [0.1, 0.2, 0.3] });
    expect(r.declared).toEqual({ bones: 3, collisionVolumes: 1 });
  });
  it("rejects malformed vectors and unknown support values", () => {
    expect(() => parseSkeletonXml(fixture.replace('pos="0 0 1"', 'pos="0 0"'))).toThrow(/bad vec3/);
    expect(() => parseSkeletonXml(fixture.replace('support="base">', 'support="weird">'))).toThrow(/bad support/);
  });
  it("rejects a document without the skeleton root", () => {
    expect(() => parseSkeletonXml("<foo/>")).toThrow(/linden_skeleton/);
  });
});
