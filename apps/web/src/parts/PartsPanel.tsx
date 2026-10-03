import { categoryOf, type PartCatalog, type PartManifest, type PartSelection } from "@charmorph/parts";
import { useMemo, useState } from "react";

interface Props {
  catalog: PartCatalog;
  selection: PartSelection;
  /** Bump this when the selection changes so the panel re-renders. */
  onChange: () => void;
  problems?: string[];
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function PartCard({ part, worn, onToggle }: { part: PartManifest; worn: boolean; onToggle: () => void }) {
  return (
    <li className={`part-card${worn ? " on" : ""}`} data-part={part.id}>
      <div className="part-info">
        <strong>{part.label}</strong>
        <div className="part-tags">
          {part.species.map((s) => <span key={s} className="tag">{s}</span>)}
          <span className="tag muted">{part.attach === "bone" ? "rigid" : "soft"} · {part.socket.bone}</span>
        </div>
      </div>
      <button type="button" aria-pressed={worn} aria-label={`${worn ? "Remove" : "Wear"} ${part.label}`} onClick={onToggle}>{worn ? "Remove" : "Wear"}</button>
    </li>
  );
}

export function PartsPanel({ catalog, selection, onChange, problems = [] }: Props) {
  const [query, setQuery] = useState("");
  const [species, setSpecies] = useState<Set<string>>(new Set());
  const tags = useMemo(() => catalog.speciesTags(), [catalog]);

  const toggleSpecies = (s: string) => setSpecies((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const toggle = (p: PartManifest) => { if (selection.has(p.id)) selection.unequip(categoryOf(p.id)); else selection.equip(p.id); onChange(); };

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
      {catalog.all.length === 0 ? (
        <p className="note">No part packs are installed yet. Parts (tails, ears, horns, wings…) appear here once a pack with a <code>parts.json</code> is added under <code>assets/</code>.</p>
      ) : (
        <>
          <div className="row-actions">
            <input className="filter" type="search" placeholder="Find a part…" aria-label="Find a part" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" disabled={selection.parts.length === 0} onClick={() => { selection.clear(); onChange(); }}>Remove all</button>
          </div>
          {tags.length > 1 && (
            <div className="chips" role="group" aria-label="Filter by species">
              {tags.map((s) => <button key={s} type="button" className={`chip${species.has(s) ? " on" : ""}`} aria-pressed={species.has(s)} onClick={() => toggleSpecies(s)}>{s}</button>)}
            </div>
          )}
          {selection.parts.length > 0 && <p className="note" role="status">Wearing: {selection.parts.map((p) => p.label).join(", ")}</p>}
          {shown.length === 0 && <p className="note">No part matches. Try clearing the search or species filter.</p>}
          {[...byCategory].map(([cat, parts]) => (
            <section key={cat} data-category={cat}>
              <h3>{title(cat)} <span className="count">{parts.length}</span></h3>
              <ul className="part-list">
                {parts.map((p) => <PartCard key={p.id} part={p} worn={selection.has(p.id)} onToggle={() => toggle(p)} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
