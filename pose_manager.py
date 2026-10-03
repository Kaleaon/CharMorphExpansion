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

import logging
import re

try:
    import bpy  # pylint: disable=import-error
    from mathutils import Matrix, Vector, Quaternion  # pylint: disable=import-error
    if not hasattr(Matrix, "Identity"):
        raise ImportError("mathutils missing Matrix.Identity")
except Exception:
    bpy = None
    Matrix = None
    Vector = None
    Quaternion = None

try:
    from .lib.charlib import library
except Exception:
    try:
        from lib.charlib import library
    except Exception:
        library = None

logger = logging.getLogger(__name__)

# Basic transformation matrices
if Matrix:
    m1 = Matrix.Identity(4)
    m2 = m1.copy()
    m2[1][1] = -1
    m2[3][3] = -1

    def qrotation(mat):
        def rot(v):
            return (v[3], v[0], v[1], v[2])
        return Matrix((rot(mat[3]), rot(mat[0]), rot(mat[1]), rot(mat[2])))

    shoulder_angle = 1.3960005939006805
    shoulder_rot = {
        "L": qrotation(Matrix.Rotation(shoulder_angle, 4, (0, 1, 0))),
        "R": qrotation(Matrix.Rotation(-shoulder_angle, 4, (0, 1, 0))),
    }
    flip_x_z = {
        "L": Matrix(((1, 0, 0, 0), (0, 0, 0, 1), (0, 0, -1, 0), (0, -1, 0, 0))),
        "R": Matrix(((1, 0, 0, 0), (0, 0, 0, -1), (0, 0, 1, 0), (0, 1, 0, 0))),
    }
else:
    m1 = None
    m2 = None
    shoulder_rot = {}
    flip_x_z = {}


classes = []

class RestPoseMatrixMapper:
    """Rest-pose matrix mapper replacing hardcoded quaternions with dynamic rest pose matrix calculations."""

    def __init__(self):
        self.bone_map = self._build_default_bone_map()

    def _build_default_bone_map(self):
        if not Matrix:
            return {}
        bm = {
            "root": ("root", m2),
            "pelvis": ("torso", None),  # Computed dynamically from rest pose if None
            "spine01": ("spine_fk.001", m1),
            "spine02": ("spine_fk.002", m1),
            "spine03": ("spine_fk.003", m1),
            "neck": ("neck", m1),
            "head": ("head", m1),
        }
        for side in ["L", "R"]:
            bm["thigh_" + side] = ("thigh_fk." + side, m2)
            bm["calf_" + side] = ("shin_fk." + side, m2)
            bm["foot_" + side] = ("foot_fk." + side, m2)
            bm["toes_" + side] = ("toe." + side, m1)
            bm["breast_" + side] = ("breast." + side, m1)
            bm["clavicle_" + side] = ("shoulder." + side, None)  # Computed dynamically
            bm["upperarm_" + side] = ("upper_arm_fk." + side, m1)
            bm["lowerarm_" + side] = ("forearm_fk." + side, m1)
            bm["hand_" + side] = ("hand_fk." + side, flip_x_z[side])
            for i in range(1, 4):
                is_master = "_master" if i == 1 else ""
                bm[f"thumb0{i}_{side}"] = (f"thumb.0{i}{is_master}.{side}", m2)
                for finger in ["index", "middle", "ring", "pinky"]:
                    bm[f"{finger}0{i}_{side}"] = (f"f_{finger}.0{i}{is_master}.{side}", m2)
        return bm

    def get_target_bone_info(self, mblab_bone_name):
        """Returns tuple (target_bone_name, transform_matrix_or_None)."""
        return self.bone_map.get(mblab_bone_name, ("", None))

    def get_reverse_bone_map(self):
        """Returns map from target_bone_name to mblab_bone_name."""
        rev = {}
        for k, (target_name, _) in self.bone_map.items():
            if target_name:
                rev[target_name] = k
        return rev

    def compute_rest_transform(self, rig, target_bone_name, mblab_bone_name):
        """Computes transformation matrix for target bone based on rest-pose matrix if not hardcoded."""
        info = self.get_target_bone_info(mblab_bone_name)
        if info[1] is not None:
            return info[1]

        # Dynamic rest pose calculation for pelvis or shoulder if matrix is None
        if not rig or not hasattr(rig, "pose") or target_bone_name not in rig.pose.bones:
            if mblab_bone_name == "pelvis" and Matrix:
                return qrotation(Matrix.Rotation(1.4466689567595232, 4, (1, 0, 0)))
            if mblab_bone_name.startswith("clavicle_") and Matrix:
                side = mblab_bone_name.split("_")[-1]
                return shoulder_rot.get(side, m1)
            return m1 if Matrix else None

        pose_bone = rig.pose.bones[target_bone_name]
        bone = getattr(pose_bone, "bone", None)
        if bone and hasattr(bone, "matrix_local") and Matrix:
            # Use rest pose matrix orientation relative to parent or world
            rest_mat = bone.matrix_local.to_3x3().to_4x4()
            return rest_mat
        return m1 if Matrix else None

    def map_bone_rotation(self, rig, mblab_bone_name, rot_val):
        """Maps MB-Lab rotation value (4D vector/quaternion) to Quaternion for target bone."""
        target_name, mat = self.get_target_bone_info(mblab_bone_name)
        if not target_name:
            return "", None

        if mat is None:
            mat = self.compute_rest_transform(rig, target_name, mblab_bone_name)

        if Vector and mat:
            vec_val = Vector(rot_val)
            quat = mat @ vec_val
            return target_name, quat
        return target_name, rot_val

    def apply_spine_chain(self, rig, pose_dict):
        """Applies dynamic spine rotations across spine chain to prevent torso distortion."""
        if not rig or not hasattr(rig, "pose"):
            return

        spine_fk = rig.pose.bones.get("spine_fk")
        spine_fk1 = rig.pose.bones.get("spine_fk.001")
        spine_fk2 = rig.pose.bones.get("spine_fk.002")
        spine_fk3 = rig.pose.bones.get("spine_fk.003")

        if spine_fk1:
            q = getattr(spine_fk1, "rotation_quaternion", None)
            if q is not None and Quaternion:
                if spine_fk:
                    # Rest-aligned base spine orientation
                    spine_fk.rotation_mode = "QUATERNION"
                    spine_fk.rotation_quaternion = Quaternion((-q[0], q[1], q[2], q[3]))
                if spine_fk2:
                    spine_fk2.rotation_mode = "QUATERNION"
                    spine_fk2.rotation_quaternion = spine_fk2.rotation_quaternion @ q
                if spine_fk3 and "spine03" not in pose_dict:
                    spine_fk3.rotation_mode = "QUATERNION"
                    spine_fk3.rotation_quaternion = q.copy()


class PoseManager:
    """Decoupled PoseManager subsystem handling two-pass IK/FK solver and Pose Asset integration."""

    def __init__(self):
        self.mapper = RestPoseMatrixMapper()
        self.ik2fk_map = {}
        self.re_rigid = re.compile(r'^rig_id = "([0-9a-z]*)"$', re.MULTILINE)

    def scan_rigify_modules(self):
        """Scans loaded texts in Blender for Rigify operator definitions."""
        if not bpy or not hasattr(bpy.data, "texts"):
            return
        for t in bpy.data.texts:
            s = t.as_string()
            m = self.re_rigid.search(s)
            if not m:
                continue
            rig_id = m.group(1)
            limbs = []
            s = s[m.end(0) + 1:]
            re_operator = re.compile(rf"^( *)props = [0-9a-z_]*\.operator\('pose.rigify_limb_ik2fk_{rig_id}'", re.MULTILINE)

            while True:
                m = re_operator.search(s)
                if not m:
                    break
                indent = m.group(1)
                re_prop = re.compile(rf"{indent}props.([0-9a-z_]*) = '([^']*)'$")
                props = {}
                while True:
                    s = s[m.end(0):]
                    s = s[s.find("\n") + 1:]
                    line = s[:s.find("\n")]
                    m = re_prop.match(line)
                    if not m:
                        break
                    props[m.group(1)] = m.group(2)
                if len(props) > 0:
                    limbs.append(props)
            if len(limbs) > 0:
                self.ik2fk_map[rig_id] = limbs

    def pass_1_fk(self, rig, pose_data, context=None):
        """Pass 1: Apply FK rotations and calculate torso ground offset."""
        if not rig or not hasattr(rig, "pose"):
            return

        # Configure limb follow properties
        ik_fk_states = {}
        torso = rig.pose.bones.get("torso")
        if torso:
            torso["neck_follow"] = 1.0
            torso["head_follow"] = 1.0

        for side in ["L", "R"]:
            for limb in ["upper_arm", "thigh"]:
                bone = rig.pose.bones.get(f"{limb}_parent.{side}")
                if bone:
                    bone["fk_limb_follow"] = 0.0
                    ik_fk_states[bone.name] = bone.get("IK_FK", 1.0)
                    bone["IK_FK"] = 1.0

        # Reset pose bone transforms if in Blender context
        if bpy and context and hasattr(bpy.ops, "pose"):
            try:
                old_mode = getattr(context, "mode", "OBJECT")
                if hasattr(bpy.ops.object, "mode_set"):
                    bpy.ops.object.mode_set(mode="POSE")
                if hasattr(bpy.ops.pose, "select_all"):
                    bpy.ops.pose.select_all(action="SELECT")
                    bpy.ops.pose.loc_clear()
                    bpy.ops.pose.rot_clear()
                    bpy.ops.pose.scale_clear()
            except Exception as e:
                logger.debug("Failed to reset pose mode ops: %s", e)
            finally:
                if old_mode and hasattr(bpy.ops.object, "mode_set"):
                    try:
                        bpy.ops.object.mode_set(mode=old_mode)
                    except Exception:
                        pass

        # Apply mapped FK bone rotations
        for mblab_name, rot_val in pose_data.items():
            target_name, quat = self.mapper.map_bone_rotation(rig, mblab_name, rot_val)
            target_bone = rig.pose.bones.get(target_name)
            if not target_bone:
                logger.debug("no target bone for %s (%s)", mblab_name, target_name)
                continue
            target_bone.rotation_mode = "QUATERNION"
            target_bone.rotation_quaternion = quat

        # Dynamic spine adjustment
        self.mapper.apply_spine_chain(rig, pose_data)

        # Calculate lowest point for sitting / posture alignment
        if context and hasattr(context, "evaluated_depsgraph_get"):
            try:
                erig = rig.evaluated_get(context.evaluated_depsgraph_get())
                torso = rig.pose.bones.get("torso")
                min_z = torso.head[2] if torso and hasattr(torso, "head") else 0.0
                for bone in erig.pose.bones:
                    if not bone.name.startswith("ORG-"):
                        continue
                    for attr in ["head", "tail"]:
                        val = getattr(bone, attr, (0, 0, 0))
                        if val[2] < min_z:
                            min_z = val[2]
                min_z = max(min_z, 0)
                if torso:
                    torso.location = (0, 0, -min_z)
            except Exception as e:
                logger.debug("Evaluated depsgraph lowest point calculation skipped: %s", e)

        # Update view layer / depsgraph
        if context and hasattr(context, "view_layer") and hasattr(context.view_layer, "update"):
            context.view_layer.update()

        return ik_fk_states

    def pass_2_ik_solver(self, rig, context, ik_fk_states=None):
        """Pass 2: IK/FK synchronization via Rigify operator or geometric vector projection fallback."""
        if not rig or not hasattr(rig, "pose"):
            return

        rig_id = rig.data.get("rig_id") if hasattr(rig, "data") and rig.data else ""
        operator_succeeded = False

        # Attempt Rigify operator
        if rig_id and bpy and hasattr(bpy.ops, "pose"):
            op_id = f"rigify_limb_ik2fk_{rig_id}"
            if hasattr(bpy.ops.pose, op_id):
                op = getattr(bpy.ops.pose, op_id)
                if not op.poll or op.poll():
                    if rig_id not in self.ik2fk_map:
                        self.scan_rigify_modules()
                    limbs = self.ik2fk_map.get(rig_id)
                    if limbs:
                        fail = False
                        for limb in limbs:
                            try:
                                res = op(**limb)
                                if "FINISHED" not in res:
                                    fail = True
                            except Exception as e:
                                logger.debug("Rigify operator failed: %s", e)
                                fail = True
                        if not fail:
                            operator_succeeded = True

        # Fallback to 3D vector projection solver
        if not operator_succeeded:
            logger.info("Executing geometric vector projection IK solver fallback")
            self._vector_projection_ik_solver(rig)

        # Restore IK_FK bone properties
        if ik_fk_states and hasattr(rig, "pose"):
            for k, v in ik_fk_states.items():
                if k in rig.pose.bones:
                    rig.pose.bones[k]["IK_FK"] = v

    def _vector_projection_ik_solver(self, rig):
        """Vector projection solver to position IK controllers and pole targets matching FK pose."""
        if not Vector:
            return

        limbs = [
            # Arm limbs
            {"side": "L", "root": "upper_arm_fk.L", "mid": "forearm_fk.L", "end": "hand_fk.L", "ik": "hand_ik.L", "pole": "upper_arm_ik_target.L"},
            {"side": "R", "root": "upper_arm_fk.R", "mid": "forearm_fk.R", "end": "hand_fk.R", "ik": "hand_ik.R", "pole": "upper_arm_ik_target.R"},
            # Leg limbs
            {"side": "L", "root": "thigh_fk.L", "mid": "shin_fk.L", "end": "foot_fk.L", "ik": "foot_ik.L", "pole": "thigh_ik_target.L"},
            {"side": "R", "root": "thigh_fk.R", "mid": "shin_fk.R", "end": "foot_fk.R", "ik": "foot_ik.R", "pole": "thigh_ik_target.R"},
        ]

        for limb in limbs:
            root_bone = rig.pose.bones.get(limb["root"])
            mid_bone = rig.pose.bones.get(limb["mid"])
            end_bone = rig.pose.bones.get(limb["end"])
            ik_bone = rig.pose.bones.get(limb["ik"])
            pole_bone = rig.pose.bones.get(limb["pole"])

            if not (root_bone and mid_bone and end_bone):
                continue

            # Get positions
            p_root = Vector(getattr(root_bone, "head", (0, 0, 0)))
            p_mid = Vector(getattr(mid_bone, "head", (0, 0, 0)))
            p_end = Vector(getattr(end_bone, "head", (0, 0, 0)))

            # Align IK controller to end bone position & rotation
            if ik_bone:
                ik_bone.rotation_mode = "QUATERNION"
                if hasattr(end_bone, "rotation_quaternion"):
                    ik_bone.rotation_quaternion = end_bone.rotation_quaternion.copy()
                if hasattr(end_bone, "matrix"):
                    ik_bone.matrix = end_bone.matrix.copy()

            # Vector projection for pole target
            if pole_bone:
                axis = p_end - p_root
                axis_length = axis.length
                if axis_length > 1e-5:
                    axis_dir = axis.normalized()
                    v_mid = p_mid - p_root
                    proj_length = v_mid.dot(axis_dir)
                    p_proj = p_root + axis_dir * proj_length
                    pole_vec = p_mid - p_proj

                    if pole_vec.length < 1e-5:
                        # Fallback for straight limbs
                        pole_dir = Vector((0, -1, 0)) if "thigh" in limb["root"] else Vector((0, 0, -1))
                    else:
                        pole_dir = pole_vec.normalized()

                    # Distance offset for pole target
                    pole_dist = (p_mid - p_root).length + (p_end - p_mid).length
                    pole_pos = p_mid + pole_dir * (pole_dist * 0.5)

                    if hasattr(pole_bone, "matrix"):
                        mat = pole_bone.matrix.copy()
                        mat.translation = pole_pos
                        pole_bone.matrix = mat
                    elif hasattr(pole_bone, "location"):
                        pole_bone.location = pole_pos

    def apply_pose(self, rig, pose_data, context=None, apply_ik2fk=True):
        """Applies pose using two-pass solver engine."""
        if not rig or not pose_data:
            return

        ik_fk_states = self.pass_1_fk(rig, pose_data, context)

        if apply_ik2fk:
            self.pass_2_ik_solver(rig, context, ik_fk_states)

    def apply_pose_ui(self, ui, context):
        """Delegates UI operator pose application to PoseManager."""
        if not ui or not hasattr(ui, "pose") or not ui.pose or ui.pose == " ":
            return
        rig = getattr(context, "active_object", None)
        if not rig:
            return

        if not library:
            return

        char = library.obj_char(rig)
        if not char or not hasattr(char, "poses"):
            return

        pose = char.poses.get(ui.pose)
        if not pose:
            logger.error("pose not found %s %s", ui.pose, rig)
            return

        apply_ik2fk = getattr(ui, "pose_ik2fk", True)
        self.apply_pose(rig, pose, context=context, apply_ik2fk=apply_ik2fk)

    # Blender Pose Asset Bridge
    def mblab_pose_to_action(self, pose_data, action_name, rig=None):
        """Converts MB-Lab pose dictionary into a native Blender Action Pose Asset."""
        if not bpy or not hasattr(bpy.data, "actions"):
            return None

        action = bpy.data.actions.new(name=action_name)

        if hasattr(action, "use_fake_user"):
            action.use_fake_user = True

        for mblab_name, rot_val in pose_data.items():
            target_name, quat = self.mapper.map_bone_rotation(rig, mblab_name, rot_val)
            if not target_name or quat is None:
                continue

            q_list = [quat[0], quat[1], quat[2], quat[3]] if hasattr(quat, "__getitem__") else list(quat)
            for i in range(4):
                data_path = f'pose.bones["{target_name}"].rotation_quaternion'
                fc = action.fcurves.find(data_path, index=i)
                if not fc:
                    fc = action.fcurves.new(data_path=data_path, index=i)
                fc.keyframe_points.insert(frame=1, value=q_list[i])

        if hasattr(action, "asset_mark"):
            try:
                action.asset_mark()
            except Exception as e:
                logger.debug("asset_mark failed: %s", e)

        return action

    def action_to_mblab_pose(self, action, rig=None):
        """Extracts MB-Lab pose dictionary from a Blender Action Pose Asset."""
        if not action or not hasattr(action, "fcurves"):
            return {}

        rev_map = self.mapper.get_reverse_bone_map()
        bone_quats = {}

        pattern = re.compile(r'^pose\.bones\["([^"]+)"\]\.rotation_quaternion$')

        for fc in action.fcurves:
            m = pattern.match(fc.data_path)
            if not m:
                continue
            target_bone_name = m.group(1)
            idx = fc.array_index

            if target_bone_name not in bone_quats:
                bone_quats[target_bone_name] = [1.0, 0.0, 0.0, 0.0]

            val = 1.0
            if len(fc.keyframe_points) > 0:
                val = fc.keyframe_points[0].co[1]

            if 0 <= idx < 4:
                bone_quats[target_bone_name][idx] = val

        pose_dict = {}
        for target_name, q_val in bone_quats.items():
            mblab_name = rev_map.get(target_name, target_name)
            pose_dict[mblab_name] = q_val

        return pose_dict

    def apply_action_pose(self, rig, action, context=None, apply_ik2fk=True):
        """Applies a Blender Action Pose Asset to target rig."""
        pose_data = self.action_to_mblab_pose(action, rig)
        if pose_data:
            self.apply_pose(rig, pose_data, context=context, apply_ik2fk=apply_ik2fk)
