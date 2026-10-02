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

import json
import bpy, bpy_extras  # pylint: disable=import-error

from .lib import morphs, utils, pbr_baker
from .common import manager as mm


class UIProps:
    export_format: bpy.props.EnumProperty(
        name="Format",
        description="Export format",
        default="yaml",
        items=[
            ("yaml", "CharMorph (yaml)", ""),
            ("json", "MB-Lab (json)", ""),
            ("dae", "Collada (.dae)", "Second Life / OpenSim Collada format"),
            ("gltf", "GLTF 2.0 (.glb)", "Baked PBR GLTF 2.0 Binary"),
            ("fbx", "Autodesk FBX (.fbx)", "Baked PBR FBX Asset")
        ])

    export_resolution: bpy.props.EnumProperty(
        name="Resolution",
        description="Bake texture resolution",
        default="2048",
        items=[
            ("1024", "1024 x 1024", "1K resolution"),
            ("2048", "2048 x 2048", "2K resolution"),
            ("4096", "4096 x 4096", "4K resolution")
        ])

    export_image_format: bpy.props.EnumProperty(
        name="Texture Format",
        description="File format for baked texture maps",
        default="PNG",
        items=[
            ("PNG", "PNG", "Portable Network Graphics"),
            ("JPEG", "JPEG", "Joint Photographic Experts Group"),
            ("TARGA", "Targa", "Truevision TGA")
        ])

    bake_mode: bpy.props.EnumProperty(
        name="Bake Mode",
        description="Hybrid dual-engine baking mode",
        default="AUTO",
        items=[
            ("AUTO", "Auto Hybrid", "Fast compositing for 2D stacks, Cycles for 3D procedural nodes"),
            ("COMPOSITOR", "Fast 2D Compositor", "Force fast 2D compositing for all channels"),
            ("CYCLES", "Cycles Deep Bake", "Force Cycles 3D surface baking for all channels")
        ])

    restore_after_export: bpy.props.BoolProperty(
        name="Restore Original Materials",
        description="Restore original material node trees after export completes",
        default=True
    )


class CHARMORPH_PT_ImportExport(bpy.types.Panel):
    bl_label = "Import/Export"
    bl_parent_id = "VIEW3D_PT_CharMorph"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_options = {"DEFAULT_CLOSED"}
    bl_order = 5

    @classmethod
    def poll(cls, _):
        return bool(mm.morpher)

    def draw(self, context):
        ui = context.window_manager.charmorph_ui

        self.layout.label(text="Export format:")
        self.layout.prop(ui, "export_format", expand=True)
        self.layout.separator()
        col = self.layout.column(align=True)
        if ui.export_format == "json":
            col.operator("charmorph.export_json")
            col.operator("charmorph.import")
        elif ui.export_format == "yaml":
            col.operator("charmorph.export_yaml")
        elif ui.export_format == "dae":
            col.operator("charmorph.export_dae")
            col.operator("charmorph.import")
        elif ui.export_format in {"gltf", "fbx"}:
            box = self.layout.box()
            box.label(text="PBR Baking & Export Settings:")
            box.prop(ui, "export_resolution")
            box.prop(ui, "export_image_format")
            box.prop(ui, "bake_mode")
            box.prop(ui, "restore_after_export")
            col_exp = box.column(align=True)
            op = col_exp.operator("charmorph.bake_and_export", text=f"Bake & Export ({ui.export_format.upper()})")
            op.export_format = ui.export_format
            op.resolution = ui.export_resolution
            op.image_format = ui.export_image_format
            op.bake_mode = ui.bake_mode
            op.restore_after_export = ui.restore_after_export
            box.operator("charmorph.restore_materials", text="Restore Original Materials")


def morphs_to_data():
    m = mm.morpher
    typ = []

    if m.L1:
        typ.append(m.L1)
        alt_name = m.char.types.get(m.L1, {}).get("title")
        if alt_name:
            typ.append(alt_name)

    return {
        "type": typ,
        "morphs": {morph.name: m.core.prop_get(morph.name) for morph in m.core.morphs_l2 if morph.name},
        "meta": {k: m.meta_get(k) for k in m.core.char.morphs_meta},
        "materials": m.materials.as_dict()
    }


class OpExportJson(bpy.types.Operator, bpy_extras.io_utils.ExportHelper):
    bl_idname = "charmorph.export_json"
    bl_label = "Export morphs"
    bl_description = "Export current morphs to MB-Lab compatible json file"
    filename_ext = ".json"

    filter_glob: bpy.props.StringProperty(default="*.json", options={'HIDDEN'})

    @classmethod
    def poll(cls, _):
        return bool(mm.morpher)

    def execute(self, _):
        with open(self.filepath, "w", encoding="utf-8") as f:
            json.dump(morphs.charmorph_to_mblab(morphs_to_data()), f, indent=4, sort_keys=True)
        return {"FINISHED"}


class OpExportYaml(bpy.types.Operator, bpy_extras.io_utils.ExportHelper):
    bl_idname = "charmorph.export_yaml"
    bl_label = "Export morphs"
    bl_description = "Export current morphs to yaml file"
    filename_ext = ".yaml"

    filter_glob: bpy.props.StringProperty(default="*.yaml", options={'HIDDEN'})

    @classmethod
    def poll(cls, _):
        return bool(mm.morpher)

    def execute(self, _):
        with open(self.filepath, "w", encoding="utf-8") as f:
            utils.dump_yaml(morphs_to_data(), f)
        return {"FINISHED"}


class OpExportCollada(bpy.types.Operator, bpy_extras.io_utils.ExportHelper):
    bl_idname = "charmorph.export_dae"
    bl_label = "Export Collada (.dae)"
    bl_description = "Export character mesh and armature to Second Life / OpenSim compatible Collada (.dae) format"
    filename_ext = ".dae"

    filter_glob: bpy.props.StringProperty(default="*.dae", options={'HIDDEN'})

    @classmethod
    def poll(cls, _):
        return bool(mm.morpher)

    def execute(self, context):
        m = mm.morpher
        char_obj = m.core.obj if m else None
        if not char_obj:
            self.report({'ERROR'}, "No active character object found")
            return {'CANCELLED'}

        armature_obj = char_obj.find_armature() if hasattr(char_obj, "find_armature") else None
        if not armature_obj and m:
            armature_obj = m.rig

        from . import sl_bento
        if not sl_bento.is_sl_armature_valid(char_obj, armature_obj):
            self.report({'ERROR'}, "Export failed: Active character mesh must be rigged to a Second Life compatible armature (sl_bento) before Collada export.")
            return {'CANCELLED'}

        try:
            sl_bento.export_collada_sl(self.filepath, char_obj, armature_obj)
            self.report({'INFO'}, f"Successfully exported Collada model to {self.filepath}")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"Collada export error: {str(e)}")
            return {'CANCELLED'}


class OpImport(bpy.types.Operator, bpy_extras.io_utils.ImportHelper):
    bl_idname = "charmorph.import"
    bl_label = "Import morphs"
    bl_description = "Import morphs from yaml or json file"
    bl_options = {"UNDO"}

    filter_glob: bpy.props.StringProperty(default="*.yaml;*.json", options={'HIDDEN'})

    @classmethod
    def poll(cls, _):
        return bool(mm.morpher)

    def execute(self, _):
        data = morphs.load_morph_data(self.filepath)
        if data is None:
            self.report({'ERROR'}, "Can't recognize format")
            return {"CANCELLED"}

        typenames = data.get("type", [])
        if isinstance(typenames, str):
            typenames = [typenames]

        m = mm.morpher
        typemap = {v["title"]: k for k, v in m.core.char.types.items() if "title" in v}
        for name in (name for sublist in ([name, typemap.get(name)] for name in typenames) for name in sublist):
            if not name:
                continue
            if m.set_L1(name, False):
                break

        m.apply_morph_data(data, False)
        return {"FINISHED"}


class OpBakeAndExport(bpy.types.Operator, bpy_extras.io_utils.ExportHelper):
    bl_idname = "charmorph.bake_and_export"
    bl_label = "Bake & Export PBR Asset"
    bl_description = "Bake character materials using hybrid dual engine and export to GLTF 2.0 or FBX"

    export_format: bpy.props.StringProperty(default="gltf")
    resolution: bpy.props.StringProperty(default="2048")
    image_format: bpy.props.StringProperty(default="PNG")
    bake_mode: bpy.props.StringProperty(default="AUTO")
    restore_after_export: bpy.props.BoolProperty(default=True)

    filename_ext: bpy.props.StringProperty(default=".glb")

    filter_glob: bpy.props.StringProperty(default="*.glb;*.gltf;*.fbx", options={'HIDDEN'})

    @classmethod
    def poll(cls, context):
        return bool(mm.morpher and mm.morpher.obj) or bool(context.object)

    def invoke(self, context, event):
        if self.export_format == "fbx":
            self.filename_ext = ".fbx"
            self.filter_glob = "*.fbx"
        else:
            self.filename_ext = ".glb"
            self.filter_glob = "*.glb;*.gltf"
        return super().invoke(context, event)

    def execute(self, context):
        obj = mm.morpher.obj if (mm.morpher and mm.morpher.obj) else context.object
        if not obj:
            self.report({'ERROR'}, "No active character object found for baking and export")
            return {'CANCELLED'}

        res = int(self.resolution) if self.resolution.isdigit() else 2048

        # Execute hybrid PBR baker
        pbr_baker.bake_character_materials(
            obj=obj,
            resolution=res,
            image_format=self.image_format,
            bake_mode=self.bake_mode
        )

        try:
            if self.export_format == "fbx":
                bpy.ops.export_scene.fbx(
                    filepath=self.filepath,
                    use_selection=True,
                    embed_textures=True,
                    path_mode='COPY'
                )
            else:
                bpy.ops.export_scene.gltf(
                    filepath=self.filepath,
                    export_format='GLB',
                    use_selection=True,
                    export_materials='EXPORT',
                    export_colors=True
                )
            self.report({'INFO'}, f"Successfully exported PBR asset to {self.filepath}")
        except Exception as e:
            self.report({'ERROR'}, f"Export failed: {e}")
            return {'CANCELLED'}
        finally:
            if self.restore_after_export:
                pbr_baker.BackupRestoreManager.restore_materials(obj)

        return {'FINISHED'}


class OpRestoreOriginalMaterials(bpy.types.Operator):
    bl_idname = "charmorph.restore_materials"
    bl_label = "Restore Original Materials"
    bl_description = "Restore original non-baked material node trees on character"

    @classmethod
    def poll(cls, context):
        obj = mm.morpher.obj if (mm.morpher and mm.morpher.obj) else context.object
        return bool(obj and "_charmorph_orig_materials" in obj)

    def execute(self, context):
        obj = mm.morpher.obj if (mm.morpher and mm.morpher.obj) else context.object
        if obj and pbr_baker.BackupRestoreManager.restore_materials(obj):
            self.report({'INFO'}, "Restored original material node trees")
            return {'FINISHED'}
        self.report({'WARNING'}, "No material backup found to restore")
        return {'CANCELLED'}


classes = [OpImport, OpExportJson, OpExportYaml, OpExportCollada, OpBakeAndExport, OpRestoreOriginalMaterials, CHARMORPH_PT_ImportExport]
