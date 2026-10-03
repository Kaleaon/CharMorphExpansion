import { XMLParser } from "fast-xml-parser";
import type { CollisionVolumeDef, JointDef, SkeletonData, Support, Vec3 } from "../../packages/skeleton/src/types.ts";

const vec3 = (s: unknown, what: string): Vec3 => {
  const p = String(s ?? "").trim().split(/\s+/).map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) throw new Error(`bad vec3 for ${what}: "${s}"`);
  return [p[0]!, p[1]!, p[2]!];
};
const support = (s: unknown, what: string): Support => {
  if (s !== "base" && s !== "extended") throw new Error(`bad support for ${what}: "${s}"`);
  return s;
};

type Node = Record<string, unknown>;
const kids = (n: Node): Node[] => (n[Object.keys(n).find((k) => k !== ":@") ?? ""] as Node[]) ?? [];
const tagOf = (n: Node) => Object.keys(n).find((k) => k !== ":@");
const attrs = (n: Node) => (n[":@"] ?? {}) as Record<string, string>;

/** Parse the viewer's `avatar_skeleton.xml` into our flat, parent-before-child table. Order follows the file. */
export function parseSkeletonXml(xml: string): Omit<SkeletonData, "source"> & { declared: { bones: number; collisionVolumes: number } } {
  const doc = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "", allowBooleanAttributes: true }).parse(xml) as Node[];
  const root = doc.find((n) => tagOf(n) === "linden_skeleton");
  if (!root) throw new Error("no <linden_skeleton> root element");
  const ra = attrs(root);
  const joints: JointDef[] = [];
  const cvs: CollisionVolumeDef[] = [];

  const visit = (children: Node[], parent: string | null) => {
    for (const n of children) {
      const tag = tagOf(n);
      const a = attrs(n);
      if (tag === "bone") {
        const name = a.name!;
        joints.push({
          name,
          parent,
          aliases: (a.aliases ?? "").split(/\s+/).filter(Boolean),
          pos: vec3(a.pos, `${name}.pos`),
          pivot: vec3(a.pivot, `${name}.pivot`),
          end: vec3(a.end, `${name}.end`),
          rot: vec3(a.rot, `${name}.rot`),
          scale: vec3(a.scale, `${name}.scale`),
          connected: a.connected === "true",
          group: a.group ?? "",
          support: support(a.support, name),
        });
        visit(kids(n), name);
      } else if (tag === "collision_volume") {
        if (!parent) throw new Error("collision_volume outside a bone");
        const name = a.name!;
        cvs.push({
          name, parent, group: a.group ?? "", support: support(a.support, name),
          pos: vec3(a.pos, `${name}.pos`), rot: vec3(a.rot, `${name}.rot`), scale: vec3(a.scale, `${name}.scale`), end: vec3(a.end, `${name}.end`),
        });
      }
    }
  };
  visit(kids(root), null);
  return {
    version: String(ra.version ?? ""),
    joints,
    collisionVolumes: cvs,
    declared: { bones: Number(ra.num_bones), collisionVolumes: Number(ra.num_collision_volumes) },
  };
}
