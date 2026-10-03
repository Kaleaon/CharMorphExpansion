const rad = (d: number) => (d * Math.PI) / 180;

/** Camera distance at which a sphere of `radius` fits fully in view (vertical or horizontal, whichever is tighter). */
export function fitDistance(radius: number, fovDeg: number, aspect: number, margin = 1.15): number {
  if (!(radius > 0)) throw new RangeError("radius must be > 0");
  if (!(aspect > 0)) throw new RangeError("aspect must be > 0");
  const vHalf = rad(fovDeg) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return (radius * margin) / Math.sin(Math.min(vHalf, hHalf));
}

/** Turntable angle in radians after `dt` seconds at `degPerSec`, wrapped to [0, 2π). */
export function advanceTurntable(angle: number, dt: number, degPerSec: number): number {
  const tau = Math.PI * 2;
  return (((angle + rad(degPerSec) * dt) % tau) + tau) % tau;
}

/** Position on a sphere around the origin; azimuth 0 = +Z (towards a default camera), elevation up from the horizon. */
export function sphericalPosition(azimuthDeg: number, elevationDeg: number, distance: number): [number, number, number] {
  const az = rad(azimuthDeg);
  const el = rad(elevationDeg);
  return [distance * Math.cos(el) * Math.sin(az), distance * Math.sin(el), distance * Math.cos(el) * Math.cos(az)];
}
