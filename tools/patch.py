# Build repair patches for the Onshape SR-71 body, in the model's own coordinates (Z down = up is -Z, nose +Y).
#   body_patch    : nacelle panel missing on the +X engine, copied from its mirror twin on -X
#   gear_doors    : flush cover plates over the nose and main landing-gear bays (underside, +Z)
#   canopy_glass  : slightly domed glass over the two cockpit openings (top, -Z)
# usage: python3 patch.py <body.gltf> <missing_faces.npy> <out.glb> [debug.png-prefix]
import sys, numpy as np, trimesh
from scipy import ndimage

body_path, missing_path, out = sys.argv[1:4]
body = trimesh.load(body_path, force='mesh', process=False)

# ---- 1. mirror the missing nacelle panel ------------------------------------------------------------
far = np.load(missing_path)
cen = body.triangles_center[far]
sel = far[(cen[:, 0] < -0.11) & (cen[:, 1] > -0.225) & (cen[:, 1] < -0.2)]
tris = body.triangles[sel] * [-1, 1, 1]
tris = tris[:, ::-1, :]                       # mirroring flips handedness: reverse winding
panel = trimesh.Trimesh(vertices=tris.reshape(-1, 3), faces=np.arange(len(tris) * 3).reshape(-1, 3))
panel.merge_vertices()
print('nacelle panel faces', len(panel.faces))

# ---- 2. ray-cast helpers -----------------------------------------------------------------------------
ray = body.ray

def sample(box, side, step=0.0004):
    """Cast rays straight at the skin from outside. side=+1: underside (from +Z), -1: top (from -Z)."""
    (x0, x1), (y0, y1) = box
    xs, ys = np.arange(x0, x1 + 1e-9, step), np.arange(y0, y1 + 1e-9, step)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    o = np.c_[X.ravel(), Y.ravel(), np.full(X.size, 0.5 * side)]
    d = np.tile([0, 0, -side], (X.size, 1)).astype(float)
    loc, idx, _ = ray.intersects_location(o, d, multiple_hits=False)
    Z = np.full(X.size, np.nan); Z[idx] = loc[:, 2]
    return X, Y, Z.reshape(X.shape)

def fit_skin(X, Y, Z, side):
    """Rebuild the intact skin over the box with a Coons patch: blend the four box-edge curves inward.
    The box edges must lie on unbroken skin; each edge curve is median-smoothed to ignore panel lines."""
    def edge(v):
        v = v.copy(); ok = ~np.isnan(v); v[~ok] = np.interp(np.where(~ok)[0], np.where(ok)[0], v[ok])
        return ndimage.median_filter(v, size=9, mode='nearest')
    L, R, B, T = edge(Z[0, :]), edge(Z[-1, :]), edge(Z[:, 0]), edge(Z[:, -1])
    nx, ny = Z.shape
    u = np.linspace(0, 1, nx)[:, None]; v = np.linspace(0, 1, ny)[None, :]
    F = (1 - u) * L[None, :] + u * R[None, :] + (1 - v) * B[:, None] + v * T[:, None] \
        - ((1 - u) * (1 - v) * L[0] + u * (1 - v) * R[0] + (1 - u) * v * L[-1] + u * v * R[-1])
    return F

def opening_mask(Z, F, side, tol=3e-4, grow=2):
    """Cells where the ray went deeper than the fitted skin (or through the part) = the opening."""
    depth = side * (Z - F)                       # >0 outward of skin, <0 inside
    mask = np.isnan(Z) | (depth < -tol)
    mask = ndimage.binary_opening(mask, iterations=1)
    lab, n = ndimage.label(mask)
    if n == 0: return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    mask = np.isin(lab, 1 + np.where(sizes >= max(20, 0.15 * sizes.max()))[0])
    return ndimage.binary_dilation(mask, iterations=grow)

def grid_mesh(X, Y, H, mask, side):
    """Quad grid over masked cells; heights H at grid points. Faces wound to face outward (side)."""
    nx, ny = X.shape
    vid = -np.ones((nx, ny), int)
    used = np.zeros((nx, ny), bool)
    cell = mask[:-1, :-1] & mask[1:, :-1] & mask[:-1, 1:] & mask[1:, 1:]   # all four corners inside the opening
    for i, j in zip(*np.where(cell)):
        used[i:i + 2, j:j + 2] = True
    verts = []
    for i, j in zip(*np.where(used)):
        vid[i, j] = len(verts); verts.append([X[i, j], Y[i, j], H[i, j]])
    faces = []
    for i, j in zip(*np.where(cell)):
        a, b, c, d = vid[i, j], vid[i + 1, j], vid[i + 1, j + 1], vid[i, j + 1]
        faces += [[a, b, c], [a, c, d]] if side > 0 else [[a, c, b], [a, d, c]]   # outward = +Z underneath, -Z on top
    return trimesh.Trimesh(np.array(verts), np.array(faces), process=False)

def cover(box, side, lift, dome=0.0, name=''):
    X, Y, Z = sample(box, side)
    F = fit_skin(X, Y, Z, side)
    mask = opening_mask(Z, F, side)
    # dome rises smoothly from the opening's edge to its middle
    dist = ndimage.distance_transform_edt(mask)
    bump = np.sin(np.clip(dist / max(dist.max(), 1), 0, 1) * np.pi / 2) ** 1.5
    H = F + side * (lift + dome * bump)
    mesh = grid_mesh(X, Y, H, mask, side)
    print(name, 'opening cells', int(mask.sum()), 'faces', len(mesh.faces), 'z range', np.nanmin(Z).round(4), np.nanmax(Z).round(4))
    return mesh, (X, Y, Z, F, mask)

# Boxes (x range, y range) around each opening, in model units.
nose_bay, d1 = cover(((-0.022, 0.022), (-0.085, 0.018)), +1, lift=-2e-5, name='nose gear bay')
main_bay, d2 = cover(((-0.075, 0.075), (-0.318, -0.276)), +1, lift=-2e-5, name='main gear bay')
cockpit, d3 = cover(((-0.013, 0.013), (0.004, 0.074)), -1, lift=-2e-5, dome=0.0012, name='cockpit')

doors = trimesh.util.concatenate([nose_bay, main_bay])

scene = trimesh.Scene()
scene.add_geometry(panel, node_name='body_patch', geom_name='body_patch')
scene.add_geometry(doors, node_name='gear_doors', geom_name='gear_doors')
scene.add_geometry(cockpit, node_name='canopy_glass', geom_name='canopy_glass')
scene.export(out, file_type='glb', include_normals=True)
print('wrote', out)

if len(sys.argv) > 4:  # debug masks
    from PIL import Image
    for k, (X, Y, Z, F, mask) in {'nose': d1, 'main': d2, 'cockpit': d3}.items():
        dep = np.nan_to_num(np.abs(Z - F), nan=0.01)
        img = np.clip(dep / 0.003, 0, 1)
        rgb = np.dstack([img, img, img]); rgb[mask, 0] = 1
        Image.fromarray((rgb.transpose(1, 0, 2)[::-1] * 255).astype(np.uint8)).resize((X.shape[0] * 4, X.shape[1] * 4), 0).save(f'{sys.argv[4]}-{k}.png')
