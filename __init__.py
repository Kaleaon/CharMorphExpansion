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
# Copyright (C) 2020 Michael Vigovsky

import logging
import sys
from unittest.mock import MagicMock

class DummyPropertyDeferred:
    pass

class DummyObject:
    pass

class DummyMesh:
    pass

class DummyArmature:
    pass

try:
    import bpy  # pylint: disable=import-error
except ImportError:
    class DummyOperator:
        pass

    class DummyImportHelper:
        pass

    class DummyExportHelper:
        pass

    bpy = MagicMock()
    bpy.app.version = (3, 3, 0)
    bpy.props._PropertyDeferred = DummyPropertyDeferred
    bpy.types.Operator = DummyOperator
    bpy.types.Panel = DummyOperator
    bpy.types.PropertyGroup = DummyOperator
    bpy.types.AddonPreferences = DummyOperator
    bpy.types.UIList = DummyOperator
    bpy.types.Header = DummyOperator
    bpy.types.Menu = DummyOperator
    bpy.types.Object = DummyObject
    bpy.types.Mesh = DummyMesh
    bpy.types.Armature = DummyArmature

    mock_bpy_extras = MagicMock()
    mock_bpy_extras.io_utils.ImportHelper = DummyImportHelper
    mock_bpy_extras.io_utils.ExportHelper = DummyExportHelper

    sys.modules["bpy"] = bpy
    sys.modules["bpy.app"] = bpy.app
    sys.modules["bpy.app.handlers"] = MagicMock()
    sys.modules["bpy.props"] = bpy.props
    sys.modules["bpy.types"] = bpy.types
    mock_utils = MagicMock()
    mock_utils.register_classes_factory.return_value = (MagicMock(), MagicMock())
    bpy.utils = mock_utils
    sys.modules["bpy.utils"] = mock_utils
    sys.modules["addon_utils"] = MagicMock()
    sys.modules["mathutils"] = MagicMock()
    sys.modules["bmesh"] = MagicMock()
    sys.modules["rna_prop_ui"] = MagicMock()
    sys.modules["idprop"] = MagicMock()
    sys.modules["idprop.types"] = MagicMock()
    sys.modules["bpy_extras"] = mock_bpy_extras
    sys.modules["bpy_extras.io_utils"] = mock_bpy_extras.io_utils
    sys.modules["bpy_extras.wm_utils"] = MagicMock()
    sys.modules["bpy_extras.wm_utils.progress_report"] = MagicMock()

from . import addon_updater_ops
from . import common, library, assets, morphing, randomize, file_io, hair, finalize, rig, rigify, pose, prefs, cmedit
from .lib import charlib

logger = logging.getLogger(__name__)

bl_info = {
    "name": "CharMorph",
    "author": "Michael Vigovsky",
    "version": (0, 3, 5),
    "blender": (3, 3, 0),
    "location": "View3D > Tools > CharMorph",
    "description": "Character creation and morphing, cloth fitting and rigging tools",
    'wiki_url': "",
    'tracker_url': 'https://github.com/Upliner/CharMorph/issues',
    "category": "Characters"
}
VERSION_ANNEX = ""

owner = object()


class VIEW3D_PT_CharMorph(bpy.types.Panel):
    bl_idname = "VIEW3D_PT_CharMorph"
    bl_label = "".join(("CharMorph ", ".".join(str(item) for item in bl_info["version"]), VERSION_ANNEX))
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "CharMorph"
    bl_order = 1

    def draw(self, _):
        pass


def on_select():
    common.manager.on_select()


@bpy.app.handlers.persistent
def undoredo_post(_context, _scene):
    common.manager.on_select(undoredo=True)


def subscribe_select_obj():
    bpy.msgbus.clear_by_owner(owner)
    bpy.msgbus.subscribe_rna(
        owner=owner,
        key=(bpy.types.LayerObjects, "active"),
        args=(),
        options={"PERSISTENT"},
        notify=on_select)


@bpy.app.handlers.persistent
def load_handler(_):
    subscribe_select_obj()
    common.manager.del_charmorphs()
    on_select()


@bpy.app.handlers.persistent
def select_handler(_):
    on_select()


classes: list[type] = [None, prefs.CharMorphPrefs, VIEW3D_PT_CharMorph]

uiprops = [bpy.types.PropertyGroup]

for module in library, morphing, randomize, file_io, assets, hair, rig, rigify, finalize, pose:
    classes.extend(module.classes)
    if hasattr(module, "UIProps"):
        uiprops.append(module.UIProps)

CharMorphUIProps = type("CharMorphUIProps", tuple(uiprops), {})
classes[0] = CharMorphUIProps

class_register, class_unregister = bpy.utils.register_classes_factory(classes)


def register():
    # addon updater code and configurations
    # in case of broken version, try to register the updater first
    # so that users can revert back to a working version
    addon_updater_ops.register(bl_info)
    logger.debug("Charmorph register")
    charlib.library.load()
    class_register()
    common.register()
    bpy.types.WindowManager.charmorph_ui = bpy.props.PointerProperty(type=CharMorphUIProps, options={"SKIP_SAVE"})
    subscribe_select_obj()

    bpy.app.handlers.load_post.append(load_handler)
    bpy.app.handlers.undo_post.append(undoredo_post)
    bpy.app.handlers.redo_post.append(undoredo_post)
    bpy.app.handlers.depsgraph_update_post.append(select_handler)

    cmedit.register()


def unregister():
    # addon updater unregister
    addon_updater_ops.unregister()
    logger.debug("Charmorph unregister")
    cmedit.unregister()

    for hlist in bpy.app.handlers:
        if not isinstance(hlist, list):
            continue
        for handler in hlist:
            if handler in (load_handler, select_handler):
                hlist.remove(handler)
                break

    bpy.msgbus.clear_by_owner(owner)
    del bpy.types.WindowManager.charmorph_ui
    common.manager.del_charmorphs()

    common.unregister()
    class_unregister()


if __name__ == "__main__":
    register()
