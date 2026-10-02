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
import re
import logging
from typing import Dict, List, Tuple, Set, Optional, Any

logger = logging.getLogger(__name__)

# Default built-in mapping rules if YAML fails to load
DEFAULT_DIRECT_MAPPINGS = {
    "DEF-pelvis": "mPelvis", "pelvis": "mPelvis", "root": "mPelvis", "mPelvis": "mPelvis",
    "DEF-spine": "mTorso", "spine": "mTorso", "DEF-spine.001": "mTorso", "spine.001": "mTorso", "DEF-spine.002": "mTorso", "spine.002": "mTorso",
    "DEF-spine.003": "mChest", "spine.003": "mChest", "DEF-spine.004": "mChest", "spine.004": "mChest", "chest": "mChest",
    "DEF-spine.005": "mNeck", "spine.005": "mNeck", "DEF-neck": "mNeck", "neck": "mNeck",
    "DEF-spine.006": "mHead", "spine.006": "mHead", "DEF-head": "mHead", "head": "mHead",
    "DEF-shoulder.L": "mCollarLeft", "shoulder.L": "mCollarLeft", "clavicle.L": "mCollarLeft",
    "DEF-upper_arm.L": "mShoulderLeft", "upper_arm.L": "mShoulderLeft", "DEF-upper_arm.L.001": "mShoulderLeft", "upper_arm.L.001": "mShoulderLeft",
    "DEF-forearm.L": "mElbowLeft", "forearm.L": "mElbowLeft", "DEF-forearm.L.001": "mElbowLeft", "forearm.L.001": "mElbowLeft",
    "DEF-hand.L": "mWristLeft", "hand.L": "mWristLeft",
    "DEF-thigh.L": "mHipLeft", "thigh.L": "mHipLeft", "DEF-thigh.L.001": "mHipLeft", "thigh.L.001": "mHipLeft",
    "DEF-shin.L": "mKneeLeft", "shin.L": "mKneeLeft", "DEF-shin.L.001": "mKneeLeft", "shin.L.001": "mKneeLeft",
    "DEF-foot.L": "mAnkleLeft", "foot.L": "mAnkleLeft",
    "DEF-toe.L": "mToeLeft", "toe.L": "mToeLeft",
    "DEF-shoulder.R": "mCollarRight", "shoulder.R": "mCollarRight", "clavicle.R": "mCollarRight",
    "DEF-upper_arm.R": "mShoulderRight", "upper_arm.R": "mShoulderRight", "DEF-upper_arm.R.001": "mShoulderRight", "upper_arm.R.001": "mShoulderRight",
    "DEF-forearm.R": "mElbowRight", "forearm.R": "mElbowRight", "DEF-forearm.R.001": "mElbowRight", "forearm.R.001": "mElbowRight",
    "DEF-hand.R": "mWristRight", "hand.R": "mWristRight",
    "DEF-thigh.R": "mHipRight", "thigh.R": "mHipRight", "DEF-thigh.R.001": "mHipRight", "thigh.R.001": "mHipRight",
    "DEF-shin.R": "mKneeRight", "shin.R": "mKneeRight", "DEF-shin.R.001": "mKneeRight", "shin.R.001": "mKneeRight",
    "DEF-foot.R": "mAnkleRight", "foot.R": "mAnkleRight",
    "DEF-toe.R": "mToeRight", "toe.R": "mToeRight",
    # Muscle & Collision Volume mappings
    "pct_muscle.L": "Pectoral_L", "DEF-pct_muscle.L": "Pectoral_L", "pectoral.L": "Pectoral_L",
    "pct_muscle.R": "Pectoral_R", "DEF-pct_muscle.R": "Pectoral_R", "pectoral.R": "Pectoral_R",
    "butt_muscle.L": "BUTT_L", "DEF-butt_muscle.L": "BUTT_L", "butt.L": "BUTT_L", "glute.L": "BUTT_L",
    "butt_muscle.R": "BUTT_R", "DEF-butt_muscle.R": "BUTT_R", "butt.R": "BUTT_R", "glute.R": "BUTT_R",
    "belly_muscle": "BELLY", "DEF-belly_muscle": "BELLY", "belly": "BELLY", "abs": "BELLY",
    "hip_muscle.L": "HIP_L", "DEF-hip_muscle.L": "HIP_L", "hip.L": "HIP_L",
    "hip_muscle.R": "HIP_R", "DEF-hip_muscle.R": "HIP_R", "hip.R": "HIP_R",
}

DEFAULT_PATTERN_MAPPINGS = [
    (re.compile(r".*pct_muscle.*\.L.*", re.IGNORECASE), "Pectoral_L"),
    (re.compile(r".*pct_muscle.*\.R.*", re.IGNORECASE), "Pectoral_R"),
    (re.compile(r".*butt.*\.L.*", re.IGNORECASE), "BUTT_L"),
    (re.compile(r".*butt.*\.R.*", re.IGNORECASE), "BUTT_R"),
    (re.compile(r".*belly.*", re.IGNORECASE), "BELLY"),
    (re.compile(r".*head.*", re.IGNORECASE), "mHead"),
    (re.compile(r".*neck.*", re.IGNORECASE), "mNeck"),
    (re.compile(r".*hand.*\.L.*", re.IGNORECASE), "mWristLeft"),
    (re.compile(r".*hand.*\.R.*", re.IGNORECASE), "mWristRight"),
    (re.compile(r".*foot.*\.L.*", re.IGNORECASE), "mAnkleLeft"),
    (re.compile(r".*foot.*\.R.*", re.IGNORECASE), "mAnkleRight"),
]


class SLBoneMapper:
    """Dynamic Bone Mapping Engine translating arbitrary bone names into Second Life bones."""

    def __init__(self, config_path: Optional[str] = None):
        self.direct_mappings: Dict[str, str] = dict(DEFAULT_DIRECT_MAPPINGS)
        self.pattern_mappings: List[Tuple[re.Pattern, str]] = list(DEFAULT_PATTERN_MAPPINGS)
        self.sl_hierarchy: Dict[str, Dict[str, Any]] = {}

        if not config_path:
            lib_dir = os.path.dirname(os.path.abspath(__file__))
            candidate = os.path.join(lib_dir, "sl_bone_map.yaml")
            if os.path.exists(candidate):
                config_path = candidate
            else:
                candidate_data = os.path.join(os.path.dirname(lib_dir), "data", "sl_bone_map.yaml")
                if os.path.exists(candidate_data):
                    config_path = candidate_data

        if config_path and os.path.exists(config_path):
            self.load_config(config_path)

    def load_config(self, config_path: str) -> None:
        try:
            try:
                from yaml import safe_load
            except ImportError:
                from .yaml import load as yload, SafeLoader
                safe_load = lambda stream: yload(stream, Loader=SafeLoader)
            with open(config_path, "r", encoding="utf-8") as f:
                data = safe_load(f.read())
            if isinstance(data, dict):
                if "direct_mappings" in data and isinstance(data["direct_mappings"], dict):
                    self.direct_mappings.update(data["direct_mappings"])
                if "pattern_mappings" in data and isinstance(data["pattern_mappings"], list):
                    for item in data["pattern_mappings"]:
                        if isinstance(item, dict) and "pattern" in item and "target" in item:
                            pattern_re = re.compile(item["pattern"], re.IGNORECASE)
                            self.pattern_mappings.append((pattern_re, item["target"]))
                if "sl_hierarchy" in data and isinstance(data["sl_hierarchy"], dict):
                    self.sl_hierarchy = data["sl_hierarchy"]
        except Exception as e:
            logger.warning(f"Failed to load SL bone mapping config from {config_path}: {e}")

    def map_bone(self, source_bone_name: str) -> Optional[str]:
        """Maps a single source bone name to a target Second Life bone name or None if unmapped/control bone."""
        if not source_bone_name:
            return None

        # Check direct mappings first
        if source_bone_name in self.direct_mappings:
            return self.direct_mappings[source_bone_name]

        # Ignore non-deform control bone prefixes unless explicitly mapped above
        if source_bone_name.startswith(("MCH-", "ORG-", "WGT-", "master")):
            # Try stripping prefix
            stripped = re.sub(r"^(DEF-|MCH-|ORG-|WGT-)", "", source_bone_name)
            if stripped in self.direct_mappings:
                return self.direct_mappings[stripped]

        # Check pattern mappings
        for pattern_re, target in self.pattern_mappings:
            if pattern_re.search(source_bone_name):
                return target

        return None


class WeightAggregator:
    """Performs runtime vertex weight aggregation from source bone groups into SL vertex groups."""

    @staticmethod
    def aggregate_vertex_weights(
        source_vertex_weights: List[Dict[str, float]],
        mapper: SLBoneMapper
    ) -> Tuple[List[Dict[str, float]], Dict[str, Any]]:
        """
        Aggregates weights for each vertex.
        
        Args:
            source_vertex_weights: List where each item represents a vertex as a dict of {source_bone_name: weight}
            mapper: SLBoneMapper instance
            
        Returns:
            Tuple of (aggregated_weights_per_vertex, diagnostic_report)
        """
        aggregated_weights: List[Dict[str, float]] = []
        mapped_bone_groups: Set[str] = set()
        unmapped_bone_groups: Set[str] = set()
        total_mapped_weight = 0.0
        total_unmapped_weight = 0.0

        for vertex_idx, weights in enumerate(source_vertex_weights):
            vert_sl_weights: Dict[str, float] = {}

            for source_bone, weight in weights.items():
                if weight <= 1e-6:
                    continue

                target_sl_bone = mapper.map_bone(source_bone)
                if target_sl_bone:
                    vert_sl_weights[target_sl_bone] = vert_sl_weights.get(target_sl_bone, 0.0) + weight
                    mapped_bone_groups.add(source_bone)
                    total_mapped_weight += weight
                else:
                    unmapped_bone_groups.add(source_bone)
                    total_unmapped_weight += weight

            # Normalize vertex weights so total sum == 1.0
            total_v_weight = sum(vert_sl_weights.values())
            if total_v_weight > 1e-6:
                for target_bone in vert_sl_weights:
                    vert_sl_weights[target_bone] /= total_v_weight

            aggregated_weights.append(vert_sl_weights)

        diagnostics = {
            "total_vertices": len(source_vertex_weights),
            "mapped_source_groups_count": len(mapped_bone_groups),
            "unmapped_source_groups_count": len(unmapped_bone_groups),
            "unmapped_source_groups": sorted(list(unmapped_bone_groups)),
            "mapped_source_groups": sorted(list(mapped_bone_groups)),
            "total_mapped_weight": total_mapped_weight,
            "total_unmapped_weight": total_unmapped_weight,
            "has_warnings": len(unmapped_bone_groups) > 0 and total_unmapped_weight > 0.01,
        }

        if diagnostics["has_warnings"]:
            logger.warning(
                f"Dynamic weight aggregation warning: {len(unmapped_bone_groups)} source bone groups "
                f"could not be mapped to Second Life bones: {diagnostics['unmapped_source_groups']}"
            )

        return aggregated_weights, diagnostics

    @classmethod
    def aggregate_blender_object_weights(cls, mesh_obj, mapper: SLBoneMapper) -> Tuple[List[Dict[str, float]], Dict[str, Any]]:
        """Extracts vertex weights from a Blender mesh object and aggregates them to SL bones."""
        # Extracts weights from mesh_obj.data.vertices
        source_vertex_weights = []
        vg_names = [vg.name for vg in mesh_obj.vertex_groups]

        for v in mesh_obj.data.vertices:
            v_weights = {}
            for g in v.groups:
                if g.group < len(vg_names):
                    vg_name = vg_names[g.group]
                    v_weights[vg_name] = g.weight
            source_vertex_weights.append(v_weights)

        return cls.aggregate_vertex_weights(source_vertex_weights, mapper)
