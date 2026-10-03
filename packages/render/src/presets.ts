/** Pure data: lighting rigs and backgrounds. Kept free of three.js so it can be tested and serialized. */

export interface LightSpec {
  role: "key" | "fill" | "rim";
  azimuthDeg: number;
  elevationDeg: number;
  intensity: number;
  color: number;
  castShadow: boolean;
}

export interface LightingPreset {
  id: string;
  label: string;
  /** Intensity of the image-based-lighting environment. */
  envIntensity: number;
  exposure: number;
  lights: LightSpec[];
}

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: "studio-3point", label: "Studio (3-point)", envIntensity: 0.45, exposure: 1.0,
    lights: [
      { role: "key", azimuthDeg: 35, elevationDeg: 35, intensity: 2.6, color: 0xfff1e0, castShadow: true },
      { role: "fill", azimuthDeg: -50, elevationDeg: 15, intensity: 0.9, color: 0xdfe9ff, castShadow: false },
      { role: "rim", azimuthDeg: 160, elevationDeg: 30, intensity: 2.0, color: 0xffffff, castShadow: false },
    ],
  },
  {
    id: "softbox", label: "Softbox (low contrast)", envIntensity: 0.9, exposure: 1.05,
    lights: [
      { role: "key", azimuthDeg: 15, elevationDeg: 55, intensity: 1.6, color: 0xffffff, castShadow: true },
      { role: "fill", azimuthDeg: -20, elevationDeg: 20, intensity: 1.2, color: 0xffffff, castShadow: false },
      { role: "rim", azimuthDeg: 180, elevationDeg: 25, intensity: 0.8, color: 0xffffff, castShadow: false },
    ],
  },
  {
    id: "dramatic", label: "Dramatic rim", envIntensity: 0.12, exposure: 1.1,
    lights: [
      { role: "key", azimuthDeg: 75, elevationDeg: 20, intensity: 2.2, color: 0xffd9b0, castShadow: true },
      { role: "fill", azimuthDeg: -70, elevationDeg: 5, intensity: 0.25, color: 0x8fb0ff, castShadow: false },
      { role: "rim", azimuthDeg: -150, elevationDeg: 35, intensity: 4.0, color: 0x9fc4ff, castShadow: false },
    ],
  },
  {
    id: "flat", label: "Flat (clinical)", envIntensity: 1.4, exposure: 1.0,
    lights: [{ role: "key", azimuthDeg: 0, elevationDeg: 10, intensity: 0.6, color: 0xffffff, castShadow: false }],
  },
];

export interface BackgroundPreset {
  id: string;
  label: string;
  /** One color = solid; two = vertical gradient (top → bottom). */
  colors: [number] | [number, number];
}

export const BACKGROUND_PRESETS: readonly BackgroundPreset[] = [
  { id: "studio-grey", label: "Studio grey", colors: [0x4a4d52, 0x1c1d20] },
  { id: "light", label: "Light", colors: [0xe9ebee, 0xc9ced4] },
  { id: "dark", label: "Dark", colors: [0x0e0f11] },
  { id: "chroma-green", label: "Chroma green", colors: [0x00b140] },
];

export const findLighting = (id: string) => LIGHTING_PRESETS.find((p) => p.id === id);
export const findBackground = (id: string) => BACKGROUND_PRESETS.find((p) => p.id === id);
