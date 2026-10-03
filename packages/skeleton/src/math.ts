import type { Vec3 } from "./types.ts";

/** Column-major 4x4 (same layout as WebGL / three.js Matrix4.elements). Length-16 arrays. */
export type Mat4 = Float64Array;
export type Quat = [number, number, number, number]; // x, y, z, w

const DEG = Math.PI / 180;

export const quatIdentity = (): Quat => [0, 0, 0, 1];

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatAxisAngle(axis: 0 | 1 | 2, deg: number): Quat {
  const h = (deg * DEG) / 2;
  const q: Quat = [0, 0, 0, Math.cos(h)];
  q[axis] = Math.sin(h);
  return q;
}

/**
 * Euler degrees → quaternion the way the Second Life viewer reads `rot` attributes: `mayaQ(x, y, z, XYZ)` = `xQ * yQ * zQ`
 * with LLQuaternion's reversed multiplication, which in the usual column-vector convention is Rz · Ry · Rx
 * (rotate about X first, then Y, then Z). Verified against indra/llmath/llquaternion.cpp.
 */
export function quatFromMayaXYZ(e: Vec3): Quat {
  return quatMul(quatMul(quatAxisAngle(2, e[2]), quatAxisAngle(1, e[1])), quatAxisAngle(0, e[0]));
}

/** Rotate a vector by a unit quaternion. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export const mat4Identity = (): Mat4 => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

/** out = T · R · S */
export function compose(t: Vec3, q: Quat, s: Vec3, out: Mat4 = new Float64Array(16)): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

/** out = a · b (b applied first). `out` must not alias a or b. */
export function mul(a: ArrayLike<number>, b: ArrayLike<number>, out: Mat4 = new Float64Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    }
  }
  return out;
}

export const translationOf = (m: ArrayLike<number>): Vec3 => [m[12]!, m[13]!, m[14]!];
