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

import logging
import bpy  # pylint: disable=import-error

try:
    from .lib.charlib import library
except Exception:
    library = None
from .pose_manager import PoseManager, RestPoseMatrixMapper, m1, m2, flip_x_z, qrotation, shoulder_rot

logger = logging.getLogger(__name__)

# Legacy compatibility exports
_global_pose_manager = PoseManager()
bone_map = _global_pose_manager.mapper.bone_map
ik2fk_map = _global_pose_manager.ik2fk_map


def scan_rigify_modules():
    _global_pose_manager.scan_rigify_modules()


def apply_pose(ui, context):
    _global_pose_manager.apply_pose_ui(ui, context)


def poll(context):
    if not (context.mode in ["OBJECT", "POSE"] and context.active_object
            and context.active_object.type == "ARMATURE"
            and context.active_object.data.get("rig_id")):
        return False
    if not library:
        return True
    char = library.obj_char(context.active_object)
    return char is not None and len(getattr(char, "poses", {})) >= 0


class OpApplyPose(bpy.types.Operator):
    bl_idname = "charmorph.apply_pose"
    bl_label = "Apply pose"
    bl_description = "Apply selected pose"
    bl_options = {"UNDO"}

    @classmethod
    def poll(cls, context):
        return poll(context)

    def execute(self, context):
        ui = context.window_manager.charmorph_ui
        pm = PoseManager()

        pose_type = getattr(ui, "pose_type", "MBLAB")
        if pose_type == "ASSET":
            action_name = getattr(ui, "action_pose", "")
            if not action_name or action_name == " ":
                self.report({'WARNING'}, "No pose asset action selected")
                return {'CANCELLED'}
            action = bpy.data.actions.get(action_name)
            if not action:
                self.report({'ERROR'}, f"Action {action_name} not found")
                return {'CANCELLED'}
            apply_ik2fk = getattr(ui, "pose_ik2fk", True)
            pm.apply_action_pose(context.active_object, action, context=context, apply_ik2fk=apply_ik2fk)
        else:
            pm.apply_pose_ui(ui, context)

        return {"FINISHED"}


class OpConvertPoseToAsset(bpy.types.Operator):
    bl_idname = "charmorph.convert_pose_to_asset"
    bl_label = "Convert to Pose Asset"
    bl_description = "Convert selected MB-Lab pose to Blender native Action pose asset"
    bl_options = {"UNDO"}

    @classmethod
    def poll(cls, context):
        return poll(context)

    def execute(self, context):
        ui = context.window_manager.charmorph_ui
        if not ui.pose or ui.pose == " ":
            self.report({'WARNING'}, "No pose selected")
            return {'CANCELLED'}
        rig = context.active_object
        char = library.obj_char(rig)
        if not char or not hasattr(char, "poses"):
            return {'CANCELLED'}
        pose_data = char.poses.get(ui.pose)
        if not pose_data:
            self.report({'ERROR'}, f"Pose {ui.pose} not found")
            return {'CANCELLED'}

        pm = PoseManager()
        action = pm.mblab_pose_to_action(pose_data, f"PoseAsset_{ui.pose}", rig)
        if action:
            self.report({'INFO'}, f"Created Pose Asset Action: {action.name}")
            return {'FINISHED'}
        return {'CANCELLED'}


class OpConvertAssetToPose(bpy.types.Operator):
    bl_idname = "charmorph.convert_asset_to_pose"
    bl_label = "Convert Asset to MB-Lab Pose"
    bl_description = "Convert native Pose Asset Action back to MB-Lab pose dictionary format"
    bl_options = {"UNDO"}

    @classmethod
    def poll(cls, context):
        return poll(context)

    def execute(self, context):
        ui = context.window_manager.charmorph_ui
        action_name = getattr(ui, "action_pose", "")
        if not action_name or action_name == " ":
            self.report({'WARNING'}, "No pose asset action selected")
            return {'CANCELLED'}
        action = bpy.data.actions.get(action_name)
        if not action:
            self.report({'ERROR'}, f"Action {action_name} not found")
            return {'CANCELLED'}

        pm = PoseManager()
        pose_dict = pm.action_to_mblab_pose(action, context.active_object)
        if pose_dict:
            rig = context.active_object
            char = library.obj_char(rig)
            if hasattr(char, "poses"):
                char.poses[action_name] = pose_dict
            self.report({'INFO'}, f"Converted Action {action_name} to MB-Lab pose format")
            return {'FINISHED'}
        return {'CANCELLED'}


def get_poses(_, context):
    if not context or not getattr(context, "object", None) or not library:
        return [(" ", "<select pose>", "")]
    char = library.obj_char(context.object)
    if not char or not hasattr(char, "poses"):
        return [(" ", "<select pose>", "")]
    return [(" ", "<select pose>", "")] + [(k, k, "") for k in sorted(char.poses.keys())]


def get_action_poses(_, context):
    actions = [(" ", "<select pose asset>", "")]
    if bpy and hasattr(bpy.data, "actions"):
        for act in sorted(bpy.data.actions, key=lambda a: a.name):
            actions.append((act.name, act.name, ""))
    return actions


class UIProps:
    pose_type: bpy.props.EnumProperty(
        name="Pose Source",
        items=[
            ("MBLAB", "MB-Lab Library", "Use MB-Lab JSON pose library"),
            ("ASSET", "Blender Pose Asset", "Use native Blender Action pose asset"),
        ],
        default="MBLAB",
        description="Source format for pose application",
    )
    pose_ik2fk: bpy.props.BoolProperty(
        name="Apply pose to IK controllers",
        default=True,
        description="Apply poses designed for FK to IK controllers too")
    pose: bpy.props.EnumProperty(
        name="Pose",
        items=get_poses,
        description="Select pose from library")
    action_pose: bpy.props.EnumProperty(
        name="Pose Asset",
        items=get_action_poses,
        description="Select native Blender Action pose asset")


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
        ui = context.window_manager.charmorph_ui

        l.prop(ui, "pose_type")
        if getattr(ui, "pose_type", "MBLAB") == "ASSET":
            l.prop(ui, "action_pose")
            l.operator("charmorph.convert_asset_to_pose")
        else:
            l.prop(ui, "pose")
            l.operator("charmorph.convert_pose_to_asset")

        l.prop(ui, "pose_ik2fk")
        l.operator("charmorph.apply_pose")


classes = [CHARMORPH_PT_Pose, OpApplyPose, OpConvertPoseToAsset, OpConvertAssetToPose]
