# Unit tests for CharMorph Cycles PBR Texture Baking Pipeline
import os
import tempfile
from unittest.mock import MagicMock

import bpy
from CharMorphExpansion.lib.bake import (
    detect_udim_tiles,
    create_target_image,
    find_principled_bsdf,
    find_output_node,
    setup_temp_emission_node,
    restore_temp_emission_node,
    convert_material_to_baked_bsdf,
    save_image_to_disk,
    bake_pbr_materials,
    PASS_CONFIGS,
)
from CharMorphExpansion.finalize import UIProps, OpBakePBR, CHARMORPH_PT_Finalize


class MockNode:
    def __init__(self, node_type, name="Node"):
        self.type = node_type
        self.name = name
        self.label = ""
        self.location = (0, 0)
        self.is_active_output = True
        self.image = None
        self.space = "TANGENT"
        self.inputs = {}
        self.outputs = {}

    def add_input(self, name):
        soc = MockSocket(name, "IN")
        self.inputs[name] = soc
        return soc

    def add_output(self, name):
        soc = MockSocket(name, "OUT")
        self.outputs[name] = soc
        return soc


class MockSocket:
    def __init__(self, name, direction):
        self.name = name
        self.direction = direction
        self.is_linked = False
        self.links = []
        self.default_value = (0.8, 0.8, 0.8, 1.0) if "Color" in name or name == "Surface" else 0.5


class MockLink:
    def __init__(self, from_socket, to_socket):
        self.from_socket = from_socket
        self.to_socket = to_socket


class MockTile:
    def __init__(self, number):
        self.number = number


class MockImageTiles:
    def __init__(self, tiled=False):
        self.tile_list = [MockTile(1001)] if tiled else []

    def __iter__(self):
        return iter(self.tile_list)

    def __len__(self):
        return len(self.tile_list)

    def new(self, tile_number):
        tile = MockTile(tile_number)
        self.tile_list.append(tile)
        return tile


class MockImage:
    def __init__(self, name, width=2048, height=2048, tiled=False):
        self.name = name
        self.width = width
        self.height = height
        self.source = 'TILED' if tiled else 'FILE'
        self.tiles = MockImageTiles(tiled)
        self.colorspace_settings = MagicMock()
        self.file_format = 'PNG'
        self.filepath = ''
        self.has_data = True

    def scale(self, w, h):
        self.width = w
        self.height = h

    def save(self):
        if self.filepath:
            os.makedirs(os.path.dirname(os.path.abspath(self.filepath)), exist_ok=True)
            with open(self.filepath, 'wb') as f:
                f.write(b"PNG_OR_TGA_MOCK_DATA")


class MockNodesCollection:
    def __init__(self, tree):
        self.tree = tree
        self.nodes_dict = {}
        self.active = None

    def values(self):
        return list(self.nodes_dict.values())

    def __iter__(self):
        return iter(self.nodes_dict.values())

    def new(self, node_type):
        node = MockNode(node_type, f"{node_type}_{len(self.nodes_dict)}")
        if node_type in ('OUTPUT_MATERIAL', 'ShaderNodeOutputMaterial'):
            node.add_input('Surface')
        elif node_type in ('BSDF_PRINCIPLED', 'ShaderNodeBsdfPrincipled'):
            node.add_input('Base Color')
            node.add_input('Roughness')
            node.add_input('Metallic')
            node.add_input('Normal')
            node.add_output('BSDF')
        elif node_type in ('ShaderNodeTexImage', 'TEX_IMAGE'):
            node.add_output('Color')
        elif node_type == 'ShaderNodeNormalMap':
            node.add_input('Color')
            node.add_output('Normal')
        elif node_type == 'ShaderNodeEmission':
            node.add_input('Color')
            node.add_output('Emission')
        self.nodes_dict[node.name] = node
        return node

    def remove(self, node):
        if hasattr(node, 'name') and node.name in self.nodes_dict:
            del self.nodes_dict[node.name]

    def clear(self):
        self.nodes_dict.clear()


class MockLinksCollection:
    def __init__(self, tree):
        self.tree = tree
        self.links_list = []

    def new(self, from_socket, to_socket):
        link = MockLink(from_socket, to_socket)
        self.links_list.append(link)
        to_socket.is_linked = True
        to_socket.links.append(link)
        from_socket.is_linked = True
        from_socket.links.append(link)
        return link

    def remove(self, link):
        if link in self.links_list:
            self.links_list.remove(link)
        if link in getattr(link.to_socket, "links", []):
            link.to_socket.links.remove(link)
            if not link.to_socket.links:
                link.to_socket.is_linked = False


class MockNodeTree:
    def __init__(self):
        self.nodes = MockNodesCollection(self)
        self.links = MockLinksCollection(self)


class MockUVLoop:
    def __init__(self, u, v):
        self.uv = (u, v)


class MockUVLayer:
    def __init__(self, uvs):
        self.data = [MockUVLoop(u, v) for u, v in uvs]


class MockMesh:
    def __init__(self, uvs=None):
        self.materials = []
        if uvs:
            mock_layer = MockUVLayer(uvs)
            mock_uvs = MagicMock()
            mock_uvs.active = mock_layer
            self.uv_layers = mock_uvs
        else:
            self.uv_layers = None


class MockObject:
    def __init__(self, name="TestObject", obj_type="MESH", uvs=None):
        self.name = name
        self.type = obj_type
        self.data = MockMesh(uvs)


class MockMaterial:
    def __init__(self, name="TestMaterial"):
        self.name = name
        self.use_nodes = True
        self.node_tree = MockNodeTree()


def test_ui_props_definitions():
    """Verify all PBR baking UI properties, operator bl_idname, panel, and pass configs exist."""
    annotations = UIProps.__annotations__
    assert "bake_res" in annotations
    assert "bake_pass_base_color" in annotations
    assert "bake_pass_normal" in annotations
    assert "bake_pass_roughness" in annotations
    assert "bake_pass_metallic" in annotations
    assert "bake_pass_ao" in annotations
    assert "bake_format" in annotations
    assert "bake_output_dir" in annotations
    assert "bake_clean_nodetree" in annotations
    assert "bake_udim" in annotations
    assert "bake_samples" in annotations
    assert "bake_margin" in annotations

    assert OpBakePBR.bl_idname == "charmorph.bake_pbr_materials"
    assert CHARMORPH_PT_Finalize.bl_label == "Finalization"
    assert len(PASS_CONFIGS) == 5


def test_detect_udim_tiles_single_and_multi():
    """Test UDIM tile detection for single tile and multi-tile UV layouts."""
    obj_single = MockObject("CharSingle", uvs=[(0.2, 0.3), (0.8, 0.9)])
    mtl_single = MockMaterial("MtlSingle")
    assert detect_udim_tiles(obj_single, mtl_single) == []

    obj_multi = MockObject("CharMulti", uvs=[(0.2, 0.3), (1.2, 0.3), (0.5, 1.5)])
    mtl_multi = MockMaterial("MtlMulti")
    tiles = detect_udim_tiles(obj_multi, mtl_multi)
    assert 1001 in tiles
    assert 1002 in tiles
    assert 1011 in tiles


def test_create_target_image():
    """Test target baking image creation for standard and UDIM images."""
    images_dict = {}

    def mock_images_new(name, width, height, alpha=True, float_buffer=False, tiled=False):
        img = MockImage(name, width, height, tiled=tiled)
        images_dict[name] = img
        return img

    def mock_images_get(name):
        return images_dict.get(name)

    bpy.data.images.new = mock_images_new
    bpy.data.images.get = mock_images_get
    bpy.data.images.remove = lambda img: images_dict.pop(img.name, None)

    # Single tile image
    img1 = create_target_image("Body_BaseColor", 2048, "sRGB")
    assert img1.width == 2048
    assert img1.source != 'TILED'

    # Multi-tile UDIM image
    img2 = create_target_image("Body_Normal", 4096, "Non-Color", udim_tiles=[1001, 1002, 1003])
    assert img2.width == 4096
    assert img2.source == 'TILED'
    tile_nums = [t.number for t in img2.tiles]
    assert 1001 in tile_nums
    assert 1002 in tile_nums
    assert 1003 in tile_nums


def test_find_nodes_and_emission_setup():
    """Test locating BSDF / Output nodes and temporary emission routing."""
    mtl = MockMaterial("TestMtl")
    tree = mtl.node_tree
    out_node = tree.nodes.new('OUTPUT_MATERIAL')
    bsdf_node = tree.nodes.new('BSDF_PRINCIPLED')
    tree.links.new(bsdf_node.outputs['BSDF'], out_node.inputs['Surface'])

    assert find_output_node(mtl) == out_node
    assert find_principled_bsdf(mtl) == bsdf_node

    source_soc = bsdf_node.inputs['Base Color']
    temp_nodes, orig_links = setup_temp_emission_node(mtl, source_soc)
    assert len(temp_nodes) == 1
    assert temp_nodes[0].type == 'ShaderNodeEmission'

    restore_temp_emission_node(mtl, temp_nodes, orig_links)
    assert len(mtl.node_tree.nodes.values()) == 2


def test_convert_material_to_baked_bsdf():
    """Test replacing procedural material tree with clean single Principled BSDF graph."""
    mtl = MockMaterial("ProceduralSkin")
    tree = mtl.node_tree
    # Add procedural noise/bump clutter
    tree.nodes.new('ShaderNodeTexNoise')
    tree.nodes.new('ShaderNodeBump')
    assert len(tree.nodes.values()) == 2

    baked_images = {
        "base_color": MockImage("Skin_BaseColor"),
        "normal": MockImage("Skin_Normal"),
        "roughness": MockImage("Skin_Roughness"),
        "metallic": MockImage("Skin_Metallic"),
        "ao": MockImage("Skin_AO"),
    }

    convert_material_to_baked_bsdf(mtl, baked_images)

    node_types = [n.type for n in mtl.node_tree.nodes.values()]
    assert 'ShaderNodeOutputMaterial' in node_types
    assert ('ShaderNodeBsdfPrincipled' in node_types or 'BSDF_PRINCIPLED' in node_types)
    assert 'ShaderNodeNormalMap' in node_types
    assert node_types.count('ShaderNodeTexImage') == 5


def test_save_image_to_disk():
    """Test saving texture files to disk in target directories."""
    with tempfile.TemporaryDirectory() as tmpdir:
        img = MockImage("Body_BaseColor_Test")
        paths = save_image_to_disk(img, tmpdir, "PNG")
        assert len(paths) == 1
        assert os.path.exists(paths[0])
        assert paths[0].endswith(".png")

        img_tga = MockImage("Body_Normal_Test")
        paths_tga = save_image_to_disk(img_tga, tmpdir, "TARGA")
        assert len(paths_tga) == 1
        assert os.path.exists(paths_tga[0])
        assert paths_tga[0].endswith(".tga")


def test_bake_pbr_materials_full_pipeline():
    """Test full execution of bake_pbr_materials with mocked scene and bake operator."""
    with tempfile.TemporaryDirectory() as tmpdir:
        obj = MockObject("CharHero")
        mtl = MockMaterial("BodyMaterial")

        # Set up node tree
        out_node = mtl.node_tree.nodes.new('OUTPUT_MATERIAL')
        bsdf_node = mtl.node_tree.nodes.new('BSDF_PRINCIPLED')
        mtl.node_tree.links.new(bsdf_node.outputs['BSDF'], out_node.inputs['Surface'])
        obj.data.materials.append(mtl)

        # Mock context
        context = MagicMock()
        context.active_object = obj
        context.selected_objects = [obj]
        context.scene = MagicMock()

        # Mock ui settings
        ui = MagicMock()
        ui.bake_res = "1024"
        ui.bake_format = "PNG"
        ui.bake_output_dir = tmpdir
        ui.bake_pass_base_color = True
        ui.bake_pass_normal = True
        ui.bake_pass_roughness = True
        ui.bake_pass_metallic = True
        ui.bake_pass_ao = True
        ui.bake_clean_nodetree = True
        ui.bake_udim = True
        ui.bake_samples = 16
        ui.bake_margin = 16

        images_dict = {}

        def mock_images_new(name, width, height, alpha=True, float_buffer=False, tiled=False):
            img = MockImage(name, width, height, tiled=tiled)
            images_dict[name] = img
            return img

        bpy.data.images.new = mock_images_new
        bpy.data.images.get = lambda n: images_dict.get(n)
        bpy.data.images.remove = lambda img: images_dict.pop(img.name, None)

        mock_bake_op = MagicMock()
        bpy.ops.object.bake = mock_bake_op

        saved_files = bake_pbr_materials(context, ui)

        assert len(saved_files) == 5
        for path in saved_files:
            assert os.path.exists(path)

        # Check node graph conversion
        node_types = [n.type for n in mtl.node_tree.nodes.values()]
        assert ('ShaderNodeBsdfPrincipled' in node_types or 'BSDF_PRINCIPLED' in node_types)
        assert 'ShaderNodeOutputMaterial' in node_types
        assert 'ShaderNodeNormalMap' in node_types
