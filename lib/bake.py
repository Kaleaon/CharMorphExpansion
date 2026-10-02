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
# Copyright (C) 2026

import os
import logging
import bpy  # pylint: disable=import-error

from .materials import apply_tex_settings

logger = logging.getLogger(__name__)

PASS_CONFIGS = {
    "base_color": {
        "label": "Base Color",
        "colorspace": "sRGB",
        "bake_type": "DIFFUSE",
        "pass_type": "COLOR",
        "target_socket": "Base Color",
    },
    "normal": {
        "label": "Normal",
        "colorspace": "Non-Color",
        "bake_type": "NORMAL",
        "normal_space": "TANGENT",
        "target_socket": "Normal",
    },
    "roughness": {
        "label": "Roughness",
        "colorspace": "Non-Color",
        "bake_type": "ROUGHNESS",
        "target_socket": "Roughness",
    },
    "metallic": {
        "label": "Metallic",
        "colorspace": "Non-Color",
        "bake_type": "EMISSION",
        "target_socket": "Metallic",
    },
    "ao": {
        "label": "Ambient Occlusion",
        "colorspace": "Non-Color",
        "bake_type": "AO",
        "target_socket": None,
    },
}


def detect_udim_tiles(obj, mtl=None):
    """
    Detect UDIM tile numbers for the given object / material.
    Returns a sorted list of tile numbers (e.g. [1001, 1002]) if UDIM tiles are detected,
    or empty list if standard single 0..1 UV tile.
    """
    tiles = set()

    # Check if existing image texture nodes in the material use TILED source
    if mtl and getattr(mtl, "node_tree", None):
        for node in mtl.node_tree.nodes:
            if getattr(node, "type", None) == 'TEX_IMAGE' and getattr(node, "image", None):
                if getattr(node.image, 'source', None) == 'TILED':
                    for tile in getattr(node.image, 'tiles', []):
                        tiles.add(tile.number)

    # Check mesh UV loop coordinates if UV maps exist
    if obj and getattr(obj, 'type', '') == 'MESH' and getattr(obj, 'data', None):
        uv_layers = getattr(obj.data, 'uv_layers', None)
        uv_layer = getattr(uv_layers, 'active', None) if uv_layers else None
        if uv_layer and getattr(uv_layer, 'data', None):
            for uv_loop in uv_layer.data:
                u, v = uv_loop.uv
                if u < 0 or v < 0:
                    continue
                tile_u = int(u)
                tile_v = int(v)
                if tile_u >= 10 or tile_v >= 10:
                    continue
                tile_number = 1001 + tile_u + (tile_v * 10)
                tiles.add(tile_number)

    if len(tiles) > 1 or (len(tiles) == 1 and 1001 not in tiles):
        return sorted(list(tiles))
    return []


def create_target_image(image_name, resolution, colorspace, udim_tiles=None):
    """
    Create or retrieve a target image datablock for baking with specified resolution,
    colorspace, and optional UDIM tile sequence.
    """
    res = int(resolution)

    existing_img = bpy.data.images.get(image_name)
    if existing_img:
        bpy.data.images.remove(existing_img)

    if udim_tiles and len(udim_tiles) > 0:
        img = bpy.data.images.new(image_name, width=res, height=res, alpha=True, float_buffer=False, tiled=True)
        existing_numbers = {t.number for t in getattr(img, "tiles", [])}
        for tile_num in udim_tiles:
            if tile_num not in existing_numbers and hasattr(img, "tiles"):
                img.tiles.new(tile_number=tile_num)
    else:
        img = bpy.data.images.new(image_name, width=res, height=res, alpha=True, float_buffer=False)

    apply_tex_settings(img, colorspace)
    return img


def find_principled_bsdf(mtl):
    """
    Locate the primary Principled BSDF node in a material node tree.
    """
    if not mtl or not getattr(mtl, "node_tree", None):
        return None
    for node in mtl.node_tree.nodes:
        if getattr(node, "type", None) == 'BSDF_PRINCIPLED':
            return node
    return None


def find_output_node(mtl):
    """
    Locate the Material Output node in a material node tree.
    """
    if not mtl or not getattr(mtl, "node_tree", None):
        return None
    for node in mtl.node_tree.nodes:
        if getattr(node, "type", None) == 'OUTPUT_MATERIAL' and getattr(node, "is_active_output", False):
            return node
    for node in mtl.node_tree.nodes:
        if getattr(node, "type", None) == 'OUTPUT_MATERIAL':
            return node
    return None


def setup_temp_emission_node(mtl, source_socket):
    """
    Temporarily route a specific socket into an Emission shader node connected to Material Output
    for pure channel value extraction during baking.
    Returns (temp_nodes, original_links) for restoration after bake.
    """
    if not mtl or not getattr(mtl, "node_tree", None) or not source_socket:
        return [], []

    tree = mtl.node_tree
    output_node = find_output_node(mtl)
    if not output_node:
        return [], []

    surface_input = output_node.inputs.get('Surface')
    if not surface_input:
        return [], []

    original_links = []
    for link in getattr(surface_input, "links", []):
        original_links.append((link.from_socket, link.to_socket))

    emission_node = tree.nodes.new('ShaderNodeEmission')
    temp_nodes = [emission_node]

    if getattr(source_socket, "is_linked", False) and getattr(source_socket, "links", None):
        from_socket = source_socket.links[0].from_socket
        tree.links.new(from_socket, emission_node.inputs['Color'])
    else:
        val = getattr(source_socket, "default_value", (1.0, 1.0, 1.0, 1.0))
        if isinstance(val, (int, float)):
            emission_node.inputs['Color'].default_value = (val, val, val, 1.0)
        elif hasattr(val, "__len__"):
            if len(val) == 3:
                emission_node.inputs['Color'].default_value = (val[0], val[1], val[2], 1.0)
            elif len(val) == 4:
                emission_node.inputs['Color'].default_value = (val[0], val[1], val[2], val[3])

    tree.links.new(emission_node.outputs['Emission'], surface_input)
    return temp_nodes, original_links


def restore_temp_emission_node(mtl, temp_nodes, original_links):
    """
    Remove temporary emission node and restore original Material Output connections.
    """
    if not mtl or not getattr(mtl, "node_tree", None):
        return
    tree = mtl.node_tree
    for node in temp_nodes:
        tree.nodes.remove(node)

    output_node = find_output_node(mtl)
    if output_node and 'Surface' in output_node.inputs:
        surface_input = output_node.inputs['Surface']
        for link in list(getattr(surface_input, "links", [])):
            tree.links.remove(link)
        for from_soc, to_soc in original_links:
            tree.links.new(from_soc, to_soc)


def convert_material_to_baked_bsdf(mtl, baked_images):
    """
    Replaces procedural shader node tree with a single standardized Principled BSDF material
    graph linked to the generated baked image maps.
    """
    if not mtl or not getattr(mtl, "node_tree", None):
        return

    tree = mtl.node_tree
    tree.nodes.clear()

    output_node = tree.nodes.new('ShaderNodeOutputMaterial')
    output_node.location = (300, 0)

    bsdf_node = tree.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf_node.location = (0, 0)
    tree.links.new(bsdf_node.outputs['BSDF'], output_node.inputs['Surface'])

    # Base Color
    if "base_color" in baked_images:
        img = baked_images["base_color"]
        tex_node = tree.nodes.new('ShaderNodeTexImage')
        tex_node.location = (-400, 200)
        tex_node.image = img
        apply_tex_settings(img, "sRGB")
        if 'Base Color' in bsdf_node.inputs:
            tree.links.new(tex_node.outputs['Color'], bsdf_node.inputs['Base Color'])

    # Roughness
    if "roughness" in baked_images:
        img = baked_images["roughness"]
        tex_node = tree.nodes.new('ShaderNodeTexImage')
        tex_node.location = (-400, -100)
        tex_node.image = img
        apply_tex_settings(img, "Non-Color")
        if 'Roughness' in bsdf_node.inputs:
            tree.links.new(tex_node.outputs['Color'], bsdf_node.inputs['Roughness'])

    # Metallic
    if "metallic" in baked_images:
        img = baked_images["metallic"]
        tex_node = tree.nodes.new('ShaderNodeTexImage')
        tex_node.location = (-400, -350)
        tex_node.image = img
        apply_tex_settings(img, "Non-Color")
        if 'Metallic' in bsdf_node.inputs:
            tree.links.new(tex_node.outputs['Color'], bsdf_node.inputs['Metallic'])

    # Tangent Space Normal
    if "normal" in baked_images:
        img = baked_images["normal"]
        tex_node = tree.nodes.new('ShaderNodeTexImage')
        tex_node.location = (-600, -600)
        tex_node.image = img
        apply_tex_settings(img, "Non-Color")

        norm_map_node = tree.nodes.new('ShaderNodeNormalMap')
        norm_map_node.location = (-300, -600)
        norm_map_node.space = 'TANGENT'

        tree.links.new(tex_node.outputs['Color'], norm_map_node.inputs['Color'])
        if 'Normal' in bsdf_node.inputs:
            tree.links.new(norm_map_node.outputs['Normal'], bsdf_node.inputs['Normal'])

    # Ambient Occlusion
    if "ao" in baked_images:
        img = baked_images["ao"]
        tex_node = tree.nodes.new('ShaderNodeTexImage')
        tex_node.location = (-400, 450)
        tex_node.image = img
        apply_tex_settings(img, "Non-Color")


def save_image_to_disk(img, output_dir, file_format):
    """
    Saves baked image datablock to specified output directory on disk.
    Returns list of saved file paths.
    """
    if hasattr(bpy, "path") and callable(getattr(bpy.path, "abspath", None)):
        res = bpy.path.abspath(output_dir)
        abs_dir = res if isinstance(res, str) else output_dir
    else:
        abs_dir = output_dir

    if isinstance(abs_dir, str) and (abs_dir.startswith("//") or not os.path.isabs(abs_dir)):
        abs_dir = os.path.abspath(abs_dir.replace("//", "./"))

    os.makedirs(abs_dir, exist_ok=True)

    ext = ".tga" if file_format == 'TARGA' else ".png"
    img.file_format = 'TARGA' if file_format == 'TARGA' else 'PNG'

    saved_paths = []
    if getattr(img, 'source', None) == 'TILED' and hasattr(img, 'tiles'):
        for tile in img.tiles:
            tile_filename = f"{img.name}_{tile.number}{ext}"
            filepath = os.path.join(abs_dir, tile_filename)
            img.filepath = filepath
            img.save()
            saved_paths.append(filepath)
    else:
        filepath = os.path.join(abs_dir, f"{img.name}{ext}")
        img.filepath = filepath
        img.save()
        saved_paths.append(filepath)

    return saved_paths


def bake_pbr_materials(context, ui):
    """
    Executes the full Cycles PBR texture baking pipeline.
    """
    scene = context.scene

    target_objects = []
    if getattr(context, "active_object", None) and getattr(context.active_object, "type", None) == 'MESH':
        target_objects.append(context.active_object)
    elif getattr(context, "selected_objects", None):
        target_objects = [o for o in context.selected_objects if getattr(o, "type", None) == 'MESH']

    if not target_objects:
        logger.warning("No mesh objects selected for baking.")
        return []

    orig_engine = getattr(scene.render, "engine", "CYCLES")
    scene.render.engine = 'CYCLES'

    if hasattr(scene, 'cycles'):
        scene.cycles.samples = getattr(ui, 'bake_samples', 16)

    orig_use_clear = getattr(scene.render.bake, 'use_clear', True)
    orig_margin = getattr(scene.render.bake, 'margin', 16)

    scene.render.bake.use_clear = True
    scene.render.bake.margin = getattr(ui, 'bake_margin', 16)

    passes_to_bake = []
    if getattr(ui, 'bake_pass_base_color', True):
        passes_to_bake.append('base_color')
    if getattr(ui, 'bake_pass_normal', True):
        passes_to_bake.append('normal')
    if getattr(ui, 'bake_pass_roughness', True):
        passes_to_bake.append('roughness')
    if getattr(ui, 'bake_pass_metallic', True):
        passes_to_bake.append('metallic')
    if getattr(ui, 'bake_pass_ao', True):
        passes_to_bake.append('ao')

    resolution = getattr(ui, 'bake_res', '2048')
    file_format = getattr(ui, 'bake_format', 'PNG')
    output_dir = getattr(ui, 'bake_output_dir', '//baked_textures/')
    clean_nodes = getattr(ui, 'bake_clean_nodetree', True)
    use_udim_detect = getattr(ui, 'bake_udim', True)

    all_saved_files = []

    try:
        for obj in target_objects:
            if not getattr(obj, "data", None) or not getattr(obj.data, "materials", None):
                continue

            for mtl in obj.data.materials:
                if not mtl or not getattr(mtl, "use_nodes", False) or not getattr(mtl, "node_tree", None):
                    continue

                udim_tiles = detect_udim_tiles(obj, mtl) if use_udim_detect else []
                baked_images = {}

                for pass_id in passes_to_bake:
                    cfg = PASS_CONFIGS[pass_id]
                    img_name = f"{obj.name}_{mtl.name}_{pass_id}"
                    img = create_target_image(img_name, resolution, cfg["colorspace"], udim_tiles)

                    bake_node = mtl.node_tree.nodes.new('ShaderNodeTexImage')
                    bake_node.image = img
                    mtl.node_tree.nodes.active = bake_node
                    bake_node.select = True

                    if pass_id == 'normal':
                        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
                    elif pass_id == 'ao':
                        bpy.ops.object.bake(type='AO')
                    elif pass_id == 'base_color':
                        bsdf = find_principled_bsdf(mtl)
                        target_soc = bsdf.inputs.get('Base Color') if bsdf else None
                        if target_soc and getattr(target_soc, "is_linked", False):
                            temp_nodes, orig_links = setup_temp_emission_node(mtl, target_soc)
                            bpy.ops.object.bake(type='EMISSION')
                            restore_temp_emission_node(mtl, temp_nodes, orig_links)
                        else:
                            bpy.ops.object.bake(
                                type='DIFFUSE',
                                pass_type={'COLOR'},
                                use_pass_direct=False,
                                use_pass_indirect=False,
                                use_pass_color=True,
                            )
                    elif pass_id in ('roughness', 'metallic'):
                        bsdf = find_principled_bsdf(mtl)
                        target_soc_name = cfg["target_socket"]
                        target_soc = bsdf.inputs.get(target_soc_name) if bsdf and target_soc_name else None
                        if target_soc:
                            temp_nodes, orig_links = setup_temp_emission_node(mtl, target_soc)
                            bpy.ops.object.bake(type='EMISSION')
                            restore_temp_emission_node(mtl, temp_nodes, orig_links)
                        else:
                            b_type = cfg["bake_type"]
                            bpy.ops.object.bake(type=b_type)

                    mtl.node_tree.nodes.remove(bake_node)
                    baked_images[pass_id] = img

                    saved_paths = save_image_to_disk(img, output_dir, file_format)
                    all_saved_files.extend(saved_paths)

                if clean_nodes:
                    convert_material_to_baked_bsdf(mtl, baked_images)

    finally:
        scene.render.engine = orig_engine
        scene.render.bake.use_clear = orig_use_clear
        scene.render.bake.margin = orig_margin

    return all_saved_files
