import { describe, expect, it } from "vitest";
import { mapBones, ruleFor } from "./rigmap.ts";

describe("ruleFor", () => {
  it("maps limbs, spine, hands and feet", () => {
    expect(ruleFor("upperarm02.L")).toBe("mShoulderLeft");
    expect(ruleFor("lowerarm01.R")).toBe("mElbowRight");
    expect(ruleFor("foot.L")).toBe("mAnkleLeft");
    expect(ruleFor("toe3-2.R")).toBe("mToeRight");
    expect(ruleFor("finger1-2.L")).toBe("mHandThumb2Left");
    expect(ruleFor("finger5-3.R")).toBe("mHandPinky3Right");
    expect(ruleFor("metacarpal2.L")).toBe("mWristLeft");
    expect(ruleFor("spine04")).toBe("mTorso");
    expect(ruleFor("spine01")).toBe("mChest");
    expect(ruleFor("pelvis.R")).toBe("mPelvis");
    expect(ruleFor("oris03.L")).toBeNull();
  });
});

describe("mapBones", () => {
  it("lets unlisted bones inherit their nearest mapped ancestor and refuses orphans", () => {
    const m = mapBones({ head: "neck03", neck03: null, "oris03.L": "jaw", jaw: "head", "tongue05.L": "tongue04", tongue04: "jaw" });
    expect(m).toMatchObject({ head: "mHead", "oris03.L": "mHead", jaw: "mHead", "tongue05.L": "mHead" });
    expect(() => mapBones({ mystery: null })).toThrow(/no SL joint/);
  });
});
