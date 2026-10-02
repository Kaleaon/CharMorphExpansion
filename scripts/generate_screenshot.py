import os
import sys
import bpy

current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from lib import pbr_baker

# Set up 3D scene with character mesh
bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.mesh.primitive_uv_sphere_add(radius=1.5, location=(0, 0, 0))
obj = bpy.context.active_object
obj.name = "CharacterHead"

# Create procedural material with 3D voronoi and noise
mat = bpy.data.materials.new("ProceduralSkin")
mat.use_nodes = True
nodes = mat.node_tree.nodes
principled = pbr_baker.MaterialNodeGraphClassifier.find_principled_bsdf(mat)

voronoi = nodes.new('ShaderNodeTexVoronoi')
voronoi.inputs['Scale'].default_value = 50.0

noise = nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value = 10.0

mix = nodes.new('ShaderNodeMix')
mix.data_type = 'FLOAT'
mat.node_tree.links.new(voronoi.outputs['Distance'], mix.inputs[2])
mat.node_tree.links.new(noise.outputs['Fac'], mix.inputs[3])

mat.node_tree.links.new(mix.outputs[0], principled.inputs['Roughness'])

obj.data.materials.append(mat)

# Execute hybrid PBR bake
pbr_baker.bake_character_materials(obj, resolution=1024, bake_mode='AUTO')

# Render 3D view screenshot
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.color_type = 'TEXTURE'
scene.display.shading.light = 'STUDIO'
scene.render.resolution_x = 1280
scene.render.resolution_y = 720

cam_data = bpy.data.cameras.new("Cam")
cam_obj = bpy.data.objects.new("CamObj", cam_data)
cam_obj.location = (2.5, -2.5, 2.0)
cam_obj.rotation_euler = (1.0, 0.0, 0.8)
scene.collection.objects.link(cam_obj)
scene.camera = cam_obj

screenshot_path = "/tmp/pbr_baker_result.png"
scene.render.filepath = screenshot_path
bpy.ops.render.render(write_still=True)

print(f"Generated screenshot at {screenshot_path}")
