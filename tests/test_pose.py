import pytest
import sys
from unittest.mock import MagicMock

from mathutils import Matrix, Vector, Quaternion

# Import pose module after conftest has set up sys.modules for bpy and mathutils
import pose


class MockBone:
    def __init__(self, name, matrix_local=None):
        self.name = name
        self.matrix_local = matrix_local or Matrix.Identity(4)


class MockPoseBone:
    def __init__(self, name, matrix=None):
        self.name = name
        self.matrix = matrix or Matrix.Identity(4)
        self.bone = MockBone(name)
        self.rotation_mode = "QUATERNION"
        self.rotation_quaternion = Quaternion([1.0, 0.0, 0.0, 0.0])
        self.rotation_euler = (0.0, 0.0, 0.0)
        self.location = Vector([0.0, 0.0, 0.0])
        self.head = Vector([0.0, 0.0, 0.0])
        self.tail = Vector([0.0, 0.0, 1.0])
        self.parent = None
        self.custom_props = {}

    def __getitem__(self, item):
        return self.custom_props[item]

    def __setitem__(self, key, value):
        self.custom_props[key] = value

    def __contains__(self, item):
        return item in self.custom_props

    def get(self, key, default=None):
        return self.custom_props.get(key, default)

    def keyframe_insert(self, data_path, frame):
        pass


class MockArmatureData:
    def __init__(self, rig_id="test_rig_123"):
        self.data_dict = {"rig_id": rig_id}

    def __getitem__(self, item):
        return self.data_dict[item]

    def __setitem__(self, key, value):
        self.data_dict[key] = value

    def __contains__(self, item):
        return item in self.data_dict

    def get(self, key, default=None):
        return self.data_dict.get(key, default)


class MockRig:
    def __init__(self, name="TestRig", rig_id="test_rig_123"):
        self.name = name
        self.type = "ARMATURE"
        self.data = MockArmatureData(rig_id=rig_id)
        self.pose = MagicMock()
        self.bones_dict = {}

        # Add essential bones
        torso = MockPoseBone("torso")
        self.bones_dict["torso"] = torso

        self.pose.bones = MagicMock()
        self.pose.bones.get = lambda k, d=None: self.bones_dict.get(k, d)
        self.pose.bones.__getitem__ = lambda self_b, k: self.bones_dict[k]
        self.pose.bones.__iter__ = lambda self_b: iter(self.bones_dict.values())
        self.pose.bones.__contains__ = lambda self_b, k: k in self.bones_dict

    def evaluated_get(self, depsgraph):
        return self


class MockViewLayer:
    def __init__(self):
        self.update_called = False

    def update(self):
        self.update_called = True


class MockContext:
    def __init__(self, active_object):
        self.active_object = active_object
        self.object = active_object
        self.mode = "OBJECT"
        self.view_layer = MockViewLayer()
        self.window_manager = MagicMock()
        self.window_manager.charmorph_ui = MagicMock()
        self.window_manager.charmorph_ui.pose = "test_pose"
        self.window_manager.charmorph_ui.pose_ik2fk = True

    def evaluated_depsgraph_get(self):
        return "depsgraph"


def test_view_layer_update_called(monkeypatch):
    rig = MockRig()
    ctx = MockContext(rig)

    # Setup dummy pose in charlib library
    dummy_pose = {"root": [1.0, 0.0, 0.0, 0.0]}
    mock_char = MagicMock()
    mock_char.poses = {"test_pose": dummy_pose}
    monkeypatch.setattr(pose.library, "obj_char", lambda r: mock_char)

    pose.apply_pose(ctx.window_manager.charmorph_ui, ctx)

    assert ctx.view_layer.update_called is True, "context.view_layer.update() should be called during apply_pose"


def test_spine_rotation_consistency(monkeypatch):
    rig = MockRig()
    ctx = MockContext(rig)

    spine_fk = MockPoseBone("spine_fk")
    spine_fk1 = MockPoseBone("spine_fk.001")
    spine_fk2 = MockPoseBone("spine_fk.002")

    rig.bones_dict["spine_fk"] = spine_fk
    rig.bones_dict["spine_fk.001"] = spine_fk1
    rig.bones_dict["spine_fk.002"] = spine_fk2

    # Set initial quaternion on spine_fk1
    spine_fk1.rotation_quaternion = Quaternion([0.92388, 0.38268, 0.0, 0.0])  # ~45 deg rotation around X

    dummy_pose = {"spine01": [0.92388, 0.38268, 0.0, 0.0]}
    mock_char = MagicMock()
    mock_char.poses = {"test_pose": dummy_pose}
    monkeypatch.setattr(pose.library, "obj_char", lambda r: mock_char)

    pose.apply_pose(ctx.window_manager.charmorph_ui, ctx)

    # Ensure spine_fk rotation matches rest-pose matrix transformation rather than negated values
    assert spine_fk.rotation_quaternion[0] > 0, "Spine quaternion W should not be inverted to negative"


def test_rigify_module_scan_direct_inspection():
    rig = MockRig(rig_id="rig_direct_inspect")
    arm_parent = MockPoseBone("upper_arm_parent.L")
    arm_parent["prop_bone"] = "upper_arm_parent.L"
    arm_parent["fk_bones"] = ["upper_arm_fk.L", "forearm_fk.L", "hand_fk.L"]
    arm_parent["ik_bones"] = ["upper_arm_ik.L", "MCH-upper_arm_ik.L", "hand_ik.L"]
    arm_parent["ctrl_bones"] = ["upper_arm_ik.L", "hand_ik.L", "upper_arm_ik_target.L"]

    rig.bones_dict["upper_arm_parent.L"] = arm_parent

    pose.scan_rigify_modules(rig)

    assert "rig_direct_inspect" in pose.ik2fk_map
    limbs = pose.ik2fk_map["rig_direct_inspect"]
    assert len(limbs) == 1
    assert limbs[0]["prop_bone"] == "upper_arm_parent.L"
    assert limbs[0]["fk_bones"] == ["upper_arm_fk.L", "forearm_fk.L", "hand_fk.L"]


def test_ik_geometric_fallback():
    rig = MockRig()
    ctx = MockContext(rig)

    for side in ["L", "R"]:
        hand_fk = MockPoseBone(f"hand_fk.{side}")
        hand_ik = MockPoseBone(f"hand_ik.{side}")
        upper_arm_fk = MockPoseBone(f"upper_arm_fk.{side}")
        forearm_fk = MockPoseBone(f"forearm_fk.{side}")
        arm_pole = MockPoseBone(f"upper_arm_ik_target.{side}")

        # Set distinct translation for hand_fk
        fk_mat = Matrix.Identity(4)
        fk_mat.translation = Vector([1.5, 2.0, 0.5])
        hand_fk.matrix = fk_mat

        rig.bones_dict[f"hand_fk.{side}"] = hand_fk
        rig.bones_dict[f"hand_ik.{side}"] = hand_ik
        rig.bones_dict[f"upper_arm_fk.{side}"] = upper_arm_fk
        rig.bones_dict[f"forearm_fk.{side}"] = forearm_fk
        rig.bones_dict[f"upper_arm_ik_target.{side}"] = arm_pole

    pose.apply_ik_fallback(rig, ctx)

    # Check that hand_ik matrix matched hand_fk matrix
    assert rig.bones_dict["hand_ik.L"].matrix.translation == Vector([1.5, 2.0, 0.5])
    assert rig.bones_dict["hand_ik.R"].matrix.translation == Vector([1.5, 2.0, 0.5])


def test_convert_legacy_poses_to_action_asset():
    rig = MockRig()
    poses_dict = {
        "Pose1": {"root": [1.0, 0.0, 0.0, 0.0]},
        "Pose2": {"root": [0.707, 0.707, 0.0, 0.0]}
    }

    action = pose.convert_legacy_poses_to_action_asset(rig, poses_dict=poses_dict, action_name="Test_Action")

    assert action is not None
    assert action.name == "Test_Action"
    assert len(action.pose_markers.markers) == 2
    assert action.pose_markers.markers[0].name == "Pose1"
    assert action.pose_markers.markers[1].name == "Pose2"
    assert action.is_asset is True
