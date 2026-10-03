import { CharacterModel } from "@charmorph/core";
import { describe, expect, it } from "vitest";
import { PartCatalog, PartError, PartSelection, categoryOf, partsFragment, validateParts, type PartManifest } from "../src/index.ts";

const part = (over: Partial<PartManifest> = {}): PartManifest => ({
  id: "tail.canine", label: "Canine tail", pack: "parts-canine", species: ["canine"],
  socket: { bone: "mTail1", offset: [0, 0, 0] }, attach: "bone", meshes: ["tail.glb"], ...over,
});
const joints = new Set(["mTail1", "mHead"]);

describe("validateParts", () => {
  it("accepts a good part", () => expect(validateParts([part()], joints)).toEqual([]));
  it("flags the usual mistakes", () => {
    const msgs = validateParts([
      part({ id: "BadId", species: [], meshes: ["../x.glb"], attach: "glue" as never, socket: { bone: "mNope", offset: [0, 0] as never } }),
      part(), part(),
    ], joints).join("|");
    for (const s of ["category.name", "species tag", "must be relative", "attach must", "not in the skeleton", "3 finite", "duplicate part id"]) expect(msgs).toContain(s);
  });
  it("rejects a slider id shared by two parts", () => {
    const slider = { id: "tail.length", label: "Length", group: "Tail", min: 0 as const, max: 1 as const, default: 0, bindings: [{ pos: "tl" }] };
    expect(validateParts([part({ sliders: [slider] }), part({ id: "tail.feline", sliders: [slider] })]).join()).toContain("more than one part");
  });
});

describe("PartCatalog", () => {
  const cat = new PartCatalog([
    part({ sliders: [{ id: "tail.length", label: "Length", group: "Tail", min: 0, max: 1, default: 0, bindings: [{ pos: "tl" }] }], morphTargets: ["tl"] }),
    part({ id: "tail.feline", label: "Feline tail", species: ["feline"], pack: "parts-feline" }),
    part({ id: "ears.feline_flop", label: "Floppy ear", species: ["feline"], pack: "parts-feline", attach: "surface", socket: { bone: "mHead", offset: [0, 0.1, 0] } }),
  ], joints);

  it("filters by category, species and pack", () => {
    expect(cat.categories()).toEqual(["ears", "tail"]);
    expect(cat.find({ category: "tail" }).map((p) => p.id)).toEqual(["tail.canine", "tail.feline"]);
    expect(cat.find({ species: ["feline"] }).map((p) => p.id)).toEqual(["tail.feline", "ears.feline_flop"]);
    expect(cat.find({ pack: "parts-canine", species: ["feline"] })).toEqual([]);
  });
  it("searches label, id and species, all words required", () => {
    expect(cat.speciesTags()).toEqual(["canine", "feline"]);
    expect(cat.search("").length).toBe(3);
    expect(cat.search("FLOPPY").map((p) => p.id)).toEqual(["ears.feline_flop"]);
    expect(cat.search("feline tail").map((p) => p.id)).toEqual(["tail.feline"]);
    expect(cat.search("tail", cat.find({ species: ["canine"] })).map((p) => p.id)).toEqual(["tail.canine"]);
    expect(cat.search("zebra")).toEqual([]);
  });
  it("builds a spec fragment that extends a model", () => {
    expect(cat.fragment("parts-feline")).toBeUndefined();
    const frag = cat.fragment("parts-canine")!;
    const m = new CharacterModel({ variables: [], macros: [], sliders: [{ id: "x", label: "x", group: "g", min: 0, max: 1, default: 0, bindings: [{ pos: "a" }] }] }, new Set(["a"]));
    m.extend(frag, cat.targets("parts-canine"));
    m.set("tail.length", 0.5);
    expect(m.weights().get("tl")).toBeCloseTo(0.5);
    expect(m.packOf("tail.length")).toBe("parts-canine");
  });
  it("maps sliders to parts and reads a pack fragment from parts.json", () => {
    expect(cat.sliderIds("tail.canine")).toEqual(["tail.length"]);
    expect(cat.sliderIds("tail.feline")).toEqual([]);
    expect(cat.partOfSlider("tail.length")?.id).toBe("tail.canine");
    expect(cat.partOfSlider("nope")).toBeUndefined();
    const file = { format: "cm-parts/1", parts: cat.all };
    expect(partsFragment(file, "parts-canine").sliders?.map((s) => s.id)).toEqual(["tail.length"]);
    expect(partsFragment(file, "parts-feline")).toEqual({ pack: "parts-feline" });
    expect(() => partsFragment({ format: "x" }, "p")).toThrow(PartError);
  });
  it("parses cm-parts/1 and rejects other documents", () => {
    expect(PartCatalog.parse({ format: "cm-parts/1", parts: [part()] }, joints).all).toHaveLength(1);
    expect(() => PartCatalog.parse({ format: "nope" })).toThrow(PartError);
    expect(() => new PartCatalog([part({ socket: { bone: "mNope", offset: [0, 0, 0] } })], joints)).toThrow(/skeleton/);
  });
});

describe("PartSelection", () => {
  const cat = new PartCatalog([part(), part({ id: "tail.feline", species: ["feline"] }), part({ id: "ears.prick", label: "Prick", attach: "surface" })]);
  it("replaces within a category, saves and restores", () => {
    const sel = new PartSelection(cat);
    sel.equip("tail.canine"); sel.equip("ears.prick"); sel.equip("tail.feline");
    expect(sel.toJSON()).toEqual(["ears.prick", "tail.feline"]);
    expect(sel.has("tail.canine")).toBe(false);
    expect(() => sel.equip("tail.ghost")).toThrow(PartError);
    sel.unequip("ears");
    expect(sel.parts.map((p) => p.id)).toEqual(["tail.feline"]);
    expect(sel.restore(["tail.canine", "wings.gone"])).toEqual(["wings.gone"]);
    expect(sel.toJSON()).toEqual(["tail.canine"]);
    expect(categoryOf("ears.prick")).toBe("ears");
  });
});
