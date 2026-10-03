import {
  BACKGROUND_PRESETS, createTestMannequin, LIGHTING_PRESETS, Viewport,
} from "@charmorph/render";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { __viewport?: Viewport }
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRef = useRef<Viewport | null>(null);
  const [lighting, setLighting] = useState("studio-3point");
  const [background, setBackground] = useState("studio-grey");
  const [turntable, setTurntable] = useState(false);
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
    vp.setContent(createTestMannequin());
    const timer = setInterval(() => setFps(Math.round(vp.fps)), 500);
    return () => {
      clearInterval(timer);
      vp.dispose();
      vpRef.current = null;
      window.__viewport = undefined;
    };
  }, []);

  useEffect(() => { vpRef.current?.setLighting(lighting); }, [lighting]);
  useEffect(() => { vpRef.current?.setBackground(background); }, [background]);
  useEffect(() => { vpRef.current?.setTurntable(turntable); }, [turntable]);

  return (
    <div className="app">
      <div className="stage">
        <canvas ref={canvasRef} aria-label="3D preview" />
        <div className="hud">{error ?? (turntable ? `${fps} fps` : "drag to orbit · scroll/pinch to zoom · right-drag to pan")}</div>
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
    </div>
  );
}
