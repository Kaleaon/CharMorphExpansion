import sys
import types
import numpy as np

# Injected mock modules for headless testing
for mod_name in ['addon_utils', 'rna_prop_ui', 'gpu', 'gpu_extras', 'idprop']:
    if mod_name not in sys.modules:
        m = types.ModuleType(mod_name)
        if mod_name == 'rna_prop_ui':
            m.rna_idprop_ui_create = lambda *args, **kwargs: None
        sys.modules[mod_name] = m

bpy_extras_mock = types.ModuleType('bpy_extras')
wm_utils_mock = types.ModuleType('bpy_extras.wm_utils')
progress_report_mock = types.ModuleType('bpy_extras.wm_utils.progress_report')
io_utils_mock = types.ModuleType('bpy_extras.io_utils')

class MockProgressReport:
    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def step(self, *args, **kwargs): pass

class MockImportHelper:
    filepath = ""

class MockExportHelper:
    filepath = ""

progress_report_mock.ProgressReport = MockProgressReport
wm_utils_mock.progress_report = progress_report_mock
io_utils_mock.ImportHelper = MockImportHelper
io_utils_mock.ExportHelper = MockExportHelper

bpy_extras_mock.wm_utils = wm_utils_mock
bpy_extras_mock.io_utils = io_utils_mock

sys.modules['bpy_extras'] = bpy_extras_mock
sys.modules['bpy_extras.wm_utils'] = wm_utils_mock
sys.modules['bpy_extras.wm_utils.progress_report'] = progress_report_mock
sys.modules['bpy_extras.io_utils'] = io_utils_mock

class MockPoseMarker:
    def __init__(self, name):
        self.name = name
        self.frame = 1

class MockActionMarkers:
    def __init__(self):
        self.markers = []

    def new(self, name):
        m = MockPoseMarker(name)
        self.markers.append(m)
        return m

class MockAction:
    def __init__(self, name):
        self.name = name
        self.pose_markers = MockActionMarkers()
        self.is_asset = False

    def asset_mark(self):
        self.is_asset = True

if 'bpy' not in sys.modules or not hasattr(sys.modules['bpy'], 'app'):
    bpy_mock = types.ModuleType('bpy')
    wm_mock = types.SimpleNamespace()
    ui_mock = types.SimpleNamespace()
    ui_mock.fitting_binder = "SOFT"
    ui_mock.fitting_weights = "NONE"
    ui_mock.fitting_weights_ovr = True
    ui_mock.fitting_mask = "NONE"
    ui_mock.hair_deform = False
    wm_mock.charmorph_ui = ui_mock
    bpy_mock.context = types.SimpleNamespace(window_manager=wm_mock)

    bpy_mock.data = types.SimpleNamespace(
        texts=[],
        objects=[],
        actions=types.SimpleNamespace(new=lambda name: MockAction(name))
    )

    class MockOperator:
        pass

    class MockPanel:
        pass

    class MockPropertyGroup:
        pass

    mock_type_with_properties = types.SimpleNamespace(
        bl_rna=types.SimpleNamespace(properties={})
    )

    bpy_mock.types = types.SimpleNamespace(
        Object=object,
        Operator=MockOperator,
        Panel=MockPanel,
        PropertyGroup=MockPropertyGroup,
        AddonPreferences=object,
        OperatorFileListElement=object,
        Bone=mock_type_with_properties,
        EditBone=mock_type_with_properties,
        PoseBone=mock_type_with_properties,
        Armature=mock_type_with_properties,
        Mesh=mock_type_with_properties,
        ShapeKey=mock_type_with_properties,
        ColorManagedInputColorspaceSettings=types.SimpleNamespace(
            bl_rna=types.SimpleNamespace(
                properties={"name": types.SimpleNamespace(enum_items=[])}
            )
        )
    )

    app_mock = types.ModuleType('bpy.app')
    handlers_mock = types.ModuleType('bpy.app.handlers')
    handlers_mock.persistent = lambda fn: fn
    handlers_mock.load_post = []
    app_mock.handlers = handlers_mock
    bpy_mock.app = app_mock

    props_mock = types.ModuleType('bpy.props')
    props_mock.StringProperty = lambda **kwargs: None
    props_mock.BoolProperty = lambda **kwargs: None
    props_mock.IntProperty = lambda **kwargs: None
    props_mock.FloatProperty = lambda **kwargs: None
    props_mock.EnumProperty = lambda **kwargs: None
    props_mock.PointerProperty = lambda **kwargs: None
    props_mock.CollectionProperty = lambda **kwargs: None
    bpy_mock.props = props_mock

    utils_mock = types.ModuleType('bpy.utils')
    utils_mock.register_class = lambda cls: None
    utils_mock.unregister_class = lambda cls: None
    utils_mock.register_classes_factory = lambda classes: (lambda: None, lambda: None)
    bpy_mock.utils = utils_mock

    ops_mock = types.ModuleType('bpy.ops')
    ops_mock.ed = types.SimpleNamespace(undo_push=lambda: None)
    ops_mock.object = types.SimpleNamespace(mode_set=lambda mode: None)
    ops_mock.pose = types.SimpleNamespace(
        select_all=lambda action: None,
        loc_clear=lambda: None,
        rot_clear=lambda: None,
        scale_clear=lambda: None
    )
    bpy_mock.ops = ops_mock

    sys.modules['bpy'] = bpy_mock
    sys.modules['bpy.app'] = app_mock
    sys.modules['bpy.app.handlers'] = handlers_mock
    sys.modules['bpy.props'] = props_mock
    sys.modules['bpy.utils'] = utils_mock
    sys.modules['bpy.ops'] = ops_mock

if 'bmesh' not in sys.modules:
    bmesh_mock = types.ModuleType('bmesh')
    bmesh_mock.ops = types.SimpleNamespace()
    bmesh_mock.types = types.SimpleNamespace()
    sys.modules['bmesh'] = bmesh_mock

if 'mathutils' not in sys.modules:
    mathutils_mock = types.ModuleType('mathutils')

    class Vector(np.ndarray):
        def __new__(cls, input_array=(0.0, 0.0, 0.0)):
            obj = np.asarray(input_array, dtype=np.float64).view(cls)
            return obj

        @property
        def length(self):
            return float(np.linalg.norm(self))

        @property
        def length_squared(self):
            return float(np.sum(self ** 2))

        def normalized(self):
            l = self.length
            return Vector(self / l) if l > 0 else Vector(self)

        def tolist(self):
            return super().tolist()

        def __eq__(self, other):
            if isinstance(other, (np.ndarray, list, tuple)):
                if len(self) != len(other):
                    return False
                return bool(np.allclose(np.asarray(self), np.asarray(other)))
            return False

    class MockQuaternion(np.ndarray):
        def __new__(cls, *args):
            if len(args) > 0:
                return np.asarray(args[0], dtype=np.float64).view(cls)
            return np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float64).view(cls)

        def copy(self):
            return MockQuaternion(super().copy())

        def to_matrix(self):
            return MockMatrix.Identity(3)

        def to_euler(self):
            return MockEuler([0.0, 0.0, 0.0])

    class MockEuler(np.ndarray):
        def __new__(cls, *args):
            if len(args) > 0:
                return np.asarray(args[0], dtype=np.float64).view(cls)
            return np.array([0.0, 0.0, 0.0], dtype=np.float64).view(cls)

    class MockMatrix(np.ndarray):
        def __new__(cls, *args):
            if len(args) > 0:
                return np.asarray(args[0], dtype=np.float64).view(cls)
            return np.eye(4, dtype=np.float64).view(cls)

        @classmethod
        def Identity(cls, n=4):
            return np.eye(n, dtype=np.float64).view(cls)

        @classmethod
        def Rotation(cls, angle, size=4, axis='Z'):
            return np.eye(size, dtype=np.float64).view(cls)

        @classmethod
        def Translation(cls, vec):
            m = np.eye(4, dtype=np.float64).view(cls)
            m[0:3, 3] = vec[:3]
            return m

        def to_3x3(self):
            return self[:3, :3].view(MockMatrix)

        def to_quaternion(self):
            return MockQuaternion([1.0, 0.0, 0.0, 0.0])

        def inverted(self):
            try:
                inv = np.linalg.inv(self)
                return inv.view(MockMatrix)
            except Exception:
                return self.copy()

        def decompose(self):
            return Vector([self[0, 3], self[1, 3], self[2, 3]]), MockQuaternion([1.0, 0.0, 0.0, 0.0]), Vector([1.0, 1.0, 1.0])

        @property
        def translation(self):
            if self.shape == (4, 4):
                return Vector(self[0:3, 3])
            return Vector([0.0, 0.0, 0.0])

        @translation.setter
        def translation(self, vec):
            if self.shape == (4, 4):
                self[0:3, 3] = vec[:3]

        def __matmul__(self, other):
            if isinstance(other, Vector):
                if len(other) == 3 and self.shape == (4, 4):
                    v = np.array([other[0], other[1], other[2], 1.0], dtype=np.float64)
                    res = super().__matmul__(v)
                    return Vector(res[:3])
                res = super().__matmul__(other)
                return Vector(res)
            res = super().__matmul__(other)
            if isinstance(res, np.ndarray):
                return res.view(MockMatrix)
            return res

    class MockKDTree:
        def __init__(self, size):
            self.nodes = []

        def insert(self, co, index):
            self.nodes.append((co, index))

        def balance(self):
            pass

        def find_range(self, co, radius):
            co = np.array(co, dtype=np.float64)
            res = []
            for n_co, n_idx in self.nodes:
                d = np.linalg.norm(np.array(n_co, dtype=np.float64) - co)
                if d <= radius:
                    res.append((Vector(n_co), n_idx, d))
            return res

        def find_n(self, co, n):
            co = np.array(co, dtype=np.float64)
            res = []
            for n_co, n_idx in self.nodes:
                d = np.linalg.norm(np.array(n_co, dtype=np.float64) - co)
                res.append((Vector(n_co), n_idx, d))
            res.sort(key=lambda x: x[2])
            return res[:n]

    class MockBVHTree:
        def __init__(self, verts=None, faces=None):
            self.verts = np.array(verts, dtype=np.float64) if verts is not None else np.array([])
            self.faces = faces or []

        @classmethod
        def FromPolygons(cls, verts, faces):
            return cls(verts, faces)

        @classmethod
        def FromBMesh(cls, bm):
            return cls()

        def find_nearest(self, co, max_dist=1e30):
            co = np.array(co, dtype=np.float64)
            if len(self.verts) == 0 or len(self.faces) == 0:
                return None, None, None, None

            best_dist = 1e30
            best_loc = None
            best_norm = None
            best_face_idx = None

            for fi, face in enumerate(self.faces):
                face_verts = self.verts[list(face)]
                v0, v1, v2 = face_verts[0], face_verts[1], face_verts[2]
                fn = np.cross(v1 - v0, v2 - v0)
                norm_len = np.linalg.norm(fn)
                if norm_len > 1e-12:
                    fn = fn / norm_len
                else:
                    fn = np.array([0.0, 0.0, 1.0])

                d_plane = np.dot(co - v0, fn)
                proj = co - d_plane * fn

                min_b = np.min(face_verts, axis=0) - 0.05
                max_b = np.max(face_verts, axis=0) + 0.05
                if np.all(proj >= min_b) and np.all(proj <= max_b):
                    dist = abs(d_plane)
                    if dist < best_dist:
                        best_dist = dist
                        best_loc = proj
                        best_norm = fn
                        best_face_idx = fi
                else:
                    center = np.mean(face_verts, axis=0)
                    dist = np.linalg.norm(co - center)
                    if dist < best_dist:
                        best_dist = dist
                        best_loc = center
                        best_norm = fn
                        best_face_idx = fi

            if best_dist > max_dist or best_loc is None:
                return None, None, None, None

            return Vector(best_loc), Vector(best_norm), best_face_idx, float(best_dist)

        def find_nearest_range(self, co, max_dist):
            res = self.find_nearest(co, max_dist)
            if res[0] is None:
                return []
            return [res]

        def ray_cast(self, co, direction, max_dist=1e30):
            return None, None, None, None

    class MockInterpolate:
        @staticmethod
        def poly_3d_calc(verts, loc):
            n = len(verts)
            return [1.0 / n] * n

    mathutils_mock.Vector = Vector
    mathutils_mock.Quaternion = MockQuaternion
    mathutils_mock.Euler = MockEuler
    mathutils_mock.Matrix = MockMatrix
    mathutils_mock.kdtree = types.SimpleNamespace(KDTree=MockKDTree)
    mathutils_mock.bvhtree = types.SimpleNamespace(BVHTree=MockBVHTree)
    mathutils_mock.interpolate = MockInterpolate
    sys.modules['mathutils'] = mathutils_mock
    sys.modules['mathutils.kdtree'] = mathutils_mock.kdtree
    sys.modules['mathutils.bvhtree'] = mathutils_mock.bvhtree
    sys.modules['mathutils.interpolate'] = mathutils_mock.interpolate
