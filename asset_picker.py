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
#
# Copyright (C) 2026 CharMorph Contributors

import os
import logging
import bpy  # pylint: disable=import-error

try:
    import bpy.utils.previews  # pylint: disable=import-error
except ImportError:
    pass

try:
    from .lib.charlib import library, Asset, Character
    from . import common
except (ImportError, ValueError):
    from lib.charlib import library, Asset, Character
    import common

logger = logging.getLogger(__name__)

preview_collections = {}


def get_preview_collection():
    if "charmorph_picker" not in preview_collections:
        try:
            pcoll = bpy.utils.previews.new()
            preview_collections["charmorph_picker"] = pcoll
        except Exception as e:
            logger.warning("Could not initialize preview collection: %s", e)
            return None
    return preview_collections.get("charmorph_picker")


def clear_preview_collections():
    for pcoll in preview_collections.values():
        try:
            bpy.utils.previews.remove(pcoll)
        except Exception as e:
            logger.warning("Error removing preview collection: %s", e)
    preview_collections.clear()


def find_asset_thumbnail(asset: Asset):
    if not asset or not hasattr(asset, "dirpath") or not asset.dirpath:
        return None
    dirpath = asset.dirpath
    if not os.path.isdir(dirpath):
        return None

    # Common thumbnail filenames
    candidates = [
        "thumb.png", "thumb.jpg", "thumb.jpeg",
        "preview.png", "preview.jpg", "preview.jpeg",
        "thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg",
        f"{asset.name}.png", f"{asset.name}.jpg", f"{asset.name}.jpeg",
        "icon.png", "icon.jpg"
    ]
    for filename in candidates:
        filepath = os.path.join(dirpath, filename)
        if os.path.isfile(filepath):
            return filepath

    # Search directory for image files containing keyword
    try:
        for fname in os.listdir(dirpath):
            fpath = os.path.join(dirpath, fname)
            if os.path.isfile(fpath):
                lower = fname.lower()
                if lower.endswith((".png", ".jpg", ".jpeg")) and any(k in lower for k in ("thumb", "prev", "icon", "cover")):
                    return fpath
    except OSError:
        pass

    return None


def find_hair_thumbnail(char: Character, style_name: str):
    if not char or not hasattr(char, "dirpath") or not char.dirpath:
        return None

    candidates = [
        char.path("hair", f"{style_name}.png"),
        char.path("hair", f"{style_name}.jpg"),
        char.path("thumbnails", f"{style_name}.png"),
        char.path("thumbnails", f"{style_name}.jpg"),
        char.path("textures", f"{style_name}.png"),
        char.path(f"hair_{style_name}.png"),
    ]
    for filepath in candidates:
        if filepath and os.path.isfile(filepath):
            return filepath
    return None


def find_pose_thumbnail(char: Character, pose_name: str):
    if not char or not hasattr(char, "dirpath") or not char.dirpath:
        return None

    candidates = [
        char.path("poses", f"{pose_name}.png"),
        char.path("poses", f"{pose_name}.jpg"),
        char.path("thumbnails", f"{pose_name}.png"),
        char.path("thumbnails", f"{pose_name}.jpg"),
        char.path(f"pose_{pose_name}.png"),
    ]
    for filepath in candidates:
        if filepath and os.path.isfile(filepath):
            return filepath
    return None


def get_item_icon(item_type: str, item_id: str, item_obj=None, char=None):
    """
    Returns (icon_id, icon_name_string)
    icon_id is non-zero integer if loaded from bpy.utils.previews, or 0.
    """
    pcoll = get_preview_collection()
    icon_key = f"{item_type}:{item_id}"

    if pcoll is not None and icon_key in pcoll:
        return pcoll[icon_key].icon_id, ""

    # Attempt to locate thumbnail file
    thumb_path = None
    if item_type == "ASSET" and (isinstance(item_obj, Asset) or hasattr(item_obj, "dirpath")):
        thumb_path = find_asset_thumbnail(item_obj)
    elif item_type == "HAIR" and (isinstance(char, Character) or hasattr(char, "dirpath")):
        thumb_path = find_hair_thumbnail(char, item_id)
    elif item_type == "POSE" and (isinstance(char, Character) or hasattr(char, "dirpath")):
        thumb_path = find_pose_thumbnail(char, item_id)

    if pcoll is not None and thumb_path and os.path.isfile(thumb_path):
        try:
            preview = pcoll.load(icon_key, thumb_path, 'IMAGE')
            return preview.icon_id, ""
        except Exception as e:
            logger.warning("Failed to load preview image %s: %s", thumb_path, e)

    # Fallback built-in icons
    fallback_icons = {
        "ASSET": "MOD_CLOTH",
        "HAIR": "STRANDS",
        "POSE": "POSE_HLT",
    }
    return 0, fallback_icons.get(item_type, "OBJECT_DATA")


def categorize_item(item_type: str, item_name: str, item_obj=None) -> list[str]:
    """
    Assign category tags to items based on metadata and name keywords.
    """
    categories = ["ALL"]
    name_lower = item_name.lower()

    if item_type == "ASSET":
        # Check config tags if present
        if item_obj and hasattr(item_obj, "config") and isinstance(item_obj.config, dict):
            tags = item_obj.config.get("categories") or item_obj.config.get("tags") or []
            if isinstance(tags, str):
                tags = [tags]
            for tag in tags:
                categories.append(tag.upper())

        # Keyword heuristics
        if any(k in name_lower for k in ("shirt", "jacket", "top", "jumper", "crop", "suit", "vest", "bra", "upper", "coat")):
            categories.append("UPPER")
            categories.append("CLOTHING")
        if any(k in name_lower for k in ("pant", "skirt", "trouser", "jean", "short", "lower", "bottom", "legging", "brief")):
            categories.append("LOWER")
            categories.append("CLOTHING")
        if any(k in name_lower for k in ("boot", "shoe", "foot", "platform", "sandal", "heel", "sneaker")):
            categories.append("SHOES")
        if any(k in name_lower for k in ("glove", "hat", "glasses", "ring", "belt", "accessory", "accessories")):
            categories.append("ACCESSORIES")
        if any(k in name_lower for k in ("underwear", "pantie", "bra", "censor")):
            categories.append("UNDERWEAR")

    elif item_type == "HAIR":
        if item_name == "default":
            categories.append("DEFAULT")
        if any(k in name_lower for k in ("short", "buzz", "pixie", "crop")):
            categories.append("SHORT")
        if any(k in name_lower for k in ("long", "tail", "braid", "dread", "ponytail", "wavy", "afro")):
            categories.append("LONG")
        if any(k in name_lower for k in ("curly", "wave", "afro")):
            categories.append("CURLY")

    elif item_type == "POSE":
        if any(k in name_lower for k in ("stand", "idle", "tpose", "apose", "rest")):
            categories.append("STANDING")
        if any(k in name_lower for k in ("sit", "chair", "kneel", "crouch", "recline")):
            categories.append("SITTING")
        if any(k in name_lower for k in ("walk", "run", "jump", "fight", "action", "dance")):
            categories.append("ACTION")

    return list(set(categories))


def gather_items(context, mode="ASSETS"):
    """
    Gathers dictionary of available items based on character and scene context.
    Returns list of dicts:
    [{ 'type': item_type, 'id': item_id, 'display_name': name, 'categories': [...], 'obj': item_obj, 'char': char_obj }]
    """
    items = []
    wm = context.window_manager
    ui = getattr(wm, "charmorph_ui", None)

    # 1. Gather Assets
    if mode in ("ASSETS", "ALL"):
        char_obj = ui.fitting_char if ui else context.object
        char = library.obj_char(char_obj)
        if char:
            for k, asset in char.assets.items():
                items.append({
                    'type': 'ASSET',
                    'id': f"char_{k}",
                    'raw_name': k,
                    'display_name': f"{k} ({char.name})",
                    'categories': categorize_item('ASSET', k, asset),
                    'obj': asset,
                    'char': char
                })
        for k, asset in library.additional_assets.items():
            items.append({
                'type': 'ASSET',
                'id': f"add_{k}",
                'raw_name': k,
                'display_name': f"{k} (Library)",
                'categories': categorize_item('ASSET', k, asset),
                'obj': asset,
                'char': char
            })

    # 2. Gather Hair
    if mode in ("HAIR", "ALL"):
        active_obj = context.object or (ui.fitting_char if ui else None)
        char = library.obj_char(active_obj)
        items.append({
            'type': 'HAIR',
            'id': 'default',
            'raw_name': 'default',
            'display_name': 'Default Hair',
            'categories': categorize_item('HAIR', 'default'),
            'obj': None,
            'char': char
        })
        if char and hasattr(char, "hairstyles"):
            for name in char.hairstyles:
                items.append({
                    'type': 'HAIR',
                    'id': name,
                    'raw_name': name,
                    'display_name': name,
                    'categories': categorize_item('HAIR', name),
                    'obj': None,
                    'char': char
                })

    # 3. Gather Poses
    if mode in ("POSE", "ALL"):
        active_obj = context.active_object or context.object
        char = library.obj_char(active_obj)
        if char and hasattr(char, "poses"):
            for k in sorted(char.poses.keys()):
                items.append({
                    'type': 'POSE',
                    'id': k,
                    'raw_name': k,
                    'display_name': k,
                    'categories': categorize_item('POSE', k),
                    'obj': None,
                    'char': char
                })

    return items


class CHARMORPH_OT_AssetPickerSelect(bpy.types.Operator):
    bl_idname = "charmorph.asset_picker_select"
    bl_label = "Select Asset"
    bl_description = "Select and apply chosen asset thumbnail"
    bl_options = {'REGISTER', 'UNDO'}

    item_type: bpy.props.StringProperty(name="Item Type", default="ASSET")
    item_id: bpy.props.StringProperty(name="Item ID", default="")

    def execute(self, context):
        ui = context.window_manager.charmorph_ui
        if self.item_type == "ASSET":
            ui.fitting_library_asset = self.item_id
            return bpy.ops.charmorph.fit_library()
        elif self.item_type == "HAIR":
            ui.hair_style = self.item_id
            return bpy.ops.charmorph.hair_create()
        elif self.item_type == "POSE":
            ui.pose = self.item_id
            return bpy.ops.charmorph.apply_pose()
        return {'CANCELLED'}


class CHARMORPH_OT_AssetPickerSetCategory(bpy.types.Operator):
    bl_idname = "charmorph.asset_picker_set_category"
    bl_label = "Set Category"
    bl_description = "Set category filter for asset picker"

    category: bpy.props.StringProperty(name="Category", default="ALL")

    def execute(self, context):
        # Category set via operator property argument on popup
        return {'FINISHED'}


class CHARMORPH_OT_AssetPicker(bpy.types.Operator):
    bl_idname = "charmorph.asset_picker"
    bl_label = "Visual Asset Browser"
    bl_description = "Interactive modal asset picker dialog with thumbnail grid and keyword search"
    bl_options = {'REGISTER', 'UNDO'}

    mode: bpy.props.EnumProperty(
        name="Mode",
        items=[
            ('ASSETS', "Assets", "Clothing and body assets"),
            ('HAIR', "Hair", "Hairstyles"),
            ('POSE', "Pose", "Character poses"),
            ('ALL', "All", "All library items"),
        ],
        default='ASSETS'
    )

    category: bpy.props.StringProperty(
        name="Category",
        description="Filter by category tab",
        default="ALL"
    )

    search_query: bpy.props.StringProperty(
        name="Search",
        description="Type keyword to filter assets instantly",
        default="",
        options={'TEXTEDIT_UPDATE'}
    )

    grid_columns: bpy.props.IntProperty(
        name="Columns",
        description="Number of columns in the thumbnail grid",
        default=4,
        min=2,
        max=8
    )

    @classmethod
    def poll(cls, context):
        return True

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self, width=680)

    def draw(self, context):
        layout = self.layout
        layout.use_property_split = False

        # Top Control Bar: Search & Column Scaler
        box = layout.box()
        row = box.row(align=True)
        row.prop(self, "search_query", text="", icon='VIEWZOOM', placeholder="Search assets, hair, poses...")
        if self.search_query:
            row.prop(self, "search_query", text="", icon='CANCEL')

        row.separator()
        row.label(text="Grid Scale:")
        row.prop(self, "grid_columns", text="", slider=True)

        # Mode & Category Navigation Tabs
        row_cat = box.row(align=True)
        if self.mode == "ASSETS":
            categories = [("ALL", "All"), ("UPPER", "Upper"), ("LOWER", "Lower"), ("SHOES", "Shoes"), ("ACCESSORIES", "Accessories"), ("UNDERWEAR", "Underwear")]
        elif self.mode == "HAIR":
            categories = [("ALL", "All"), ("DEFAULT", "Default"), ("SHORT", "Short"), ("LONG", "Long"), ("CURLY", "Curly")]
        elif self.mode == "POSE":
            categories = [("ALL", "All"), ("STANDING", "Standing"), ("SITTING", "Sitting"), ("ACTION", "Action")]
        else:
            categories = [("ALL", "All"), ("CLOTHING", "Clothing"), ("SHOES", "Shoes"), ("SHORT", "Short Hair"), ("LONG", "Long Hair"), ("STANDING", "Standing Poses")]

        for cat_id, cat_label in categories:
            is_active = (self.category == cat_id)
            row_cat.prop_enum(self, "category", cat_id, text=cat_label)

        layout.separator()

        # Gather and Filter Items (In-memory, instant filtering)
        all_items = gather_items(context, mode=self.mode)
        query = self.search_query.strip().lower()

        filtered_items = []
        for item in all_items:
            # Category match
            if self.category != "ALL" and self.category not in item['categories']:
                continue
            # Search query match
            if query:
                searchable = f"{item['display_name']} {item['raw_name']} {' '.join(item['categories'])}".lower()
                if query not in searchable:
                    continue
            filtered_items.append(item)

        # Count header
        count_row = layout.row()
        count_row.label(text=f"Found {len(filtered_items)} item(s)", icon='FILTER')

        if not filtered_items:
            info_box = layout.box()
            info_box.label(text="No matching assets found.", icon='INFO')
            return

        # Responsive Visual Thumbnail Grid
        grid = layout.grid_flow(columns=self.grid_columns, align=True, even_columns=True, even_rows=True)

        for item in filtered_items:
            icon_id, icon_str = get_item_icon(item['type'], item['id'], item['obj'], item['char'])

            col = grid.column(align=True)
            box_tile = col.box()

            # Single-click selection tile button
            if icon_id > 0:
                op = box_tile.operator(
                    "charmorph.asset_picker_select",
                    text=item['raw_name'],
                    icon_value=icon_id
                )
            else:
                op = box_tile.operator(
                    "charmorph.asset_picker_select",
                    text=item['raw_name'],
                    icon=icon_str
                )

            op.item_type = item['type']
            op.item_id = item['id']

    def execute(self, context):
        return {'FINISHED'}


classes = [
    CHARMORPH_OT_AssetPickerSelect,
    CHARMORPH_OT_AssetPickerSetCategory,
    CHARMORPH_OT_AssetPicker,
]


def register():
    get_preview_collection()
    for cls in classes:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    clear_preview_collections()
