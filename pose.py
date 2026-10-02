# ##### BEGIN GPL LICENSE BLOCK #####
#
#  This program is free software; you can redistribute it and/or
#  modify it under the terms of the GNU General Public License
#  as published by the Free Software Foundation; either version 3
#  of the License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with this program; if not, write to the Free Software Foundation,
#  Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# ##### END GPL LICENSE BLOCK #####
#
# Copyright (C) 2020 Michael Vigovsky

import logging, re
import bpy  # pylint: disable=import-error

from mathutils import Matrix, Vector, Quaternion  # pylint: disable=import-error

try:
    from .lib.charlib import library
except ImportError:
    from lib.charlib import library

logger = logging.getLogger(__name__)

m1 = Matrix.Identity(4)
m2 = m1.copy()
m2[1][1] = -1
m2[3][3] = -1
flip_x_z = {
    "L": Matrix(((1, 0, 0, 0), (0, 0, 0, 1), (0, 0,-1, 0), (0,-1, 0, 0))),
    "R": Matrix(((1, 0, 0, 0), (0, 0, 0,-1), (0, 0, 1, 0), (0, 1, 0, 0))),
}


def qrotation(mat):
    def rot(v):
        return (v[3], v[0], v[1], v[2])
    return Matrix((rot(mat[3]), rot(mat[0]), rot(mat[1]), rot(mat[2])))


shoulder_angle = 1.3960005939006805
shoulder_rot = {
    "L": qrotation(Matrix.Rotation( shoulder_angle, 4, (0, 1, 0))),
    "R": qrotation(Matrix.Rotation(-shoulder_angle, 4, (0, 1, 0))),
}

bone_map = {
    "root": ("root", m2),
    "pelvis": ("torso", qrotation(Matrix.Rotation(1.4466689567595232, 4, (1, 0, 0)))),
    "spine01": ("spine_fk.001", m1),
    "spine02": ("spine_fk.002", m1),
    "spine03": ("spine_fk.003", m1),
    "neck": ("neck", m1),
    "head": ("head", m1),
}

for side in ["L", "R"]:
    bone_map["thigh_" + side] = ("thigh_fk." + side, m2)
    bone_map["calf_" + side] = ("shin_fk." + side, m2)
    bone_map["foot_" + side] = ("foot_fk." + side, m2)
    bone_map["toes_" + side] = ("toe." + side, m1)
    bone_map["breast_" + side] = ("breast." + side, m1)
    bone_map["clavicle_" + side] = ("shoulder." + side, shoulder_rot[side])
    bone_map["upperarm_" + side] = ("upper_arm_fk." + side, m1)
    bone_map["lowerarm_" + side] = ("forearm_fk." + side, m1)
    bone_map["hand_" + side] = ("hand_fk." + side, flip_x_z[side])
    for i in range(1, 4):
        is_master = "_master" if i == 1 else ""
        bone_map[f"thumb0{i}_{side}"] = (f"thumb.0{i}{is_master}.{side}", m2)
        for finger in ["index", "middle", "ring", "pinky"]:
            bone_map[f"{finger}0{i}_{side}"] = (f"f_{finger}.0{i}{is_master}.{side}", m2)
del side

# Different rigify versions use different parameters for IK2FK so we need to scan its modules

ik2fk_map = {}


def scan_rigify_modules(rig=None):
    if rig is None:
        if hasattr(bpy, "context") and hasattr(bpy.context, "active_object"):
            rig = bpy.context.active_object
    if not rig or not hasattr(rig, "data") or "rig_id" not in rig.data:
        return
    rig_id = rig.data["rig_id"]
    limbs = []

    # First check for direct Rigify properties stored on pose bones
    if hasattr(rig, "pose") and hasattr(rig.pose, "bones"):
        for bone in rig.pose.bones:
            if "prop_bone" in bone and "fk_bones" in bone:
                limb_info = {
                    "prop_bone": bone["prop_bone"],
                    "fk_bones": list(bone.get("fk_bones", [])),
                    "ik_bones": list(bone.get("ik_bones", [])),
                    "ctrl_bones": list(bone.get("ctrl_bones", [])),
                }
                limbs.append(limb_info)

    # Standard Rigify limb properties mapping fallback by bone inspection
    if not limbs and hasattr(rig, "pose") and hasattr(rig.pose, "bones"):
        for side in ["L", "R"]:
            arm_prop = f"upper_arm_parent.{side}"
            if arm_prop in rig.pose.bones:
                limbs.append({
                    "prop_bone": arm_prop,
                    "fk_bones": [f"upper_arm_fk.{side}", f"forearm_fk.{side}", f"hand_fk.{side}"],
                    "ik_bones": [f"upper_arm_ik.{side}", f"MCH-upper_arm_ik.{side}", f"hand_ik.{side}"],
                    "ctrl_bones": [f"upper_arm_ik.{side}", f"hand_ik.{side}", f"upper_arm_ik_target.{side}"],
                })
            leg_prop = f"thigh_parent.{side}"
            if leg_prop in rig.pose.bones:
                limbs.append({
                    "prop_bone": leg_prop,
                    "fk_bones": [f"thigh_fk.{side}", f"shin_fk.{side}", f"foot_fk.{side}"],
                    "ik_bones": [f"thigh_ik.{side}", f"MCH-thigh_ik.{side}", f"foot_ik.{side}"],
                    "ctrl_bones": [f"thigh_ik.{side}", f"foot_ik.{side}", f"thigh_ik_target.{side}"],
                })

    if limbs:
        ik2fk_map[rig_id] = limbs


def _align_bone_matrix(bone, target_matrix):
    try:
        bone.matrix = target_matrix.copy()
    except Exception:
        pass
    if getattr(bone, "parent", None):
        try:
            local_mat = bone.parent.matrix.inverted() @ target_matrix
        except Exception:
            local_mat = target_matrix
    else:
        local_mat = target_matrix
    try:
        loc, rot, scale = local_mat.decompose()
        bone.location = loc
        if getattr(bone, "rotation_mode", "") == "QUATERNION":
            bone.rotation_quaternion = rot
        else:
            bone.rotation_euler = rot.to_euler()
    except Exception:
        pass


def _align_pole_target(pole_bone, b1, b2, b3):
    try:
        p0 = Vector(b1.matrix.translation)
        p1 = Vector(b2.matrix.translation)
        p2 = Vector(b3.matrix.translation)
        mid = (p0 + p2) * 0.5
        vec = p1 - mid
        if vec.length_squared > 1e-6:
            pole_dir = vec.normalized()
            limb_len = (p1 - p0).length + (p2 - p1).length
            pole_pos = p1 + pole_dir * (limb_len * 0.5)
            pole_mat = pole_bone.matrix.copy()
            pole_mat.translation = pole_pos
            _align_bone_matrix(pole_bone, pole_mat)
    except Exception:
        pass


def apply_ik_fallback(rig, context):
    if not hasattr(rig, "pose") or not hasattr(rig.pose, "bones"):
        return
    for side in ["L", "R"]:
        # Hand IK fallback
        hand_fk = rig.pose.bones.get(f"hand_fk.{side}")
        hand_ik = rig.pose.bones.get(f"hand_ik.{side}")
        upper_arm_fk = rig.pose.bones.get(f"upper_arm_fk.{side}")
        forearm_fk = rig.pose.bones.get(f"forearm_fk.{side}")
        arm_pole = rig.pose.bones.get(f"upper_arm_ik_target.{side}")

        if hand_fk and hand_ik:
            _align_bone_matrix(hand_ik, hand_fk.matrix)

        if upper_arm_fk and forearm_fk and hand_fk and arm_pole:
            _align_pole_target(arm_pole, upper_arm_fk, forearm_fk, hand_fk)

        # Foot IK fallback
        foot_fk = rig.pose.bones.get(f"foot_fk.{side}")
        foot_ik = rig.pose.bones.get(f"foot_ik.{side}")
        thigh_fk = rig.pose.bones.get(f"thigh_fk.{side}")
        shin_fk = rig.pose.bones.get(f"shin_fk.{side}")
        leg_pole = rig.pose.bones.get(f"thigh_ik_target.{side}")

        if foot_fk and foot_ik:
            _align_bone_matrix(foot_ik, foot_fk.matrix)

        if thigh_fk and shin_fk and foot_fk and leg_pole:
            _align_pole_target(leg_pole, thigh_fk, shin_fk, foot_fk)

    if hasattr(context, "view_layer") and hasattr(context.view_layer, "update"):
        context.view_layer.update()


def apply_pose(ui, context):
    if not ui.pose or ui.pose == " ":
        return
    rig = context.active_object
    pose = library.obj_char(rig).poses.get(ui.pose)
    if not pose:
        logger.error("pose not found %s %s", ui.pose, rig)
        return
    rig_id = rig.data["rig_id"]

    # Some settings
    ik_fk = {}
    if "torso" in rig.pose.bones:
        rig.pose.bones["torso"]["neck_follow"] = 1.0
        rig.pose.bones["torso"]["head_follow"] = 1.0
    for side in ["L", "R"]:
        for limb in ["upper_arm", "thigh"]:
            bone_name = f"{limb}_parent.{side}"
            if bone_name in rig.pose.bones:
                bone = rig.pose.bones[bone_name]
                bone["fk_limb_follow"] = 0.0
                ik_fk[bone.name] = bone.get("IK_FK", 1.0)
                bone["IK_FK"] = 1.0

    # TODO: different mix modes
    old_mode = context.mode
    try:
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.pose.loc_clear()
        bpy.ops.pose.rot_clear()
        bpy.ops.pose.scale_clear()
    finally:
        bpy.ops.object.mode_set(mode=old_mode)

    for k, v in pose.items():
        name, matrix = bone_map.get(k, ("", None))
        target_bone = rig.pose.bones.get(name)
        if not target_bone:
            logger.debug("no target for %s", k)
            continue
        target_bone.rotation_mode = "QUATERNION"
        target_bone.rotation_quaternion = Quaternion(matrix @ Vector(v))

    spine_fk = rig.pose.bones.get("spine_fk")
    spine_fk1 = rig.pose.bones.get("spine_fk.001")

    if spine_fk and spine_fk1:
        if hasattr(spine_fk, "bone") and hasattr(spine_fk1, "bone") and hasattr(spine_fk.bone, "matrix_local"):
            rest_mat = spine_fk.bone.matrix_local.to_3x3().inverted() @ spine_fk1.bone.matrix_local.to_3x3()
            q1 = Quaternion(spine_fk1.rotation_quaternion)
            rot_mat = q1.to_matrix()
            spine_fk.rotation_quaternion = (rest_mat @ rot_mat @ rest_mat.inverted()).to_quaternion()
        else:
            spine_fk.rotation_quaternion = Quaternion(spine_fk1.rotation_quaternion)

    # Enforce view layer matrix update
    if hasattr(context, "view_layer") and hasattr(context.view_layer, "update"):
        context.view_layer.update()

    if hasattr(context, "evaluated_depsgraph_get"):
        # Calculate lowest point for sitting and similiar poses
        erig = rig.evaluated_get(context.evaluated_depsgraph_get())
        torso = rig.pose.bones.get("torso")
        min_z = torso.head[2] if torso else 0.0
        for bone in erig.pose.bones:
            if not bone.name.startswith("ORG-"):
                continue
            for attr in ["head", "tail"]:
                val = getattr(bone, attr)
                if val[2] < min_z:
                    min_z = val[2]
        min_z = max(min_z, 0)
        if torso:
            torso.location = (0, 0, -min_z)
            if hasattr(context, "view_layer") and hasattr(context.view_layer, "update"):
                context.view_layer.update()

    ik2fk_operator = None
    ik2fk_limbs = None

    if ui.pose_ik2fk:
        op_id = "rigify_limb_ik2fk_" + rig_id
        if hasattr(bpy.ops.pose, op_id):
            op = getattr(bpy.ops.pose, op_id)
            if op.poll():
                ik2fk_operator = op
                if rig_id not in ik2fk_map:
                    scan_rigify_modules(rig)
                ik2fk_limbs = ik2fk_map.get(rig_id)
                if not ik2fk_limbs:
                    logger.error("CharMorph doesn't support IK2FK for your Rigify version")

    if ik2fk_operator and ik2fk_limbs:
        fail = False
        for limb in ik2fk_limbs:
            result = ik2fk_operator(**limb)
            if "FINISHED" not in result:
                fail = True

        if fail:
            logger.error("IK2FK failed, using geometric fallback")
            apply_ik_fallback(rig, context)
            for k, v in ik_fk.items():
                if k in rig.pose.bones:
                    rig.pose.bones[k]["IK_FK"] = v
        else:
            for k, v in ik_fk.items():
                if k in rig.pose.bones:
                    rig.pose.bones[k]["IK_FK"] = v
    elif ui.pose_ik2fk:
        apply_ik_fallback(rig, context)
        for k, v in ik_fk.items():
            if k in rig.pose.bones:
                rig.pose.bones[k]["IK_FK"] = v


def convert_pose_dict_to_action(rig, pose_data, pose_name="Pose", frame=1, action=None):
    if action is None:
        action_name = f"{rig.name}_Poses" if hasattr(rig, "name") else "CharMorph_Poses"
        action = bpy.data.actions.new(name=action_name)

    for k, v in pose_data.items():
        name, matrix = bone_map.get(k, ("", None))
        target_bone = rig.pose.bones.get(name) if hasattr(rig, "pose") and hasattr(rig.pose, "bones") else None
        if not target_bone:
            continue
        target_bone.rotation_mode = "QUATERNION"
        target_bone.rotation_quaternion = matrix @ Vector(v)
        if hasattr(target_bone, "keyframe_insert"):
            target_bone.keyframe_insert(data_path="rotation_quaternion", frame=frame)

    if hasattr(action, "pose_markers"):
        marker = action.pose_markers.new(name=pose_name)
        marker.frame = frame

    return action


def convert_legacy_poses_to_action_asset(rig, poses_dict=None, action_name="CharMorph_Poses"):
    if poses_dict is None:
        char = library.obj_char(rig)
        poses_dict = char.poses if hasattr(char, "poses") else {}

    action = bpy.data.actions.new(name=action_name)
    frame = 1
    for pose_name, pose_data in poses_dict.items():
        convert_pose_dict_to_action(rig, pose_data, pose_name=pose_name, frame=frame, action=action)
        frame += 1

    if hasattr(action, "asset_mark"):
        action.asset_mark()

    return action


def poll(context):
    if not (context.mode in ["OBJECT", "POSE"] and context.active_object
            and context.active_object.type == "ARMATURE"
            and context.active_object.data.get("rig_id")):
        return False
    char = library.obj_char(context.active_object)
    return len(char.poses) > 0


class OpApplyPose(bpy.types.Operator):
    bl_idname = "charmorph.apply_pose"
    bl_label = "Apply pose"
    bl_description = "Apply selected pose"
    bl_options = {"UNDO"}

    @classmethod
    def poll(cls, context):
        return poll(context)

    def execute(self, context):  # pylint: disable=no-self-use
        apply_pose(context.window_manager.charmorph_ui, context)
        return {"FINISHED"}


def get_poses(_, context):
    return [(" ", "<select pose>", "")] + [(k, k, "") for k in sorted(library.obj_char(context.object).poses.keys())]


class UIProps:
    pose_ik2fk: bpy.props.BoolProperty(
        name="Apply pose to IK controllers",
        default=True,
        description="Apply poses designed for FK to IK controllers too (might be slow)")
    pose: bpy.props.EnumProperty(
        name="Pose",
        items=get_poses,
        description="Select pose from library")


class CHARMORPH_PT_Pose(bpy.types.Panel):
    bl_label = "Pose"
    bl_parent_id = "VIEW3D_PT_CharMorph"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_order = 11

    @classmethod
    def poll(cls, context):
        return poll(context)

    def draw(self, context):
        l = self.layout
        for prop in UIProps.__annotations__:  # pylint: disable=no-member
            l.prop(context.window_manager.charmorph_ui, prop)
        l.operator("charmorph.apply_pose")


classes = [CHARMORPH_PT_Pose, OpApplyPose]
