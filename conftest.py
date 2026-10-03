"""pytest configuration for CharMorphExpansion."""

import sys
import os
import numpy as np
from unittest.mock import MagicMock

# Ensure CharMorph Expansion root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

class DummyPropertyDeferred:
    pass

class DummyObject:
    pass

class DummyMesh:
    pass

class DummyArmature:
    pass

class DummyOperator:
    pass

class DummyImportHelper:
    pass

class DummyExportHelper:
    pass

# Mock Blender modules for headless execution
mock_bpy = MagicMock()
mock_bpy.app.version = (4, 2, 0)
mock_bpy.props._PropertyDeferred = DummyPropertyDeferred
mock_bpy.types.Operator = DummyOperator
mock_bpy.types.Panel = DummyOperator
mock_bpy.types.PropertyGroup = DummyOperator
mock_bpy.types.AddonPreferences = DummyOperator
mock_bpy.types.UIList = DummyOperator
mock_bpy.types.Header = DummyOperator
mock_bpy.types.Menu = DummyOperator
mock_bpy.types.Object = DummyObject
mock_bpy.types.Mesh = DummyMesh
mock_bpy.types.Armature = DummyArmature

mock_utils = MagicMock()
mock_utils.register_classes_factory.return_value = (MagicMock(), MagicMock())
mock_bpy.utils = mock_utils

mock_bpy_extras = MagicMock()
mock_bpy_extras.io_utils.ImportHelper = DummyImportHelper
mock_bpy_extras.io_utils.ExportHelper = DummyExportHelper

class Vector(tuple):
    def __new__(cls, val=(0.0, 0.0, 0.0)):
        if isinstance(val, (int, float)):
            return super().__new__(cls, (float(val), float(val), float(val)))
        return super().__new__(cls, tuple(float(x) for x in val))

    def __add__(self, other):
        return Vector((self[0] + other[0], self[1] + other[1], self[2] + other[2]))

    def __sub__(self, other):
        return Vector((self[0] - other[0], self[1] - other[1], self[2] - other[2]))

    def __truediv__(self, other):
        return Vector((self[0] / float(other), self[1] / float(other), self[2] / float(other)))

class DummyKDTree:
    def __init__(self, size):
        self.points = []

    def insert(self, co, index):
        self.points.append((co, index))

    def balance(self):
        pass

    def find_n(self, co, n):
        if not self.points:
            return []
        target = np.array(co)
        res = []
        for pt_co, idx in self.points:
            dist = float(np.linalg.norm(np.array(pt_co) - target))
            res.append((pt_co, idx, dist))
        res.sort(key=lambda x: x[2])
        return res[:n]

class DummyBVHTree:
    def __init__(self, verts, faces):
        self.verts = np.array(verts, dtype=np.float64)
        self.faces = faces

    @classmethod
    def FromPolygons(cls, verts, faces):
        return cls(verts, faces)

    def find_nearest(self, point):
        if len(self.verts) == 0 or len(self.faces) == 0:
            return None
        p = np.array(point, dtype=np.float64)
        best_dist = float("inf")
        best_res = None
        for face_idx, f in enumerate(self.faces):
            if len(f) < 3:
                continue
            v0, v1, v2 = self.verts[f[0]], self.verts[f[1]], self.verts[f[2]]
            norm = np.cross(v1 - v0, v2 - v0)
            norm_len = np.linalg.norm(norm)
            if norm_len > 1e-12:
                norm /= norm_len
            else:
                norm = np.array([0.0, 0.0, 1.0])
            proj = p - np.dot(p - v0, norm) * norm
            dist = float(np.linalg.norm(p - proj))
            if dist < best_dist:
                best_dist = dist
                best_res = (proj.tolist(), norm.tolist(), face_idx, dist)
        return best_res

mock_mathutils = MagicMock()
mock_mathutils.Vector = Vector
mock_mathutils.kdtree.KDTree = DummyKDTree
mock_mathutils.bvhtree.BVHTree = DummyBVHTree

sys.modules["bpy"] = mock_bpy
sys.modules["bpy.app"] = mock_bpy.app
sys.modules["bpy.app.handlers"] = MagicMock()
sys.modules["bpy.props"] = mock_bpy.props
sys.modules["bpy.types"] = mock_bpy.types
sys.modules["bpy.utils"] = mock_utils
sys.modules["addon_utils"] = MagicMock()
sys.modules["mathutils"] = mock_mathutils
sys.modules["bmesh"] = MagicMock()
sys.modules["rna_prop_ui"] = MagicMock()
sys.modules["idprop"] = MagicMock()
sys.modules["idprop.types"] = MagicMock()
sys.modules["bpy_extras"] = mock_bpy_extras
sys.modules["bpy_extras.io_utils"] = mock_bpy_extras.io_utils
sys.modules["bpy_extras.wm_utils"] = MagicMock()
sys.modules["bpy_extras.wm_utils.progress_report"] = MagicMock()
