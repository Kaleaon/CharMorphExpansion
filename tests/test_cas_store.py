# ##### BEGIN GPL LICENSE BLOCK #####
#
#  This program is free software; you can redistribute it and/or
#  modify it under the terms of the GNU General Public License
#  as published by the Free Software Foundation; either version 3
#  of the License, or (at your option) any later version.
#
#  This program is distributed in the hope that it will be useful,
#  but WITHOUT ANY WARRANTY; without even the implied warranty of
#  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#  GNU General Public License for more details.
#
#  You should have received a copy of the GNU General Public License
#  along with this program; if not, write to the Free Software Foundation,
#  Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# ##### END GPL LICENSE BLOCK #####

"""Unit and integration tests for CasAssetStore and reference-counting engine."""

import sys
from unittest.mock import MagicMock

if "bpy" not in sys.modules:
    bpy_mock = MagicMock()
    bpy_mock.app.version = (3, 0, 0)
    sys.modules["bpy"] = bpy_mock
    sys.modules["bpy.app"] = MagicMock()
    sys.modules["bpy.app.handlers"] = MagicMock()
    sys.modules["bpy_extras"] = MagicMock()
    sys.modules["bpy_extras.io_utils"] = MagicMock()
    sys.modules["bpy_extras.wm_utils"] = MagicMock()
    sys.modules["bpy_extras.wm_utils.progress_report"] = MagicMock()

import hashlib
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from cas_store import CasAssetStore, CHUNK_SIZE


class TestCasAssetStore(unittest.TestCase):
    """Test suite covering CAS asset storage, reference counting, path translation, and GC."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store_dir = Path(self.temp_dir.name) / "cas_store"
        self.db_path = Path(self.temp_dir.name) / "ref_counts.sqlite"
        self.store = CasAssetStore(store_dir=self.store_dir, db_path=self.db_path)

    def tearDown(self):
        self.store.close()
        self.temp_dir.cleanup()

    def test_sha256_hashing_chunked(self):
        """Verify SHA-256 computation on small and large inputs using chunking."""
        data = b"Shared texture binary data for testing CAS hashing"
        expected_hash = hashlib.sha256(data).hexdigest()

        # Test hashing bytes
        h_bytes = self.store.compute_hash(data)
        self.assertEqual(h_bytes, expected_hash)

        # Test hashing file
        file_path = Path(self.temp_dir.name) / "texture.png"
        file_path.write_bytes(data)
        h_file = self.store.compute_hash(file_path)
        self.assertEqual(h_file, expected_hash)

    def test_duplicate_texture_ingestion_deduplication(self):
        """
        Scenario: Duplicate Texture Ingestion.
        Importing two packages with identical textures stores a single file instance
        and increments the reference count.
        """
        shared_content = b"IDENTICAL_TEXTURE_CONTENT_PAYLOAD_12345"
        shared_hash = hashlib.sha256(shared_content).hexdigest()

        pkg1_dir = Path(self.temp_dir.name) / "package_alpha"
        pkg1_dir.mkdir()
        (pkg1_dir / "skin.png").write_bytes(shared_content)

        pkg2_dir = Path(self.temp_dir.name) / "package_beta"
        pkg2_dir.mkdir()
        (pkg2_dir / "skin.png").write_bytes(shared_content)

        # Ingest Package 1
        hashes_pkg1 = self.store.ingest_package(
            package_id="expansion_pack_alpha",
            package_dir=pkg1_dir,
            virtual_base_path="alpha/textures"
        )
        self.assertIn(shared_hash, hashes_pkg1)
        self.assertEqual(self.store.get_ref_count(shared_hash), 1)

        # Ingest Package 2 (identical texture)
        hashes_pkg2 = self.store.ingest_package(
            package_id="expansion_pack_beta",
            package_dir=pkg2_dir,
            virtual_base_path="beta/textures"
        )
        self.assertIn(shared_hash, hashes_pkg2)

        # Deduplication check: ref count must be 2, single physical file stored
        self.assertEqual(self.store.get_ref_count(shared_hash), 2)
        cas_path = self.store.get_path(shared_hash)
        self.assertIsNotNone(cas_path)
        self.assertTrue(Path(cas_path).exists())

    def test_ref_counted_package_cleanup(self):
        """
        Scenario: Silent Ref-Counted Package Cleanup.
        Uninstalling package_alpha decrements ref counts for shared textures (retaining them)
        and immediately purges unique assets whose ref count drops to zero.
        """
        shared_content = b"SHARED_TEXTURE_DATA"
        unique_content = b"UNIQUE_ALPHA_TEXTURE_DATA"

        shared_hash = hashlib.sha256(shared_content).hexdigest()
        unique_hash = hashlib.sha256(unique_content).hexdigest()

        # Ingest unique asset for alpha
        self.store.ingest_file(
            source=unique_content,
            package_id="pack_alpha",
            virtual_path="alpha/unique.png",
            filename="unique.png"
        )

        # Ingest shared asset for alpha and beta
        self.store.ingest_file(
            source=shared_content,
            package_id="pack_alpha",
            virtual_path="shared/diffuse.png",
            filename="diffuse.png"
        )
        self.store.ingest_file(
            source=shared_content,
            package_id="pack_beta",
            virtual_path="shared/diffuse.png",
            filename="diffuse.png"
        )

        self.assertEqual(self.store.get_ref_count(unique_hash), 1)
        self.assertEqual(self.store.get_ref_count(shared_hash), 2)

        # Uninstall pack_alpha
        self.store.uninstall_package("pack_alpha", run_gc=True)

        # Unique asset must be purged from DB and disk (ref count dropped to 0)
        self.assertEqual(self.store.get_ref_count(unique_hash), 0)
        self.assertIsNone(self.store.get_path(unique_hash))

        # Shared asset must be retained for pack_beta (ref count dropped to 1)
        self.assertEqual(self.store.get_ref_count(shared_hash), 1)
        shared_cas_path = self.store.get_path(shared_hash)
        self.assertIsNotNone(shared_cas_path)
        self.assertTrue(Path(shared_cas_path).exists())

        # Uninstall pack_beta
        self.store.uninstall_package("pack_beta", run_gc=True)

        # Shared asset must now be purged when ref count reaches 0
        self.assertEqual(self.store.get_ref_count(shared_hash), 0)
        self.assertIsNone(self.store.get_path(shared_hash))

    def test_virtual_path_translation_and_fallback(self):
        """Verify virtual path translation mapping and backward compatibility fallback."""
        texture_bytes = b"MAP_TEXTURE_DATA_XYZ"
        texture_hash = hashlib.sha256(texture_bytes).hexdigest()

        legacy_vpath = "characters/female/textures/skin.png"
        self.store.ingest_file(
            source=texture_bytes,
            package_id="base_female_pack",
            virtual_path=legacy_vpath,
            filename="skin.png"
        )

        # Mapped path translates to CAS store physical file path
        translated = self.store.translate_path(legacy_vpath)
        self.assertNotEqual(translated, legacy_vpath)
        self.assertTrue(Path(translated).exists())
        self.assertEqual(Path(translated).read_bytes(), texture_bytes)

        # Unmapped external path falls back gracefully to original path
        unmapped_path = "external/blender/materials/wood.blend"
        fallback = self.store.translate_path(unmapped_path)
        self.assertEqual(fallback, unmapped_path)

    def test_background_garbage_collector(self):
        """Verify collect_garbage cleans up orphaned entries and files."""
        asset_bytes = b"ORPHAN_ASSET_CONTENT"
        h = self.store.ingest_file(
            source=asset_bytes,
            package_id="temp_pack",
            virtual_path="temp/file.png"
        )

        cas_file = self.store.get_path(h)
        self.assertTrue(Path(cas_file).exists())

        # Manually clear package reference without GC
        self.store.uninstall_package("temp_pack", run_gc=False)

        # Ref count is 0, but GC hasn't run yet
        self.assertEqual(self.store.get_ref_count(h), 0)
        self.assertTrue(Path(cas_file).exists())

        # Run GC
        purged = self.store.collect_garbage()
        self.assertEqual(purged, 1)
        self.assertFalse(Path(cas_file).exists())


if __name__ == "__main__":
    unittest.main()
