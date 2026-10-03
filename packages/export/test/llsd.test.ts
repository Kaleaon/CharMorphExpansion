import { describe, expect, it } from "vitest";
import { int, LlInt, LlsdError, parseBinary, serializeBinary, type Llsd } from "../src/llsd.ts";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("serializeBinary: exact wire bytes (viewer's LLSDBinaryFormatter)", () => {
  it("scalars", () => {
    expect(hex(serializeBinary(null))).toBe("21");
    expect(hex(serializeBinary(true))).toBe("31");
    expect(hex(serializeBinary(false))).toBe("30");
    expect(hex(serializeBinary(int(258)))).toBe("6900000102");
    expect(hex(serializeBinary(int(-1)))).toBe("69ffffffff");
    expect(hex(serializeBinary(1.5))).toBe("723ff8000000000000");
    expect(hex(serializeBinary("hi"))).toBe("73000000026869");
    expect(hex(serializeBinary(Uint8Array.of(1, 2, 3)))).toBe("62000000030102" + "03");
  });
  it("arrays and maps (keys sorted, counts big-endian)", () => {
    expect(hex(serializeBinary([int(1), true]))).toBe("5b00000002" + "6900000001" + "31" + "5d");
    expect(hex(serializeBinary({ b: false, a: int(7) }))).toBe("7b00000002" + "6b0000000161" + "6900000007" + "6b0000000162" + "30" + "7d");
    expect(hex(serializeBinary({}))).toBe("7b0000000" + "07d");
  });
  it("distinguishes integers from reals and rejects non-integers / non-finite", () => {
    expect(hex(serializeBinary(3))[0]).toBe("7"); // 'r'
    expect(() => int(1.5)).toThrow(RangeError);
    expect(() => int(2 ** 31)).toThrow(RangeError);
    expect(() => serializeBinary(NaN)).toThrow(LlsdError);
  });
});

describe("parseBinary", () => {
  const sample: Llsd = {
    header: { offset: int(0), size: int(123456) },
    names: ["mPelvis", "mTorso"],
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.25, 0.5, 1.75, 1],
    blob: Uint8Array.of(0, 255, 7),
    flag: true, nothing: null, text: "héllo ✓",
  };
  it("round-trips everything, keeping ints and reals apart", () => {
    const { value, end } = parseBinary(serializeBinary(sample));
    expect(end).toBe(serializeBinary(sample).length);
    const v = value as Record<string, Llsd>;
    expect((v.header as Record<string, Llsd>).size).toEqual(new LlInt(123456));
    expect(v.matrix).toEqual(sample && (sample as Record<string, Llsd>).matrix);
    expect(v.blob).toEqual(Uint8Array.of(0, 255, 7));
    expect(v.text).toBe("héllo ✓");
    expect(v.nothing).toBeNull();
  });
  it("reports where the value ended so blocks can follow it", () => {
    const a = serializeBinary({ x: int(1) });
    const joined = new Uint8Array([...a, 9, 9, 9]);
    expect(parseBinary(joined).end).toBe(a.length);
  });
  it("skips an optional '<? LLSD/Binary ?>' header line", () => {
    const body = serializeBinary(int(5));
    const withHeader = new Uint8Array([...new TextEncoder().encode("<? LLSD/Binary ?>\n"), ...body]);
    expect((parseBinary(withHeader).value as LlInt).value).toBe(5);
  });
  it("rejects truncated or malformed data", () => {
    const good = serializeBinary({ a: [int(1), int(2)] });
    expect(() => parseBinary(good.subarray(0, good.length - 3))).toThrow(LlsdError);
    expect(() => parseBinary(Uint8Array.of(0x7a))).toThrow(/unknown LLSD type/);
    expect(() => parseBinary(Uint8Array.of(0x5b, 0, 0, 0, 1, 0x21, 0x00))).toThrow(/not closed/);
    expect(() => parseBinary(new Uint8Array(0))).toThrow(/truncated/);
  });
});
