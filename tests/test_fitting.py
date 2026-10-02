import sys
import types
import time
import numpy as np

import pytest
from lib.fit_calc import Geometry, SoftBinder, HardBinder, _calc_binding_reverse, FitCalculator
from lib.fitting import apply_surface_clearance_and_relaxation, build_adjacency_list


def create_cube_geometry(scale=1.0, offset=(0.0, 0.0, 0.0)):
    half = 0.5 * scale
    ox, oy, oz = offset
    verts = np.array([
        [-half + ox, -half + oy, -half + oz], # 0
        [ half + ox, -half + oy, -half + oz], # 1
        [ half + ox,  half + oy, -half + oz], # 2
        [-half + ox,  half + oy, -half + oz], # 3
        [-half + ox, -half + oy,  half + oz], # 4
        [ half + ox, -half + oy,  half + oz], # 5
        [ half + ox,  half + oy,  half + oz], # 6
        [-half + ox,  half + oy,  half + oz], # 7
    ], dtype=np.float64)

    faces = [
        (0, 3, 2, 1),  # bottom (-Z)
        (4, 5, 6, 7),  # top (+Z)
        (0, 1, 5, 4),  # front (-Y)
        (2, 3, 7, 6),  # back (+Y)
        (0, 4, 7, 3),  # left (-X)
        (1, 2, 6, 5),  # right (+X)
    ]
    return Geometry(verts, faces)


def test_geometry_normals_and_adaptive_threshold():
    geom_small = create_cube_geometry(scale=1.0)
    geom_large = create_cube_geometry(scale=10.0)

    assert geom_small.bbox_scale < geom_large.bbox_scale

    thresh_small = geom_small.get_adaptive_dist_thresh()
    thresh_large = geom_large.get_adaptive_dist_thresh()
    assert thresh_large > thresh_small

    normals = geom_small.vertex_normals
    assert normals.shape == geom_small.verts.shape
    norms = np.linalg.norm(normals, axis=1)
    np.testing.assert_allclose(norms, 1.0, rtol=1e-5)


def test_normal_gated_binding():
    char_geom = create_cube_geometry(scale=2.0)

    asset_verts_geom1 = np.array([
        [0.0, 0.0, 1.1],
        [0.1, 0.0, 1.1],
        [0.0, 0.1, 1.1],
    ], dtype=np.float64)
    asset_geom_aligned = Geometry(asset_verts_geom1, [(0, 1, 2)])

    asset_verts_geom2 = np.array([
        [0.0, 0.0, 1.1],
        [0.0, 0.1, 1.1],
        [0.1, 0.0, 1.1],
    ], dtype=np.float64)
    asset_geom_opposed = Geometry(asset_verts_geom2, [(0, 1, 2)])

    binder_aligned = SoftBinder(char_geom, asset_verts_geom1[:1], asset_geom_aligned)
    binder_aligned.calc_binding_kd()

    binder_opposed = SoftBinder(char_geom, asset_verts_geom2[:1], asset_geom_opposed)
    binder_opposed.calc_binding_kd()

    weight_aligned = sum(binder_aligned.bindings[0].values()) if binder_aligned.bindings else 0
    weight_opposed = sum(binder_opposed.bindings[0].values()) if binder_opposed.bindings else 0

    assert weight_aligned > weight_opposed
    assert weight_opposed == 0.0


def test_softbinder_calc_binding_direct_and_reverse_normal_gating():
    char_geom = create_cube_geometry(scale=2.0)

    # Aligned asset triangle near top corner of char box (facing +Z)
    verts_aligned = np.array([
        [0.8, 0.8, 1.02],
        [0.9, 0.8, 1.02],
        [0.8, 0.9, 1.02],
    ], dtype=np.float64)
    geom_aligned = Geometry(verts_aligned, [(0, 1, 2)])

    # Opposed asset triangle near top corner of char box, facing -Z
    verts_opposed = np.array([
        [0.8, 0.8, 1.02],
        [0.8, 0.9, 1.02],
        [0.9, 0.8, 1.02],
    ], dtype=np.float64)
    geom_opposed = Geometry(verts_opposed, [(0, 1, 2)])

    # Test calc_binding_direct
    b_direct_aligned = SoftBinder(char_geom, verts_aligned, geom_aligned)
    b_direct_aligned.calc_binding_kd()
    b_direct_aligned.calc_binding_direct()

    b_direct_opposed = SoftBinder(char_geom, verts_opposed, geom_opposed)
    b_direct_opposed.calc_binding_kd()
    b_direct_opposed.calc_binding_direct()

    total_weight_direct_aligned = sum(sum(b.values()) for b in b_direct_aligned.bindings)
    total_weight_direct_opposed = sum(sum(b.values()) for b in b_direct_opposed.bindings)

    assert total_weight_direct_aligned > 0
    assert total_weight_direct_opposed == 0.0

    # Test calc_binding_reverse
    b_rev_aligned = SoftBinder(char_geom, verts_aligned, geom_aligned)
    b_rev_aligned.calc_binding_kd()
    b_rev_aligned.calc_binding_reverse(geom_aligned)

    b_rev_opposed = SoftBinder(char_geom, verts_opposed, geom_opposed)
    b_rev_opposed.calc_binding_kd()
    b_rev_opposed.calc_binding_reverse(geom_opposed)

    total_weight_rev_aligned = sum(sum(b.values()) for b in b_rev_aligned.bindings)
    total_weight_rev_opposed = sum(sum(b.values()) for b in b_rev_opposed.bindings)

    assert total_weight_rev_aligned > 0
    assert total_weight_rev_opposed == 0.0


def test_calc_binding_reverse_adaptive_and_gating():
    char_geom = create_cube_geometry(scale=2.0)

    verts_aligned = np.array([
        [0.8, 0.8, 1.02],
        [0.9, 0.8, 1.02],
        [0.8, 0.9, 1.02],
    ], dtype=np.float64)
    geom_aligned = Geometry(verts_aligned, [(0, 1, 2)])

    bind_dict_aligned = [{} for _ in range(3)]
    _calc_binding_reverse(bind_dict_aligned, char_geom, geom_aligned)

    verts_opposed = np.array([
        [0.8, 0.8, 1.02],
        [0.8, 0.9, 1.02],
        [0.9, 0.8, 1.02],
    ], dtype=np.float64)
    geom_opposed = Geometry(verts_opposed, [(0, 1, 2)])

    bind_dict_opposed = [{} for _ in range(3)]
    _calc_binding_reverse(bind_dict_opposed, char_geom, geom_opposed)

    assert sum(len(d) for d in bind_dict_aligned) > 0
    assert sum(len(d) for d in bind_dict_opposed) == 0


def test_extreme_morph_fitting_no_cross_bridging_and_no_inverted_normals():
    # Two separate legs at x = -0.5 and x = +0.5
    leg1 = create_cube_geometry(scale=0.4, offset=(-0.5, 0.0, 0.0))
    leg2 = create_cube_geometry(scale=0.4, offset=(0.5, 0.0, 0.0))

    char_verts = np.vstack([leg1.verts, leg2.verts])
    char_faces = list(leg1.faces) + [(f[0]+8, f[1]+8, f[2]+8, f[3]+8) for f in leg2.faces]
    char_geom = Geometry(char_verts, char_faces)

    # Sleeve/pant leg surrounding leg1 (-0.5, 0, 0)
    sleeve = create_cube_geometry(scale=0.5, offset=(-0.5, 0.0, 0.0))

    binder = SoftBinder(char_geom, sleeve.verts, sleeve)
    binder.calc_binding_kd()
    binder.calc_binding_direct()
    binder.calc_binding_reverse(sleeve)

    # Verify sleeve is bound ONLY to leg1 vertices (index 0..7), NOT leg2 vertices (index 8..15)
    bound_char_indices = set()
    for b in binder.bindings:
        bound_char_indices.update(b.keys())

    assert all(idx < 8 for idx in bound_char_indices), "Cross-surface bridging detected across legs!"

    # Simulate extreme character morph: leg1 moves further left (-1.5), leg2 moves further right (+1.5)
    char_diff = np.zeros_like(char_verts)
    char_diff[:8, 0] = -1.0  # Move leg1 left by -1.0
    char_diff[8:, 0] = +1.0  # Move leg2 right by +1.0

    calc = FitCalculator(char_geom)
    positions, idx, wresult = calc._calc_binding_internal(sleeve.verts, None, sleeve)

    from lib.fit_calc import FitBinding
    fit_bind = FitBinding((positions, idx, wresult))
    sleeve_diff = fit_bind.fit(char_diff)
    fitted_sleeve_verts = sleeve.verts + sleeve_diff

    # Check fitted sleeve faces normal orientation (must not be inverted)
    fitted_sleeve_geom = Geometry(fitted_sleeve_verts, sleeve.faces)
    fitted_normals = fitted_sleeve_geom.vertex_normals
    orig_normals = sleeve.vertex_normals

    dot_products = np.sum(fitted_normals * orig_normals, axis=1)
    assert np.all(dot_products > 0.0), "Inverted face normals detected after extreme refitting!"


def test_binding_calculation_time_under_50ms():
    # Generate realistic character mesh (100 verts) and asset mesh (36 verts)
    grid_size = 10
    x = np.linspace(-1, 1, grid_size)
    y = np.linspace(-1, 1, grid_size)
    xx, yy = np.meshgrid(x, y)
    zz = np.zeros_like(xx)

    char_verts = np.column_stack([xx.ravel(), yy.ravel(), zz.ravel()])
    char_faces = []
    for r in range(grid_size - 1):
        for c in range(grid_size - 1):
            i0 = r * grid_size + c
            i1 = i0 + 1
            i2 = (r + 1) * grid_size + c + 1
            i3 = (r + 1) * grid_size + c
            char_faces.append((i0, i1, i2, i3))

    char_geom = Geometry(char_verts, char_faces)

    asset_verts = char_verts[:36] + np.array([0.0, 0.0, 0.05])
    asset_faces = [f for f in char_faces if max(f) < 36]
    asset_geom = Geometry(asset_verts, asset_faces)

    calc = FitCalculator(char_geom)

    start_time = time.time()
    _ = calc._calc_binding_internal(asset_verts, None, asset_geom)
    elapsed_ms = (time.time() - start_time) * 1000

    assert elapsed_ms < 50.0, f"Binding calculation took {elapsed_ms:.2f}ms (must be under 50ms)"


def test_post_fitting_surface_clearance_projection():
    char_geom = create_cube_geometry(scale=2.0)

    asset_verts = np.array([
        [0.0, 0.0, 0.95],  # Penetrating body by 0.05
        [0.0, 0.0, 1.05],  # Safe clearance
    ], dtype=np.float64)
    asset_faces = [(0, 1)]

    min_clearance = 0.002
    result = apply_surface_clearance_and_relaxation(
        asset_verts, asset_faces, char_geom,
        min_clearance=min_clearance,
        max_relaxation_passes=0
    )

    assert result[0][2] >= 1.0 + min_clearance - 1e-6
    assert result[1][2] == pytest.approx(1.05)


def test_masked_body_vertex_exclusion():
    char_geom = create_cube_geometry(scale=2.0)
    # Top face vertices in create_cube_geometry: (4, 5, 6, 7)
    masked_verts = {4, 5, 6, 7}

    asset_verts = np.array([
        [0.0, 0.0, 0.95],
    ], dtype=np.float64)
    asset_faces = [(0, 0)]

    min_clearance = 0.002
    result = apply_surface_clearance_and_relaxation(
        asset_verts, asset_faces, char_geom,
        masked_body_verts=masked_verts,
        min_clearance=min_clearance,
        max_relaxation_passes=0
    )

    assert result[0][2] == pytest.approx(0.95)


def test_laplacian_relaxation_smoothing_and_cap():
    char_geom = create_cube_geometry(scale=2.0)

    asset_verts = np.array([
        [0.0, 0.0, 1.005],
        [0.1, 0.0, 1.005],
        [0.2, 0.0, 1.500],  # Spike
        [0.3, 0.0, 1.005],
        [0.4, 0.0, 1.005],
    ], dtype=np.float64)

    asset_faces = [(0, 1), (1, 2), (2, 3), (3, 4)]

    start_time = time.time()
    result = apply_surface_clearance_and_relaxation(
        asset_verts, asset_faces, char_geom,
        min_clearance=0.002,
        max_relaxation_passes=10
    )
    elapsed_ms = (time.time() - start_time) * 1000

    assert result[2][2] < 1.500

    for v in result:
        assert v[2] >= 1.0 + 0.002 - 1e-6

    assert elapsed_ms < 120.0
