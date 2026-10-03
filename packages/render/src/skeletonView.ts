import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4,
  MeshBasicMaterial, SphereGeometry,
} from "three";
import { SL_TO_THREE, type Skeleton } from "@charmorph/skeleton";

const BASE_COLOR = new Color(0x5aa9ff);
const EXT_COLOR = new Color(0xffa24a);
const SELECT_COLOR = new Color(0xffffff);
const CV_COLOR = 0x6be3a0;

export interface SkeletonViewOptions {
  showExtended: boolean;
  showCollisionVolumes: boolean;
}

/**
 * Debug/pose overlay for a `Skeleton`: joint dots, bone lines and collision-volume ellipsoids.
 * The group carries the SL→three basis change, so everything inside stays in SL coordinates.
 */
export class SkeletonView extends Group {
  private readonly joints: InstancedMesh;
  private readonly lines: LineSegments;
  private readonly cvs: InstancedMesh;
  private readonly linePos: Float32Array;
  private readonly m = new Matrix4();
  private selected = -1;
  private opts: SkeletonViewOptions = { showExtended: true, showCollisionVolumes: false };

  constructor(readonly skeleton: Skeleton) {
    super();
    this.name = "skeleton-view";
    this.matrixAutoUpdate = false;
    this.matrix.fromArray(SL_TO_THREE as number[]);

    const n = skeleton.count;
    const dot = new MeshBasicMaterial({ depthTest: false, transparent: true });
    this.joints = new InstancedMesh(new SphereGeometry(0.009, 10, 8), dot, n);
    this.joints.instanceMatrix.setUsage(DynamicDrawUsage);
    this.joints.renderOrder = 11;
    this.joints.frustumCulled = false;

    this.linePos = new Float32Array(n * 6);
    const lg = new BufferGeometry();
    lg.setAttribute("position", new BufferAttribute(this.linePos, 3).setUsage(DynamicDrawUsage));
    this.lines = new LineSegments(lg, new LineBasicMaterial({ color: 0xcfd6e4, depthTest: false, transparent: true, opacity: 0.8 }));
    this.lines.renderOrder = 10;
    this.lines.frustumCulled = false;

    this.cvs = new InstancedMesh(new SphereGeometry(1, 14, 10), new MeshBasicMaterial({ color: CV_COLOR, wireframe: true, depthTest: false, transparent: true, opacity: 0.5 }), skeleton.cvCount);
    this.cvs.instanceMatrix.setUsage(DynamicDrawUsage);
    this.cvs.renderOrder = 9;
    this.cvs.frustumCulled = false;

    this.add(this.cvs, this.lines, this.joints);
    this.setOptions(this.opts);
    this.sync();
  }

  setOptions(o: Partial<SkeletonViewOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.cvs.visible = this.opts.showCollisionVolumes;
    this.sync();
  }

  select(name: string | null): void {
    this.selected = name ? this.skeleton.indexOf(name) : -1;
    this.sync();
  }

  /** Re-read world matrices from the skeleton (call after `skeleton.update()`). */
  sync(): void {
    const s = this.skeleton;
    const w = s.world;
    const ext = this.opts.showExtended;
    let l = 0;
    for (let i = 0; i < s.count; i++) {
      const extended = s.data.joints[i]!.support === "extended";
      const visible = ext || !extended;
      const x = w[i * 16 + 12]!, y = w[i * 16 + 13]!, z = w[i * 16 + 14]!;
      // Hidden joints collapse to a zero-scale instance so instance indices stay stable.
      this.m.makeScale(visible ? 1 : 0, visible ? 1 : 0, visible ? 1 : 0).setPosition(x, y, z);
      this.joints.setMatrixAt(i, this.m);
      this.joints.setColorAt(i, i === this.selected ? SELECT_COLOR : extended ? EXT_COLOR : BASE_COLOR);
      const p = s.parents[i]!;
      if (p >= 0 && visible) {
        this.linePos.set([w[p * 16 + 12]!, w[p * 16 + 13]!, w[p * 16 + 14]!, x, y, z], l);
        l += 6;
      }
    }
    this.joints.instanceMatrix.needsUpdate = true;
    if (this.joints.instanceColor) this.joints.instanceColor.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, l / 3);
    (this.lines.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;

    {
      // Always kept current (cheap) so bounds used for camera framing are right even while hidden.
      for (let c = 0; c < s.cvCount; c++) {
        this.m.fromArray(s.cvWorld, c * 16); // already includes the ellipsoid scale
        this.cvs.setMatrixAt(c, this.m);
      }
      this.cvs.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const o of [this.joints, this.lines, this.cvs]) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  }
}
