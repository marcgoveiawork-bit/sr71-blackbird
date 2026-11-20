# For faces whose mirror twin has no matching face, check the distance from the mirrored face to the real surface.
# Far from any surface = genuinely missing on the other side.
import sys, trimesh, numpy as np, networkx as nx
from scipy.spatial import cKDTree
m = trimesh.load(sys.argv[1], force='mesh', process=False)
miss = np.load(sys.argv[2])
c = m.triangles_center[miss] * [-1, 1, 1]
pq = trimesh.proximity.ProximityQuery(m)
_, dist, _ = pq.on_surface(c)
far = miss[dist > 1.5e-4]
print('candidates', len(miss), 'truly missing', len(far))
cc = m.triangles_center[far]
G = nx.Graph(); G.add_nodes_from(range(len(far))); G.add_edges_from(cKDTree(cc).query_pairs(0.003))
for comp in sorted(nx.connected_components(G), key=len, reverse=True)[:12]:
    idx = far[list(comp)]; v = m.triangles_center[idx]
    print(len(idx), 'area %.2e' % m.area_faces[idx].sum(), 'source side', v.min(0).round(4), v.max(0).round(4))
np.save(sys.argv[3], far)
