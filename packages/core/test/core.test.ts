import { describe, expect, it } from "vitest";
import { CharacterModel, macroWeights, parsePreset, scalarBasis, SpecError, validateSpec, type CharacterSpec, type MacroGroup, type MacroVariable } from "../src/index.ts";

const variables: MacroVariable[] = [
    { kind: "scalar", id: "gender", label: "Gender", group: "Macro", default: 0.5, anchors: [{ name: "female", at: 0 }, { name: "male", at: 1 }] },
    { kind: "simplex", id: "eth", label: "Ethnicity", group: "Macro", components: [{ name: "a", label: "A", default: 1 / 3 }, { name: "b", label: "B", default: 1 / 3 }, { name: "c", label: "C", default: 1 / 3 }] },
    { kind: "scalar", id: "weight", label: "Weight", group: "Macro", default: 0.5, anchors: [{ name: "min", at: 0 }, { name: "avg", at: 0.5 }, { name: "max", at: 1 }] },
];
const macro: MacroGroup = {
  id: "body",
  variables: ["gender", "eth", "weight"],
  targets: {
    "female|a|avg": "fa", "male|a|avg": "ma", "female|b|avg": "fb", "male|b|avg": "mb", "female|c|avg": "fc", "male|c|avg": "mc",
    "female|a|max": "fa-max", "male|a|max": "ma-max",
  },
};
const spec: CharacterSpec = {
  variables,
  macros: [macro],
  sliders: [
    { id: "torso", label: "Torso", group: "Body", min: -1, max: 1, default: 0, bindings: [{ neg: "t-", pos: "t+" }] },
    { id: "arms", label: "Arms", group: "Body", min: -1, max: 1, default: 0, bindings: [{ neg: "l-", pos: "l+" }, { neg: "r-", pos: "r+" }] },
    { id: "bulge", label: "Bulge", group: "Body", min: 0, max: 1, default: 0, bindings: [{ pos: "b" }] },
    { id: "other", label: "Other", group: "Body", min: -1, max: 1, default: 0, bindings: [{ pos: "t+" }] }, // shares a target with torso
  ],
};

describe("scalarBasis", () => {
  const v = variables[2]!;
  if (v.kind !== "scalar") throw new Error();
  it("interpolates between neighbouring anchors and sums to 1", () => {
    const b = scalarBasis(v, 0.25);
    expect(b).toEqual([{ name: "min", w: 0.5 }, { name: "avg", w: 0.5 }]);
  });
  it("hits an anchor exactly and clamps outside the range", () => {
    expect(scalarBasis(v, 0.5)).toEqual([{ name: "avg", w: 1 }]);
    expect(scalarBasis(v, -3)).toEqual([{ name: "min", w: 1 }]);
    expect(scalarBasis(v, 9)).toEqual([{ name: "max", w: 1 }]);
  });
});

describe("macroWeights", () => {
  it("defaults give equal 1/6 weights over the six average targets", () => {
    const w = macroWeights(macro, new Map(variables.map((v) => [v.id, v])), { });
    expect([...w.keys()].sort()).toEqual(["fa", "fb", "fc", "ma", "mb", "mc"]);
    for (const x of w.values()) expect(x).toBeCloseTo(1 / 6, 9);
  });
  it("weights sum to 1 minus the share that lands on combinations with no target", () => {
    const w = macroWeights(macro, new Map(variables.map((v) => [v.id, v])), { gender: 0, weight: 1 }); // female + max weight: only a has a target
    expect(w.get("fa-max")).toBeCloseTo(1 / 3, 9);
    expect(w.size).toBe(1);
  });
  it("blends across axes multilinearly", () => {
    const w = macroWeights(macro, new Map(variables.map((v) => [v.id, v])), { gender: 0.25, "eth.a": 1, "eth.b": 0, "eth.c": 0, weight: 0.5 });
    expect(w.get("fa")).toBeCloseTo(0.75, 9);
    expect(w.get("ma")).toBeCloseTo(0.25, 9);
  });
});

describe("CharacterModel", () => {
  it("starts at defaults and exposes macro + slider ids", () => {
    const m = new CharacterModel(spec);
    expect(m.get("gender")).toBe(0.5);
    expect(m.get("eth.a")).toBeCloseTo(1 / 3);
    expect(m.ids).toEqual(expect.arrayContaining(["torso", "arms", "bulge", "gender", "weight", "eth.b"]));
  });
  it("clamps to range and rejects non-finite / unknown", () => {
    const m = new CharacterModel(spec);
    m.set("torso", 5); expect(m.get("torso")).toBe(1);
    m.set("bulge", -2); expect(m.get("bulge")).toBe(0);
    m.set("gender", 3); expect(m.get("gender")).toBe(1);
    expect(() => m.set("torso", NaN)).toThrow(RangeError);
    expect(() => m.get("nope")).toThrow(SpecError);
  });
  it("maps bipolar values to the right side and drives multiple bindings", () => {
    const m = new CharacterModel(spec);
    m.set("torso", -0.4); m.set("arms", 0.6);
    const w = m.weights();
    expect(w.get("t-")).toBeCloseTo(0.4); expect(w.has("t+")).toBe(false);
    expect(w.get("l+")).toBeCloseTo(0.6); expect(w.get("r+")).toBeCloseTo(0.6);
  });
  it("sums contributions of several sliders onto one target", () => {
    const m = new CharacterModel(spec);
    m.set("torso", 0.5); m.set("other", 0.25);
    expect(m.weights().get("t+")).toBeCloseTo(0.75);
  });
  it("keeps simplex components normalized when one changes", () => {
    const m = new CharacterModel(spec);
    m.set("eth.a", 0.7);
    expect(m.get("eth.a") + m.get("eth.b") + m.get("eth.c")).toBeCloseTo(1, 9);
    expect(m.get("eth.b")).toBeCloseTo(m.get("eth.c"), 9);
    m.set("eth.a", 1);
    expect(m.get("eth.b")).toBeCloseTo(0, 9);
    m.set("eth.b", 0.5); // recovers from a degenerate state
    expect(m.get("eth.a") + m.get("eth.b") + m.get("eth.c")).toBeCloseTo(1, 9);
  });
  it("round-trips presets (only non-defaults stored) and reports unknown ids", () => {
    const m = new CharacterModel(spec);
    m.set("torso", 0.3); m.set("gender", 1);
    const p = m.toPreset("mine");
    expect(Object.keys(p.values).sort()).toEqual(["gender", "torso"]);
    const m2 = new CharacterModel(spec);
    m2.set("bulge", 1);
    expect(m2.applyPreset({ ...p, values: { ...p.values, ghost: 1 } })).toEqual(["ghost"]);
    expect(m2.get("bulge")).toBe(0); // preset application resets first
    expect(m2.get("torso")).toBe(0.3);
    expect(parsePreset(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it("restores simplex components exactly (no drift from sequential renormalization)", () => {
    const m = new CharacterModel(spec);
    m.set("eth.a", 0.6); m.set("eth.b", 0.1);
    const want = [m.get("eth.a"), m.get("eth.b"), m.get("eth.c")];
    const m2 = new CharacterModel(spec);
    m2.applyPreset(JSON.parse(JSON.stringify(m.toPreset("x"))));
    expect([m2.get("eth.a"), m2.get("eth.b"), m2.get("eth.c")]).toEqual(want);
    // hand-written presets are normalized
    m2.applyPreset({ format: "cm-preset/1", name: "h", values: { "eth.a": 2, "eth.b": 2 } });
    expect(m2.get("eth.a") + m2.get("eth.b") + m2.get("eth.c")).toBeCloseTo(1, 12);
  });
  it("rejects malformed presets", () => {
    expect(() => parsePreset({ format: "x" })).toThrow(SpecError);
    expect(() => parsePreset({ format: "cm-preset/1", name: "n", values: { a: "1" } })).toThrow(/finite/);
  });
});

describe("validateSpec", () => {
  it("flags duplicates, bad ranges, empty/unipolar-neg bindings, bad macro keys and unknown targets", () => {
    const bad: CharacterSpec = {
      variables,
      macros: [{ ...macro, targets: { "female|zzz|avg": "x" } }, { id: "g", variables: ["ghost"], targets: {} }],
      sliders: [
        { id: "s", label: "", group: "", min: 0, max: 1, default: 2, bindings: [{ neg: "n" }, {}] },
        { id: "s", label: "", group: "", min: -1, max: 1, default: 0, bindings: [] },
      ],
    };
    const p = validateSpec(bad, new Set(["n"])).join("|");
    expect(p).toContain("duplicate id \"s\"");
    expect(p).toContain("default outside range");
    expect(p).toContain("unipolar slider has a neg");
    expect(p).toContain("empty binding");
    expect(p).toContain("no bindings");
    expect(p).toContain("does not match its variables");
    expect(p).toContain('unknown target "x"');
    expect(p).toContain('unknown variable "ghost"');
    expect(() => new CharacterModel(bad)).toThrow(SpecError);
  });
});


describe("CharacterModel.extend (lazy packs)", () => {
  const ageVar: MacroVariable = {
    kind: "scalar", id: "age", label: "Age", group: "Macro", default: 0.5,
    anchors: [{ name: "child", at: 0 }, { name: "young", at: 0.5 }, { name: "old", at: 1 }],
    readout: { unit: "yrs", stops: [[0, 11], [0.5, 25], [1, 90]] },
  };
  // Core macro keyed without age; the age pack replaces it with an age-aware version.
  const coreMacro: MacroGroup = { id: "m", variables: ["gender"], targets: { female: "f-young", male: "m-young" } };
  const base: CharacterSpec = { variables: [variables[0]!], macros: [coreMacro], sliders: [spec.sliders[0]!] };
  const agePack = {
    pack: "age",
    variables: [ageVar],
    macros: [{ id: "m", variables: ["gender", "age"], targets: { "female|young": "f-young", "male|young": "m-young", "female|old": "f-old", "male|old": "m-old", "female|child": "f-child", "male|child": "m-child" } }],
    sliders: [{ id: "nose", label: "Nose", group: "Face", min: -1 as const, max: 1 as const, default: 0, bindings: [{ neg: "n-", pos: "n+" }] }],
  };

  it("adds sliders, keeps existing values, and leaves default weights unchanged", () => {
    const m = new CharacterModel(base, new Set(["f-young", "m-young", "t-", "t+"]));
    m.set("gender", 0.25); m.set("torso", 0.5);
    const before = m.weights();
    expect(m.has("age")).toBe(false);
    m.extend(agePack, ["f-old", "m-old", "f-child", "m-child", "n-", "n+"]);
    expect(m.hasPack("age")).toBe(true);
    expect(m.packOf("age")).toBe("age");
    expect(m.packOf("nose")).toBe("age");
    expect(m.packOf("gender")).toBe("core");
    expect(m.get("gender")).toBe(0.25);
    expect(m.get("age")).toBe(0.5);
    expect([...m.weights()].sort()).toEqual([...before].sort()); // age at "young" → identical weights
    m.set("age", 1);
    expect(m.weights().get("f-old")).toBeCloseTo(0.75);
    expect(m.weights().get("m-old")).toBeCloseTo(0.25);
    expect(m.weights().has("f-young")).toBe(false);
  });

  it("is atomic: an invalid pack changes nothing and may be retried", () => {
    const m = new CharacterModel(base, new Set(["f-young", "m-young", "t-", "t+"]));
    const broken = { ...agePack, sliders: [{ ...agePack.sliders[0]!, id: "torso" }] }; // duplicate id
    expect(() => m.extend(broken, ["f-old", "m-old", "f-child", "m-child", "n-", "n+"])).toThrow(SpecError);
    expect(m.hasPack("age")).toBe(false);
    expect(m.has("age")).toBe(false);
    expect(() => m.extend(agePack, [])).toThrow(/unknown target/); // targets not supplied
    m.extend(agePack, ["f-old", "m-old", "f-child", "m-child", "n-", "n+"]);
    expect(m.hasPack("age")).toBe(true);
    expect(() => m.extend(agePack, ["x"])).toThrow(/already loaded/);
  });

  it("records the packs a preset needs, and old presets without `packs` still parse", () => {
    const m = new CharacterModel(base, new Set(["f-young", "m-young", "t-", "t+"]));
    m.extend(agePack, ["f-old", "m-old", "f-child", "m-child", "n-", "n+"]);
    expect(m.toPreset("a").packs).toBeUndefined();
    m.set("nose", 0.4); m.set("torso", 0.1);
    const p = m.toPreset("a");
    expect(p.packs).toEqual(["age"]);
    expect(parsePreset(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parsePreset({ ...p, packs: [1] })).toThrow(/packs/);
    expect(parsePreset({ format: "cm-preset/1", name: "legacy", values: { torso: 1 } }).packs).toBeUndefined();
  });
});

describe("material-param channel", () => {
  const slack = (over: object = {}) => ({
    id: "skin.slack_neck", label: "Neck slack", group: "skin", min: -1 as const, max: 1 as const, default: 0, tier: "advanced" as const,
    bindings: [{ neg: "neck-tight", pos: "neck-sag" }],
    material: [{ param: "wrinkleNormalStrength", response: "pos" as const }],
    ...over,
  });
  const mk = (...sliders: ReturnType<typeof slack>[]) => new CharacterModel({ variables: [], macros: [], sliders }, new Set(["neck-tight", "neck-sag", "ear-sag"]));

  it("scales with the positive side only and is empty at default", () => {
    const m = mk(slack());
    expect(m.materialParams()).toEqual({});
    m.set("skin.slack_neck", 0.5);
    expect(m.materialParams()).toEqual({ wrinkleNormalStrength: 0.5 });
    m.set("skin.slack_neck", -0.8); // tight skin flattens wrinkles
    expect(m.materialParams()).toEqual({});
  });
  it("sums contributions across sliders and honors abs/neg/gain", () => {
    const m = mk(slack(), slack({ id: "skin.slack_ears", bindings: [{ pos: "ear-sag" }], material: [{ param: "wrinkleNormalStrength", response: "abs", gain: 0.5 }, { param: "tension", response: "neg" }] }));
    m.set("skin.slack_neck", 0.4); m.set("skin.slack_ears", -0.6);
    const p = m.materialParams();
    expect(p.wrinkleNormalStrength).toBeCloseTo(0.4 + 0.3);
    expect(p.tension).toBeCloseTo(0.6);
  });
  it("allows a material-only slider but rejects bad material bindings", () => {
    expect(validateSpec({ variables: [], macros: [], sliders: [slack({ bindings: [] })] })).toEqual([]);
    expect(validateSpec({ variables: [], macros: [], sliders: [slack({ bindings: [] , material: undefined })] }).join()).toContain("no bindings");
    expect(validateSpec({ variables: [], macros: [], sliders: [slack({ min: 0, bindings: [{ pos: "x" }], material: [{ param: "p", response: "neg" }] })] }).join()).toContain("neg material");
    expect(validateSpec({ variables: [], macros: [], sliders: [slack({ material: [{ param: "", response: "abs" }] })] }).join()).toContain("without a param");
  });
});

describe("preset parts", () => {
  it("round-trips a parts list through parsePreset and rejects a bad one", () => {
    const p = { format: "cm-preset/1" as const, name: "n", values: {}, parts: ["tail.canine", "ears.prick"] };
    expect(parsePreset(JSON.parse(JSON.stringify(p))).parts).toEqual(["tail.canine", "ears.prick"]);
    expect(() => parsePreset({ ...p, parts: [1] })).toThrow(/parts/);
    expect(() => parsePreset({ ...p, parts: "tail" })).toThrow(/parts/);
    expect(parsePreset({ format: "cm-preset/1", name: "old", values: {} }).parts).toBeUndefined();
  });
});
