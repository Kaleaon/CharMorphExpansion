import type { CharacterSpec, MacroGroup, MacroVariable, SliderDef } from "../../packages/core/src/types.ts";

/** Everything that decides which MakeHuman targets end up in the pack and how sliders drive them. */

export interface TargetRef { id: string; /** path under makehuman/data/targets/ */ file: string }

const T = (dir: string, stem: string): TargetRef => ({ id: stem, file: `${dir}/${stem}.target` });

const GENDERS = ["female", "male"] as const;
const RACES = ["african", "asian", "caucasian"] as const;
const LEVELS = [["min", "minmuscle", "minweight"], ["avg", "averagemuscle", "averageweight"], ["max", "maxmuscle", "maxweight"]] as const;

export const variables: MacroVariable[] = [
  { kind: "scalar", id: "gender", label: "Gender", group: "Body type", default: 0.5, anchors: [{ name: "female", at: 0 }, { name: "male", at: 1 }] },
  { kind: "simplex", id: "ethnicity", label: "Ethnicity", group: "Body type", components: RACES.map((r) => ({ name: r, label: r[0]!.toUpperCase() + r.slice(1), default: 1 / 3 })) },
  { kind: "scalar", id: "muscle", label: "Muscle", group: "Body type", default: 0.5, anchors: LEVELS.map(([n], i) => ({ name: n, at: i / 2 })) },
  { kind: "scalar", id: "weight", label: "Weight", group: "Body type", default: 0.5, anchors: LEVELS.map(([n], i) => ({ name: n, at: i / 2 })) },
];

// Age is fixed at "young" in this pack (child/old targets are large; they arrive with M4's pack-size work).
const raceGender: MacroGroup = {
  id: "race-gender",
  variables: ["gender", "ethnicity"],
  targets: Object.fromEntries(GENDERS.flatMap((g) => RACES.map((r) => [`${g}|${r}`, `${r}-${g}-young`]))),
};
const build: MacroGroup = {
  id: "build",
  variables: ["gender", "muscle", "weight"],
  targets: Object.fromEntries(GENDERS.flatMap((g) => LEVELS.flatMap(([mn, mf]) => LEVELS.map(([wn, , wf]) => [`${g}|${mn}|${wn}`, `universal-${g}-young-${mf}-${wf}`])))),
};

export const macroTargets: TargetRef[] = [
  ...GENDERS.flatMap((g) => RACES.map((r) => T("macrodetails", `${r}-${g}-young`))),
  ...GENDERS.flatMap((g) => LEVELS.flatMap(([, mf]) => LEVELS.map(([, , wf]) => T("macrodetails", `universal-${g}-young-${mf}-${wf}`)))),
];

interface Regional { id: string; label: string; group: string; dir: string; /** target stems; several = bound together (e.g. left+right) */ stems: string[] }
const lr = (stem: string) => [`l-${stem}`, `r-${stem}`];
const regional: Regional[] = [
  { id: "torso-width", label: "Torso width", group: "Torso", dir: "torso", stems: ["torso-scale-horiz"] },
  { id: "torso-height", label: "Torso height", group: "Torso", dir: "torso", stems: ["torso-scale-vert"] },
  { id: "torso-depth", label: "Torso depth", group: "Torso", dir: "torso", stems: ["torso-scale-depth"] },
  { id: "torso-vshape", label: "V-shape", group: "Torso", dir: "torso", stems: ["torso-vshape"] },
  { id: "hip-width", label: "Hip width", group: "Hips", dir: "hip", stems: ["hip-scale-horiz"] },
  { id: "hip-height", label: "Hip height", group: "Hips", dir: "hip", stems: ["hip-scale-vert"] },
  { id: "hip-depth", label: "Hip depth", group: "Hips", dir: "hip", stems: ["hip-scale-depth"] },
  { id: "belly", label: "Belly", group: "Hips", dir: "stomach", stems: ["stomach-pregnant"] },
  { id: "buttocks", label: "Buttocks volume", group: "Hips", dir: "buttocks", stems: ["buttocks-volume"] },
  { id: "head-width", label: "Head width", group: "Head & neck", dir: "head", stems: ["head-scale-horiz"] },
  { id: "head-height", label: "Head height", group: "Head & neck", dir: "head", stems: ["head-scale-vert"] },
  { id: "head-depth", label: "Head depth", group: "Head & neck", dir: "head", stems: ["head-scale-depth"] },
  { id: "neck-length", label: "Neck length", group: "Head & neck", dir: "neck", stems: ["neck-scale-vert"] },
  { id: "neck-width", label: "Neck width", group: "Head & neck", dir: "neck", stems: ["neck-scale-horiz"] },
  { id: "upperarm-length", label: "Upper arm length", group: "Arms", dir: "armslegs", stems: lr("upperarm-scale-vert") },
  { id: "forearm-length", label: "Forearm length", group: "Arms", dir: "armslegs", stems: lr("lowerarm-scale-vert") },
  { id: "upperarm-fat", label: "Upper arm fat", group: "Arms", dir: "armslegs", stems: lr("upperarm-fat") },
  { id: "thigh-length", label: "Thigh length", group: "Legs", dir: "armslegs", stems: lr("upperleg-scale-vert") },
  { id: "shin-length", label: "Shin length", group: "Legs", dir: "armslegs", stems: lr("lowerleg-scale-vert") },
  { id: "thigh-fat", label: "Thigh fat", group: "Legs", dir: "armslegs", stems: lr("upperleg-fat") },
];

export const regionalTargets: TargetRef[] = regional.flatMap((r) => r.stems.flatMap((s) => [T(r.dir, `${s}-decr`), T(r.dir, `${s}-incr`)]));

const sliders: SliderDef[] = regional.map((r) => ({
  id: r.id, label: r.label, group: r.group, min: -1, max: 1, default: 0,
  bindings: r.stems.map((s) => ({ neg: `${s}-decr`, pos: `${s}-incr` })),
}));

export const spec: CharacterSpec = { variables, sliders, macros: [raceGender, build] };
export const allTargets: TargetRef[] = [...macroTargets, ...regionalTargets];

// ---------------------------------------------------------------------------------------------------------------------
// Lazy packs
// ---------------------------------------------------------------------------------------------------------------------

import type { SpecFragment } from "../../packages/core/src/types.ts";

const AGES = ["baby", "child", "young", "old"] as const;
const OTHER_AGES = AGES.filter((a) => a !== "young");

/** Age widens both macro groups with an `age` axis. Anchor positions are ours; the readout is 1 / 25 / 90 years (MakeHuman's documented range). */
const ageVariable: MacroVariable = {
  kind: "scalar", id: "age", label: "Age", group: "Body type", default: 0.5,
  anchors: [{ name: "baby", at: 0 }, { name: "child", at: 0.1875 }, { name: "young", at: 0.5 }, { name: "old", at: 1 }],
  readout: { unit: "years", stops: [[0, 1], [0.5, 25], [1, 90]] },
};

export const agePackFragment: SpecFragment = {
  pack: "age",
  variables: [ageVariable],
  macros: [
    { id: "race-gender", variables: ["gender", "ethnicity", "age"], targets: Object.fromEntries(GENDERS.flatMap((g) => RACES.flatMap((r) => AGES.map((a) => [`${g}|${r}|${a}`, `${r}-${g}-${a}`])))) },
    { id: "build", variables: ["gender", "muscle", "weight", "age"], targets: Object.fromEntries(GENDERS.flatMap((g) => LEVELS.flatMap(([mn, mf]) => LEVELS.flatMap(([wn, , wf]) => AGES.map((a) => [`${g}|${mn}|${wn}|${a}`, `universal-${g}-${a}-${mf}-${wf}`]))))) },
  ],
};

export const ageTargets: TargetRef[] = [
  ...GENDERS.flatMap((g) => RACES.flatMap((r) => OTHER_AGES.map((a) => T("macrodetails", `${r}-${g}-${a}`)))),
  ...GENDERS.flatMap((g) => LEVELS.flatMap(([, mf]) => LEVELS.flatMap(([, , wf]) => OTHER_AGES.map((a) => T("macrodetails", `universal-${g}-${a}-${mf}-${wf}`))))),
];

/** Target ids already bound by the core pack's sliders — packs must not bind them again. */
export const coreTargetIds: Set<string> = new Set(regionalTargets.map((t) => t.id));

const BODY_SECTIONS: Record<string, string> = { torso: "Torso detail", hip: "Hips detail", stomach: "Stomach", buttocks: "Buttocks", pelvis: "Pelvis", breast: "Chest" };
const FACE_SECTIONS: Record<string, string> = { head: "Head shape", forehead: "Forehead", eyebrows: "Eyebrows", eyes: "Eyes", nose: "Nose", mouth: "Mouth", ears: "Ears", chin: "Chin", cheek: "Cheeks", neck: "Neck" };

/** armslegs is one upstream folder; split it by body part for the UI. */
export function armsLegsSection(canonical: string): string {
  if (/hand|finger/.test(canonical)) return "Hands";
  if (/foot|toe/.test(canonical)) return "Feet";
  if (/arm/.test(canonical)) return "Arms detail";
  return "Legs detail";
}

export const facePack = {
  id: "face", label: "Face details", description: "Head shape, forehead, eyebrows, eyes, nose, mouth, ears, chin, cheeks and neck.",
  groups: Object.keys(FACE_SECTIONS), section: (g: string) => FACE_SECTIONS[g]!,
};
export const bodyPack = {
  id: "body", label: "Body details", description: "Fine torso, hip, arm, leg, hand and foot controls.",
  groups: [...Object.keys(BODY_SECTIONS), "armslegs"], section: (g: string, canonical: string) => (g === "armslegs" ? armsLegsSection(canonical) : BODY_SECTIONS[g]!),
};
export const agePackInfo = { id: "age", label: "Age range", description: "Baby, child and old-age body types (adds the Age slider)." };
