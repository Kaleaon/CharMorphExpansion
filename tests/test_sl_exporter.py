# Unittests for Second Life Dynamic Weight Conversion Engine & Collada Exporter

import unittest
import xml.etree.ElementTree as ET
import os
import sys

# Ensure CharMorph root directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from lib.sl_bone_mapping import SLBoneMapper, WeightAggregator
from lib.collada_exporter import ColladaExporter


class TestSLBoneMapping(unittest.TestCase):

    def setUp(self):
        self.mapper = SLBoneMapper()

    def test_rigify_bone_mapping(self):
        self.assertEqual(self.mapper.map_bone("DEF-pelvis"), "mPelvis")
        self.assertEqual(self.mapper.map_bone("DEF-spine"), "mTorso")
        self.assertEqual(self.mapper.map_bone("DEF-spine.003"), "mChest")
        self.assertEqual(self.mapper.map_bone("DEF-spine.006"), "mHead")
        self.assertEqual(self.mapper.map_bone("DEF-upper_arm.L"), "mShoulderLeft")
        self.assertEqual(self.mapper.map_bone("DEF-forearm.L"), "mElbowLeft")
        self.assertEqual(self.mapper.map_bone("DEF-hand.L"), "mWristLeft")
        self.assertEqual(self.mapper.map_bone("DEF-thigh.R"), "mHipRight")
        self.assertEqual(self.mapper.map_bone("DEF-shin.R"), "mKneeRight")
        self.assertEqual(self.mapper.map_bone("DEF-foot.R"), "mAnkleRight")

    def test_muscle_collision_volume_mapping(self):
        self.assertEqual(self.mapper.map_bone("pct_muscle.L"), "Pectoral_L")
        self.assertEqual(self.mapper.map_bone("pct_muscle.R"), "Pectoral_R")
        self.assertEqual(self.mapper.map_bone("butt_muscle.L"), "BUTT_L")
        self.assertEqual(self.mapper.map_bone("butt_muscle.R"), "BUTT_R")
        self.assertEqual(self.mapper.map_bone("belly_muscle"), "BELLY")

    def test_unmapped_control_bones(self):
        self.assertIsNone(self.mapper.map_bone("WGT-custom_widget"))
        self.assertIsNone(self.mapper.map_bone("MCH-ik_target_unknown"))

    def test_weight_aggregation_and_normalization(self):
        source_weights = [
            {"DEF-spine": 0.5, "DEF-spine.001": 0.5},
            {"pct_muscle.L": 0.8, "DEF-spine.003": 0.2},
            {"unmapped_custom_bone": 1.0}
        ]

        agg_weights, diag = WeightAggregator.aggregate_vertex_weights(source_weights, self.mapper)

        self.assertEqual(len(agg_weights), 3)

        # Vertex 0: DEF-spine and DEF-spine.001 both map to mTorso -> weight 1.0
        self.assertAlmostEqual(agg_weights[0].get("mTorso", 0.0), 1.0)

        # Vertex 1: pct_muscle.L (Pectoral_L: 0.8) and DEF-spine.003 (mChest: 0.2)
        self.assertAlmostEqual(agg_weights[1].get("Pectoral_L", 0.0), 0.8)
        self.assertAlmostEqual(agg_weights[1].get("mChest", 0.0), 0.2)

        # Diagnostics check
        self.assertIn("unmapped_custom_bone", diag["unmapped_source_groups"])
        self.assertTrue(diag["has_warnings"])


class TestColladaExporter(unittest.TestCase):

    def test_collada_xml_structure(self):
        positions = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
        normals = [(0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 1.0)]
        uvs = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)]
        polygons = [[(0, 0, 0), (1, 1, 1), (2, 2, 2)]]
        vertex_weights = [
            {"mPelvis": 1.0},
            {"mTorso": 0.5, "mChest": 0.5},
            {"Pectoral_L": 1.0}
        ]

        exporter = ColladaExporter(positions, normals, uvs, polygons, vertex_weights)
        xml_str = exporter.export_xml()

        root = ET.fromstring(xml_str)
        ns = {"c": "http://www.collada.org/2005/11/COLLADASchema"}

        # Verify up_axis is Z_UP
        up_axis = root.find("c:asset/c:up_axis", ns)
        self.assertIsNotNone(up_axis)
        self.assertEqual(up_axis.text, "Z_UP")

        # Verify joint hierarchy root mPelvis
        m_pelvis = root.find(".//c:node[@id='mPelvis']", ns)
        self.assertIsNotNone(m_pelvis)

        # Verify skin controller
        skin = root.find(".//c:skin", ns)
        self.assertIsNotNone(skin)

        bind_shape = skin.find("c:bind_shape_matrix", ns)
        self.assertIsNotNone(bind_shape)

        joints_src = skin.find("c:source[@id='skin-joints']", ns)
        self.assertIsNotNone(joints_src)

        weights_src = skin.find("c:source[@id='skin-weights']", ns)
        self.assertIsNotNone(weights_src)

        vweights = skin.find("c:vertex_weights", ns)
        self.assertIsNotNone(vweights)


if __name__ == "__main__":
    unittest.main()
