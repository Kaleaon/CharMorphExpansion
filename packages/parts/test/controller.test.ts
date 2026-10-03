import { CharacterModel } from "@charmorph/core";
import { describe, expect, it } from "vitest";
import { PartCatalog, PartsController, type PartManifest, type PartPackLoader } from "../src/index.ts";

const slider = (id: string, target: string) => ({ id, label: id, group: "Parts", min: 0 as const, max: 1 as const, default: 0, bindings: [{ pos: target }] });
const part = (over: Partial<PartManifest>): PartManifest => ({ id: "tail.canine", label: "x", pack: "parts-canine", species: ["canine"], socket: { bone: "mTail1", offset: [0, 0, 0] }, attach: "bone", meshes: ["a.glb"], ...over });
const parts = [
  part({ sliders: [slider("tail.canine_length", "tc-len")], morphTargets: ["tc-len"] }),
  part({ id: "tail.feline", pack: "parts-feline", sliders: [slider("tail.feline_length", "tf-len")], morphTargets: ["tf-len"] }),
  part({ id: "horns.curl", pack: "parts-static" }), // no pack to load
];

function setup() {
  const catalog = new PartCatalog(parts);
  const model = new CharacterModel({ variables: [], macros: [], sliders: [slider("base", "b")] }, new Set(["b"]));
  const loads: string[] = [];
  let fail = false;
  const loader: PartPackLoader = {
    has: (pack) => pack !== "parts-static",
    ensure: async (pack) => {
      if (fail) throw new Error("download failed");
      loads.push(pack);
      if (!model.hasPack(pack)) model.extend(catalog.fragment(pack)!, catalog.targets(pack));
    },
  };
  return { catalog, model, loads, ctl: new PartsController(catalog, model, loader), failNext: () => { fail = true; } };
}

describe("PartsController", () => {
  it("loads the part's pack on equip so its sliders exist and shape the body", async () => {
    const { ctl, model, loads } = setup();
    expect(model.has("tail.canine_length")).toBe(false);
    await ctl.equip("tail.canine");
    expect(loads).toEqual(["parts-canine"]);
    expect(ctl.isWorn("tail.canine")).toBe(true);
    model.set("tail.canine_length", 0.6);
    expect(model.weights().get("tc-len")).toBeCloseTo(0.6);
  });

  it("equips parts without a loadable pack, and rejects unknown ones", async () => {
    const { ctl, loads } = setup();
    await ctl.equip("horns.curl");
    expect(loads).toEqual([]);
    expect(ctl.worn).toEqual(["horns.curl"]);
    await expect(ctl.equip("tail.ghost")).rejects.toThrow(/unknown part/);
  });

  it("leaves the selection untouched when the pack fails to load", async () => {
    const { ctl, failNext } = setup();
    await ctl.equip("horns.curl");
    failNext();
    await expect(ctl.equip("tail.canine")).rejects.toThrow("download failed");
    expect(ctl.worn).toEqual(["horns.curl"]);
  });

  it("resets a part's sliders when it is replaced, removed or cleared", async () => {
    const { ctl, model } = setup();
    await ctl.equip("tail.canine");
    model.set("tail.canine_length", 1);
    await ctl.equip("tail.feline"); // replaces the canine tail
    expect(model.get("tail.canine_length")).toBe(0);
    expect(ctl.sliderVisible("tail.canine_length")).toBe(false);
    expect(ctl.sliderVisible("tail.feline_length")).toBe(true);
    expect(ctl.sliderVisible("base")).toBe(true); // non-part sliders are always shown
    model.set("tail.feline_length", 0.5);
    ctl.unequip("tail");
    expect(model.get("tail.feline_length")).toBe(0);
    await ctl.equip("tail.feline"); model.set("tail.feline_length", 0.5);
    ctl.clear();
    expect(model.get("tail.feline_length")).toBe(0);
    expect(ctl.worn).toEqual([]);
  });

  it("saves the worn parts with the preset and restores them on a fresh character", async () => {
    const a = setup();
    await a.ctl.equip("tail.canine"); await a.ctl.equip("horns.curl");
    a.model.set("tail.canine_length", 0.4); a.model.set("base", 0.9);
    const preset = a.ctl.toPreset("pup");
    expect(preset.parts).toEqual(["horns.curl", "tail.canine"]);
    expect(preset.packs).toEqual(["parts-canine"]); // slider values already bring their pack along
    expect(setup().ctl.toPreset("plain").parts).toBeUndefined();

    const b = setup();
    await b.ctl.preparePreset(preset);
    expect(b.loads).toEqual(["parts-canine"]);
    expect(b.model.applyPreset(preset)).toEqual([]);
    expect(b.ctl.restore(preset)).toEqual([]);
    expect(b.ctl.worn).toEqual(["horns.curl", "tail.canine"]);
    expect(b.model.get("tail.canine_length")).toBeCloseTo(0.4);
    expect(b.model.get("base")).toBeCloseTo(0.9);
  });

  it("restore skips parts missing from the catalog and zeroes sliders of parts not worn", async () => {
    const { ctl, model } = setup();
    await ctl.equip("tail.canine"); await ctl.equip("tail.feline"); // loads both packs
    model.set("tail.canine_length", 0.7);
    const preset = { format: "cm-preset/1" as const, name: "x", values: { tail_ghost: 1 }, parts: ["wings.gone", "tail.feline"] };
    expect(ctl.restore(preset)).toEqual(["wings.gone"]);
    expect(ctl.worn).toEqual(["tail.feline"]);
    expect(model.get("tail.canine_length")).toBe(0);
  });
});
