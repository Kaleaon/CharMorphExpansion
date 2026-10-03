import type { SavedCharacter } from "@charmorph/storage";
import { useCallback, useEffect, useState } from "react";
import type { Character } from "./useCharacter.ts";

interface Props {
  ch: Character;
  /** Small JPEG data URL of the current view. */
  thumbnail: () => string;
}

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LibraryPanel({ ch, thumbnail }: Props) {
  const store = ch.store;
  const [items, setItems] = useState<SavedCharacter[]>([]);
  const [name, setName] = useState("My character");
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => { if (store) setItems(await store.list()); }, [store]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (ch.status !== "ready" || !store || !ch.model) return <p className="note">Loading…</p>;

  const save = async (asNew: boolean) => {
    try {
      const rec = await store.put({
        ...(asNew || !currentId ? {} : { id: currentId }),
        name,
        preset: ch.model!.toPreset(name),
        thumbnail: thumbnail(),
      });
      setCurrentId(rec.id);
      setNote(`Saved “${rec.name}”.`);
      await refresh();
    } catch (e) {
      setNote(`Could not save: ${(e as Error).message}`);
    }
  };
  return (
    <div className="library">
      <p className="note">
        {store.persistent ? "Characters are stored in this browser." : "Storage is unavailable here (private window?). Saves last only until you close the tab — use Export preset to keep them."}
      </p>
      <div className="row-actions">
        <input className="filter" aria-label="Character name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <button type="button" onClick={() => void save(true)}>Save as new</button>
        <button type="button" disabled={!currentId} onClick={() => void save(false)}>Update “{items.find((i) => i.id === currentId)?.name ?? "…"}”</button>
      </div>
      {note && <p className="note" role="status">{note}</p>}
      {items.length === 0 && <p className="note">Nothing saved yet.</p>}
      <ul className="saved">
        {items.map((c) => (
          <li key={c.id} data-id={c.id} className={c.id === currentId ? "on" : ""}>
            {c.thumbnail ? <img src={c.thumbnail} alt="" width={48} height={64} /> : <span className="thumb-empty" />}
            <span className="saved-info"><strong>{c.name}</strong><span className="note">{when(c.updatedAt)}{c.preset.packs?.length ? ` · needs ${c.preset.packs.join(", ")}` : ""}</span></span>
            <button type="button" onClick={async () => {
              try {
                setNote(`Loading “${c.name}”…`);
                const unknown = await ch.loadPreset(JSON.stringify(c.preset));
                setCurrentId(c.id);
                setName(c.name);
                setNote(unknown.length ? `Loaded; ignored ${unknown.length} unknown value(s).` : `Loaded “${c.name}”.`);
              } catch (e) { setNote(`Could not load: ${(e as Error).message}`); }
            }}>Load</button>
            <button type="button" aria-label={`Delete ${c.name}`} onClick={async () => { await store.delete(c.id); if (c.id === currentId) setCurrentId(undefined); await refresh(); }}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
