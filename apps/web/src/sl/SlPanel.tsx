import type { FitResult } from "@charmorph/rig";
import { useState } from "react";
import type { SlController, SlMode } from "./SlController.ts";

interface Props {
  sl: SlController;
  enabled: boolean;
  onEnabled: (on: boolean) => void;
  /** Called after anything that changes the deformation, so the view refreshes. */
  onChange: () => void;
  ready: boolean;
}

const pct = (v: number, min: number, max: number) => ((v - min) / (max - min)) * 100;

export function SlPanel({ sl, enabled, onEnabled, onChange, ready }: Props) {
  const [, bump] = useState(0);
  const [fit, setFit] = useState<FitResult | null>(null);
  const refresh = () => { bump((n) => n + 1); onChange(); };
  const params = sl.sliderParams;

  return (
    <div className="sl">
      <p className="note">
        The body is skinned to the Second Life skeleton. With the SL view on, the character is shown in SL's T-pose and deformed by
        the real SL shape rules (bone scale/offset), the way a rigged mesh would be in-world.
      </p>
      <label className="check"><input type="checkbox" checked={enabled} disabled={!ready} onChange={(e) => onEnabled(e.target.checked)} /> SL view (T-pose, skinned)</label>
      {enabled && (
        <>
          <fieldset className="mode">
            <legend>Skeleton</legend>
            {([["overrides", "Joint overrides (exact fit)"], ["sliders", "SL sliders only"]] as [SlMode, string][]).map(([m, label]) => (
              <label key={m} className="check"><input type="radio" name="slmode" checked={sl.mode === m} onChange={() => { sl.mode = m; refresh(); }} /> {label}</label>
            ))}
          </fieldset>
          <div className="row-actions">
            <button type="button" onClick={() => { const r = sl.fit(); setFit(r); sl.mode = "sliders"; refresh(); }}>Fit SL sliders to this body</button>
            <button type="button" onClick={() => { sl.resetShape(); setFit(null); refresh(); }}>Reset SL sliders</button>
          </div>
          {fit && (
            <p className="note" role="status">
              Best fit with SL sliders alone: average joint error {(fit.rms * 100).toFixed(1)} cm, worst {(fit.max * 100).toFixed(1)} cm
              ({fit.worst[0]?.joint}). Sliders at their limit cannot reach this body — use joint overrides for an exact fit.
            </p>
          )}
          {params.map((p) => {
            const w = sl.shape.get(p.id);
            const atLimit = w <= p.min + 1e-9 || w >= p.max - 1e-9;
            return (
              <label key={p.id} className="slider">
                <span className="slider-head"><span>{p.label ?? p.name}{atLimit && fit ? " ⚠" : ""}</span><output>{pct(w, p.min, p.max).toFixed(0)}%</output></span>
                <input
                  type="range" min={0} max={100} step={1} value={pct(w, p.min, p.max)} aria-label={`SL ${p.label ?? p.name}`}
                  onChange={(e) => { sl.shape.set(p.id, p.min + (Number(e.target.value) / 100) * (p.max - p.min)); refresh(); }}
                  onDoubleClick={() => { sl.shape.set(p.id, p.default); refresh(); }}
                />
              </label>
            );
          })}
          <p className="note">Height as the viewer estimates it: {ready ? `${sl.bodyHeight().toFixed(2)} m` : "–"}</p>
        </>
      )}
    </div>
  );
}
