import {
  BACKGROUND_PRESETS, LIGHTING_PRESETS, SkeletonView, Viewport,
} from "@charmorph/render";
import type { Skeleton, Vec3 } from "@charmorph/skeleton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group } from "three";
import { LibraryPanel } from "./shape/LibraryPanel.tsx";
import { ExportPanel } from "./export/ExportPanel.tsx";
import { ShapePanel } from "./shape/ShapePanel.tsx";
import { useCharacter } from "./shape/useCharacter.ts";
import { SlController } from "./sl/SlController.ts";
import { SlPanel } from "./sl/SlPanel.tsx";

declare global {
  interface Window { __viewport?: Viewport; __skeleton?: Skeleton; __sl?: SlController }
}

const AXES = ["X", "Y", "Z"] as const;
type Tab = "shape" | "library" | "sl" | "export" | "skeleton" | "scene";
const TAB_LABEL: Record<Tab, string> = { shape: "Shape", library: "Library", sl: "SL", export: "Export", skeleton: "Skeleton", scene: "Scene" };

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const contentRef = useRef<Group>(new Group());
  const skelViewRef = useRef<SkeletonView | null>(null);
  const poses = useRef(new Map<string, Vec3>());
  const ch = useCharacter();

  const [tab, setTab] = useState<Tab>("shape");
  const [lighting, setLighting] = useState("studio-3point");
  const [background, setBackground] = useState("studio-grey");
  const [turntable, setTurntable] = useState(false);
  const [slOn, setSlOn] = useState(false);
  const [showSkel, setShowSkel] = useState(false);
  const [showBento, setShowBento] = useState(true);
  const [showCv, setShowCv] = useState(false);
  const [joint, setJoint] = useState("mShoulderLeft");
  const [, bump] = useState(0);
  const [hud, setHud] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The SL controller exists once the rig has loaded; it owns the skeleton the overlay draws.
  const sl = useMemo(() => (ch.rig && ch.mesh ? new SlController(ch.rig, ch.mesh) : null), [ch.rig, ch.mesh]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let vp: Viewport;
    try {
      vp = new Viewport(canvas);
    } catch (e) {
      setError(`Could not start WebGL: ${(e as Error).message}`);
      return;
    }
    vpRef.current = vp;
    window.__viewport = vp;
    vp.setContent(contentRef.current);
    const onFrame = () => vp.invalidate();
    window.addEventListener("cm-frame", onFrame);
    const timer = setInterval(() => {
      const s = window.__character?.stats();
      setHud(s ? `morph ${s.latencyMs.toFixed(1)} ms · ${Math.round(vp.fps) || "–"} fps` : "");
    }, 500);
    return () => {
      window.removeEventListener("cm-frame", onFrame);
      clearInterval(timer);
      vp.dispose();
      vpRef.current = null;
      window.__viewport = undefined;
    };
  }, []);

  // Skeleton overlay on the controller's skeleton.
  useEffect(() => {
    if (!sl) return;
    const view = new SkeletonView(sl.skeleton);
    view.visible = false;
    skelViewRef.current = view;
    contentRef.current.add(view);
    window.__skeleton = sl.skeleton;
    window.__sl = sl;
    return () => {
      contentRef.current.remove(view);
      view.dispose();
      skelViewRef.current = null;
      window.__skeleton = undefined;
      window.__sl = undefined;
    };
  }, [sl]);

  // Add the body once it has loaded, and frame the camera on it.
  const body = ch.view;
  useEffect(() => {
    if (!body || !vpRef.current) return;
    contentRef.current.add(body);
    vpRef.current.frame();
    return () => { contentRef.current.remove(body); };
  }, [body]);

  /** Push the SL controller's latest deformation to the display. */
  const showSl = useCallback(() => {
    if (!sl || !ch.view || !sl.ready) return;
    const o = sl.update();
    ch.view.applyFrame(o.positions, o.normals);
    contentRef.current.position.y = o.groundShift;
    skelViewRef.current?.sync();
    vpRef.current?.invalidate();
  }, [sl, ch.view]);

  const { setFrameProcessor } = ch;
  useEffect(() => {
    if (!sl) return;
    if (slOn) {
      setFrameProcessor((f) => {
        const o = sl.setFrame(f);
        contentRef.current.position.y = o.groundShift;
        skelViewRef.current?.sync();
        return o;
      });
    } else {
      setFrameProcessor(null);
      contentRef.current.position.y = 0;
      sl.skeleton.setRestPositions({});
      sl.skeleton.setDeltas({});
      sl.skeleton.resetPose();
      poses.current.forEach((e, j) => sl.skeleton.setPoseEuler(j, e));
      sl.skeleton.update();
      skelViewRef.current?.sync();
    }
    vpRef.current?.invalidate();
    // setFrameProcessor identity changes every render; only the toggle and the controller matter here
  }, [slOn, sl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { vpRef.current?.setLighting(lighting); }, [lighting]);
  useEffect(() => { vpRef.current?.setBackground(background); }, [background]);
  useEffect(() => { vpRef.current?.setTurntable(turntable); }, [turntable]);
  useEffect(() => {
    const v = skelViewRef.current;
    if (!v) return;
    v.visible = showSkel;
    v.setOptions({ showExtended: showBento, showCollisionVolumes: showCv });
    vpRef.current?.invalidate();
  }, [showSkel, showBento, showCv, sl]);
  useEffect(() => { skelViewRef.current?.select(joint); vpRef.current?.invalidate(); }, [joint, sl]);

  const euler = poses.current.get(joint) ?? [0, 0, 0];
  const poseChanged = () => {
    if (!sl) return;
    if (slOn) showSl();
    else {
      sl.skeleton.resetPose();
      poses.current.forEach((e, j) => sl.skeleton.setPoseEuler(j, e));
      sl.skeleton.update();
      skelViewRef.current?.sync();
      vpRef.current?.invalidate();
    }
    bump((n) => n + 1);
  };
  const setAxis = (axis: number, value: number) => {
    const e: Vec3 = [...euler] as Vec3;
    e[axis] = value;
    poses.current.set(joint, e);
    sl?.setPose(joint, e);
    poseChanged();
  };
  const resetPose = () => {
    poses.current.clear();
    sl?.resetPose();
    poseChanged();
  };

  return (
    <div className="app">
      <div className="stage">
        <canvas ref={canvasRef} aria-label="3D preview" />
        <div className="hud">{error ?? hud}</div>
      </div>
      <aside className="side">
        <div className="tabs" role="tablist">
          {(["shape", "library", "sl", "export", "skeleton", "scene"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="tab-body">
          {tab === "shape" && (
            <>
              <div className="row-actions" role="group" aria-label="Camera">
                <button type="button" onClick={() => vpRef.current?.frame()}>Body view</button>
                <button type="button" onClick={() => vpRef.current?.focus(0.9, 0.2)}>Face view</button>
              </div>
              <ShapePanel ch={ch} />
            </>
          )}
          {tab === "library" && <LibraryPanel ch={ch} thumbnail={() => vpRef.current?.thumbnail() ?? ""} />}
          {tab === "sl" && (sl
            ? <SlPanel sl={sl} enabled={slOn} onEnabled={setSlOn} onChange={showSl} ready={sl.ready || ch.status === "ready"} />
            : <p className="note">Loading the Second Life rig…</p>)}
          {tab === "export" && <ExportPanel ch={ch} />}
          {tab === "scene" && (
            <div className="grid">
              <label>Lighting
                <select value={lighting} onChange={(e) => setLighting(e.target.value)}>
                  {LIGHTING_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label>Background
                <select value={background} onChange={(e) => setBackground(e.target.value)}>
                  {BACKGROUND_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <label className="check"><input type="checkbox" checked={turntable} onChange={(e) => setTurntable(e.target.checked)} /> Turntable</label>
              <button type="button" onClick={() => vpRef.current?.frame()}>Reset view</button>
            </div>
          )}
          {tab === "skeleton" && sl && (
            <div className="grid">
              <p className="note">
                SL skeleton: {sl.skeleton.count} joints · {sl.skeleton.cvCount} collision volumes.
                {slOn ? " Showing this character's skeleton (joint overrides)." : " Turn on the SL view (SL tab) to fit it to the body."}
              </p>
              <label className="check"><input type="checkbox" checked={showSkel} onChange={(e) => setShowSkel(e.target.checked)} /> Show skeleton</label>
              <label className="check"><input type="checkbox" checked={showBento} onChange={(e) => setShowBento(e.target.checked)} /> Bento bones</label>
              <label className="check"><input type="checkbox" checked={showCv} onChange={(e) => setShowCv(e.target.checked)} /> Collision volumes</label>
              <label>Joint
                <select value={joint} onChange={(e) => setJoint(e.target.value)}>
                  {sl.skeleton.names.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {AXES.map((a, i) => (
                <label key={a}>Rot {a}: {Math.round(euler[i]!)}°
                  <input type="range" min={-90} max={90} step={1} value={euler[i]} onChange={(e) => setAxis(i, Number(e.target.value))} />
                </label>
              ))}
              <button type="button" onClick={resetPose}>Reset pose</button>
            </div>
          )}
          {tab === "skeleton" && !sl && <p className="note">Loading the Second Life rig…</p>}
        </div>
      </aside>
    </div>
  );
}
