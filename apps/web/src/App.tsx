import {
  BACKGROUND_PRESETS, createTestMannequin, LIGHTING_PRESETS, SkeletonView, Viewport,
} from "@charmorph/render";
import { createSlSkeleton, type Skeleton, type Vec3 } from "@charmorph/skeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group } from "three";

declare global {
  interface Window { __viewport?: Viewport; __skeleton?: Skeleton }
}

const AXES = ["X", "Y", "Z"] as const;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const mannequinRef = useRef<Group | null>(null);
  const viewRef = useRef<SkeletonView | null>(null);
  const skel = useMemo(() => createSlSkeleton(), []);
  const poses = useRef(new Map<string, Vec3>());

  const [lighting, setLighting] = useState("studio-3point");
  const [background, setBackground] = useState("studio-grey");
  const [turntable, setTurntable] = useState(false);
  const [showMesh, setShowMesh] = useState(false);
  const [showSkel, setShowSkel] = useState(true);
  const [showBento, setShowBento] = useState(true);
  const [showCv, setShowCv] = useState(false);
  const [joint, setJoint] = useState("mShoulderLeft");
  const [, bump] = useState(0);
  const [fps, setFps] = useState(0);
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
    const content = new Group();
    const mannequin = createTestMannequin();
    const view = new SkeletonView(skel);
    mannequinRef.current = mannequin;
    viewRef.current = view;
    content.add(mannequin, view);
    mannequin.visible = false;
    vp.setContent(content);
    const timer = setInterval(() => setFps(Math.round(vp.fps)), 500);
    return () => {
      clearInterval(timer);
      view.dispose();
      vp.dispose();
      vpRef.current = null;
      window.__viewport = undefined;
      window.__skeleton = undefined;
    };
  }, [skel]);

  useEffect(() => { vpRef.current?.setLighting(lighting); }, [lighting]);
  useEffect(() => { vpRef.current?.setBackground(background); }, [background]);
  useEffect(() => { vpRef.current?.setTurntable(turntable); }, [turntable]);
  useEffect(() => { if (mannequinRef.current) mannequinRef.current.visible = showMesh; vpRef.current?.invalidate(); }, [showMesh]);
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
        <div className="hud">
          {error ?? (turntable ? `${fps} fps` : `SL skeleton: ${skel.count} joints · ${skel.cvCount} collision volumes · drag to orbit`)}
        </div>
      </div>
      <div className="panel">
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
      <div className="panel">
        <label className="check"><input type="checkbox" checked={showSkel} onChange={(e) => setShowSkel(e.target.checked)} /> Skeleton</label>
        <label className="check"><input type="checkbox" checked={showBento} onChange={(e) => setShowBento(e.target.checked)} /> Bento bones</label>
        <label className="check"><input type="checkbox" checked={showCv} onChange={(e) => setShowCv(e.target.checked)} /> Collision volumes</label>
        <label className="check"><input type="checkbox" checked={showMesh} onChange={(e) => setShowMesh(e.target.checked)} /> Test mesh</label>
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
    </div>
  );
}
