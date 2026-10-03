/** Offline mapping of MakeHuman bone names onto the Second Life joints that carry their skin weights. */

const FINGER_NAMES: Record<string, string> = { "1": "Thumb", "2": "Index", "3": "Middle", "4": "Ring", "5": "Pinky" };

/** Explicit rules for the bones that matter; every other bone inherits the mapping of its nearest mapped ancestor. */
export function ruleFor(bone: string): string | null {
  const side = bone.endsWith(".L") ? "Left" : bone.endsWith(".R") ? "Right" : "";
  const base = side ? bone.slice(0, -2) : bone;
  const finger = /^finger(\d)-(\d)$/.exec(base);
  if (finger) return `mHand${FINGER_NAMES[finger[1]!]!}${finger[2]}${side}`;
  // SL bends the toes at the ball of the foot: that joint is mFoot. mToe is the end joint at the tip and carries no weights.
  if (/^toe\d-\d$/.test(base)) return `mFoot${side}`;
  if (/^metacarpal\d$/.test(base)) return `mWrist${side}`;
  switch (base) {
    case "root": case "spine05": case "pelvis": return "mPelvis";
    case "spine04": case "spine03": return "mTorso";
    case "spine02": case "spine01": case "breast": return "mChest";
    case "neck01": case "neck02": case "neck03": return "mNeck";
    case "head": return "mHead";
    case "eye": return `mEye${side}`;
    case "clavicle": case "shoulder01": return `mCollar${side}`;
    case "upperarm01": case "upperarm02": return `mShoulder${side}`;
    case "lowerarm01": case "lowerarm02": return `mElbow${side}`;
    case "wrist": return `mWrist${side}`;
    case "upperleg01": case "upperleg02": return `mHip${side}`;
    case "lowerleg01": case "lowerleg02": return `mKnee${side}`;
    case "foot": return `mAnkle${side}`;
    default: return null;
  }
}

/** Resolve every bone to an SL joint (own rule, else the nearest ancestor's). Throws if some bone has none. */
export function mapBones(parents: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  const resolve = (b: string): string => {
    if (out[b]) return out[b]!;
    const own = ruleFor(b);
    if (own) return (out[b] = own);
    const p = parents[b];
    if (p === undefined || p === null) throw new Error(`no SL joint for MakeHuman bone "${b}" (no rule and no parent)`);
    return (out[b] = resolve(p));
  };
  for (const b of Object.keys(parents)) resolve(b);
  return out;
}
