import { describe, expect, it } from "vitest";
import { generateSliders, humanize, type RawGroup } from "./modifiers.ts";

const raw: RawGroup[] = [
  { group: "nose", modifiers: [
    { target: "nose-scale-horiz", min: "decr", max: "incr" },
    { target: "nose-trans", min: "in", max: "out" },
    { target: "nose-trans", min: "down", max: "up" },
    { target: "nose-flaring-decr|incr" } as never,
    { target: "nose-hump" },
  ] },
  { group: "eyes", modifiers: [
    { target: "r-eye-bag", min: "decr", max: "incr" },
    { target: "l-eye-bag", min: "decr", max: "incr" },
    { target: "l-eye-only", min: "decr", max: "incr" },
  ] },
  { group: "macrodetails", modifiers: [{ macrovar: "Gender" }] },
  { group: "ears", modifiers: [{ target: "ears-taken", min: "decr", max: "incr" }] },
];
const gen = (over: Partial<Parameters<typeof generateSliders>[1]> = {}) =>
  generateSliders(raw, { groups: ["nose", "eyes", "macrodetails"], section: (g) => g[0]!.toUpperCase() + g.slice(1), exclude: new Set(), ...over });

describe("humanize", () => {
  it("translates axis words and drops the repeated group word", () => {
    expect(humanize("nose-scale-horiz", "nose")).toBe("Scale width");
    expect(humanize("head-scale-vert", "head")).toBe("Scale height");
    expect(humanize("nose-trans", "nose", "down", "up")).toBe("Nose position up/down");
    expect(humanize("eye-bag", "eyes")).toBe("Eye bag");
    expect(humanize("nose", "nose")).toBe("Nose");
    expect(humanize("head-scale-depth", "head")).toBe("Scale depth");
  });
});

describe("generateSliders", () => {
  it("builds bipolar sliders with decr/incr targets and skips macro variables and unlisted groups", () => {
    const { sliders, refs } = gen();
    const w = sliders.find((s) => s.id === "nose-scale-horiz")!;
    expect(w).toMatchObject({ min: -1, max: 1, group: "Nose", label: "Scale width", bindings: [{ neg: "nose-scale-horiz-decr", pos: "nose-scale-horiz-incr" }] });
    expect(sliders.some((s) => s.group === "Ears" || s.group === "Macrodetails")).toBe(false);
    expect(refs.find((r) => r.id === "nose-scale-horiz-incr")).toEqual({ id: "nose-scale-horiz-incr", file: "nose/nose-scale-horiz-incr.target" });
  });
  it("gives unipolar sliders for modifiers without min/max", () => {
    const hump = gen().sliders.find((s) => s.id === "nose-hump")!;
    expect(hump).toMatchObject({ min: 0, bindings: [{ pos: "nose-hump" }] });
    expect(hump.bindings[0]).not.toHaveProperty("neg");
  });
  it("disambiguates the same target used with different axes", () => {
    const ids = gen().sliders.filter((s) => s.id.startsWith("nose-trans")).map((s) => s.id);
    expect(ids).toEqual(["nose-trans", "nose-trans-down-up"]);
  });
  it("merges left/right pairs into one slider with two bindings; a lone side keeps its prefix", () => {
    const { sliders } = gen();
    const bag = sliders.find((s) => s.id === "eye-bag")!;
    expect(bag.bindings).toHaveLength(2);
    expect(bag.label).toBe("Eye bag");
    const lone = sliders.find((s) => s.id === "l-eye-only")!;
    expect(lone.label).toBe("Left eye only");
    expect(lone.bindings).toHaveLength(1);
  });
  it("tells same-labelled sliders apart by axis", () => {
    const { sliders } = generateSliders([{ group: "stomach", modifiers: [{ target: "stomach-navel", min: "in", max: "out" }, { target: "stomach-navel", min: "down", max: "up" }] }],
      { groups: ["stomach"], section: () => "Stomach", exclude: new Set() });
    expect(sliders.map((x) => x.label)).toEqual(["Stomach navel (in/out)", "Stomach navel (up/down)"]);
  });
  it("keeps the bare label for the decr/incr axis when another axis shares the name", () => {
    const { sliders } = generateSliders([{ group: "eyes", modifiers: [{ target: "eye-bag", min: "decr", max: "incr" }, { target: "eye-bag", min: "in", max: "out" }] }],
      { groups: ["eyes"], section: () => "Eyes", exclude: new Set() });
    expect(sliders.map((x) => x.label)).toEqual(["Eye bag", "Eye bag (in/out)"]);
  });
  it("skips modifiers whose targets are already bound elsewhere, and has unique ids", () => {
    const { sliders } = gen({ exclude: new Set(["nose-scale-horiz-incr"]) });
    expect(sliders.some((s) => s.id === "nose-scale-horiz")).toBe(false);
    const all = gen().sliders.map((s) => s.id);
    expect(new Set(all).size).toBe(all.length);
  });
});
