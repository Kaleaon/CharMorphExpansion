import { describe, expect, it } from "vitest";
import { parseLadXml } from "./parseLad.ts";

const xml = `<?xml version="1.0"?>
<linden_avatar version="2.0">
  <skeleton file_name="avatar_skeleton.xml"/>
  <mesh type="x" lod="0"><param id="9" name="vertex_only" value_min="0" value_max="1"><param_morph/></param></mesh>
  <mesh type="y" lod="1"><param shared="1" id="1" group="0" name="Height" value_min="-2" value_max="2"><param_morph/></param></mesh>
  <driver_parameters>
    <param id="1" group="0" name="Height" label="Height" wearable="shape" value_min="-2" value_max="2" value_default="0.5" sex="female">
      <param_skeleton><bone name="mPelvis" scale="0 0 .1" offset="0 0 .02"/><bone name="mKneeLeft" scale=".5 0 0"/></param_skeleton>
    </param>
    <param id="2" group="0" name="Fat" value_min="0" value_max="1">
      <param_driver><driven id="3"/><driven id="4" min1="0.2" max1="0.4" max2="0.6" min2="0.8"/><driven id="9"/></param_driver>
    </param>
    <param id="3" group="1" name="Belly" value_min="0" value_max="1">
      <param_morph><volume_morph name="BELLY" scale="0.1 .2 .3" pos="0 0 -.05"/></param_morph>
    </param>
    <param id="4" group="1" name="Chest" value_min="-1" value_max="2"><param_morph><volume_morph name="CHEST" scale="1 1 1"/></param_morph></param>
    <param id="11001" group="0" name="Hover" value_min="-2" value_max="2"/>
    <param id="5" group="0" name="Colour_only"><param_color/></param>
    <param id="6" group="0" name="Drives_nothing_useful"><param_driver><driven id="9"/></param_driver></param>
  </driver_parameters>
</linden_avatar>`;

describe("parseLadXml", () => {
  const { params } = parseLadXml(xml);
  const p = (id: number) => params.find((x) => x.id === id)!;
  it("keeps skeleton/volume params and the drivers that reach them; drops the rest", () => {
    expect(params.map((x) => x.id)).toEqual([1, 2, 3, 4, 11001]); // 11001 = Hover, kept on purpose
  });
  it("reads bone scale/offset vectors, ranges, labels and sex", () => {
    expect(p(1)).toMatchObject({ name: "Height", label: "Height", min: -2, max: 2, default: 0.5, group: 0, wearable: "shape", sex: "female" });
    expect(p(1).bones).toEqual([{ name: "mPelvis", scale: [0, 0, 0.1], offset: [0, 0, 0.02] }, { name: "mKneeLeft", scale: [0.5, 0, 0] }]);
  });
  it("defaults value_default to 0 (not the minimum) and clamps explicit defaults into range", () => {
    expect(p(3).default).toBe(0);
    expect(p(4).min).toBe(-1);
    expect(p(4).default).toBe(0);
    expect(parseLadXml(xml.replace('value_default="0.5"', 'value_default="9"')).params[0]!.default).toBe(2);
  });
  it("reads volume morphs", () => {
    expect(p(3).volumes).toEqual([{ name: "BELLY", scale: [0.1, 0.2, 0.3], pos: [0, 0, -0.05] }]);
  });
  it("applies the viewer's driven-entry defaults (min1=min, max1=max, max2=min2=max1) and prunes useless driven entries", () => {
    expect(p(2).driven).toEqual([
      { id: 3, min1: 0, max1: 1, max2: 1, min2: 1 },
      { id: 4, min1: 0.2, max1: 0.4, max2: 0.6, min2: 0.8 },
    ]);
  });
  it("ignores shared back-references to a parameter defined elsewhere", () => {
    expect(params.filter((x) => x.id === 1)).toHaveLength(1);
    expect(p(1).bones).toHaveLength(2);
  });
  it("rejects malformed vectors and duplicate ids", () => {
    expect(() => parseLadXml(xml.replace('scale="0 0 .1"', 'scale="0 0"'))).toThrow(/bad vec3/);
    expect(() => parseLadXml(xml.replace('<param id="3"', '<param id="2"'))).toThrow(/duplicate param id/);
  });
});
