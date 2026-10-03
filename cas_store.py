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

"""Content-addressable storage engine (CasAssetStore) with automatic reference-counting."""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import sqlite3
import tempfile
import threading
from pathlib import Path
from typing import Dict, List, Optional, Set, Union

logger = logging.getLogger(__name__)

CHUNK_SIZE = 65536  # 64 KB chunk size for non-freezing SHA-256 calculation


class CasAssetStore:
    """Content-addressable asset store with SQLite-backed reference counting."""

    def __init__(self, store_dir: Optional[Union[str, Path]] = None, db_path: Optional[Union[str, Path]] = None):
        if store_dir is None:
            base_dir = Path(__file__).resolve().parent / "data" / "cas_store"
        else:
            base_dir = Path(store_dir).resolve()

        self.store_dir = base_dir
        self.store_dir.mkdir(parents=True, exist_ok=True)

        if db_path is None:
            self.db_path = self.store_dir / "ref_counts.sqlite"
        else:
            self.db_path = Path(db_path).resolve()
            self.db_path.parent.mkdir(parents=True, exist_ok=True)

        self._local = threading.local()
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        """Returns a thread-local SQLite database connection."""
        if not hasattr(self._local, "conn") or self._local.conn is None:
            conn = sqlite3.connect(str(self.db_path), timeout=30.0)
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA foreign_keys = ON;")
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return self._local.conn

    def _init_db(self) -> None:
        """Initializes the database schema if not already created."""
        conn = self._get_connection()
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cas_assets (
                    hash TEXT PRIMARY KEY,
                    storage_path TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    ref_count INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS package_references (
                    package_id TEXT NOT NULL,
                    virtual_path TEXT NOT NULL,
                    hash TEXT NOT NULL,
                    PRIMARY KEY (package_id, virtual_path),
                    FOREIGN KEY (hash) REFERENCES cas_assets(hash) ON DELETE CASCADE
                );
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS virtual_paths (
                    virtual_path TEXT PRIMARY KEY,
                    hash TEXT NOT NULL
                );
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pkg_ref_hash ON package_references(hash);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_vpath_hash ON virtual_paths(hash);")

    @staticmethod
    def compute_hash(source: Union[str, Path, bytes]) -> str:
        """Computes SHA-256 cryptographic hash of file path or bytes in chunks."""
        hasher = hashlib.sha256()
        if isinstance(source, (str, Path)):
            with open(source, "rb") as f:
                while chunk := f.read(CHUNK_SIZE):
                    hasher.update(chunk)
        elif isinstance(source, bytes):
            for i in range(0, len(source), CHUNK_SIZE):
                hasher.update(source[i:i + CHUNK_SIZE])
        else:
            raise TypeError("Source must be a file path or bytes")
        return hasher.hexdigest()

    def normalize_virtual_path(self, vpath: Union[str, Path]) -> str:
        """Normalizes virtual paths for standard database keys."""
        path_str = str(vpath).replace("\\", "/")
        return os.path.normpath(path_str).replace("\\", "/")

    def _get_target_path(self, file_hash: str, original_filename: Optional[str] = None) -> Path:
        """Generates internal CAS storage path based on hash prefix."""
        prefix = file_hash[:2]
        subdir = self.store_dir / prefix
        subdir.mkdir(parents=True, exist_ok=True)
        ext = ""
        if original_filename:
            ext = Path(original_filename).suffix.lower()
        return subdir / f"{file_hash}{ext}"

    def ingest_file(
        self,
        source: Union[str, Path, bytes],
        package_id: str,
        virtual_path: Optional[Union[str, Path]] = None,
        filename: Optional[str] = None
    ) -> str:
        """
        Ingests a file into CAS storage, updates ref counts, and assigns package ownership.

        Returns SHA-256 asset hash.
        """
        if isinstance(source, (str, Path)):
            src_path = Path(source)
            if not src_path.is_file():
                raise FileNotFoundError(f"Source file not found: {source}")
            file_hash = self.compute_hash(src_path)
            file_size = src_path.stat().st_size
            if filename is None:
                filename = src_path.name
            if virtual_path is None:
                virtual_path = str(src_path)
        elif isinstance(source, bytes):
            file_hash = self.compute_hash(source)
            file_size = len(source)
            if filename is None:
                filename = "asset.bin"
            if virtual_path is None:
                virtual_path = filename
        else:
            raise TypeError("Source must be a file path or bytes")

        norm_vpath = self.normalize_virtual_path(virtual_path)
        target_path = self._get_target_path(file_hash, filename)

        # Atomic copy/write to CAS store directory if not already stored
        if not target_path.exists():
            temp_fd, temp_path = tempfile.mkstemp(dir=str(self.store_dir))
            try:
                with os.fdopen(temp_fd, "wb") as f_out:
                    if isinstance(source, (str, Path)):
                        with open(source, "rb") as f_in:
                            while chunk := f_in.read(CHUNK_SIZE):
                                f_out.write(chunk)
                    else:
                        f_out.write(source)
                os.replace(temp_path, target_path)
            except Exception:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                raise

        conn = self._get_connection()
        with conn:
            # Upsert asset
            conn.execute(
                """
                INSERT INTO cas_assets (hash, storage_path, file_size, ref_count)
                VALUES (?, ?, ?, 0)
                ON CONFLICT(hash) DO UPDATE SET storage_path = excluded.storage_path;
                """,
                (file_hash, str(target_path), file_size)
            )

            # Insert package reference
            conn.execute(
                """
                INSERT INTO package_references (package_id, virtual_path, hash)
                VALUES (?, ?, ?)
                ON CONFLICT(package_id, virtual_path) DO UPDATE SET hash = excluded.hash;
                """,
                (package_id, norm_vpath, file_hash)
            )

            # Update virtual_paths mapping
            conn.execute(
                """
                INSERT INTO virtual_paths (virtual_path, hash)
                VALUES (?, ?)
                ON CONFLICT(virtual_path) DO UPDATE SET hash = excluded.hash;
                """,
                (norm_vpath, file_hash)
            )

            # Recalculate reference count
            conn.execute(
                """
                UPDATE cas_assets
                SET ref_count = (
                    SELECT COUNT(DISTINCT package_id)
                    FROM package_references
                    WHERE hash = ?
                )
                WHERE hash = ?;
                """,
                (file_hash, file_hash)
            )

        return file_hash

    def ingest_package(
        self,
        package_id: str,
        package_dir: Union[str, Path],
        virtual_base_path: Optional[str] = None
    ) -> List[str]:
        """
        Recursively ingests all asset files in a package directory.

        Returns list of ingested SHA-256 hashes.
        """
        pkg_path = Path(package_dir).resolve()
        if not pkg_path.is_dir():
            raise NotADirectoryError(f"Package directory not found: {package_dir}")

        ingested_hashes = []
        for root, _, files in os.walk(pkg_path):
            for file_name in files:
                file_path = Path(root) / file_name
                rel_path = file_path.relative_to(pkg_path)
                if virtual_base_path:
                    vpath = f"{virtual_base_path}/{rel_path.as_posix()}"
                else:
                    vpath = rel_path.as_posix()

                h = self.ingest_file(
                    source=file_path,
                    package_id=package_id,
                    virtual_path=vpath,
                    filename=file_name
                )
                ingested_hashes.append(h)

        return ingested_hashes

    def uninstall_package(self, package_id: str, run_gc: bool = True) -> List[str]:
        """
        Decrements ref counts and removes package ownership for package_id.

        If run_gc is True, purges unreferenced assets. Returns list of affected asset hashes.
        """
        conn = self._get_connection()
        affected_hashes: Set[str] = set()

        with conn:
            cursor = conn.execute(
                "SELECT DISTINCT hash FROM package_references WHERE package_id = ?;",
                (package_id,)
            )
            affected_hashes = {row["hash"] for row in cursor.fetchall()}

            conn.execute("DELETE FROM package_references WHERE package_id = ?;", (package_id,))

            # Clean up virtual paths that no longer have any package reference
            conn.execute("""
                DELETE FROM virtual_paths
                WHERE virtual_path NOT IN (SELECT DISTINCT virtual_path FROM package_references);
            """)

            # Recalculate reference count for affected hashes
            for h in affected_hashes:
                conn.execute(
                    """
                    UPDATE cas_assets
                    SET ref_count = (
                        SELECT COUNT(DISTINCT package_id)
                        FROM package_references
                        WHERE hash = ?
                    )
                    WHERE hash = ?;
                    """,
                    (h, h)
                )

        if run_gc:
            self.collect_garbage()

        return list(affected_hashes)

    def translate_path(self, legacy_path: Union[str, Path]) -> str:
        """
        Virtual path translator mapping legacy character file paths to CAS storage paths.

        Returns CAS storage path if mapped, otherwise returns legacy_path unchanged.
        """
        raw_str = str(legacy_path)
        norm_vpath = self.normalize_virtual_path(legacy_path)
        conn = self._get_connection()

        # Query virtual_paths or cas_assets directly
        cursor = conn.execute("""
            SELECT ca.storage_path
            FROM virtual_paths vp
            JOIN cas_assets ca ON vp.hash = ca.hash
            WHERE vp.virtual_path = ?;
        """, (norm_vpath,))
        row = cursor.fetchone()

        if row and row["storage_path"]:
            storage_path = Path(row["storage_path"])
            if storage_path.exists():
                return str(storage_path)

        # Also check if raw_str itself is a hash in cas_assets
        cursor = conn.execute("SELECT storage_path FROM cas_assets WHERE hash = ?;", (raw_str,))
        row = cursor.fetchone()
        if row and row["storage_path"]:
            storage_path = Path(row["storage_path"])
            if storage_path.exists():
                return str(storage_path)

        return raw_str

    def get_path(self, asset_hash: str) -> Optional[str]:
        """Returns physical storage path for asset_hash if present in CAS."""
        conn = self._get_connection()
        cursor = conn.execute("SELECT storage_path FROM cas_assets WHERE hash = ?;", (asset_hash,))
        row = cursor.fetchone()
        if row and row["storage_path"]:
            sp = Path(row["storage_path"])
            if sp.exists():
                return str(sp)
        return None

    def get_ref_count(self, asset_hash: str) -> int:
        """Returns reference count for asset_hash."""
        conn = self._get_connection()
        cursor = conn.execute("SELECT ref_count FROM cas_assets WHERE hash = ?;", (asset_hash,))
        row = cursor.fetchone()
        return row["ref_count"] if row else 0

    def get_package_assets(self, package_id: str) -> Dict[str, str]:
        """Returns a mapping of virtual_path -> hash for a given package_id."""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT virtual_path, hash FROM package_references WHERE package_id = ?;",
            (package_id,)
        )
        return {row["virtual_path"]: row["hash"] for row in cursor.fetchall()}

    def collect_garbage(self) -> int:
        """
        Background garbage collector purging unreferenced files from disk and database.

        Returns number of purged files.
        """
        conn = self._get_connection()
        unreferenced: List[sqlite3.Row] = []

        with conn:
            cursor = conn.execute("SELECT hash, storage_path FROM cas_assets WHERE ref_count <= 0;")
            unreferenced = cursor.fetchall()

            purged_count = 0
            for row in unreferenced:
                h = row["hash"]
                sp = Path(row["storage_path"]) if row["storage_path"] else None
                if sp and sp.exists():
                    try:
                        sp.unlink()
                        # Remove empty parent directory if empty
                        if sp.parent != self.store_dir and not any(sp.parent.iterdir()):
                            sp.parent.rmdir()
                    except OSError as e:
                        logger.warning(f"Error purging CAS file {sp}: {e}")

                conn.execute("DELETE FROM cas_assets WHERE hash = ?;", (h,))
                purged_count += 1

        return purged_count

    def close(self) -> None:
        """Closes the thread-local database connection."""
        if hasattr(self._local, "conn") and self._local.conn is not None:
            self._local.conn.close()
            self._local.conn = None


_global_cas_store: Optional[CasAssetStore] = None
_store_lock = threading.Lock()


def get_cas_store() -> CasAssetStore:
    """Returns global default CasAssetStore instance."""
    global _global_cas_store
    if _global_cas_store is None:
        with _store_lock:
            if _global_cas_store is None:
                _global_cas_store = CasAssetStore()
    return _global_cas_store
