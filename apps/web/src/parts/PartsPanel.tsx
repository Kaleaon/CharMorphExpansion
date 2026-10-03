import { categoryOf, type PartManifest, type PartsController } from "@charmorph/parts";
import { useMemo, useState } from "react";

interface Props {
  parts: PartsController;
  /** Wear a part: loads its pack and sliders first, so it can fail. */
  onEquip: (id: string) => Promise<void>;
  onUnequip: (category: string) => void;
  onClear: () => void;
  problems?: string[];
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function PartCard({ part, worn, busy, onToggle }: { part: PartManifest; worn: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <li className={`part-card${worn ? " on" : ""}`} data-part={part.id}>
      <div className="part-info">
        <strong>{part.label}</strong>
        <div className="part-tags">
          {part.species.map((s) => <span key={s} className="tag">{s}</span>)}
          <span className="tag muted">{part.attach === "bone" ? "rigid" : "soft"} · {part.socket.bone}</span>
        </div>
      </div>
      <button type="button" aria-pressed={worn} aria-label={`${worn ? "Remove" : "Wear"} ${part.label}`} disabled={busy} onClick={onToggle}>{busy ? "Loading…" : worn ? "Remove" : "Wear"}</button>
    </li>
  );
}

export function PartsPanel({ parts, onEquip, onUnequip, onClear, problems = [] }: Props) {
  const { catalog } = parts;
  const [query, setQuery] = useState("");
  const [species, setSpecies] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const tags = useMemo(() => catalog.speciesTags(), [catalog]);

  const toggleSpecies = (s: string) => setSpecies((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const toggle = async (p: PartManifest) => {
    setFailure("");
    if (parts.isWorn(p.id)) { onUnequip(categoryOf(p.id)); return; }
    setBusy(p.id);
    try { await onEquip(p.id); }
    catch (e) { setFailure(`Could not wear ${p.label}: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  const shown = catalog.search(query, catalog.find({ species: [...species] }));
  const byCategory = new Map<string, PartManifest[]>();
  for (const p of shown) {
    const c = categoryOf(p.id);
    if (!byCategory.has(c)) byCategory.set(c, []);
    byCategory.get(c)!.push(p);
  }

  return (
    <div className="parts">
      {problems.map((p) => <p key={p} className="note error" role="alert">{p}</p>)}
      {failure && <p className="note error" role="alert">{failure}</p>}
      {catalog.all.length === 0 ? (
        <p className="note">No part packs are installed yet. Parts (tails, ears, horns, wings…) appear here once a pack with a <code>parts.json</code> is added under <code>assets/</code>.</p>
      ) : (
        <>
          <div className="row-actions">
            <input className="filter" type="search" placeholder="Find a part…" aria-label="Find a part" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" disabled={parts.worn.length === 0} onClick={onClear}>Remove all</button>
          </div>
          {tags.length > 1 && (
            <div className="chips" role="group" aria-label="Filter by species">
              {tags.map((s) => <button key={s} type="button" className={`chip${species.has(s) ? " on" : ""}`} aria-pressed={species.has(s)} onClick={() => toggleSpecies(s)}>{s}</button>)}
            </div>
          )}
          {parts.worn.length > 0 && (
            <p className="note" role="status">
              Wearing: {parts.selection.parts.map((p) => p.label).join(", ")}
              {parts.worn.some((id) => parts.catalog.sliderIds(id).length > 0) ? " — their sliders are in the Shape tab." : ""}
            </p>
          )}
          {shown.length === 0 && <p className="note">No part matches. Try clearing the search or species filter.</p>}
          {[...byCategory].map(([cat, list]) => (
            <section key={cat} data-category={cat}>
              <h3>{title(cat)} <span className="count">{list.length}</span></h3>
              <ul className="part-list">
                {list.map((p) => <PartCard key={p.id} part={p} worn={parts.isWorn(p.id)} busy={busy === p.id} onToggle={() => void toggle(p)} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
