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

import os
import zlib
import struct
import logging

try:
    import bpy
    import bpy.utils.previews
except ImportError:
    bpy = None

logger = logging.getLogger(__name__)

preview_collections = {}


def get_placeholder_filepath() -> str:
    addon_dir = os.path.dirname(os.path.realpath(__file__))
    placeholder_dir = os.path.join(addon_dir, "icons")
    placeholder_file = os.path.join(placeholder_dir, "placeholder.png")

    if not os.path.isfile(placeholder_file):
        os.makedirs(placeholder_dir, exist_ok=True)
        try:
            _generate_placeholder_png(placeholder_file)
        except Exception as e:
            logger.error("Failed to generate fallback placeholder icon: %s", e)

    return placeholder_file


def _generate_placeholder_png(filepath: str, width: int = 64, height: int = 64):
    def make_chunk(chunk_type: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b'IHDR', ihdr_data)

    raw_data = bytearray()
    border_color = (120, 120, 130, 255)
    bg_color = (60, 64, 72, 255)
    inner_color = (85, 90, 100, 255)

    for y in range(height):
        raw_data.append(0)
        for x in range(width):
            if x < 2 or x >= width - 2 or y < 2 or y >= height - 2:
                raw_data.extend(border_color)
            elif (x >= 16 and x < 48 and y >= 16 and y < 48) and ((x + y) % 8 < 4):
                raw_data.extend(inner_color)
            else:
                raw_data.extend(bg_color)

    idat_data = zlib.compress(bytes(raw_data))
    idat = make_chunk(b'IDAT', idat_data)
    iend = make_chunk(b'IEND', b'')

    with open(filepath, 'wb') as f:
        f.write(header + ihdr + idat + iend)


def get_preview_collection(category: str = "main"):
    if not bpy or not hasattr(bpy.utils, "previews"):
        return None

    pcoll = preview_collections.get(category)
    if pcoll is None:
        try:
            pcoll = bpy.utils.previews.new()
            preview_collections[category] = pcoll
        except Exception as e:
            logger.error("Failed to create preview collection '%s': %s", category, e)
            return None

    return pcoll


def get_icon_value(category: str, key: str, filepath: str = None) -> int:
    pcoll = get_preview_collection(category)
    if pcoll is None:
        return 0

    if key in pcoll:
        return pcoll[key].icon_value

    placeholder = get_placeholder_filepath()
    target_path = filepath if (filepath and isinstance(filepath, str) and os.path.isfile(filepath)) else placeholder

    try:
        pcoll.load(key, target_path, 'IMAGE')
        return pcoll[key].icon_value
    except Exception as e:
        logger.warning("Failed to load preview for key '%s' from '%s': %s", key, target_path, e)
        if target_path != placeholder and os.path.isfile(placeholder):
            try:
                pcoll.load(key, placeholder, 'IMAGE')
                return pcoll[key].icon_value
            except Exception as ex:
                logger.error("Failed to load placeholder fallback for key '%s': %s", key, ex)

    return 0


def find_item_thumbnail(dirpath: str, item_name: str = None, extra_paths: list = None) -> str:
    """Helper to locate a thumbnail image file for an asset/item."""
    candidates = []

    if extra_paths:
        for path in extra_paths:
            if path:
                candidates.append(path)

    if dirpath and os.path.isdir(dirpath):
        candidates.extend([
            os.path.join(dirpath, "thumb.png"),
            os.path.join(dirpath, "thumb.jpg"),
            os.path.join(dirpath, "preview.png"),
            os.path.join(dirpath, "preview.jpg"),
        ])
        if item_name:
            candidates.extend([
                os.path.join(dirpath, f"{item_name}.png"),
                os.path.join(dirpath, f"{item_name}.jpg"),
                os.path.join(dirpath, f"thumb_{item_name}.png"),
                os.path.join(dirpath, f"thumb_{item_name}.jpg"),
            ])

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate

    return get_placeholder_filepath()


def clear_preview_collections():
    if not bpy or not hasattr(bpy.utils, "previews"):
        preview_collections.clear()
        return

    for category, pcoll in list(preview_collections.items()):
        try:
            bpy.utils.previews.remove(pcoll)
        except Exception as e:
            logger.error("Error removing preview collection '%s': %s", category, e)

    preview_collections.clear()


def register():
    get_placeholder_filepath()


def unregister():
    clear_preview_collections()
