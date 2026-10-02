import os
import sys
import unittest
import importlib.util

# Load mock_bpy from file location BEFORE importing CharMorphExpansion package
mock_path = os.path.join(os.path.dirname(__file__), "mock_bpy.py")
spec = importlib.util.spec_from_file_location("mock_bpy", mock_path)
mock_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mock_module)

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import CharMorphExpansion.preview_manager as preview_manager
import CharMorphExpansion.library as library
import CharMorphExpansion.assets as assets
import CharMorphExpansion.hair as hair
import CharMorphExpansion.pose as pose


class TestPreviewManager(unittest.TestCase):
    def setUp(self):
        preview_manager.clear_preview_collections()

    def tearDown(self):
        preview_manager.clear_preview_collections()

    def test_placeholder_creation(self):
        path = preview_manager.get_placeholder_filepath()
        self.assertTrue(os.path.isfile(path))
        self.assertTrue(os.path.getsize(path) > 0)

    def test_find_item_thumbnail_fallback(self):
        thumb = preview_manager.find_item_thumbnail("/nonexistent_directory_12345", "test_item")
        self.assertEqual(thumb, preview_manager.get_placeholder_filepath())

    def test_find_item_thumbnail_existing(self):
        addon_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        icons_dir = os.path.join(addon_dir, "icons")
        thumb = preview_manager.find_item_thumbnail(icons_dir, "placeholder")
        self.assertTrue(os.path.isfile(thumb))

    def test_get_icon_value_standalone(self):
        val = preview_manager.get_icon_value("base_models", "test_key", preview_manager.get_placeholder_filepath())
        self.assertIsInstance(val, int)

    def test_preview_collections_lifecycle(self):
        preview_manager.register()
        preview_manager.get_preview_collection("test_cat")
        preview_manager.unregister()
        self.assertEqual(len(preview_manager.preview_collections), 0)


class TestEnumCallbacks(unittest.TestCase):
    def test_enum_item_format(self):
        # Load character library
        library.library.load()

        # Check get_base_models
        base_models = library.get_base_models(None, None)
        self.assertIsInstance(base_models, list)
        self.assertTrue(len(base_models) > 0)
        for item in base_models:
            self.assertEqual(len(item), 5)
            self.assertIsInstance(item[0], str)
            self.assertIsInstance(item[1], str)
            self.assertIsInstance(item[2], str)
            self.assertIsInstance(item[3], int)
            self.assertIsInstance(item[4], int)

        # Check get_assets
        asset_items = assets.get_assets(None, None)
        self.assertIsInstance(asset_items, list)
        self.assertTrue(len(asset_items) > 0)
        for item in asset_items:
            self.assertEqual(len(item), 5)

        # Check get_hairstyles
        hair_items = hair.get_hairstyles(None, None)
        self.assertIsInstance(hair_items, list)
        self.assertTrue(len(hair_items) > 0)
        for item in hair_items:
            self.assertEqual(len(item), 5)

        # Check get_poses
        pose_items = pose.get_poses(None, None)
        self.assertIsInstance(pose_items, list)
        self.assertTrue(len(pose_items) > 0)
        for item in pose_items:
            self.assertEqual(len(item), 5)


if __name__ == "__main__":
    unittest.main()
