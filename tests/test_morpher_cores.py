import sys
from unittest.mock import MagicMock

if 'bpy' not in sys.modules:
    bpy = MagicMock()
    bpy.app = MagicMock()
    bpy.app.version = (2, 79, 0)
    bpy.app.handlers = MagicMock()
    bpy.app.handlers.persistent = lambda fn: fn
    bpy.props = MagicMock()
    bpy.props._PropertyDeferred = type("PropertyDeferred", (), {})

    sys.modules['bpy'] = bpy
    sys.modules['bpy.app'] = bpy.app
    sys.modules['bpy.app.handlers'] = bpy.app.handlers
    sys.modules['bpy.props'] = bpy.props

mock_modules = [
    'bpy_extras', 'bpy_extras.wm_utils', 'bpy_extras.wm_utils.progress_report',
    'bmesh', 'mathutils', 'rna_prop_ui', 'gpu',
]
for mod_name in mock_modules:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import unittest  # noqa: E402
import numpy  # noqa: E402

from lib import morphs, morpher_cores  # noqa: E402


class TestMorpherCoreL2Refactor(unittest.TestCase):

    def test_get_L2_morph_keys_without_L1(self):
        obj = MagicMock()
        obj.data = {}
        # mock charlib obj_char
        mock_char = MagicMock()
        mock_char.np_basis = None
        mock_char.types = {}
        mock_char.custom_morph_order = False

        core = morpher_cores.MorpherCore.__new__(morpher_cores.MorpherCore)
        core.char = mock_char
        core.L1 = ""

        keys = list(core._get_L2_morph_keys())
        self.assertEqual(keys, [""])

    def test_get_L2_morph_keys_with_L1_and_L2_type(self):
        mock_char = MagicMock()
        mock_char.types = {"female": {"L2": "female_l2"}}

        core = morpher_cores.MorpherCore.__new__(morpher_cores.MorpherCore)
        core.char = mock_char
        core.L1 = "female"

        keys = list(core._get_L2_morph_keys())
        self.assertEqual(keys, ["", "female_l2"])

    def test_build_l2_combiner(self):
        core = morpher_cores.MorpherCore.__new__(morpher_cores.MorpherCore)

        m1 = morphs.MinMaxMorphData("nose_size", numpy.zeros((10, 3)), -1.0, 1.0)
        m2 = morphs.MinMaxMorphData("lip_size", numpy.zeros((10, 3)), 0.0, 1.0)

        def mock_enum_raw():
            yield m1
            yield m2

        core._enum_l2_raw_morphs = mock_enum_raw
        combiner = core._build_l2_combiner()

        self.assertIsInstance(combiner, morphs.MorphCombiner)
        self.assertIn("nose_size", combiner.morphs_dict)
        self.assertIn("lip_size", combiner.morphs_dict)
        self.assertEqual(len(combiner.morphs_list), 2)

    def test_shape_keys_morpher_enum_l2_raw_morphs(self):
        sk1 = MagicMock()
        sk1.name = "L2__nose_size"
        sk1.slider_min = -1.0
        sk1.slider_max = 1.0

        sk2 = MagicMock()
        sk2.name = "L2_female_l2_lip_size"
        sk2.slider_min = 0.0
        sk2.slider_max = 1.0

        sk_other = MagicMock()
        sk_other.name = "L1_female"

        key_blocks = [sk1, sk2, sk_other]

        obj = MagicMock()
        obj.data.shape_keys.key_blocks = key_blocks

        mock_char = MagicMock()
        mock_char.types = {"female": {"L2": "female_l2"}}
        mock_char.custom_morph_order = False

        morpher = morpher_cores.ShapeKeysMorpher.__new__(morpher_cores.ShapeKeysMorpher)
        morpher.obj = obj
        morpher.char = mock_char
        morpher.L1 = "female"

        raw_morphs = list(morpher._enum_l2_raw_morphs())
        self.assertEqual(len(raw_morphs), 2)
        self.assertEqual(raw_morphs[0].name, "nose_size")
        self.assertEqual(raw_morphs[1].name, "lip_size")

        # Now test get_morphs_L2 delegates to _build_l2_combiner
        l2_morphs = morpher.get_morphs_L2()
        self.assertEqual(len(l2_morphs), 2)
        self.assertIn("nose_size", morpher.morphs_l2_dict)
        self.assertIn("lip_size", morpher.morphs_l2_dict)

    def test_numpy_morpher_enum_l2_raw_morphs(self):
        m1 = morphs.MinMaxMorphData("jaw_size", numpy.zeros((10, 3)), -1.0, 1.0)
        m2 = morphs.MinMaxMorphData("eye_size", numpy.zeros((10, 3)), 0.0, 1.0)

        mock_storage = MagicMock()

        def mock_enum(level, *names):
            if level == 2 and not names:
                return [m1]
            if level == 2 and names == ("female_l2",):
                return [m2]
            return []

        mock_storage.enum.side_effect = mock_enum

        mock_char = MagicMock()
        mock_char.types = {"female": {"L2": "female_l2"}}

        morpher = morpher_cores.NumpyMorpher.__new__(morpher_cores.NumpyMorpher)
        morpher.storage = mock_storage
        morpher.char = mock_char
        morpher.L1 = "female"

        raw_morphs = list(morpher._enum_l2_raw_morphs())
        self.assertEqual(len(raw_morphs), 2)
        self.assertEqual(raw_morphs[0].name, "jaw_size")
        self.assertEqual(raw_morphs[1].name, "eye_size")

        # Test get_morphs_L2
        l2_morphs = morpher.get_morphs_L2()
        self.assertEqual(len(l2_morphs), 2)


if __name__ == "__main__":
    unittest.main()
