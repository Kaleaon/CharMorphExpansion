import {
  BACKGROUND_PRESETS, LIGHTING_PRESETS, SkeletonView, Viewport,
} from "@charmorph/render";
import { createSlSkeleton, type Skeleton, type Vec3 } from "@charmorph/skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group } from "three";
import { ShapePanel } from "./shape/ShapePanel.tsx";
import { useCharacter } from "./shape/useCharacter.ts";

declare global {
  interface Window { __viewport?: Viewport; __skeleton?: Skeleton }
}

const AXES = ["X", "Y", "Z"] as const;
type Tab = "shape" | "skeleton" | "scene";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const contentRef = useRef<Group>(new Group());
  const viewRef = useRef<SkeletonView | null>(null);
  const skel = useMemo(() => createSlSkeleton(), []);
  const poses = useRef(new Map<string, Vec3>());
  const ch = useCharacter();

  const [tab, setTab] = useState<Tab>("shape");
  const [lighting, setLighting] = useState("studio-3point");
  const [background, setBackground] = useState("studio-grey");
  const [turntable, setTurntable] = useState(false);
  const [showSkel, setShowSkel] = useState(false);
  const [showBento, setShowBento] = useState(true);
  const [showCv, setShowCv] = useState(false);
  const [joint, setJoint] = useState("mShoulderLeft");
  const [, bump] = useState(0);
  const [hud, setHud] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    window.__skeleton = skel;
    const view = new SkeletonView(skel);
    view.visible = false;
    viewRef.current = view;
    contentRef.current.add(view);
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
      view.dispose();
      vp.dispose();
      vpRef.current = null;
      window.__viewport = undefined;
      window.__skeleton = undefined;
    };
  }, [skel]);

  // Add the body once it has loaded, and frame the camera on it.
  const body = ch.view;
  useEffect(() => {
    if (!body || !vpRef.current) return;
    contentRef.current.add(body);
    vpRef.current.frame();
    return () => { contentRef.current.remove(body); };
  }, [body]);

  useEffect(() => { vpRef.current?.setLighting(lighting); }, [lighting]);
  useEffect(() => { vpRef.current?.setBackground(background); }, [background]);
  useEffect(() => { vpRef.current?.setTurntable(turntable); }, [turntable]);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.visible = showSkel;
    v.setOptions({ showExtended: showBento, showCollisionVolumes: showCv });
    vpRef.current?.invalidate();
  }, [showSkel, showBento, showCv]);
  useEffect(() => { viewRef.current?.select(joint); vpRef.current?.invalidate(); }, [joint]);

  const euler = poses.current.get(joint) ?? [0, 0, 0];
  const setAxis = (axis: number, value: number) => {
    const e: Vec3 = [...euler] as Vec3;
    e[axis] = value;
    poses.current.set(joint, e);
    skel.setPoseEuler(joint, e);
    skel.update();
    viewRef.current?.sync();
    vpRef.current?.invalidate();
    bump((n) => n + 1);
  };
  const resetPose = () => {
    poses.current.clear();
    skel.resetPose();
    skel.update();
    viewRef.current?.sync();
    vpRef.current?.invalidate();
    bump((n) => n + 1);
  };

  return (
    <div className="app">
      <div className="stage">
        <canvas ref={canvasRef} aria-label="3D preview" />
        <div className="hud">{error ?? hud}</div>
      </div>
      <aside className="side">
        <div className="tabs" role="tablist">
          {(["shape", "skeleton", "scene"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "shape" ? "Shape" : t === "skeleton" ? "Skeleton" : "Scene"}
            </button>
          ))}
        </div>
        <div className="tab-body">
          {tab === "shape" && <ShapePanel ch={ch} />}
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
          {tab === "skeleton" && (
            <div className="grid">
              <p className="note">SL skeleton: {skel.count} joints · {skel.cvCount} collision volumes. It is not fitted to the MakeHuman body yet (milestone M5).</p>
              <label className="check"><input type="checkbox" checked={showSkel} onChange={(e) => setShowSkel(e.target.checked)} /> Show skeleton</label>
              <label className="check"><input type="checkbox" checked={showBento} onChange={(e) => setShowBento(e.target.checked)} /> Bento bones</label>
              <label className="check"><input type="checkbox" checked={showCv} onChange={(e) => setShowCv(e.target.checked)} /> Collision volumes</label>
              <label>Joint
                <select value={joint} onChange={(e) => setJoint(e.target.value)}>
                  {skel.names.map((n) => <option key={n} value={n}>{n}</option>)}
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
        </div>
      </aside>
    </div>
  );
}
