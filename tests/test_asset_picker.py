# Unit tests for CharMorph Interactive Asset Picker

import os
import sys
import unittest
import time
from unittest.mock import MagicMock, patch

# Mock bpy module for headless execution
class MockBpyProps:
    class _PropertyDeferred:
        pass
    @staticmethod
    def StringProperty(**kwargs):
        return kwargs.get('default', '')
    @staticmethod
    def IntProperty(**kwargs):
        return kwargs.get('default', 0)
    @staticmethod
    def EnumProperty(**kwargs):
        return kwargs.get('default', '')
    @staticmethod
    def FloatProperty(**kwargs):
        return kwargs.get('default', 0.0)
    @staticmethod
    def CollectionProperty(**kwargs):
        return None
    @staticmethod
    def BoolProperty(**kwargs):
        return kwargs.get('default', False)
    @staticmethod
    def PointerProperty(**kwargs):
        return None

class MockBpyTypes:
    def __init__(self):
        self._cache = {
            'Operator': type('Operator', (object,), {'bl_rna': MagicMock()}),
            'Panel': type('Panel', (object,), {'bl_rna': MagicMock()}),
            'PropertyGroup': type('PropertyGroup', (object,), {'bl_rna': MagicMock()}),
            'AddonPreferences': type('AddonPreferences', (object,), {'bl_rna': MagicMock()}),
            'Header': type('Header', (object,), {'bl_rna': MagicMock()}),
        }

    def __getattr__(self, name):
        if name not in self._cache:
            self._cache[name] = type(name, (object,), {'bl_rna': MagicMock()})
        return self._cache[name]

mock_bpy_types = MockBpyTypes()
MockImportHelper = type('ImportHelper', (object,), {'bl_rna': MagicMock()})

class MockBpyUtils:
    def register_classes_factory(self, classes):
        return (lambda: None, lambda: None)
    def register_class(self, cls):
        pass
    def unregister_class(self, cls):
        pass

mock_bpy_utils = MockBpyUtils()

class MockPreview:
    def __init__(self, icon_id=101):
        self.icon_id = icon_id

class MockPreviewCollection(dict):
    def load(self, key, path, img_type):
        p = MockPreview(hash(key) & 0x7FFFFFFF)
        self[key] = p
        return p

class MockBpyPreviews:
    @staticmethod
    def new():
        return MockPreviewCollection()
    @staticmethod
    def remove(pcoll):
        pcoll.clear()

# Inject mocks into sys.modules
mock_bpy = MagicMock()
mock_bpy.props = MockBpyProps
mock_bpy.types = mock_bpy_types
mock_bpy.app.version = (3, 3, 0)
mock_handlers = MagicMock()
mock_handlers.persistent = lambda func: func
sys.modules['bpy'] = mock_bpy
sys.modules['bpy.app'] = mock_bpy.app
sys.modules['bpy.app.handlers'] = mock_handlers
sys.modules['bpy.ops'] = mock_bpy.ops
if 'mathutils' not in sys.modules:
    sys.modules['mathutils'] = MagicMock()
if 'bmesh' not in sys.modules:
    sys.modules['bmesh'] = MagicMock()
sys.modules['rna_prop_ui'] = MagicMock()
sys.modules['idprop'] = MagicMock()
sys.modules['idprop.types'] = MagicMock()
sys.modules['addon_utils'] = MagicMock()

class MockIOUtils:
    ImportHelper = MockImportHelper
    ExportHelper = MockImportHelper

mock_bpy_extras = MagicMock()
mock_bpy_extras.io_utils = MockIOUtils()
sys.modules['bpy_extras'] = mock_bpy_extras
sys.modules['bpy_extras.io_utils'] = mock_bpy_extras.io_utils
sys.modules['bpy_extras.wm_utils'] = MagicMock()
sys.modules['bpy_extras.wm_utils.progress_report'] = MagicMock()
sys.modules['bpy.props'] = MockBpyProps
sys.modules['bpy.types'] = mock_bpy_types
sys.modules['bpy.utils'] = mock_bpy_utils
mock_bpy.utils = mock_bpy_utils
mock_bpy_utils.previews = MockBpyPreviews
sys.modules['bpy.utils.previews'] = MockBpyPreviews

# Import addon modules after mocking bpy
parent_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if addon_dir not in sys.path:
    sys.path.insert(0, addon_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from CharMorphExpansion import asset_picker, assets, hair, pose
    from CharMorphExpansion.lib.charlib import library, Asset, Character
except ImportError:
    import asset_picker, assets, hair, pose
    from lib.charlib import library, Asset, Character


class TestAssetPicker(unittest.TestCase):

    def setUp(self):
        asset_picker.clear_preview_collections()
        asset_picker.get_preview_collection()

    def test_categorize_item(self):
        self.assertIn("UPPER", asset_picker.categorize_item("ASSET", "RGF.crop.top.shirt"))
        self.assertIn("LOWER", asset_picker.categorize_item("ASSET", "RGF.pants"))
        self.assertIn("SHOES", asset_picker.categorize_item("ASSET", "RGF.Platform.ankle.boots"))
        self.assertIn("SHORT", asset_picker.categorize_item("HAIR", "f_hair_short01"))
        self.assertIn("LONG", asset_picker.categorize_item("HAIR", "f_hair_long_braid"))
        self.assertIn("STANDING", asset_picker.categorize_item("POSE", "stand_idle_01"))
        self.assertIn("SITTING", asset_picker.categorize_item("POSE", "sit_chair_02"))

    def test_get_item_icon(self):
        dummy_asset = asset_picker.Asset("dummy_jacket", "/tmp/dummy.blend", path="/tmp")
        icon_id, icon_str = asset_picker.get_item_icon("ASSET", "dummy_jacket", dummy_asset)
        self.assertEqual(icon_id, 0)
        self.assertEqual(icon_str, "MOD_CLOTH")

        # Test with image file
        test_img = "/tmp/thumb.png"
        with open(test_img, "wb") as f:
            f.write(b"dummy_png_data")

        try:
            dummy_asset.dirpath = "/tmp"
            icon_id_loaded, _ = asset_picker.get_item_icon("ASSET", "char_jacket", dummy_asset)
            self.assertGreater(icon_id_loaded, 0)
        finally:
            if os.path.exists(test_img):
                os.remove(test_img)

    def test_gather_and_filtering_performance(self):
        # Create context mock
        context = MagicMock()
        mock_ui = MagicMock()
        context.window_manager.charmorph_ui = mock_ui

        # Mock library character
        mock_char = MagicMock(spec=Character)
        mock_char.name = "mb_female"
        mock_char.assets = {f"item_{i}": Asset(f"item_{i}", f"/tmp/item_{i}.blend") for i in range(150)}
        mock_char.hairstyles = [f"hair_{i}" for i in range(50)]
        mock_char.poses = {f"pose_{i}": {} for i in range(100)}

        with patch.object(asset_picker.library, "obj_char", return_value=mock_char):
            # Benchmark item gathering & filtering performance
            t0 = time.time()
            all_items = asset_picker.gather_items(context, mode="ALL")
            t_gather = (time.time() - t0) * 1000

            self.assertGreaterEqual(len(all_items), 300)
            self.assertLess(t_gather, 50.0, "Item gathering took longer than 50ms")

            # Benchmark keyword search filtering (< 50ms)
            t0 = time.time()
            filtered = [
                item for item in all_items
                if "5" in item["display_name"].lower()
            ]
            t_filter = (time.time() - t0) * 1000
            self.assertLess(t_filter, 50.0, "Search query filtering took longer than 50ms")
            self.assertTrue(len(filtered) > 0)

    def test_launcher_buttons_in_panels(self):
        # Verify CHARMORPH_PT_Assets draw method includes Open Visual Browser button
        panel_assets = assets.CHARMORPH_PT_Assets()
        mock_ctx = MagicMock()
        mock_layout = MagicMock()
        panel_assets.layout = mock_layout

        panel_assets.draw(mock_ctx)
        # Check operator calls on layout
        op_calls = mock_layout.operator.call_args_list
        op_names = [call[0][0] for call in op_calls]
        self.assertIn("charmorph.asset_picker", op_names)

        # Verify CHARMORPH_PT_Hair draw method
        panel_hair = hair.CHARMORPH_PT_Hair()
        panel_hair.layout = mock_layout
        panel_hair.draw(mock_ctx)
        op_calls_hair = mock_layout.operator.call_args_list
        op_names_hair = [call[0][0] for call in op_calls_hair]
        self.assertIn("charmorph.asset_picker", op_names_hair)

        # Verify CHARMORPH_PT_Pose draw method
        panel_pose = pose.CHARMORPH_PT_Pose()
        panel_pose.layout = mock_layout
        panel_pose.draw(mock_ctx)
        op_calls_pose = mock_layout.operator.call_args_list
        op_names_pose = [call[0][0] for call in op_calls_pose]
        self.assertIn("charmorph.asset_picker", op_names_pose)

    def test_select_operator_execution(self):
        context = MagicMock()
        mock_ui = MagicMock()
        context.window_manager.charmorph_ui = mock_ui

        # Test ASSET selection
        select_op = asset_picker.CHARMORPH_OT_AssetPickerSelect()
        select_op.item_type = "ASSET"
        select_op.item_id = "char_jacket"

        with patch("bpy.ops.charmorph.fit_library") as mock_fit:
            mock_fit.return_value = {'FINISHED'}
            res = select_op.execute(context)
            self.assertEqual(mock_ui.fitting_library_asset, "char_jacket")
            mock_fit.assert_called_once()
            self.assertEqual(res, {'FINISHED'})

        # Test HAIR selection
        select_op.item_type = "HAIR"
        select_op.item_id = "hair_long_01"
        with patch("bpy.ops.charmorph.hair_create") as mock_hair:
            mock_hair.return_value = {'FINISHED'}
            res = select_op.execute(context)
            self.assertEqual(mock_ui.hair_style, "hair_long_01")
            mock_hair.assert_called_once()
            self.assertEqual(res, {'FINISHED'})

        # Test POSE selection
        select_op.item_type = "POSE"
        select_op.item_id = "sit_01"
        with patch("bpy.ops.charmorph.apply_pose") as mock_pose:
            mock_pose.return_value = {'FINISHED'}
            res = select_op.execute(context)
            self.assertEqual(mock_ui.pose, "sit_01")
            mock_pose.assert_called_once()
            self.assertEqual(res, {'FINISHED'})


if __name__ == "__main__":
    unittest.main()
