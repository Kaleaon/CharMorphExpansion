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

    class MockOperator:
        pass

    class MockPanel:
        pass

    class MockPropertyGroup:
        pass

    bpy_mock.types = types.SimpleNamespace(
        Object=object,
        Operator=MockOperator,
        Panel=MockPanel,
        PropertyGroup=MockPropertyGroup,
        AddonPreferences=object,
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
    bpy_mock.props = props_mock

    utils_mock = types.ModuleType('bpy.utils')
    utils_mock.register_class = lambda cls: None
    utils_mock.unregister_class = lambda cls: None
    bpy_mock.utils = utils_mock

    ops_mock = types.ModuleType('bpy.ops')
    ops_mock.ed = types.SimpleNamespace()
    bpy_mock.ops = ops_mock

    sys.modules['bpy'] = bpy_mock
    sys.modules['bpy.app'] = app_mock
    sys.modules['bpy.app.handlers'] = handlers_mock
    sys.modules['bpy.props'] = props_mock
    sys.modules['bpy.utils'] = utils_mock
    sys.modules['bpy.ops'] = ops_mock

if 'bmesh' not in sys.modules:
    bmesh_mock = types.ModuleType('bmesh')
    sys.modules['bmesh'] = bmesh_mock

if 'mathutils' not in sys.modules:
    mathutils_mock = types.ModuleType('mathutils')

    class Vector(np.ndarray):
        def __new__(cls, input_array):
            obj = np.asarray(input_array, dtype=np.float64).view(cls)
            return obj

        @property
        def length(self):
            return float(np.linalg.norm(self))

        def tolist(self):
            return super().tolist()

    class MockQuaternion(np.ndarray):
        def __new__(cls, *args):
            return np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float64).view(cls)

    class MockEuler(np.ndarray):
        def __new__(cls, *args):
            return np.array([0.0, 0.0, 0.0], dtype=np.float64).view(cls)

    class MockMatrix(np.ndarray):
        def __new__(cls, *args):
            return np.eye(4, dtype=np.float64).view(cls)

        @classmethod
        def Identity(cls, n=4):
            return np.eye(n, dtype=np.float64).view(cls)

        @classmethod
        def Rotation(cls, angle, size=4, axis='Z'):
            return np.eye(size, dtype=np.float64).view(cls)

        @classmethod
        def Translation(cls, vec):
            return np.eye(4, dtype=np.float64).view(cls)

        def to_3x3(self):
            return np.eye(3, dtype=np.float64)

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

import os
BASE_MESH_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "base_meshes"))
def ensure_base_mesh_files():
    os.makedirs(BASE_MESH_DIR, exist_ok=True)
    hn_path = os.path.join(BASE_MESH_DIR, "HumanoidNeutral.xml")
    if not os.path.exists(hn_path):
        with open(hn_path, "w", encoding="utf-8") as f:
            f.write('''<BaseMesh name="HumanoidNeutral" version="1.0">
  <Topology unit="meters">
    <Vertices><Vertex id="0" x="0" y="0" z="0"/><Vertex id="1" x="0" y="0" z="0"/><Vertex id="2" x="0" y="0" z="0"/></Vertices>
    <Faces><Face verts="0 1 2"/></Faces>
  </Topology>
  <WeightLayers>
    <Layer name="deform" type="deform" normalised="true">
      <Bone name="root">
        <Weight vertex="0" value="1.0"/>
        <Weight vertex="1" value="1.0"/>
        <Weight vertex="2" value="1.0"/>
      </Bone>
    </Layer>
  </WeightLayers>
</BaseMesh>''')

    ha_path = os.path.join(BASE_MESH_DIR, "HumanoidAthletic.xml")
    if not os.path.exists(ha_path):
        with open(ha_path, "w", encoding="utf-8") as f:
            f.write('''<BaseMesh name="HumanoidAthletic" version="1.0">
  <Topology unit="meters">
    <Vertices><Vertex id="0" x="0" y="0" z="0"/><Vertex id="1" x="0" y="0" z="0"/><Vertex id="2" x="0" y="0" z="0"/></Vertices>
    <Faces><Face verts="0 1 2"/></Faces>
  </Topology>
  <WeightLayers>
    <Layer name="deform" type="deform" normalised="true">
      <Bone name="root">
        <Weight vertex="0" value="1.0"/>
        <Weight vertex="1" value="1.0"/>
        <Weight vertex="2" value="1.0"/>
      </Bone>
    </Layer>
  </WeightLayers>
</BaseMesh>''')

    sm_path = os.path.join(BASE_MESH_DIR, "SuperMesh.xml")
    if not os.path.exists(sm_path):
        with open(sm_path, "w", encoding="utf-8") as f:
            f.write('''<SuperMesh name="SuperMesh" version="1.0" is_super_mesh="true">
  <Metadata><author>Test</author></Metadata>
  <Topology unit="meters">
    <Vertices>
      <Vertex id="0" x="0" y="0" z="0"/><Vertex id="1" x="0" y="0" z="0"/><Vertex id="2" x="0" y="0" z="0"/>
      <Vertex id="3" x="0" y="0" z="0"/><Vertex id="4" x="0" y="0" z="0"/><Vertex id="5" x="0" y="0" z="0"/>
      <Vertex id="6" x="0" y="0" z="0"/><Vertex id="7" x="0" y="0" z="0"/><Vertex id="8" x="0" y="0" z="0"/>
      <Vertex id="9" x="0" y="0" z="0"/><Vertex id="10" x="0" y="0" z="0"/><Vertex id="11" x="0" y="0" z="0"/>
      <Vertex id="12" x="0" y="0" z="0"/><Vertex id="13" x="0" y="0" z="0"/><Vertex id="14" x="0" y="0" z="0"/>
      <Vertex id="15" x="0" y="0" z="0"/><Vertex id="16" x="0" y="0" z="0"/><Vertex id="17" x="0" y="0" z="0"/>
      <Vertex id="18" x="0" y="0" z="0"/><Vertex id="19" x="0" y="0" z="0"/><Vertex id="20" x="0" y="0" z="0"/>
    </Vertices>
    <Faces>
      <Face verts="0 1 2"/><Face verts="1 2 3"/><Face verts="2 3 4"/><Face verts="3 4 5"/><Face verts="4 5 6"/>
      <Face verts="5 6 7"/><Face verts="6 7 8"/><Face verts="7 8 9"/><Face verts="8 9 10"/><Face verts="9 10 11"/>
    </Faces>
    <PreallocatedGeometry>
      <Region name="muzzle" verts="8 9 10"/>
      <Region name="tail" verts="15 16 17 18"/>
      <Region name="ears" verts="11 12 13 14"/>
    </PreallocatedGeometry>
  </Topology>
  <Rig>
    <Bone name="tail.01" parent="pelvis" head_x="0" head_y="-0.1" head_z="0.9" tail_x="0" tail_y="-0.2" tail_z="0.8"/>
    <Bone name="ear.01.L" parent="head" head_x="0.1" head_y="0" head_z="1.7" tail_x="0.15" tail_y="0" tail_z="1.8"/>
    <Bone name="ear.01.R" parent="head" head_x="-0.1" head_y="0" head_z="1.7" tail_x="-0.15" tail_y="0" tail_z="1.8"/>
    <LimbChains>
      <Chain name="tail" bones="tail.01, tail.02, tail.03, tail.04"/>
    </LimbChains>
  </Rig>
</SuperMesh>''')

ensure_base_mesh_files()
