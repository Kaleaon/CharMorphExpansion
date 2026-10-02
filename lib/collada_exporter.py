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
import xml.etree.ElementTree as ET
from xml.dom import minidom
import datetime
from typing import Dict, List, Tuple, Optional, Any

# Standard Second Life Rest Skeleton Joint Hierarchy and Default Rest Locations (in meters)
SL_DEFAULT_JOINT_TREE = {
    "name": "mPelvis",
    "pos": [0.0, 0.0, 1.0],
    "children": [
        {
            "name": "mTorso",
            "pos": [0.0, 0.0, 0.2],
            "children": [
                {
                    "name": "mChest",
                    "pos": [0.0, 0.0, 0.25],
                    "children": [
                        {
                            "name": "mNeck",
                            "pos": [0.0, 0.0, 0.25],
                            "children": [
                                {
                                    "name": "mHead",
                                    "pos": [0.0, 0.0, 0.15],
                                    "children": [
                                        {"name": "HEAD", "pos": [0.0, 0.0, 0.05], "children": []}
                                    ]
                                },
                                {"name": "NECK", "pos": [0.0, 0.0, 0.05], "children": []}
                            ]
                        },
                        {
                            "name": "mCollarLeft",
                            "pos": [0.05, 0.0, 0.2],
                            "children": [
                                {
                                    "name": "mShoulderLeft",
                                    "pos": [0.15, 0.0, 0.0],
                                    "children": [
                                        {
                                            "name": "mElbowLeft",
                                            "pos": [0.25, 0.0, 0.0],
                                            "children": [
                                                {
                                                    "name": "mWristLeft",
                                                    "pos": [0.25, 0.0, 0.0],
                                                    "children": [
                                                        {"name": "HAND_L", "pos": [0.08, 0.0, 0.0], "children": []}
                                                    ]
                                                },
                                                {"name": "LOWER_ARM_L", "pos": [0.1, 0.0, 0.0], "children": []}
                                            ]
                                        },
                                        {"name": "UPPER_ARM_L", "pos": [0.1, 0.0, 0.0], "children": []}
                                    ]
                                }
                            ]
                        },
                        {
                            "name": "mCollarRight",
                            "pos": [-0.05, 0.0, 0.2],
                            "children": [
                                {
                                    "name": "mShoulderRight",
                                    "pos": [-0.15, 0.0, 0.0],
                                    "children": [
                                        {
                                            "name": "mElbowRight",
                                            "pos": [-0.25, 0.0, 0.0],
                                            "children": [
                                                {
                                                    "name": "mWristRight",
                                                    "pos": [-0.25, 0.0, 0.0],
                                                    "children": [
                                                        {"name": "HAND_R", "pos": [-0.08, 0.0, 0.0], "children": []}
                                                    ]
                                                },
                                                {"name": "LOWER_ARM_R", "pos": [-0.1, 0.0, 0.0], "children": []}
                                            ]
                                        },
                                        {"name": "UPPER_ARM_R", "pos": [-0.1, 0.0, 0.0], "children": []}
                                    ]
                                }
                            ]
                        },
                        {"name": "CHEST", "pos": [0.0, 0.1, 0.1], "children": []},
                        {"name": "Pectoral_L", "pos": [0.08, 0.1, 0.08], "children": []},
                        {"name": "Pectoral_R", "pos": [-0.08, 0.1, 0.08], "children": []},
                        {"name": "UPPER_BACK", "pos": [0.0, -0.1, 0.1], "children": []}
                    ]
                },
                {"name": "TORSO", "pos": [0.0, 0.0, 0.1], "children": []},
                {"name": "BELLY", "pos": [0.0, 0.1, 0.0], "children": []},
                {"name": "LOWER_BACK", "pos": [0.0, -0.1, 0.0], "children": []}
            ]
        },
        {
            "name": "mHipLeft",
            "pos": [0.1, 0.0, -0.05],
            "children": [
                {
                    "name": "mKneeLeft",
                    "pos": [0.0, 0.0, -0.4],
                    "children": [
                        {
                            "name": "mAnkleLeft",
                            "pos": [0.0, 0.0, -0.4],
                            "children": [
                                {
                                    "name": "mToeLeft",
                                    "pos": [0.0, 0.15, -0.08],
                                    "children": []
                                },
                                {"name": "FOOT_L", "pos": [0.0, 0.05, -0.04], "children": []}
                            ]
                        },
                        {"name": "SHIN_L", "pos": [0.0, 0.0, -0.2], "children": []}
                    ]
                },
                {"name": "THIGH_L", "pos": [0.0, 0.0, -0.2], "children": []},
                {"name": "HIP_L", "pos": [0.05, 0.0, 0.0], "children": []}
            ]
        },
        {
            "name": "mHipRight",
            "pos": [-0.1, 0.0, -0.05],
            "children": [
                {
                    "name": "mKneeRight",
                    "pos": [0.0, 0.0, -0.4],
                    "children": [
                        {
                            "name": "mAnkleRight",
                            "pos": [0.0, 0.0, -0.4],
                            "children": [
                                {
                                    "name": "mToeRight",
                                    "pos": [0.0, 0.15, -0.08],
                                    "children": []
                                },
                                {"name": "FOOT_R", "pos": [0.0, 0.05, -0.04], "children": []}
                            ]
                        },
                        {"name": "SHIN_R", "pos": [0.0, 0.0, -0.2], "children": []}
                    ]
                },
                {"name": "THIGH_R", "pos": [0.0, 0.0, -0.2], "children": []},
                {"name": "HIP_R", "pos": [-0.05, 0.0, 0.0], "children": []}
            ]
        },
        {"name": "PELVIS", "pos": [0.0, 0.0, 0.0], "children": []},
        {"name": "BUTT_L", "pos": [0.08, -0.1, -0.05], "children": []},
        {"name": "BUTT_R", "pos": [-0.08, -0.1, -0.05], "children": []}
    ]
}


def create_identity_4x4() -> List[float]:
    return [
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 1.0, 0.0,
        0.0, 0.0, 0.0, 1.0
    ]


def create_translation_4x4(pos: List[float]) -> List[float]:
    return [
        1.0, 0.0, 0.0, pos[0],
        0.0, 1.0, 0.0, pos[1],
        0.0, 0.0, 1.0, pos[2],
        0.0, 0.0, 0.0, 1.0
    ]


def multiply_4x4(a: List[float], b: List[float]) -> List[float]:
    result = [0.0] * 16
    for row in range(4):
        for col in range(4):
            val = 0.0
            for k in range(4):
                val += a[row * 4 + k] * b[k * 4 + col]
            result[row * 4 + col] = val
    return result


def invert_translation_4x4(mat: List[float]) -> List[float]:
    """Inverts a rigid 4x4 matrix with pure translation."""
    inv = list(mat)
    inv[3] = -mat[3]
    inv[7] = -mat[7]
    inv[11] = -mat[11]
    return inv


def format_matrix_str(mat: List[float]) -> str:
    return " ".join(f"{v:.6f}" for v in mat)


class ColladaExporter:
    """Dedicated Collada XML exporter producing valid COLLADA 1.4.1 files for Second Life."""

    def __init__(
        self,
        mesh_positions: List[Tuple[float, float, float]],
        mesh_normals: List[Tuple[float, float, float]],
        mesh_uvs: List[Tuple[float, float]],
        polygons: List[List[Tuple[int, int, int]]],  # List of polygons, where each vert in polygon has (v_idx, norm_idx, uv_idx)
        vertex_weights: List[Dict[str, float]],       # List per vertex of {sl_bone_name: weight}
        joint_tree: Optional[Dict[str, Any]] = None
    ):
        self.mesh_positions = mesh_positions
        self.mesh_normals = mesh_normals
        self.mesh_uvs = mesh_uvs
        self.polygons = polygons
        self.vertex_weights = vertex_weights
        self.joint_tree = joint_tree or SL_DEFAULT_JOINT_TREE

        # Collect unique bones present in vertex_weights or standard skeleton
        self.active_bones = self._collect_active_bones()
        self.world_matrices: Dict[str, List[float]] = {}
        self.inverse_bind_matrices: Dict[str, List[float]] = {}
        self._compute_joint_transforms(self.joint_tree, create_identity_4x4())

    def _collect_active_bones(self) -> List[str]:
        used = set()
        for weights in self.vertex_weights:
            for b_name in weights.keys():
                used.add(b_name)

        # Collect ordered list of active bones present in joint_tree
        ordered_bones = []

        def traverse(node):
            name = node["name"]
            if name in used or True:  # Include bones in hierarchy for complete SL skeleton
                ordered_bones.append(name)
            for child in node.get("children", []):
                traverse(child)

        traverse(self.joint_tree)
        return ordered_bones

    def _compute_joint_transforms(self, node: Dict[str, Any], parent_world_mat: List[float]):
        name = node["name"]
        pos = node.get("pos", [0.0, 0.0, 0.0])
        local_mat = create_translation_4x4(pos)
        world_mat = multiply_4x4(parent_world_mat, local_mat)

        self.world_matrices[name] = world_mat
        self.inverse_bind_matrices[name] = invert_translation_4x4(world_mat)

        for child in node.get("children", []):
            self._compute_joint_transforms(child, world_mat)

    def export_xml(self) -> str:
        """Generates the Collada XML string conforming to COLLADA 1.4.1 schema."""
        collada = ET.Element("COLLADA", {
            "xmlns": "http://www.collada.org/2005/11/COLLADASchema",
            "version": "1.4.1"
        })

        # Asset
        asset = ET.SubElement(collada, "asset")
        contrib = ET.SubElement(asset, "contributor")
        authoring = ET.SubElement(contrib, "authoring_tool")
        authoring.text = "CharMorph Second Life Collada Exporter"
        
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        ET.SubElement(asset, "created").text = now
        ET.SubElement(asset, "modified").text = now
        ET.SubElement(asset, "unit", {"name": "meter", "meter": "1.0"})
        ET.SubElement(asset, "up_axis").text = "Z_UP"

        # Library Geometries
        lib_geom = ET.SubElement(collada, "library_geometries")
        geometry = ET.SubElement(lib_geom, "geometry", {"id": "avatar-mesh-geom", "name": "AvatarMesh"})
        mesh = ET.SubElement(geometry, "mesh")

        # Source Positions
        pos_source = ET.SubElement(mesh, "source", {"id": "mesh-positions"})
        pos_array_id = "mesh-positions-array"
        pos_vals = []
        for p in self.mesh_positions:
            pos_vals.extend([p[0], p[1], p[2]])
        pos_array = ET.SubElement(pos_source, "float_array", {"id": pos_array_id, "count": str(len(pos_vals))})
        pos_array.text = " ".join(f"{v:.6f}" for v in pos_vals)
        tech_common_pos = ET.SubElement(pos_source, "technique_common")
        accessor_pos = ET.SubElement(tech_common_pos, "accessor", {"source": f"#{pos_array_id}", "count": str(len(self.mesh_positions)), "stride": "3"})
        ET.SubElement(accessor_pos, "param", {"name": "X", "type": "float"})
        ET.SubElement(accessor_pos, "param", {"name": "Y", "type": "float"})
        ET.SubElement(accessor_pos, "param", {"name": "Z", "type": "float"})

        # Source Normals
        norm_source = ET.SubElement(mesh, "source", {"id": "mesh-normals"})
        norm_array_id = "mesh-normals-array"
        norm_vals = []
        for n in self.mesh_normals:
            norm_vals.extend([n[0], n[1], n[2]])
        norm_array = ET.SubElement(norm_source, "float_array", {"id": norm_array_id, "count": str(len(norm_vals))})
        norm_array.text = " ".join(f"{v:.6f}" for v in norm_vals)
        tech_common_norm = ET.SubElement(norm_source, "technique_common")
        accessor_norm = ET.SubElement(tech_common_norm, "accessor", {"source": f"#{norm_array_id}", "count": str(len(self.mesh_normals)), "stride": "3"})
        ET.SubElement(accessor_norm, "param", {"name": "X", "type": "float"})
        ET.SubElement(accessor_norm, "param", {"name": "Y", "type": "float"})
        ET.SubElement(accessor_norm, "param", {"name": "Z", "type": "float"})

        # Source UVs
        uv_source = ET.SubElement(mesh, "source", {"id": "mesh-uvs"})
        uv_array_id = "mesh-uvs-array"
        uv_vals = []
        for uv in self.mesh_uvs:
            uv_vals.extend([uv[0], uv[1]])
        uv_array = ET.SubElement(uv_source, "float_array", {"id": uv_array_id, "count": str(len(uv_vals))})
        uv_array.text = " ".join(f"{v:.6f}" for v in uv_vals)
        tech_common_uv = ET.SubElement(uv_source, "technique_common")
        accessor_uv = ET.SubElement(tech_common_uv, "accessor", {"source": f"#{uv_array_id}", "count": str(len(self.mesh_uvs)), "stride": "2"})
        ET.SubElement(accessor_uv, "param", {"name": "S", "type": "float"})
        ET.SubElement(accessor_uv, "param", {"name": "T", "type": "float"})

        # Vertices element
        vertices = ET.SubElement(mesh, "vertices", {"id": "mesh-vertices"})
        ET.SubElement(vertices, "input", {"semantic": "POSITION", "source": "#mesh-positions"})

        # Polylist
        polylist = ET.SubElement(mesh, "polylist", {"count": str(len(self.polygons))})
        ET.SubElement(polylist, "input", {"semantic": "VERTEX", "source": "#mesh-vertices", "offset": "0"})
        ET.SubElement(polylist, "input", {"semantic": "NORMAL", "source": "#mesh-normals", "offset": "1"})
        ET.SubElement(polylist, "input", {"semantic": "TEXCOORD", "source": "#mesh-uvs", "offset": "2", "set": "0"})

        vcount_el = ET.SubElement(polylist, "vcount")
        vcount_el.text = " ".join(str(len(poly)) for poly in self.polygons)

        p_indices = []
        for poly in self.polygons:
            for v_idx, n_idx, uv_idx in poly:
                p_indices.extend([v_idx, n_idx, uv_idx])
        p_el = ET.SubElement(polylist, "p")
        p_el.text = " ".join(str(idx) for idx in p_indices)

        # Library Controllers
        lib_ctrl = ET.SubElement(collada, "library_controllers")
        controller = ET.SubElement(lib_ctrl, "controller", {"id": "avatar-skin-controller", "name": "AvatarSkinController"})
        skin = ET.SubElement(controller, "skin", {"source": "#avatar-mesh-geom"})
        
        ET.SubElement(skin, "bind_shape_matrix").text = format_matrix_str(create_identity_4x4())

        # Controller Joint Source
        ctrl_joints_src = ET.SubElement(skin, "source", {"id": "skin-joints"})
        joints_arr_id = "skin-joints-array"
        joint_names = [b for b in self.active_bones if b in self.inverse_bind_matrices]
        name_arr = ET.SubElement(ctrl_joints_src, "Name_array", {"id": joints_arr_id, "count": str(len(joint_names))})
        name_arr.text = " ".join(joint_names)
        tech_common_ctrl_j = ET.SubElement(ctrl_joints_src, "technique_common")
        accessor_ctrl_j = ET.SubElement(tech_common_ctrl_j, "accessor", {"source": f"#{joints_arr_id}", "count": str(len(joint_names)), "stride": "1"})
        ET.SubElement(accessor_ctrl_j, "param", {"name": "JOINT", "type": "Name"})

        # Controller Inverse Bind Matrices Source
        ctrl_ib_src = ET.SubElement(skin, "source", {"id": "skin-bind_poses"})
        ib_arr_id = "skin-bind_poses-array"
        ib_vals = []
        for j_name in joint_names:
            ib_vals.extend(self.inverse_bind_matrices[j_name])
        float_arr_ib = ET.SubElement(ctrl_ib_src, "float_array", {"id": ib_arr_id, "count": str(len(ib_vals))})
        float_arr_ib.text = format_matrix_str(ib_vals)
        tech_common_ctrl_ib = ET.SubElement(ctrl_ib_src, "technique_common")
        accessor_ctrl_ib = ET.SubElement(tech_common_ctrl_ib, "accessor", {"source": f"#{ib_arr_id}", "count": str(len(joint_names)), "stride": "16"})
        ET.SubElement(accessor_ctrl_ib, "param", {"name": "TRANSFORM", "type": "float4x4"})

        # Controller Weights Source
        ctrl_w_src = ET.SubElement(skin, "source", {"id": "skin-weights"})
        w_arr_id = "skin-weights-array"
        
        # Build unique weights palette and per-vertex bone/weight index lists
        weights_palette = [1.0]
        weight_to_idx = {1.0: 0}
        
        joint_name_to_idx = {b_name: idx for idx, b_name in enumerate(joint_names)}

        vcount_list = []
        v_list = []

        for v_idx, w_dict in enumerate(self.vertex_weights):
            v_joints = []
            for b_name, weight in w_dict.items():
                if b_name in joint_name_to_idx and weight > 1e-5:
                    j_idx = joint_name_to_idx[b_name]
                    
                    rounded_w = round(weight, 5)
                    if rounded_w not in weight_to_idx:
                        weight_to_idx[rounded_w] = len(weights_palette)
                        weights_palette.append(rounded_w)
                    w_idx = weight_to_idx[rounded_w]
                    
                    v_joints.extend([j_idx, w_idx])

            if not v_joints:
                # Default to root joint mPelvis with weight 1.0
                j_idx = joint_name_to_idx.get("mPelvis", 0)
                v_joints.extend([j_idx, 0])

            vcount_list.append(len(v_joints) // 2)
            v_list.extend(v_joints)

        float_arr_w = ET.SubElement(ctrl_w_src, "float_array", {"id": w_arr_id, "count": str(len(weights_palette))})
        float_arr_w.text = " ".join(f"{w:.5f}" for w in weights_palette)
        tech_common_ctrl_w = ET.SubElement(ctrl_w_src, "technique_common")
        accessor_ctrl_w = ET.SubElement(tech_common_ctrl_w, "accessor", {"source": f"#{w_arr_id}", "count": str(len(weights_palette)), "stride": "1"})
        ET.SubElement(accessor_ctrl_w, "param", {"name": "WEIGHT", "type": "float"})

        # Vertex Weights element
        vw_el = ET.SubElement(skin, "vertex_weights", {"count": str(len(self.vertex_weights))})
        ET.SubElement(vw_el, "input", {"semantic": "JOINT", "source": "#skin-joints", "offset": "0"})
        ET.SubElement(vw_el, "input", {"semantic": "WEIGHT", "source": "#skin-weights", "offset": "1"})

        ET.SubElement(vw_el, "vcount").text = " ".join(str(c) for c in vcount_list)
        ET.SubElement(vw_el, "v").text = " ".join(str(idx) for idx in v_list)

        # Library Visual Scenes
        lib_vs = ET.SubElement(collada, "library_visual_scenes")
        vis_scene = ET.SubElement(lib_vs, "visual_scene", {"id": "VisualSceneNode", "name": "VisualScene"})

        # Joint Nodes Hierarchy
        def build_node_xml(parent_el, node_data):
            name = node_data["name"]
            node_el = ET.SubElement(parent_el, "node", {
                "id": name,
                "sid": name,
                "name": name,
                "type": "JOINT"
            })
            pos = node_data.get("pos", [0.0, 0.0, 0.0])
            local_mat = create_translation_4x4(pos)
            ET.SubElement(node_el, "matrix", {"sid": "transform"}).text = format_matrix_str(local_mat)

            for child in node_data.get("children", []):
                build_node_xml(node_el, child)

        build_node_xml(vis_scene, self.joint_tree)

        # Mesh Instance Node
        mesh_node = ET.SubElement(vis_scene, "node", {"id": "AvatarMeshNode", "name": "AvatarMeshNode", "type": "NODE"})
        inst_ctrl = ET.SubElement(mesh_node, "instance_controller", {"url": "#avatar-skin-controller"})
        ET.SubElement(inst_ctrl, "skeleton").text = "#mPelvis"

        # Scene
        scene = ET.SubElement(collada, "scene")
        ET.SubElement(scene, "instance_visual_scene", {"url": "#VisualSceneNode"})

        # Pretty print XML
        xml_str = ET.tostring(collada, encoding="utf-8")
        parsed = minidom.parseString(xml_str)
        return parsed.toprettyxml(indent="  ")

    def save_file(self, filepath: str) -> None:
        xml_content = self.export_xml()
        os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(xml_content)
