import os
import sys
import tempfile
import time
import unittest

# Ensure repo root is on sys.path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from lib import xml_base_mesh


MINIMAL_XML = """<?xml version="1.0" encoding="UTF-8"?>
<BaseMesh name="{name}" version="1.0">
    <Metadata>
        <Author>Test</Author>
    </Metadata>
    <Topology unit="meters">
        <Vertices>
            <Vertex id="0" x="0.0" y="0.0" z="0.0"/>
            <Vertex id="1" x="1.0" y="0.0" z="0.0"/>
            <Vertex id="2" x="0.0" y="1.0" z="0.0"/>
        </Vertices>
        <Faces>
            <Face verts="0 1 2"/>
        </Faces>
    </Topology>
    <Rig/>
    <WeightLayers/>
    <Sizing/>
</BaseMesh>
"""


class TestXmlBaseMeshCache(unittest.TestCase):

    def setUp(self):
        xml_base_mesh.clear_cache()
        xml_base_mesh.set_cache_max_size(128)
        self.temp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        xml_base_mesh.clear_cache()
        xml_base_mesh.set_cache_max_size(128)
        self.temp_dir.cleanup()

    def _create_xml_file(self, filename: str, name: str = "TestMesh") -> str:
        filepath = os.path.join(self.temp_dir.name, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(MINIMAL_XML.format(name=name))
        return filepath

    def test_cache_hit_returns_same_instance(self):
        filepath = self._create_xml_file("mesh1.xml", "MeshOne")
        mesh1 = xml_base_mesh.load_base_mesh(filepath)
        mesh2 = xml_base_mesh.load_base_mesh(filepath)

        self.assertIs(mesh1, mesh2)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 1)

    def test_mtime_update_invalidates_cache(self):
        filepath = self._create_xml_file("mesh1.xml", "MeshOne")
        mesh1 = xml_base_mesh.load_base_mesh(filepath)

        # Update file content and mtime
        time.sleep(0.01)  # ensure mtime delta if precision is low
        mtime_before = os.path.getmtime(filepath)
        new_mtime = mtime_before + 10.0

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(MINIMAL_XML.format(name="MeshOneModified"))

        os.utime(filepath, (new_mtime, new_mtime))

        mesh2 = xml_base_mesh.load_base_mesh(filepath)

        self.assertIsNot(mesh1, mesh2)
        self.assertEqual(mesh2.name, "MeshOneModified")

    def test_deleted_file_evicted_from_cache(self):
        filepath = self._create_xml_file("mesh1.xml", "MeshOne")
        xml_base_mesh.load_base_mesh(filepath)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 1)

        os.remove(filepath)

        with self.assertRaises((FileNotFoundError, OSError)):
            xml_base_mesh.load_base_mesh(filepath)

        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 0)

    def test_lru_eviction(self):
        xml_base_mesh.set_cache_max_size(2)

        file1 = self._create_xml_file("mesh1.xml", "Mesh1")
        file2 = self._create_xml_file("mesh2.xml", "Mesh2")
        file3 = self._create_xml_file("mesh3.xml", "Mesh3")

        mesh1 = xml_base_mesh.load_base_mesh(file1)
        mesh2 = xml_base_mesh.load_base_mesh(file2)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 2)

        # Access file1 again to make it recently used
        xml_base_mesh.load_base_mesh(file1)

        # Loading file3 should evict file2 (since file1 was accessed more recently)
        mesh3 = xml_base_mesh.load_base_mesh(file3)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 2)

        # Loading file2 should create a new instance as it was evicted
        mesh2_new = xml_base_mesh.load_base_mesh(file2)
        self.assertIsNot(mesh2, mesh2_new)

    def test_load_dir_uses_cache(self):
        file1 = self._create_xml_file("a_mesh1.xml", "Mesh1")
        file2 = self._create_xml_file("b_mesh2.xml", "Mesh2")

        res1 = xml_base_mesh.load_dir(self.temp_dir.name)
        self.assertEqual(len(res1), 2)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 2)

        res2 = xml_base_mesh.load_dir(self.temp_dir.name)
        self.assertIs(res1["Mesh1"], res2["Mesh1"])
        self.assertIs(res1["Mesh2"], res2["Mesh2"])

        # Delete one file and verify load_dir removes it from cache and output
        os.remove(file2)
        res3 = xml_base_mesh.load_dir(self.temp_dir.name)
        self.assertEqual(len(res3), 1)
        self.assertIn("Mesh1", res3)
        self.assertNotIn("Mesh2", res3)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 1)

    def test_clear_cache(self):
        file1 = self._create_xml_file("mesh1.xml", "Mesh1")
        xml_base_mesh.load_base_mesh(file1)
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 1)

        xml_base_mesh.clear_cache()
        self.assertEqual(xml_base_mesh.get_cache_info()["size"], 0)


if __name__ == "__main__":
    unittest.main()
