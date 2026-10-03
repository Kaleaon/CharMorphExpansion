import { exportBodyMesh, type BodyExport } from "@charmorph/export";
import { useState } from "react";
import type { Character } from "../shape/useCharacter.ts";

const kb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function save(bytes: Uint8Array, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ExportPanel({ ch }: { ch: Character }) {
  const [overrides, setOverrides] = useState(true);
  const [lockScale, setLockScale] = useState(true);
  const [lods, setLods] = useState<"copies" | "high">("copies");
  const [pelvis, setPelvis] = useState(0);
  const [result, setResult] = useState<BodyExport | null>(null);
  const [note, setNote] = useState("");

  if (ch.status !== "ready" || !ch.rig || !ch.mesh) return <p className="note">Loading…</p>;

  const run = () => {
    const f = ch.latestFrame();
    if (!f) { setNote("No frame yet — move a slider first."); return; }
    try {
      const out = exportBodyMesh(f, ch.rig!, ch.mesh!, { jointOverrides: overrides, lockScale, lods, pelvisOffset: pelvis });
      setResult(out);
      save(out.bytes, "character.llmesh");
      setNote("");
    } catch (e) {
      setNote(`Could not export: ${(e as Error).message}`);
    }
  };

  return (
    <div className="grid">
      <p className="note">
        Writes the T-posed body as a Second Life rigged mesh asset (<code>.llmesh</code>). Not verified in-world: the file has been
        checked against the viewer's documented decoding and skinning formula, but not uploaded to a grid.
      </p>
      <label className="check"><input type="checkbox" checked={overrides} onChange={(e) => setOverrides(e.target.checked)} /> Include this character's joint positions</label>
      <label className="check"><input type="checkbox" checked={lockScale} disabled={!overrides} onChange={(e) => setLockScale(e.target.checked)} /> Lock scale where a position is defined</label>
      <label>Levels of detail
        <select value={lods} onChange={(e) => setLods(e.target.value as "copies" | "high")}>
          <option value="copies">Four levels (copies of the high level)</option>
          <option value="high">High level only (smaller)</option>
        </select>
      </label>
      <label>Pelvis offset: {pelvis.toFixed(3)} m
        <input type="range" min={-0.2} max={0.2} step={0.001} value={pelvis} disabled={!overrides} onChange={(e) => setPelvis(Number(e.target.value))} />
      </label>
      <button type="button" onClick={run}>Download .llmesh</button>
      {note && <p className="note error" role="alert">{note}</p>}
      {result && (
        <p className="note" role="status">
          {kb(result.bytes.length)} · {result.vertices} vertices · {result.triangles} triangles · {result.joints.length} joints
        </p>
      )}
    </div>
  );
}
