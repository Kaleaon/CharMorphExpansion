import type { MorphMesh } from "@charmorph/morph";
import { NormalSolver } from "@charmorph/morph";
import { BodyRig, fitShape, FIT_PARAMS, type BodyFrame, type FitResult } from "@charmorph/rig";
import { computeBodyHeight, pelvisToFoot, SL_SKELETON_DATA, Skeleton, createSlShape, type SlShape, type Vec3 } from "@charmorph/skeleton";

export type SlMode = "overrides" | "sliders";

export interface SlOutput {
  positions: Float32Array;
  normals: Float32Array;
  /** Vertical shift (metres) that keeps the feet on the ground: the body's own sole offset plus the viewer's pelvisToFoot rule for shape changes. */
  groundShift: number;
}

/**
 * Drives the Second Life view: T-poses the morphed body, builds the character's SL skeleton, applies SL shape sliders and
 * pose through the skeleton, and produces final positions/normals. Everything is derived from the latest morph frame.
 *
 * Modes: "overrides" — the skeleton takes the character's own joint positions (what joint-position overrides in a mesh upload do),
 * so the SL sliders start neutral. "sliders" — the plain SL skeleton plus slider deformation only; the body is warped to it,
 * which shows what the SL sliders alone can and cannot reproduce.
 */
export class SlController {
  readonly skeleton = new Skeleton(SL_SKELETON_DATA);
  readonly shape: SlShape = createSlShape();
  mode: SlMode = "overrides";
  private readonly normals: NormalSolver;
  private frame: BodyFrame | null = null;
  private tposed = new Float32Array(0);
  private out = new Float32Array(0);
  private nout = new Float32Array(0);
  private rest: Record<string, Vec3> = {};
  private bind = new Map<string, Vec3>();
  private target = new Map<string, Vec3>();
  private pose = new Map<string, Vec3>();
  /** Lifts the T-posed body so its lowest vertex sits on the floor before shape changes apply the viewer's own grounding rule. */
  private sole = 0;

  constructor(private readonly rig: BodyRig, mesh: MorphMesh) {
    this.normals = new NormalSolver(mesh);
  }

  get ready(): boolean { return this.frame !== null; }

  /** New morph frame: re-derive the T-pose and the character's skeleton, then deform. */
  setFrame(f: BodyFrame): SlOutput {
    this.frame = { positions: Float32Array.from(f.positions), helpers: Float32Array.from(f.helpers) };
    const rt = this.rig.retarget(this.frame);
    if (this.tposed.length !== f.positions.length) { this.tposed = new Float32Array(f.positions.length); this.out = new Float32Array(f.positions.length); this.nout = new Float32Array(f.positions.length); }
    this.rig.tpose(this.frame, rt, this.tposed);
    let low = Infinity;
    for (let i = 1; i < this.tposed.length; i += 3) low = Math.min(low, this.tposed[i]!);
    this.sole = -low;
    this.rest = this.rig.customRest(rt);
    this.bind = this.rig.bindPositions(rt);
    this.target = new Map([...rt.joints].map(([n, j]) => [n, j.to] as [string, Vec3]));
    return this.update();
  }

  setPose(joint: string, euler: Vec3 | null): void {
    if (euler) this.pose.set(joint, euler); else this.pose.delete(joint);
  }

  resetPose(): void { this.pose.clear(); }

  /** Re-deform with the current mode, shape sliders and pose (no new morph frame needed). */
  update(): SlOutput {
    if (!this.frame) throw new Error("SlController: no frame yet");
    this.skeleton.setRestPositions(this.mode === "overrides" ? this.rest : {});
    this.skeleton.resetPose();
    for (const [j, e] of this.pose) this.skeleton.setPoseEuler(j, e);

    // The viewer keeps the feet on the ground by lifting the avatar by pelvisToFoot; measure that against the neutral skeleton.
    this.skeleton.setDeltas({});
    this.skeleton.update();
    const neutral = pelvisToFoot(this.skeleton) - this.skeleton.worldPosition("mPelvis")[2];
    const result = this.shape.evaluate();
    this.skeleton.setDeltas(result.deltas);
    this.skeleton.update();
    const groundShift = pelvisToFoot(this.skeleton) - this.skeleton.worldPosition("mPelvis")[2] - neutral + result.hover;

    this.rig.deform(this.tposed, this.skeleton, this.bind, this.out);
    this.normals.compute(this.out, this.nout);
    return { positions: this.out, normals: this.nout, groundShift: this.sole + groundShift };
  }

  /** The viewer's estimate of the avatar's height with the current skeleton state (needs `update()` first). */
  bodyHeight(): number { return computeBodyHeight(this.skeleton); }

  /** Choose the SL body sliders that best reproduce this character's joints without joint overrides. */
  fit(): FitResult {
    if (!this.frame) throw new Error("SlController: no frame yet");
    const scratch = new Skeleton(SL_SKELETON_DATA);
    const res = fitShape(this.target, this.shape, scratch);
    for (const [id, w] of res.weights) this.shape.set(id, w);
    return res;
  }

  resetShape(): void { this.shape.reset(); }

  /** Body-proportion sliders in the order the viewer's appearance editor lists them. */
  get sliderParams() { return FIT_PARAMS.map((id) => this.shape.param(id)); }
}
