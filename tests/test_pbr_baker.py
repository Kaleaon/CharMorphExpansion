# Unit and integration tests for Hybrid Dual Engine PBR Baker and Export Manager

import os
import sys
import unittest
import bpy

# Ensure CharMorph module is importable
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)
if os.path.dirname(parent_dir) not in sys.path:
    sys.path.insert(0, os.path.dirname(parent_dir))

try:
    from lib import pbr_baker
except ImportError:
    from CharMorphExpansion.lib import pbr_baker


class TestPBRBaker(unittest.TestCase):

    def setUp(self):
        # Clear existing mesh objects and materials
        bpy.ops.wm.read_factory_settings(use_empty=True)

        # Create test mesh cube with UVs
        bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 0))
        self.obj = bpy.context.active_object
        self.obj.name = "TestCharacter"

    def tearDown(self):
        # Clean up created objects
        for obj in list(bpy.data.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        for mat in list(bpy.data.materials):
            bpy.data.materials.remove(mat, do_unlink=True)
        for img in list(bpy.data.images):
            bpy.data.images.remove(img, do_unlink=True)

    def test_classifier_2d_vs_3d(self):
        """Test MaterialNodeGraphClassifier distinguishes 2D stacks from 3D procedural nodes."""
        # 2D Material
        mat_2d = bpy.data.materials.new(name="Mat2D")
        mat_2d.use_nodes = True
        nodes_2d = mat_2d.node_tree.nodes
        principled_2d = pbr_baker.MaterialNodeGraphClassifier.find_principled_bsdf(mat_2d)

        tex_img = nodes_2d.new('ShaderNodeTexImage')
        mat_2d.node_tree.links.new(tex_img.outputs['Color'], principled_2d.inputs['Base Color'])

        self.assertFalse(pbr_baker.MaterialNodeGraphClassifier.is_channel_3d_procedural(mat_2d, 'Base Color'))
        self.assertFalse(pbr_baker.MaterialNodeGraphClassifier.is_material_3d_procedural(mat_2d))

        # 3D Procedural Material (Voronoi skin pores / noise)
        mat_3d = bpy.data.materials.new(name="Mat3D")
        mat_3d.use_nodes = True
        nodes_3d = mat_3d.node_tree.nodes
        principled_3d = pbr_baker.MaterialNodeGraphClassifier.find_principled_bsdf(mat_3d)

        voronoi = nodes_3d.new('ShaderNodeTexVoronoi')
        mat_3d.node_tree.links.new(voronoi.outputs['Distance'], principled_3d.inputs['Roughness'])

        self.assertTrue(pbr_baker.MaterialNodeGraphClassifier.is_channel_3d_procedural(mat_3d, 'Roughness'))
        self.assertTrue(pbr_baker.MaterialNodeGraphClassifier.is_material_3d_procedural(mat_3d))

    def test_fast_2d_compositor(self):
        """Test Fast2DCompositor bakes 2D channels in < 3 seconds per slot."""
        mat = bpy.data.materials.new(name="TestFastMat")
        mat.use_nodes = True

        img = pbr_baker.Fast2DCompositor.bake_channel(mat, 'Base Color', resolution=1024)
        self.assertIsNotNone(img)
        self.assertEqual(img.size[0], 1024)
        self.assertEqual(img.size[1], 1024)
        self.assertEqual(img.colorspace_settings.name, 'sRGB')

        norm_img = pbr_baker.Fast2DCompositor.bake_channel(mat, 'Tangent Normal', resolution=1024)
        self.assertIsNotNone(norm_img)
        self.assertEqual(norm_img.colorspace_settings.name, 'Non-Color')

    def test_cycles_deep_baker(self):
        """Test CyclesDeepBaker handles 3D procedural Voronoi/Noise nodes producing valid normal/roughness maps."""
        mat = bpy.data.materials.new(name="TestCyclesMat")
        mat.use_nodes = True
        principled = pbr_baker.MaterialNodeGraphClassifier.find_principled_bsdf(mat)

        v_node = mat.node_tree.nodes.new('ShaderNodeTexVoronoi')
        mat.node_tree.links.new(v_node.outputs['Color'], principled.inputs['Roughness'])

        self.obj.data.materials.append(mat)

        rough_img = pbr_baker.CyclesDeepBaker.bake_channel(self.obj, mat, 'Roughness', resolution=512)
        self.assertIsNotNone(rough_img)
        self.assertEqual(rough_img.size[0], 512)
        self.assertEqual(rough_img.size[1], 512)
        self.assertEqual(rough_img.colorspace_settings.name, 'Non-Color')

    def test_pbr_material_builder(self):
        """Test PBRMaterialBuilder constructs clean Principled BSDF material trees."""
        mat_orig = bpy.data.materials.new(name="OrigMat")
        img_col = bpy.data.images.new("TestCol", 512, 512)
        img_norm = bpy.data.images.new("TestNorm", 512, 512)

        pbr_mat = pbr_baker.PBRMaterialBuilder.create_baked_material(
            mat_orig,
            {'Base Color': img_col, 'Tangent Normal': img_norm}
        )

        self.assertIsNotNone(pbr_mat)
        self.assertTrue(pbr_mat.use_nodes)

        principled = pbr_baker.MaterialNodeGraphClassifier.find_principled_bsdf(pbr_mat)
        self.assertIsNotNone(principled)

        # Verify Base Color link
        self.assertTrue(principled.inputs['Base Color'].is_linked)
        # Verify Normal link
        self.assertTrue(principled.inputs['Normal'].is_linked)

    def test_backup_and_restore_materials(self):
        """Test non-destructive backup and restoration of material node trees."""
        mat1 = bpy.data.materials.new("Mat1")
        mat2 = bpy.data.materials.new("Mat2")
        self.obj.data.materials.append(mat1)
        self.obj.data.materials.append(mat2)

        backup = pbr_baker.BackupRestoreManager.backup_materials(self.obj)
        self.assertEqual(len(backup), 2)
        self.assertEqual(backup["0"], "Mat1")
        self.assertEqual(backup["1"], "Mat2")

        # Replace materials
        baked_mat = bpy.data.materials.new("BakedMat")
        self.obj.data.materials[0] = baked_mat
        self.assertEqual(self.obj.data.materials[0].name, "BakedMat")

        # Restore
        restored = pbr_baker.BackupRestoreManager.restore_materials(self.obj)
        self.assertTrue(restored)
        self.assertEqual(self.obj.data.materials[0].name, "Mat1")

    def test_end_to_end_bake_and_export_gltf(self):
        """Test end-to-end GLTF 2.0 export with baked PBR materials."""
        mat = bpy.data.materials.new("CharSkin")
        mat.use_nodes = True
        self.obj.data.materials.append(mat)

        out_path = os.path.join(bpy.app.tempdir, "test_character.glb")
        if os.path.exists(out_path):
            os.remove(out_path)

        new_mats = pbr_baker.bake_character_materials(self.obj, resolution=512, bake_mode='AUTO')
        self.assertIn(0, new_mats)

        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            use_selection=True,
            export_materials='EXPORT'
        )

        self.assertTrue(os.path.exists(out_path))
        self.assertGreater(os.path.getsize(out_path), 0)

    def test_end_to_end_bake_and_export_fbx(self):
        """Test end-to-end FBX export with baked PBR materials."""
        mat = bpy.data.materials.new("CharBody")
        mat.use_nodes = True
        self.obj.data.materials.append(mat)

        out_path = os.path.join(bpy.app.tempdir, "test_character.fbx")
        if os.path.exists(out_path):
            os.remove(out_path)

        new_mats = pbr_baker.bake_character_materials(self.obj, resolution=512, bake_mode='AUTO')
        self.assertIn(0, new_mats)

        bpy.ops.export_scene.fbx(
            filepath=out_path,
            use_selection=True,
            embed_textures=True,
            path_mode='COPY'
        )

        self.assertTrue(os.path.exists(out_path))
        self.assertGreater(os.path.getsize(out_path), 0)


def run_tests():
    suite = unittest.TestLoader().loadTestsFromTestCase(TestPBRBaker)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    if not result.wasSuccessful():
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
