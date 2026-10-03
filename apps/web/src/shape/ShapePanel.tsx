import type { CharacterModel, MacroVariable, SliderDef } from "@charmorph/core";
import { useRef, useState } from "react";
import type { Character } from "./useCharacter.ts";

interface Row { id: string; label: string; min: number; max: number; step: number }
interface Section { title: string; rows: Row[] }

/** Group sliders and macro variables into panel sections, keeping spec order. */
function sections(model: CharacterModel): Section[] {
  const out = new Map<string, Row[]>();
  const add = (group: string, row: Row) => { if (!out.has(group)) out.set(group, []); out.get(group)!.push(row); };
  for (const v of model.spec.variables as MacroVariable[]) {
    if (v.kind === "scalar") add(v.group, { id: v.id, label: v.label, min: 0, max: 1, step: 0.01 });
    else for (const c of v.components) add(v.group, { id: `${v.id}.${c.name}`, label: c.label, min: 0, max: 1, step: 0.01 });
  }
  for (const s of model.spec.sliders as SliderDef[]) add(s.group, { id: s.id, label: s.label, min: s.min, max: s.max, step: 0.01 });
  return [...out].map(([title, rows]) => ({ title, rows }));
}

export function ShapePanel({ ch }: { ch: Character }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const model = ch.model;
  if (ch.status === "loading") return <p className="note">Loading body…</p>;
  if (ch.status === "error" || !model) return <p className="note error">Could not load the body: {ch.error}</p>;

  const download = () => {
    const blob = new Blob([ch.savePreset("My character")], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "character-preset.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const unknown = ch.loadPreset(await file.text());
      setNote(unknown.length ? `Loaded; ignored ${unknown.length} unknown value(s).` : "Preset loaded.");
    } catch (e) {
      setNote(`Could not load preset: ${(e as Error).message}`);
    }
  };

  return (
    <div className="shape">
      <div className="row-actions">
        <button type="button" onClick={ch.reset}>Reset all</button>
        <button type="button" onClick={download}>Save preset</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Load preset</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {note && <p className="note" role="status">{note}</p>}
      {sections(model).map((sec, i) => (
        <details key={sec.title} open={i === 0}>
          <summary>{sec.title}</summary>
          {sec.rows.map((r) => {
            const v = model.get(r.id);
            return (
              <label key={r.id} className="slider">
                <span className="slider-head"><span>{r.label}</span><output>{v.toFixed(2)}</output></span>
                <input
                  type="range" min={r.min} max={r.max} step={r.step} value={v}
                  aria-label={r.label}
                  onChange={(e) => ch.set(r.id, Number(e.target.value))}
                  onDoubleClick={() => ch.set(r.id, model.getDefault(r.id))}
                />
              </label>
            );
          })}
        </details>
      ))}
    </div>
  );
}
