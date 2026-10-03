import type { CharacterModel, MacroVariable, SliderDef } from "@charmorph/core";
import type { PackInfo } from "@charmorph/packs";
import { memo, useMemo, useRef, useState } from "react";
import type { Character } from "./useCharacter.ts";

interface Row { id: string; label: string; min: number; max: number; step: number; readout?: (v: number) => string }
interface Section { title: string; rows: Row[] }

/** Piecewise-linear readout, e.g. age 0..1 → "25 years". */
function readoutFn(unit: string, stops: [number, number][]): (v: number) => string {
  return (v) => {
    let out = stops[stops.length - 1]![1];
    if (v <= stops[0]![0]) out = stops[0]![1];
    else for (let i = 0; i < stops.length - 1; i++) {
      const [a, ya] = stops[i]!, [b, yb] = stops[i + 1]!;
      if (v <= b) { out = ya + ((v - a) / (b - a)) * (yb - ya); break; }
    }
    return `${Math.round(out)} ${unit}`;
  };
}

/** Group sliders and macro variables into panel sections, keeping spec order. */
function sections(model: CharacterModel): Section[] {
  const out = new Map<string, Row[]>();
  const add = (group: string, row: Row) => { if (!out.has(group)) out.set(group, []); out.get(group)!.push(row); };
  for (const v of model.spec.variables as MacroVariable[]) {
    if (v.kind === "scalar") add(v.group, { id: v.id, label: v.label, min: 0, max: 1, step: 0.01, readout: v.readout && readoutFn(v.readout.unit, v.readout.stops) });
    else for (const c of v.components) add(v.group, { id: `${v.id}.${c.name}`, label: c.label, min: 0, max: 1, step: 0.01 });
  }
  for (const s of model.spec.sliders as SliderDef[]) add(s.group, { id: s.id, label: s.label, min: s.min, max: s.max, step: 0.01 });
  return [...out].map(([title, rows]) => ({ title, rows }));
}

interface SliderProps { row: Row; value: number; onChange: (id: string, v: number) => void; onReset: (id: string) => void }

const Slider = memo(function Slider({ row, value, onChange, onReset }: SliderProps) {
  return (
    <label className="slider">
      <span className="slider-head"><span>{row.label}</span><output>{row.readout ? row.readout(value) : value.toFixed(2)}</output></span>
      <input
        type="range" min={row.min} max={row.max} step={row.step} value={value}
        aria-label={row.label}
        onChange={(e) => onChange(row.id, Number(e.target.value))}
        onDoubleClick={() => onReset(row.id)}
      />
    </label>
  );
});

const mb = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

function PackCard({ info, ch }: { info: PackInfo; ch: Character }) {
  const st = ch.packs!.state(info.id);
  if (st.state === "ready") return null;
  return (
    <div className="pack-card" data-pack={info.id}>
      <div>
        <strong>{info.label}</strong>
        <div className="note">{info.description} {info.sliderCount} controls · {mb(info.bytes)} download</div>
        {st.state === "error" && <div className="note error" role="alert">Could not load: {st.error}</div>}
      </div>
      <button type="button" disabled={st.state === "loading"} onClick={() => { void ch.ensurePack(info.id).catch(() => undefined); }}>
        {st.state === "loading" ? "Loading…" : st.state === "error" ? "Retry" : "Download"}
      </button>
    </div>
  );
}

export function ShapePanel({ ch }: { ch: Character }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set(["Body type"]));
  const model = ch.model;
  const secs = useMemo(() => (model ? sections(model) : []), [model, ch.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = ch.set;
  const onReset = useMemo(() => (id: string) => ch.set(id, model!.getDefault(id)), [ch.set, model]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ch.status === "loading") return <p className="note">Loading body…</p>;
  if (ch.status === "error" || !model || !ch.packs) return <p className="note error">Could not load the body: {ch.error}</p>;

  const q = filter.trim().toLowerCase();
  const visible = secs
    .map((s) => ({ ...s, rows: q ? s.rows.filter((r) => r.label.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)) : s.rows }))
    .filter((s) => s.rows.length > 0);

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
      setNote("Loading preset…");
      const unknown = await ch.loadPreset(await file.text());
      setNote(unknown.length ? `Loaded; ignored ${unknown.length} unknown value(s).` : "Preset loaded.");
    } catch (e) {
      setNote(`Could not load preset: ${(e as Error).message}`);
    }
  };
  const toggle = (title: string) => setOpen((o) => { const n = new Set(o); if (n.has(title)) n.delete(title); else n.add(title); return n; });

  return (
    <div className="shape">
      <div className="row-actions">
        <button type="button" onClick={ch.reset}>Reset all</button>
        <button type="button" onClick={download}>Export preset</button>
        <button type="button" onClick={() => fileRef.current?.click()}>Import preset</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {note && <p className="note" role="status">{note}</p>}
      {ch.packs.available.map((p) => <PackCard key={p.id} info={p} ch={ch} />)}
      <input className="filter" type="search" placeholder="Find a slider…" aria-label="Find a slider" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {visible.length === 0 && <p className="note">No slider matches “{filter}”. Face and body details need their packs downloaded first.</p>}
      {visible.map((sec) => {
        const isOpen = q !== "" || open.has(sec.title);
        return (
          <details key={sec.title} open={isOpen} data-section={sec.title}>
            <summary onClick={(e) => { e.preventDefault(); if (!q) toggle(sec.title); }}>{sec.title} <span className="count">{sec.rows.length}</span></summary>
            {isOpen && sec.rows.map((r) => <Slider key={r.id} row={r} value={model.get(r.id)} onChange={onChange} onReset={onReset} />)}
          </details>
        );
      })}
    </div>
  );
}
