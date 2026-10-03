import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, Box3, Group, InstancedMesh, Mesh, CircleGeometry, MeshStandardMaterial,
  type Object3D, PCFSoftShadowMap, PerspectiveCamera, PMREMGenerator, Scene, SRGBColorSpace, Sphere, Texture, Vector3, WebGLRenderer,
  ShadowMaterial,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { advanceTurntable, fitDistance, sphericalPosition } from "./framing.ts";
import { type BackgroundPreset, findBackground, findLighting, LIGHTING_PRESETS, type LightingPreset } from "./presets.ts";

export interface ViewportOptions {
  lighting?: string;
  background?: string;
  turntable?: boolean;
  turntableDegPerSec?: number;
  /** Cap device pixel ratio (mobile GPUs). */
  maxPixelRatio?: number;
}

const LIGHT_DISTANCE = 6;

/** World-space bounds of the visible meshes under `root` (unlike Box3.setFromObject, hidden objects are ignored). */
function visibleBounds(root: Object3D | null): Box3 {
  const box = new Box3();
  if (!root) return box;
  root.updateWorldMatrix(true, true);
  const tmp = new Box3();
  root.traverseVisible((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !m.geometry) return;
    const inst = o as InstancedMesh;
    if (inst.isInstancedMesh) { inst.computeBoundingBox(); tmp.copy(inst.boundingBox!); }
    else { m.geometry.computeBoundingBox(); tmp.copy(m.geometry.boundingBox!); }
    box.union(tmp.applyMatrix4(o.matrixWorld));
  });
  return box;
}

/** Real-time preview viewport: PBR, image-based lighting, a switchable studio rig, orbit camera and optional turntable. */
export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.05, 100);
  readonly controls: OrbitControls;
  /** Everything user-visible hangs off this group; the turntable rotates it. */
  readonly stage = new Group();
  fps = 0;

  private readonly rig = new Group();
  private readonly floor: Mesh;
  private envTexture: Texture;
  private bgTexture: Texture | null = null;
  private lightingId = "";
  private backgroundId = "";
  private content: Object3D | null = null;
  private radius = 1;
  private target = new Vector3();
  private turntable: boolean;
  private turntableSpeed: number;
  private angle = 0;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private resizeObs: ResizeObserver | null = null;
  private disposed = false;
  private readonly maxPR: number;

  constructor(readonly canvas: HTMLCanvasElement, opts: ViewportOptions = {}) {
    this.maxPR = opts.maxPixelRatio ?? 2;
    this.turntable = opts.turntable ?? false;
    this.turntableSpeed = opts.turntableDegPerSec ?? 18;

    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    const pmrem = new PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;

    this.floor = this.createFloor();
    this.scene.add(this.stage, this.rig, this.floor);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("change", () => this.invalidate());

    this.setLighting(opts.lighting ?? "studio-3point");
    this.setBackground(opts.background ?? "studio-grey");

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas);
    this.resize();
  }

  private createFloor(): Mesh {
    // Shadow catcher on top of a faint disc so the figure feels grounded without a hard horizon.
    const holder = new Mesh(new CircleGeometry(4, 64), new ShadowMaterial({ opacity: 0.35 }));
    holder.rotation.x = -Math.PI / 2;
    holder.receiveShadow = true;
    const disc = new Mesh(new CircleGeometry(0.6, 64), new MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9, transparent: true, opacity: 0.55 }));
    disc.position.z = 0.0005;
    holder.add(disc);
    return holder;
  }

  /** Replace the displayed object (disposal of the old one is the caller's job) and frame it. */
  setContent(obj: Object3D | null): void {
    if (this.content) this.stage.remove(this.content);
    this.content = obj;
    if (obj) {
      this.stage.add(obj);
      this.frame();
    }
    this.invalidate();
  }

  /** Re-aim the camera at the content's bounds. */
  frame(): void {
    const box = visibleBounds(this.content);
    if (box.isEmpty()) box.set(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1.8, 0.5));
    const s = box.getBoundingSphere(new Sphere());
    this.radius = s.radius;
    this.target.copy(s.center);
    const dist = fitDistance(s.radius, this.camera.fov, this.camera.aspect);
    this.camera.near = Math.max(0.01, dist / 100);
    this.camera.far = dist * 20;
    this.camera.position.set(this.target.x, this.target.y + s.radius * 0.1, this.target.z + dist);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.target);
    this.controls.minDistance = s.radius * 0.5;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
    this.floor.position.y = box.min.y;
    this.invalidate();
  }

  /**
   * Re-aim the camera at a horizontal slice of the content: `centerY` is a fraction of the content height (0 = feet, 1 = top),
   * `span` the fraction of the height that should fill the view. Keeps the current viewing direction.
   */
  focus(centerY: number, span: number): void {
    const box = visibleBounds(this.content);
    if (box.isEmpty()) return;
    const height = box.max.y - box.min.y;
    const target = new Vector3((box.min.x + box.max.x) / 2, box.min.y + height * centerY, (box.min.z + box.max.z) / 2);
    const dist = fitDistance((height * span) / 2, this.camera.fov, this.camera.aspect, 1.1);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    this.camera.position.copy(target).addScaledVector(dir.normalize(), dist);
    this.controls.target.copy(target);
    this.controls.minDistance = Math.min(this.controls.minDistance, dist * 0.5);
    this.controls.update();
    this.invalidate();
  }

  setLighting(id: string): void {
    const preset: LightingPreset = findLighting(id) ?? LIGHTING_PRESETS[0]!;
    this.lightingId = preset.id;
    for (const l of [...this.rig.children]) {
      this.rig.remove(l);
      (l as DirectionalLight).dispose?.();
    }
    for (const spec of preset.lights) {
      const light = new DirectionalLight(new Color(spec.color), spec.intensity);
      light.position.set(...sphericalPosition(spec.azimuthDeg, spec.elevationDeg, LIGHT_DISTANCE));
      light.castShadow = spec.castShadow;
      if (spec.castShadow) {
        light.shadow.mapSize.set(2048, 2048);
        light.shadow.radius = 5;
        light.shadow.bias = -0.0004;
        const c = light.shadow.camera;
        c.left = c.bottom = -2.5;
        c.right = c.top = 2.5;
        c.near = 0.5;
        c.far = 14;
      }
      this.rig.add(light);
    }
    this.scene.environmentIntensity = preset.envIntensity;
    this.renderer.toneMappingExposure = preset.exposure;
    this.invalidate();
  }

  setBackground(id: string): void {
    const preset: BackgroundPreset = findBackground(id) ?? findBackground("studio-grey")!;
    this.backgroundId = preset.id;
    this.bgTexture?.dispose();
    this.bgTexture = null;
    if (preset.colors.length === 1) {
      this.scene.background = new Color(preset.colors[0]);
    } else {
      const c = document.createElement("canvas");
      c.width = 4;
      c.height = 256;
      const ctx = c.getContext("2d")!;
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, `#${preset.colors[0].toString(16).padStart(6, "0")}`);
      grad.addColorStop(1, `#${preset.colors[1].toString(16).padStart(6, "0")}`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 4, 256);
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      this.bgTexture = tex;
      this.scene.background = tex;
    }
    this.invalidate();
  }

  get currentLighting(): string { return this.lightingId; }
  get currentBackground(): string { return this.backgroundId; }
  get turntableOn(): boolean { return this.turntable; }

  setTurntable(on: boolean, degPerSec?: number): void {
    this.turntable = on;
    if (degPerSec !== undefined) this.turntableSpeed = degPerSec;
    this.last = 0;
    this.invalidate();
  }

  /** Ask for a redraw; the render loop sleeps when nothing changes (battery friendly on mobile). */
  invalidate(): void {
    this.dirty = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.tick);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPR));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private tick = (now: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0;
    this.last = now;
    const moved = this.controls.update(dt);
    if (this.turntable) {
      this.angle = advanceTurntable(this.angle, dt, this.turntableSpeed);
      this.stage.rotation.y = this.angle;
    }
    if (this.dirty || moved || this.turntable) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      if (dt > 0) this.fps = this.fps ? this.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
    }
    if (this.turntable || moved) this.raf = requestAnimationFrame(this.tick);
    else this.last = 0;
  };

  /** Render now and return a PNG data URL (used for thumbnails and tests). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/png");
  }

  /** Render now and return a small JPEG data URL (cover-cropped to width×height) for library thumbnails. */
  thumbnail(width = 144, height = 192, quality = 0.8): string {
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) return "";
    const sw = this.canvas.width, sh = this.canvas.height;
    const scale = Math.max(width / sw, height / sh);
    const cw = width / scale, ch = height / scale;
    ctx.drawImage(this.canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, width, height);
    return out.toDataURL("image/jpeg", quality);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.controls.dispose();
    this.bgTexture?.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
  }
}
