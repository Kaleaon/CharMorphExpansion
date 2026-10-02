# Automated test suite for PoseManager subsystem and Blender Pose Asset integration

import math
import sys
import types
import pytest

# Inject mock modules for Blender C-extensions if running outside Blender
class DummyRNA:
    properties = {"name": type("DummyProp", (), {"enum_items": []})()}

class DummyTypes(types.ModuleType):
    def __init__(self):
        super().__init__("bpy.types")
        self._cache = {}

    def __getattr__(self, item):
        if item.startswith("__"):
            raise AttributeError(item)
        if item not in self._cache:
            cls = type(item, (), {})
            cls.bl_rna = DummyRNA()
            self._cache[item] = cls
        return self._cache[item]

class DummyProps(types.ModuleType):
    def __init__(self):
        super().__init__("bpy.props")
        self._PropertyDeferred = type("_PropertyDeferred", (), {})

    def __getattr__(self, item):
        if item.startswith("__"):
            raise AttributeError(item)
        if item == "_PropertyDeferred":
            return self._PropertyDeferred
        return lambda *args, **kw: None

dummy_types_inst = DummyTypes()

class DummyModule(types.ModuleType):
    def __init__(self, name=""):
        super().__init__(name)
        self._mod_name = name
        self._children = {}
        self.persistent = lambda f: f
        h_mock = types.SimpleNamespace(persistent=lambda f: f)
        self.app = types.SimpleNamespace(handlers=h_mock, version=(3, 3, 0))
        self.types = dummy_types_inst
        self.props = DummyProps()
        self.utils = types.SimpleNamespace(
            register_classes_factory=lambda cls: (lambda: None, lambda: None)
        )

    def __getattr__(self, item):
        if item.startswith("__"):
            raise AttributeError(item)
        if self._mod_name in ("bpy.types", "types"):
            return getattr(self.types, item)
        if item == "props":
            return self.props
        if item == "types":
            return self.types
        if item and item[0].isupper():
            return type(item, (), {})
        if item not in self._children:
            self._children[item] = DummyModule(item)
        return self._children[item]

    def __call__(self, *args, **kwargs):
        return DummyModule()

    def __iter__(self):
        return iter([])

dummy_types_inst = DummyTypes()
bpy_mock = DummyModule("bpy")
bpy_app = DummyModule("bpy.app")
bpy_handlers = DummyModule("bpy.app.handlers")
bpy_handlers.persistent = lambda f: f
bpy_app.handlers = bpy_handlers
bpy_app.version = (3, 3, 0)
bpy_mock.app = bpy_app
bpy_mock.types = dummy_types_inst

io_utils_mock = DummyModule("bpy_extras.io_utils")
io_utils_mock.ImportHelper = type("ImportHelper", (), {})

bpy_extras_mock = DummyModule("bpy_extras")
bpy_extras_mock.io_utils = io_utils_mock

sys.modules['bpy_extras'] = bpy_extras_mock
sys.modules['bpy_extras.io_utils'] = io_utils_mock

for mod_name in [
    "bpy", "bpy.app", "bpy.app.handlers", "bpy.types", "bpy.props", "bpy.ops", "bpy.utils",
    "bmesh", "bpy_extras.wm_utils", "bpy_extras.wm_utils.progress_report", "rna_prop_ui", "idprop"
]:
    sys.modules[mod_name] = DummyModule(mod_name)

sys.modules['bpy'] = bpy_mock
sys.modules['bpy.app'] = bpy_app
sys.modules['bpy.app.handlers'] = bpy_handlers
sys.modules['bpy.types'] = dummy_types_inst
bpy_mock.types = dummy_types_inst

# Implement lightweight mathutils/bpy mocks if running outside Blender
class MockVector:
    def __init__(self, vals=(0, 0, 0)):
        self.vals = list(vals)

    def __getitem__(self, idx):
        return self.vals[idx]

    def __setitem__(self, idx, val):
        self.vals[idx] = val

    def __len__(self):
        return len(self.vals)

    @property
    def length(self):
        return math.sqrt(sum(x*x for x in self.vals))

    def normalized(self):
        l = self.length
        if l == 0:
            return MockVector((0, 0, 0))
        return MockVector([x / l for x in self.vals])

    def dot(self, other):
        return sum(a * b for a, b in zip(self.vals, other.vals))

    def copy(self):
        return MockVector(self.vals.copy())

    def __add__(self, other):
        return MockVector([a + b for a, b in zip(self.vals, other.vals)])

    def __sub__(self, other):
        return MockVector([a - b for a, b in zip(self.vals, other.vals)])

    def __mul__(self, scalar):
        return MockVector([a * scalar for a in self.vals])

    def __rmul__(self, scalar):
        return self.__mul__(scalar)

    def __repr__(self):
        return f"MockVector({self.vals})"


class MockQuaternion:
    def __init__(self, vals=(1, 0, 0, 0)):
        self.vals = list(vals)

    def __getitem__(self, idx):
        return self.vals[idx]

    def __setitem__(self, idx, val):
        self.vals[idx] = val

    def __len__(self):
        return 4

    def copy(self):
        return MockQuaternion(self.vals.copy())

    def __matmul__(self, other):
        return MockQuaternion(self.vals.copy())

    def __repr__(self):
        return f"MockQuaternion({self.vals})"


class MockMatrix:
    def __init__(self, rows=None):
        if rows is None:
            self.rows = [[1 if i == j else 0 for j in range(4)] for i in range(4)]
        else:
            self.rows = [list(r) for r in rows]

    @classmethod
    def Identity(cls, size=4):
        return cls([[1 if i == j else 0 for j in range(size)] for i in range(size)])

    @classmethod
    def Rotation(cls, angle, size=4, axis=(0, 0, 1)):
        return cls.Identity(size)

    def copy(self):
        return MockMatrix([list(r) for r in self.rows])

    def to_3x3(self):
        return self

    def to_4x4(self):
        return self

    def to_quaternion(self):
        return MockQuaternion([1, 0, 0, 0])

    def __getitem__(self, idx):
        return self.rows[idx]

    def __matmul__(self, other):
        if isinstance(other, MockVector):
            return MockVector(other.vals)
        if isinstance(other, MockQuaternion):
            return MockQuaternion(other.vals)
        if isinstance(other, MockMatrix):
            return MockMatrix()
        if isinstance(other, (list, tuple)):
            return MockVector(other) if len(other) == 3 else MockQuaternion(other)
        return other

    @property
    def translation(self):
        return MockVector((self.rows[0][3], self.rows[1][3], self.rows[2][3]))

    @translation.setter
    def translation(self, val):
        v = list(val)
        self.rows[0][3] = v[0]
        self.rows[1][3] = v[1]
        self.rows[2][3] = v[2]


class MockMathutils(types.ModuleType):
    def __init__(self):
        super().__init__("mathutils")
        self.Matrix = MockMatrix
        self.Vector = MockVector
        self.Quaternion = MockQuaternion

sys.modules['mathutils'] = MockMathutils()

# Setup mock mathutils module if needed
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pose_manager

if pose_manager.Matrix is None or not hasattr(pose_manager.Matrix, "Identity"):
    pose_manager.Matrix = MockMatrix
    pose_manager.Vector = MockVector
    pose_manager.Quaternion = MockQuaternion
    pose_manager.m1 = MockMatrix.Identity(4)
    pose_manager.m2 = pose_manager.m1.copy()
    pose_manager.m2.rows[1][1] = -1
    pose_manager.m2.rows[3][3] = -1
    pose_manager.shoulder_rot = {
        "L": MockMatrix.Identity(4),
        "R": MockMatrix.Identity(4),
    }
    pose_manager.flip_x_z = {
        "L": MockMatrix.Identity(4),
        "R": MockMatrix.Identity(4),
    }


class MockBoneData:
    def __init__(self, name=""):
        self.name = name
        self.matrix_local = MockMatrix()


class MockPoseBone:
    def __init__(self, name=""):
        self.name = name
        self.bone = MockBoneData(name)
        self.rotation_mode = "QUATERNION"
        self.rotation_quaternion = MockQuaternion([1, 0, 0, 0])
        self.location = MockVector([0, 0, 0])
        self.head = MockVector([0, 0, 0])
        self.tail = MockVector([0, 0, 0])
        self.matrix = MockMatrix()
        self.props = {}

    def __getitem__(self, key):
        return self.props[key]

    def __setitem__(self, key, val):
        self.props[key] = val

    def get(self, key, default=None):
        return self.props.get(key, default)


class MockArmatureData:
    def __init__(self, rig_id="test_rig_123"):
        self.props = {"rig_id": rig_id}

    def get(self, key, default=None):
        return self.props.get(key, default)


class MockRig:
    def __init__(self, rig_id="test_rig_123"):
        self.type = "ARMATURE"
        self.data = MockArmatureData(rig_id)
        self.pose_bones = {}
        self.pose = type("MockPose", (), {"bones": self.pose_bones})()

    def add_bone(self, name):
        b = MockPoseBone(name)
        self.pose_bones[name] = b
        return b


class MockKeyframePoint:
    def __init__(self, frame=1, value=0.0):
        self.co = (frame, value)


class MockKeyframePoints:
    def __init__(self):
        self.points = []

    def insert(self, frame=1, value=0.0):
        kp = MockKeyframePoint(frame, value)
        self.points.append(kp)
        return kp

    def __iter__(self):
        return iter(self.points)

    def __len__(self):
        return len(self.points)

    def __getitem__(self, idx):
        return self.points[idx]


class MockFCurve:
    def __init__(self, data_path="", index=0):
        self.data_path = data_path
        self.array_index = index
        self.keyframe_points = MockKeyframePoints()


class MockAction:
    def __init__(self, name=""):
        self.name = name
        self.use_fake_user = False
        self.fcurve_list = []
        self.fcurves = type("MockFCurves", (), {
            "new": self._new_fcurve,
            "find": self._find_fcurve,
            "__iter__": lambda s: iter(self.fcurve_list),
        })()
        self.is_asset = False

    def _new_fcurve(self, data_path="", index=0):
        fc = MockFCurve(data_path, index)
        self.fcurve_list.append(fc)
        return fc

    def _find_fcurve(self, data_path="", index=0):
        for fc in self.fcurve_list:
            if fc.data_path == data_path and fc.array_index == index:
                return fc
        return None

    def asset_mark(self):
        self.is_asset = True


# Unit Tests
def test_rest_pose_matrix_mapper_defaults():
    mapper = pose_manager.RestPoseMatrixMapper()
    target_name, mat = mapper.get_target_bone_info("root")
    assert target_name == "root"
    assert mat is not None

    target_name, mat = mapper.get_target_bone_info("pelvis")
    assert target_name == "torso"
    assert mat is None  # Computed dynamically


def test_rest_pose_matrix_mapper_computation():
    mapper = pose_manager.RestPoseMatrixMapper()
    rig = MockRig()
    rig.add_bone("torso")
    rig.add_bone("shoulder.L")

    pelvis_mat = mapper.compute_rest_transform(rig, "torso", "pelvis")
    assert pelvis_mat is not None

    target_name, quat = mapper.map_bone_rotation(rig, "pelvis", [1.0, 0.0, 0.0, 0.0])
    assert target_name == "torso"
    assert quat is not None


def test_spine_chain_dynamic_mapping():
    mapper = pose_manager.RestPoseMatrixMapper()
    rig = MockRig()
    s_base = rig.add_bone("spine_fk")
    s1 = rig.add_bone("spine_fk.001")
    s2 = rig.add_bone("spine_fk.002")

    s1.rotation_quaternion = MockQuaternion([0.95, 0.1, 0.0, 0.0])
    mapper.apply_spine_chain(rig, {"spine01": [0.95, 0.1, 0.0, 0.0]})

    assert s_base.rotation_mode == "QUATERNION"
    assert s_base.rotation_quaternion[0] == -0.95
    assert s2.rotation_mode == "QUATERNION"


def test_two_pass_solver_pass1_fk():
    pm = pose_manager.PoseManager()
    rig = MockRig()
    t_bone = rig.add_bone("torso")
    s1_bone = rig.add_bone("spine_fk.001")
    arm_bone = rig.add_bone("upper_arm_fk.L")

    pose_data = {
        "pelvis": [1.0, 0.0, 0.0, 0.0],
        "spine01": [0.99, 0.01, 0.0, 0.0],
        "upperarm_L": [0.9, 0.2, 0.0, 0.0],
    }

    ik_fk_states = pm.pass_1_fk(rig, pose_data)
    assert arm_bone.rotation_mode == "QUATERNION"
    assert arm_bone.rotation_quaternion is not None


def test_vector_projection_ik_solver():
    pm = pose_manager.PoseManager()
    rig = MockRig()

    # Set up FK limb bones with head positions
    root_bone = rig.add_bone("upper_arm_fk.L")
    root_bone.head = MockVector([0.2, 0.0, 1.5])

    mid_bone = rig.add_bone("forearm_fk.L")
    mid_bone.head = MockVector([0.5, -0.1, 1.2])

    end_bone = rig.add_bone("hand_fk.L")
    end_bone.head = MockVector([0.8, 0.0, 0.9])

    ik_bone = rig.add_bone("hand_ik.L")
    pole_bone = rig.add_bone("upper_arm_ik_target.L")

    pm._vector_projection_ik_solver(rig)

    # Verify pole target position calculated without error
    assert pole_bone.location is not None or pole_bone.matrix is not None


def test_pose_asset_conversion_roundtrip():
    pm = pose_manager.PoseManager()

    # Mock bpy.data.actions
    pose_manager.bpy.data.actions.new = lambda name: MockAction(name)

    pose_data = {
        "root": [1.0, 0.0, 0.0, 0.0],
        "upperarm_L": [0.9, 0.1, 0.0, 0.0],
    }

    rig = MockRig()
    action = pm.mblab_pose_to_action(pose_data, "TestPoseAsset", rig)
    assert action is not None
    assert action.name == "TestPoseAsset"
    assert action.is_asset

    # Convert back
    recovered_pose = pm.action_to_mblab_pose(action, rig)
    assert "upperarm_L" in recovered_pose or "upper_arm_fk.L" in recovered_pose


def test_custom_rig_fallback_handling():
    pm = pose_manager.PoseManager()
    custom_rig = MockRig(rig_id="")
    # Custom armature with missing IK controllers
    custom_rig.add_bone("spine_fk.001")

    pose_data = {"spine01": [1.0, 0.0, 0.0, 0.0]}

    # Should apply FK pass and fall back gracefully without unhandled errors
    pm.apply_pose(custom_rig, pose_data, apply_ik2fk=True)
    assert custom_rig.pose_bones["spine_fk.001"].rotation_mode == "QUATERNION"
