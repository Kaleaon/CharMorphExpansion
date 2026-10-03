"""Unit tests for Modular Topology Attachment and Dynamic Re-Indexing Engine."""

import os
import sys
import unittest
import numpy

# Ensure CharMorph root directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from lib import xml_base_mesh, morphs, morpher_cores, rigging


class MockTarget:
    def __init__(self):
        self.data = None

    def foreach_set(self, attr, data):
        self.data = data


class MockMesh:
    def __init__(self, vert_count=10):
        self.vert_count = vert_count
        self.shape_keys = None
        self.update_count = 0
        self.vertices = self

    def __len__(self):
        return self.vert_count

    def foreach_get(self, attr, arr):
        arr.fill(0.0)

    def foreach_set(self, attr, arr):
        pass

    def update(self):
        self.update_count += 1


class MockObject:
    def __init__(self, vert_count=10):
        self.name = "mock_obj"
        self.data = MockMesh(vert_count)

    def get(self, key, default=None):
        return default


class TestModularTopology(unittest.TestCase):

    def setUp(self):
        self.attachments_dir = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "data", "characters", "attachments")
        )

    def test_xml_base_mesh_parses_sockets_and_seams(self):
        """Verify xml_base_mesh parses socket definitions and seam boundary maps."""
        xml_content = """<?xml version="1.0" encoding="utf-8"?>
        <BaseMesh name="test_humanoid" version="1.0">
            <Metadata><Author>Test</Author></Metadata>
            <Topology unit="meters">
                <Vertices>
                    <Vertex id="0" x="0.0" y="0.0" z="0.0"/>
                    <Vertex id="1" x="1.0" y="0.0" z="0.0"/>
                    <Vertex id="2" x="0.0" y="1.0" z="0.0"/>
                </Vertices>
                <Faces>
                    <Face verts="0, 1, 2"/>
                </Faces>
            </Topology>
            <Sockets>
                <Socket name="head_muzzle" parent_bone="head" x="0.0" y="0.1" z="1.6" slot="muzzle"/>
                <Socket name="tail_socket" parent_bone="mPelvis" x="0.0" y="-0.1" z="0.9" slot="tail"/>
            </Sockets>
            <SeamBoundaryMaps>
                <SeamMap socket="head_muzzle" base_verts="0, 1" attachment_verts="0, 1" weld="true"/>
            </SeamBoundaryMaps>
        </BaseMesh>
        """
        import xml.etree.ElementTree as ET
        root = ET.fromstring(xml_content)

        sockets = xml_base_mesh._parse_sockets(root.find("Sockets"))
        self.assertIn("head_muzzle", sockets)
        self.assertEqual(sockets["head_muzzle"].parent_bone, "head")
        self.assertEqual(sockets["head_muzzle"].target_slot, "muzzle")
        self.assertEqual(sockets["head_muzzle"].position, (0.0, 0.1, 1.6))

        seams = xml_base_mesh._parse_seams(root.find("SeamBoundaryMaps"))
        self.assertEqual(len(seams), 1)
        self.assertEqual(seams[0].socket_name, "head_muzzle")
        self.assertEqual(seams[0].base_vertex_indices, (0, 1))
        self.assertEqual(seams[0].attachment_vertex_indices, (0, 1))
        self.assertTrue(seams[0].weld)

    def test_load_attachment_module_assets(self):
        """Verify non-humanoid attachment assets load correctly from XML."""
        muzzle_path = os.path.join(self.attachments_dir, "muzzle.xml")
        self.assertTrue(os.path.exists(muzzle_path), f"Missing {muzzle_path}")

        module = xml_base_mesh.load_attachment_module(muzzle_path)
        self.assertEqual(module.name, "canine_muzzle")
        self.assertEqual(module.slot, "head_muzzle")
        self.assertGreater(len(module.vertices), 0)
        self.assertGreater(len(module.faces), 0)
        self.assertIn("muzzle_root", module.bones)
        self.assertIn("skin", module.weight_layers)
        self.assertEqual(len(module.seams), 1)

    def test_dynamic_vertex_reindexing_and_attachment(self):
        """Verify base mesh attaches modules with dynamic vertex offsets and composite geometry."""
        base = xml_base_mesh.BaseMesh(
            name="test_base",
            version="1.0",
            metadata={},
            vertices=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            faces=[(0, 1, 2)],
            bones={"head": xml_base_mesh.Bone("head", None, (0, 0, 1.5), (0, 0, 1.7))},
            weight_layers={"skin": xml_base_mesh.WeightLayer("skin", "deform", True, weights={"head": {0: 1.0, 1: 1.0, 2: 1.0}})},
            sizing={},
        )

        muzzle = xml_base_mesh.AttachmentModule(
            name="muzzle",
            slot="head_muzzle",
            vertices=[(0.0, 0.12, 1.60), (0.03, 0.22, 1.61)],
            faces=[(0, 1, 0)],
            bones={"muzzle_bone": xml_base_mesh.Bone("muzzle_bone", None, (0, 0.12, 1.60), (0, 0.22, 1.60))},
            weight_layers={"skin": xml_base_mesh.WeightLayer("skin", "deform", True, weights={"muzzle_bone": {0: 1.0, 1: 1.0}})},
        )

        tail = xml_base_mesh.AttachmentModule(
            name="tail",
            slot="tail_socket",
            vertices=[(0.0, -0.15, 0.95), (0.0, -0.35, 0.85), (0.0, -0.55, 0.70)],
            faces=[(0, 1, 2)],
            bones={"tail_bone": xml_base_mesh.Bone("tail_bone", None, (0, -0.15, 0.95), (0, -0.35, 0.85))},
            weight_layers={"skin": xml_base_mesh.WeightLayer("skin", "deform", True, weights={"tail_bone": {0: 1.0, 1: 1.0, 2: 1.0}})},
        )

        # Attach muzzle (offset should be 3, since base has 3 verts)
        off_muzzle = base.attach_module(muzzle)
        self.assertEqual(off_muzzle, 3)
        self.assertEqual(muzzle.vertex_offset, 3)

        # Attach tail (offset should be 3 + 2 = 5)
        off_tail = base.attach_module(tail)
        self.assertEqual(off_tail, 5)
        self.assertEqual(tail.vertex_offset, 5)

        # Composite vertices
        comp_verts = base.get_composite_vertices()
        self.assertEqual(len(comp_verts), 8)  # 3 + 2 + 3 = 8

        # Composite faces (tail face indices shifted by 5)
        comp_faces = base.get_composite_faces()
        self.assertEqual(len(comp_faces), 3)
        self.assertEqual(comp_faces[2], (5, 6, 7))

        # Detach module
        detached = base.detach_module("muzzle")
        self.assertTrue(detached)
        self.assertNotIn("muzzle", base.attached_modules)
        self.assertEqual(tail.vertex_offset, 3)  # Recalculated offset
        self.assertEqual(len(base.get_composite_vertices()), 6)

    def test_seam_boundary_welding(self):
        """Verify seam boundary welding aligns attachment boundary vertices with base vertices."""
        base = xml_base_mesh.BaseMesh(
            name="base",
            version="1.0",
            metadata={},
            vertices=[(10.0, 20.0, 30.0)],
            faces=[],
            bones={},
            weight_layers={},
            sizing={},
        )

        attachment = xml_base_mesh.AttachmentModule(
            name="att",
            slot="slot1",
            vertices=[(0.0, 0.0, 0.0), (1.0, 1.0, 1.0)],
            seams=[
                xml_base_mesh.SeamBoundaryMap(
                    socket_name="slot1",
                    base_vertex_indices=(0,),
                    attachment_vertex_indices=(0,),
                    weld=True,
                )
            ],
        )

        base.attach_module(attachment)
        # Attachment vertex 0 should be welded to base vertex 0 position
        self.assertEqual(attachment.vertices[0], (10.0, 20.0, 30.0))
        self.assertEqual(attachment.vertices[1], (1.0, 1.0, 1.0))

    def test_morph_evaluation_with_offsets(self):
        """Verify PartialMorph and FullMorph apply deltas accurately using vertex index offsets."""
        verts = numpy.zeros((10, 3), dtype=numpy.float64)

        # FullMorph targeting attachment starting at offset 5 (length 3)
        delta_full = numpy.array([[1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [3.0, 0.0, 0.0]], dtype=numpy.float64)
        full_morph = morphs.FullMorph(delta_full, offset=5)
        full_morph.apply(verts, value=1.0)

        numpy.testing.assert_array_equal(verts[:5], 0.0)
        numpy.testing.assert_array_equal(verts[5:8], delta_full)
        numpy.testing.assert_array_equal(verts[8:], 0.0)

        # PartialMorph targeting attachment starting at offset 5 with local index array [0, 2]
        delta_part = numpy.array([[0.0, 5.0, 0.0], [0.0, 7.0, 0.0]], dtype=numpy.float64)
        part_morph = morphs.PartialMorph(numpy.array([0, 2]), delta_part, offset=5)
        part_morph.apply(verts, value=1.0)

        # Index 5 (local 0 + 5) should be [1.0, 5.0, 0.0]
        numpy.testing.assert_array_equal(verts[5], [1.0, 5.0, 0.0])
        # Index 7 (local 2 + 5) should be [3.0, 7.0, 0.0]
        numpy.testing.assert_array_equal(verts[7], [3.0, 7.0, 0.0])

    def test_morpher_core_composite_buffer_and_offsets(self):
        """Verify NumpyMorpher updates composite buffers when attachment modules activate."""
        obj = MockObject(vert_count=4)
        obj.data.get = lambda key, default=None: "ext" if key == "cm_morpher" else default

        morpher = morpher_cores.NumpyMorpher(obj)
        morpher.full_basis = numpy.array([
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ], dtype=numpy.float64)

        # Unattached state
        basis_unattached = morpher.get_composite_basis()
        self.assertEqual(len(basis_unattached), 4)

        # Attach module
        module = xml_base_mesh.AttachmentModule(
            name="muzzle_module",
            slot="muzzle",
            vertices=[(0.0, 0.5, 1.5), (0.0, 0.8, 1.5)],
        )
        off = morpher.attach_module(module)
        self.assertEqual(off, 4)

        # Composite basis should now have 6 vertices
        basis_attached = morpher.get_composite_basis()
        self.assertEqual(len(basis_attached), 6)

        # Evaluate morphs
        morpher._do_all_morphs()
        self.assertEqual(len(morpher.morphed), 6)

        # Apply attachment morph
        att_delta = numpy.array([[0.0, 0.0, 0.5], [0.0, 0.0, 1.0]], dtype=numpy.float64)
        att_morph = morphs.FullMorph(att_delta, offset=4)
        morpher.add_attachment_morph("muzzle_module", "muzzle_size", att_morph, value=1.0)

        # Morphed array should reflect the morph on attached vertices 4 and 5
        numpy.testing.assert_allclose(morpher.morphed[4], [0.0, 0.5, 2.0], atol=1e-5)
        numpy.testing.assert_allclose(morpher.morphed[5], [0.0, 0.8, 2.5], atol=1e-5)

        # Detach module
        morpher.detach_module("muzzle_module")
        self.assertEqual(len(morpher.get_composite_basis()), 4)

    def test_rig_generator_bone_and_weight_merging(self):
        """Verify rig generator merges attachment bone chains and re-indexes weight layers."""
        base_bones = {
            "head": {"parent": "neck", "head": (0, 0, 1.5), "tail": (0, 0, 1.7)},
        }

        att_bones = {
            "muzzle_root": {"parent": None, "head": (0, 0.1, 1.6), "tail": (0, 0.2, 1.6)},
            "jaw": {"parent": "muzzle_root", "head": (0, 0.1, 1.55), "tail": (0, 0.2, 1.53)},
        }

        merged_bones = rigging.merge_attachment_bones(base_bones, att_bones, socket_parent="head")
        self.assertIn("muzzle_root", merged_bones)
        self.assertEqual(merged_bones["muzzle_root"]["parent"], "head")
        self.assertEqual(merged_bones["jaw"]["parent"], "muzzle_root")

        # Test weight layer merging with vertex offset
        base_weights = {
            "skin": xml_base_mesh.WeightLayer("skin", "deform", True, weights={"head": {0: 1.0, 1: 1.0}})
        }
        att_weights = {
            "skin": xml_base_mesh.WeightLayer("skin", "deform", True, weights={"muzzle_root": {0: 0.8, 1: 1.0}})
        }

        merged_layers = rigging.merge_attachment_weights(base_weights, att_weights, vertex_offset=5)
        self.assertIn("skin", merged_layers)
        skin_layer = merged_layers["skin"]
        self.assertIn("head", skin_layer.weights)
        self.assertIn("muzzle_root", skin_layer.weights)
        self.assertEqual(skin_layer.weights["muzzle_root"], {5: 0.8, 6: 1.0})

    def test_zero_overhead_unattached_slots(self):
        """Guardrail: Unattached modular slots consume zero memory and zero vertex computation overhead."""
        base_mesh = xml_base_mesh.BaseMesh(
            name="base",
            version="1.0",
            metadata={},
            vertices=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0)],
            faces=[],
            bones={},
            weight_layers={},
            sizing={},
        )
        self.assertEqual(len(base_mesh.attached_modules), 0)
        self.assertEqual(len(base_mesh.vertex_offsets), 0)
        composite_verts = base_mesh.get_composite_vertices()
        self.assertEqual(len(composite_verts), len(base_mesh.vertices))


if __name__ == "__main__":
    unittest.main()
