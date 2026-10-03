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
import time
import logging
import bpy

logger = logging.getLogger(__name__)

PROCEDURAL_3D_NODE_TYPES = {
    'TEX_VORONOI',
    'TEX_NOISE',
    'TEX_MUSGRAVE',
    'TEX_WAVE',
    'TEX_MAGIC',
    'TEX_WHITE_NOISE',
    'TEX_POINTDENSITY',
    'TEX_VOXEL',
    'TEX_CHECKER'
}

CHANNEL_NAMES = [
    'Base Color',
    'Tangent Normal',
    'Roughness',
    'Metallic',
    'Specular',
    'Ambient Occlusion'
]


class MaterialNodeGraphClassifier:
    """Inspects material node trees to detect 3D procedural nodes vs 2D image/color stacks."""

    @staticmethod
    def is_3d_procedural_node(node) -> bool:
        if not node:
            return False
        if node.type in PROCEDURAL_3D_NODE_TYPES:
            return True
        # Check node group internals recursively if it's a group
        if node.type == 'GROUP' and node.node_tree:
            for sub_node in node.node_tree.nodes:
                if MaterialNodeGraphClassifier.is_3d_procedural_node(sub_node):
                    return True
        return False

    @staticmethod
    def trace_upstream_nodes(socket, visited=None) -> list:
        if visited is None:
            visited = set()
        nodes = []
        if not socket or not socket.is_linked:
            return nodes
        for link in socket.links:
            from_node = link.from_node
            if from_node in visited:
                continue
            visited.add(from_node)
            nodes.append(from_node)
            for input_socket in from_node.inputs:
                nodes.extend(MaterialNodeGraphClassifier.trace_upstream_nodes(input_socket, visited))
        return nodes

    @classmethod
    def is_channel_3d_procedural(cls, mat: bpy.types.Material, channel_name: str) -> bool:
        if not mat or not mat.use_nodes or not mat.node_tree:
            return False

        principled = cls.find_principled_bsdf(mat)
        if not principled:
            # Check entire node tree if Principled BSDF isn't standard
            for node in mat.node_tree.nodes:
                if cls.is_3d_procedural_node(node):
                    return True
            return False

        socket_map = {
            'Base Color': 'Base Color',
            'Tangent Normal': 'Normal',
            'Roughness': 'Roughness',
            'Metallic': 'Metallic',
            'Specular': 'Specular IOR Level' if 'Specular IOR Level' in principled.inputs else 'Specular',
            'Ambient Occlusion': None
        }

        socket_label = socket_map.get(channel_name)
        if not socket_label or socket_label not in principled.inputs:
            return False

        socket = principled.inputs[socket_label]
        upstream_nodes = cls.trace_upstream_nodes(socket)
        for node in upstream_nodes:
            if cls.is_3d_procedural_node(node):
                return True

        return False

    @classmethod
    def is_material_3d_procedural(cls, mat: bpy.types.Material) -> bool:
        if not mat or not mat.use_nodes or not mat.node_tree:
            return False
        for node in mat.node_tree.nodes:
            if cls.is_3d_procedural_node(node):
                return True
        return False

    @staticmethod
    def find_principled_bsdf(mat: bpy.types.Material):
        if not mat or not mat.use_nodes or not mat.node_tree:
            return None
        for node in mat.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                return node
        return None


class Fast2DCompositor:
    """Fast 2D GPU/CPU compositor engine for baking 2D texture layers in < 3s per slot."""

    @classmethod
    def bake_channel(cls, mat: bpy.types.Material, channel_name: str, resolution: int, image_format: str = 'PNG') -> bpy.types.Image:
        start_time = time.perf_counter()
        img_name = f"CM_Baked_{mat.name}_{channel_name.replace(' ', '_')}"
        img = bpy.data.images.get(img_name)
        if img:
            bpy.data.images.remove(img)

        img = bpy.data.images.new(
            name=img_name,
            width=resolution,
            height=resolution,
            alpha=(channel_name in ['Base Color', 'Tangent Normal']),
            float_buffer=False
        )

        principled = MaterialNodeGraphClassifier.find_principled_bsdf(mat)
        if not principled:
            # Fallback blank image
            cls._fill_fallback_image(img, channel_name)
            return img

        socket_map = {
            'Base Color': ('Base Color', (0.8, 0.8, 0.8, 1.0)),
            'Tangent Normal': ('Normal', (0.5, 0.5, 1.0, 1.0)),
            'Roughness': ('Roughness', (0.5, 0.5, 0.5, 1.0)),
            'Metallic': ('Metallic', (0.0, 0.0, 0.0, 1.0)),
            'Specular': ('Specular IOR Level' if 'Specular IOR Level' in principled.inputs else 'Specular', (0.5, 0.5, 0.5, 1.0)),
            'Ambient Occlusion': (None, (1.0, 1.0, 1.0, 1.0))
        }

        socket_info = socket_map.get(channel_name, (None, (0.0, 0.0, 0.0, 1.0)))
        socket_name, default_val = socket_info

        # Render flat 2D quad in temporary scene with orthographic camera
        cls._render_2d_flat_quad(mat, socket_name, default_val, img, resolution)

        # Set colorspace
        if channel_name in ['Tangent Normal', 'Roughness', 'Metallic', 'Specular']:
            img.colorspace_settings.name = 'Non-Color'
        else:
            img.colorspace_settings.name = 'sRGB'

        elapsed = time.perf_counter() - start_time
        logger.info("Fast2DCompositor baked %s - %s in %.3f seconds", mat.name, channel_name, elapsed)
        return img

    @classmethod
    def _fill_fallback_image(cls, img: bpy.types.Image, channel_name: str):
        defaults = {
            'Base Color': [0.8, 0.8, 0.8, 1.0],
            'Tangent Normal': [0.5, 0.5, 1.0, 1.0],
            'Roughness': [0.5, 0.5, 0.5, 1.0],
            'Metallic': [0.0, 0.0, 0.0, 1.0],
            'Specular': [0.5, 0.5, 0.5, 1.0],
            'Ambient Occlusion': [1.0, 1.0, 1.0, 1.0]
        }
        val = defaults.get(channel_name, [0.0, 0.0, 0.0, 1.0])
        pixels = val * (img.size[0] * img.size[1])
        img.pixels.foreach_set(pixels)

    @classmethod
    def _render_2d_flat_quad(cls, mat: bpy.types.Material, socket_name: str, default_val: tuple, target_img: bpy.types.Image, resolution: int):
        principled = MaterialNodeGraphClassifier.find_principled_bsdf(mat)
        socket = principled.inputs.get(socket_name) if (principled and socket_name) else None

        # Check if linked or static value
        if socket and socket.is_linked:
            # We construct a temporary material for 2D quad emission render
            temp_mat = bpy.data.materials.new(name="_CM_Temp2DBakeMat")
            temp_mat.use_nodes = True
            temp_mat.node_tree.nodes.clear()

            # Copy nodes from mat into temp_mat
            node_map = {}
            for node in mat.node_tree.nodes:
                new_node = temp_mat.node_tree.nodes.new(type=node.bl_idname)
                node_map[node] = new_node
                # Copy properties
                for prop in node.bl_rna.properties:
                    if not prop.is_readonly and prop.identifier not in {'rna_type', 'type', 'inputs', 'outputs'}:
                        try:
                            setattr(new_node, prop.identifier, getattr(node, prop.identifier))
                        except Exception:
                            pass
                if hasattr(node, 'image') and node.image:
                    new_node.image = node.image

            # Copy links
            for link in mat.node_tree.links:
                from_n = node_map.get(link.from_node)
                to_n = node_map.get(link.to_node)
                if from_n and to_n:
                    try:
                        temp_mat.node_tree.links.new(
                            from_n.outputs[link.from_socket.name],
                            to_n.inputs[link.to_socket.name]
                        )
                    except Exception:
                        pass

            # Create Emission output node
            emission = temp_mat.node_tree.nodes.new('ShaderNodeEmission')
            output = temp_mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            temp_mat.node_tree.links.new(emission.outputs['Emission'], output.inputs['Surface'])

            # Find socket source node in temp_mat
            temp_principled = None
            for node in temp_mat.node_tree.nodes:
                if node.type == 'BSDF_PRINCIPLED':
                    temp_principled = node
                    break

            if temp_principled and socket_name in temp_principled.inputs and temp_principled.inputs[socket_name].is_linked:
                source_link = temp_principled.inputs[socket_name].links[0]
                temp_mat.node_tree.links.new(
                    source_link.from_socket,
                    emission.inputs['Color']
                )
            else:
                emission.inputs['Color'].default_value = default_val

            # Setup temporary flat quad scene
            cls._render_scene_to_image(temp_mat, target_img, resolution)
            bpy.data.materials.remove(temp_mat)
        else:
            # Unlinked socket, fill constant color value
            val = list(default_val)
            if socket:
                if socket.type == 'RGBA':
                    val = list(socket.default_value)
                elif socket.type == 'VALUE':
                    v = float(socket.default_value)
                    val = [v, v, v, 1.0]
            pixels = val * (target_img.size[0] * target_img.size[1])
            target_img.pixels.foreach_set(pixels)

    @classmethod
    def _render_scene_to_image(cls, mat: bpy.types.Material, target_img: bpy.types.Image, resolution: int):
        orig_scene = bpy.context.scene
        mesh = bpy.data.meshes.new("_CM_TempBakeQuadMesh")
        obj = bpy.data.objects.new("_CM_TempBakeQuadObj", mesh)

        # 1x1 quad plane in XY (0..1)
        verts = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        faces = [(0, 1, 2, 3)]
        mesh.from_pydata(verts, [], faces)
        mesh.update()

        # Add UV Map (0..1)
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uv_data = [ (0, 0), (1, 0), (1, 1), (0, 1) ]
        for i, loop in enumerate(mesh.loops):
            uv_layer.data[loop.index].uv = uv_data[loop.vertex_index]

        mesh.materials.append(mat)

        # Create temporary bake scene
        bake_scene = bpy.data.scenes.new("_CM_Temp2DBakeScene")
        bake_scene.collection.objects.link(obj)

        cam_data = bpy.data.cameras.new("_CM_TempBakeCam")
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = 1.0
        cam_obj = bpy.data.objects.new("_CM_TempBakeCamObj", cam_data)
        cam_obj.location = (0.5, 0.5, 1.0)
        cam_obj.rotation_euler = (0, 0, 0)
        bake_scene.collection.objects.link(cam_obj)
        bake_scene.camera = cam_obj

        try:
            bake_scene.render.engine = 'BLENDER_WORKBENCH'
        except Exception:
            bake_scene.render.engine = 'WORKBENCH'
        bake_scene.display.shading.light = 'FLAT'
        bake_scene.display.shading.color_type = 'MATERIAL'
        bake_scene.render.resolution_x = resolution
        bake_scene.render.resolution_y = resolution
        bake_scene.render.resolution_percentage = 100

        # Save current scene
        window = bpy.context.window
        orig_scene_window = window.scene if window else None
        if window:
            window.scene = bake_scene

        # Render offscreen
        tmp_filepath = os.path.join(bpy.app.tempdir, "_cm_2d_bake_temp.png")
        bake_scene.render.filepath = tmp_filepath
        bake_scene.render.image_settings.file_format = 'PNG'
        bake_scene.render.image_settings.color_mode = 'RGBA'

        bpy.ops.render.render(write_still=True, scene=bake_scene.name)

        if os.path.exists(tmp_filepath):
            temp_loaded = bpy.data.images.load(tmp_filepath)
            target_img.pixels.foreach_set(list(temp_loaded.pixels))
            bpy.data.images.remove(temp_loaded)
            try:
                os.remove(tmp_filepath)
            except Exception:
                pass

        # Cleanup temporary scene & objects
        if window and orig_scene_window:
            window.scene = orig_scene_window

        bpy.data.scenes.remove(bake_scene)
        bpy.data.objects.remove(obj)
        bpy.data.objects.remove(cam_obj)
        bpy.data.meshes.remove(mesh)
        bpy.data.cameras.remove(cam_data)


class CyclesDeepBaker:
    """Cycles deep baking engine for complex 3D procedural shader nodes."""

    @classmethod
    def bake_channel(cls, obj: bpy.types.Object, mat: bpy.types.Material, channel_name: str, resolution: int) -> bpy.types.Image:
        start_time = time.perf_counter()
        img_name = f"CM_CyclesBaked_{mat.name}_{channel_name.replace(' ', '_')}"
        img = bpy.data.images.get(img_name)
        if img:
            bpy.data.images.remove(img)

        img = bpy.data.images.new(
            name=img_name,
            width=resolution,
            height=resolution,
            alpha=(channel_name in ['Base Color', 'Tangent Normal']),
            float_buffer=False
        )

        scene = bpy.context.scene
        orig_engine = scene.render.engine
        orig_bake_type = getattr(scene.cycles, 'bake_type', 'COMBINED') if hasattr(scene, 'cycles') else 'COMBINED'

        scene.render.engine = 'CYCLES'
        if hasattr(scene, 'cycles'):
            scene.cycles.samples = 4
            scene.cycles.bake_type = 'COMBINED'

        if not mat.use_nodes or not mat.node_tree:
            mat.use_nodes = True

        nodes = mat.node_tree.nodes
        tex_node = nodes.new('ShaderNodeTexImage')
        tex_node.image = img
        nodes.active = tex_node

        principled = MaterialNodeGraphClassifier.find_principled_bsdf(mat)

        # Connect appropriate output for Cycles baking
        temp_emission = None
        temp_output = None
        bake_type = 'EMIT'

        if channel_name == 'Tangent Normal':
            bake_type = 'NORMAL'
        elif channel_name == 'Roughness':
            bake_type = 'ROUGHNESS'
        else:
            # Use Emission node pass for color, metallic, specular, AO
            socket_map = {
                'Base Color': 'Base Color',
                'Metallic': 'Metallic',
                'Specular': 'Specular IOR Level' if (principled and 'Specular IOR Level' in principled.inputs) else 'Specular',
                'Ambient Occlusion': None
            }
            s_name = socket_map.get(channel_name)
            if principled and s_name and s_name in principled.inputs:
                temp_emission = nodes.new('ShaderNodeEmission')
                if principled.inputs[s_name].is_linked:
                    mat.node_tree.links.new(
                        principled.inputs[s_name].links[0].from_socket,
                        temp_emission.inputs['Color']
                    )
                else:
                    val = principled.inputs[s_name].default_value
                    if isinstance(val, (int, float)):
                        temp_emission.inputs['Color'].default_value = (val, val, val, 1.0)
                    else:
                        temp_emission.inputs['Color'].default_value = val

                temp_output = nodes.new('ShaderNodeOutputMaterial')
                mat.node_tree.links.new(temp_emission.outputs['Emission'], temp_output.inputs['Surface'])

        # Ensure object is active & selected
        for o in bpy.context.selected_objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

        try:
            if bake_type == 'NORMAL':
                bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=16)
                img.colorspace_settings.name = 'Non-Color'
            elif bake_type == 'ROUGHNESS':
                bpy.ops.object.bake(type='ROUGHNESS', margin=16)
                img.colorspace_settings.name = 'Non-Color'
            else:
                bpy.ops.object.bake(type='EMIT', margin=16)
                if channel_name in ['Metallic', 'Specular']:
                    img.colorspace_settings.name = 'Non-Color'
                else:
                    img.colorspace_settings.name = 'sRGB'
        except Exception as e:
            logger.error("Cycles bake error for %s - %s: %s", mat.name, channel_name, e)
            Fast2DCompositor._fill_fallback_image(img, channel_name)
        finally:
            # Clean up temp nodes
            if temp_emission:
                nodes.remove(temp_emission)
            if temp_output:
                nodes.remove(temp_output)
            nodes.remove(tex_node)

            # Restore scene settings
            scene.render.engine = orig_engine
            if hasattr(scene, 'cycles'):
                scene.cycles.bake_type = orig_bake_type

        elapsed = time.perf_counter() - start_time
        logger.info("CyclesDeepBaker baked %s - %s in %.3f seconds", mat.name, channel_name, elapsed)
        return img


class PBRMaterialBuilder:
    """Constructs clean Principled BSDF material trees linked to baked PBR textures."""

    @classmethod
    def create_baked_material(cls, orig_mat: bpy.types.Material, channel_images: dict[str, bpy.types.Image]) -> bpy.types.Material:
        new_mat = bpy.data.materials.new(name=f"{orig_mat.name}_PBR")
        new_mat.use_nodes = True
        nodes = new_mat.node_tree.nodes
        links = new_mat.node_tree.links
        nodes.clear()

        output = nodes.new('ShaderNodeOutputMaterial')
        output.location = (400, 0)

        principled = nodes.new('ShaderNodeBsdfPrincipled')
        principled.location = (0, 0)
        links.new(principled.outputs['BSDF'], output.inputs['Surface'])

        # Create texture nodes
        y_loc = 300

        # Base Color
        if 'Base Color' in channel_images:
            tex_col = nodes.new('ShaderNodeTexImage')
            tex_col.image = channel_images['Base Color']
            tex_col.location = (-400, y_loc)
            links.new(tex_col.outputs['Color'], principled.inputs['Base Color'])
            y_loc -= 250

        # Tangent Normal
        if 'Tangent Normal' in channel_images:
            tex_norm = nodes.new('ShaderNodeTexImage')
            tex_norm.image = channel_images['Tangent Normal']
            tex_norm.image.colorspace_settings.name = 'Non-Color'
            tex_norm.location = (-600, y_loc)

            norm_map = nodes.new('ShaderNodeNormalMap')
            norm_map.location = (-300, y_loc)

            links.new(tex_norm.outputs['Color'], norm_map.inputs['Color'])
            links.new(norm_map.outputs['Normal'], principled.inputs['Normal'])
            y_loc -= 250

        # Roughness
        if 'Roughness' in channel_images:
            tex_rough = nodes.new('ShaderNodeTexImage')
            tex_rough.image = channel_images['Roughness']
            tex_rough.image.colorspace_settings.name = 'Non-Color'
            tex_rough.location = (-400, y_loc)
            links.new(tex_rough.outputs['Color'], principled.inputs['Roughness'])
            y_loc -= 250

        # Metallic
        if 'Metallic' in channel_images:
            tex_met = nodes.new('ShaderNodeTexImage')
            tex_met.image = channel_images['Metallic']
            tex_met.image.colorspace_settings.name = 'Non-Color'
            tex_met.location = (-400, y_loc)
            links.new(tex_met.outputs['Color'], principled.inputs['Metallic'])
            y_loc -= 250

        # Specular
        spec_socket = 'Specular IOR Level' if 'Specular IOR Level' in principled.inputs else 'Specular'
        if 'Specular' in channel_images and spec_socket in principled.inputs:
            tex_spec = nodes.new('ShaderNodeTexImage')
            tex_spec.image = channel_images['Specular']
            tex_spec.image.colorspace_settings.name = 'Non-Color'
            tex_spec.location = (-400, y_loc)
            links.new(tex_spec.outputs['Color'], principled.inputs[spec_socket])

        return new_mat


class BackupRestoreManager:
    """Manages non-destructive material backup and restoration."""

    @classmethod
    def backup_materials(cls, obj: bpy.types.Object) -> dict[str, str]:
        if not obj or not obj.data or not hasattr(obj.data, 'materials'):
            return {}
        backup = {}
        for i, mat in enumerate(obj.data.materials):
            backup[str(i)] = mat.name if mat else ""
        obj["_charmorph_orig_materials"] = backup
        return backup

    @classmethod
    def restore_materials(cls, obj: bpy.types.Object) -> bool:
        if not obj or "_charmorph_orig_materials" not in obj:
            return False
        backup = dict(obj["_charmorph_orig_materials"])
        for idx_str, mat_name in backup.items():
            slot_idx = int(idx_str)
            if slot_idx < len(obj.data.materials):
                mat = bpy.data.materials.get(mat_name) if mat_name else None
                obj.data.materials[slot_idx] = mat
        del obj["_charmorph_orig_materials"]
        return True


def bake_character_materials(
    obj: bpy.types.Object,
    resolution: int = 2048,
    image_format: str = 'PNG',
    bake_mode: str = 'AUTO'
) -> dict[int, bpy.types.Material]:
    """
    Main hybrid baking pipeline.
    Inspects materials, bakes PBR channel maps via Fast2DCompositor or CyclesDeepBaker,
    replaces material slots on obj with clean PBR materials, and returns the newly created materials.
    """
    if not obj or not obj.data or not hasattr(obj.data, 'materials'):
        logger.error("Invalid object for material baking: %s", obj)
        return {}

    # Save original material backup
    BackupRestoreManager.backup_materials(obj)

    new_materials = {}
    tmp_dir = os.path.join(bpy.app.tempdir, "cm_baked_textures")
    os.makedirs(tmp_dir, exist_ok=True)
    ext_map = {'PNG': '.png', 'JPEG': '.jpg', 'TARGA': '.tga'}
    ext = ext_map.get(image_format, '.png')

    for i, mat in enumerate(obj.data.materials):
        if not mat:
            continue

        channel_images = {}
        for channel in CHANNEL_NAMES:
            use_cycles = False
            if bake_mode == 'CYCLES':
                use_cycles = True
            elif bake_mode == 'COMPOSITOR':
                use_cycles = False
            else: # AUTO
                use_cycles = MaterialNodeGraphClassifier.is_channel_3d_procedural(mat, channel)

            if use_cycles:
                logger.info("Routing %s - %s to CyclesDeepBaker (3D procedural detected)", mat.name, channel)
                img = CyclesDeepBaker.bake_channel(obj, mat, channel, resolution)
            else:
                logger.info("Routing %s - %s to Fast2DCompositor (2D stack)", mat.name, channel)
                img = Fast2DCompositor.bake_channel(mat, channel, resolution, image_format)

            # Save and pack image for FBX / GLTF export
            file_path = os.path.join(tmp_dir, f"{img.name}{ext}")
            img.filepath_raw = file_path
            img.file_format = image_format
            try:
                img.save()
                img.pack()
            except Exception as e:
                logger.warning("Could not save/pack baked image %s: %s", img.name, e)

            channel_images[channel] = img

        pbr_mat = PBRMaterialBuilder.create_baked_material(mat, channel_images)
        obj.data.materials[i] = pbr_mat
        new_materials[i] = pbr_mat

    return new_materials
