/**
 * Binary LLSD (Linden Lab Structured Data), the container Second Life mesh assets are built from. Layout follows the
 * viewer's LLSDBinaryFormatter (indra/llcommon/llsdserialize.cpp): '{' u32-BE count then ('k' u32-BE len, bytes, value)* '}',
 * '[' u32-BE count values* ']', '!' undefined, '1'/'0' booleans, 'i' int32-BE, 'r' float64-BE, 's' u32-BE len + UTF-8,
 * 'b' u32-BE len + bytes, 'u' 16-byte UUID, 'd' float64 date, 'l' URI.
 */

/** A 32-bit LLSD integer. Plain JS numbers are LLSD *reals*, so offsets and sizes must be wrapped. */
export class LlInt {
  constructor(readonly value: number) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new RangeError(`not an int32: ${value}`);
  }
}
export const int = (n: number) => new LlInt(n);

export type Llsd = null | boolean | LlInt | number | string | Uint8Array | Llsd[] | { [key: string]: Llsd };

export class LlsdError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

/** Serialize without any header text, like `LLSDSerialize::toBinary`. Map keys are written sorted (the viewer's maps are ordered). */
export function serializeBinary(value: Llsd): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const put = (b: Uint8Array) => { chunks.push(b); size += b.length; };
  const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, false); put(b); };
  const str = (s: string) => { const b = enc.encode(s); u32(b.length); put(b); };
  const walk = (v: Llsd): void => {
    if (v === null) { put(Uint8Array.of(0x21)); return; }
    if (typeof v === "boolean") { put(Uint8Array.of(v ? 0x31 : 0x30)); return; }
    if (v instanceof LlInt) { const b = new Uint8Array(5); b[0] = 0x69; new DataView(b.buffer).setInt32(1, v.value, false); put(b); return; }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new LlsdError("non-finite real");
      const b = new Uint8Array(9); b[0] = 0x72; new DataView(b.buffer).setFloat64(1, v, false); put(b); return;
    }
    if (typeof v === "string") { put(Uint8Array.of(0x73)); str(v); return; }
    if (v instanceof Uint8Array) { put(Uint8Array.of(0x62)); u32(v.length); put(v); return; }
    if (Array.isArray(v)) { put(Uint8Array.of(0x5b)); u32(v.length); for (const x of v) walk(x); put(Uint8Array.of(0x5d)); return; }
    const keys = Object.keys(v).sort();
    put(Uint8Array.of(0x7b)); u32(keys.length);
    for (const k of keys) { put(Uint8Array.of(0x6b)); str(k); walk(v[k]!); }
    put(Uint8Array.of(0x7d));
  };
  walk(value);
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Parse binary LLSD starting at `offset`; returns the value and the offset just past it. A `<? LLSD/Binary ?>` line is skipped if present. */
export function parseBinary(bytes: Uint8Array, offset = 0): { value: Llsd; end: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = offset;
  if (bytes[p] === 0x3c /* < */) { // "<? LLSD/Binary ?>\n"
    const nl = bytes.indexOf(0x0a, p);
    if (nl < 0) throw new LlsdError("unterminated LLSD header line");
    p = nl + 1;
  }
  const need = (n: number) => { if (p + n > bytes.length) throw new LlsdError("LLSD data is truncated"); };
  const u32 = () => { need(4); const n = dv.getUint32(p, false); p += 4; return n; };
  const str = () => { const n = u32(); need(n); const s = dec.decode(bytes.subarray(p, p + n)); p += n; return s; };
  const read = (depth: number): Llsd => {
    if (depth > 64) throw new LlsdError("LLSD nested too deeply");
    need(1);
    const t = bytes[p++]!;
    switch (t) {
      case 0x21: return null;
      case 0x31: return true;
      case 0x30: return false;
      case 0x69: need(4); { const n = dv.getInt32(p, false); p += 4; return new LlInt(n); }
      case 0x72: need(8); { const n = dv.getFloat64(p, false); p += 8; return n; }
      case 0x73: return str();
      case 0x62: { const n = u32(); need(n); const b = bytes.slice(p, p + n); p += n; return b; }
      case 0x75: need(16); { const b = bytes.slice(p, p + 16); p += 16; return b; } // UUID: kept as raw bytes
      case 0x64: need(8); { const n = dv.getFloat64(p, false); p += 8; return n; }
      case 0x6c: return str();
      case 0x5b: {
        const n = u32(); const a: Llsd[] = [];
        for (let i = 0; i < n; i++) a.push(read(depth + 1));
        need(1); if (bytes[p++] !== 0x5d) throw new LlsdError("array not closed");
        return a;
      }
      case 0x7b: {
        const n = u32(); const m: { [k: string]: Llsd } = {};
        for (let i = 0; i < n; i++) {
          need(1); if (bytes[p++] !== 0x6b) throw new LlsdError("map key expected");
          const k = str();
          m[k] = read(depth + 1);
        }
        need(1); if (bytes[p++] !== 0x7d) throw new LlsdError("map not closed");
        return m;
      }
      default: throw new LlsdError(`unknown LLSD type byte 0x${t.toString(16)} at ${p - 1}`);
    }
  };
  const value = read(0);
  return { value, end: p };
}
