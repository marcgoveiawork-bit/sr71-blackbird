# Find faces present on one side of the jet (x<0 or x>0) whose mirror image is missing on the other side.
import sys, trimesh, numpy as np
from scipy.spatial import cKDTree
m = trimesh.load(sys.argv[1], force='mesh', process=False)
c = m.triangles_center
tree = cKDTree(c)
mir = c * [-1, 1, 1]
d, _ = tree.query(mir)
side = np.abs(c[:, 0]) > 0.003
miss = np.where(side & (d > 3e-4))[0]
print('faces', len(c), 'unmatched', len(miss))
# cluster unmatched faces
import networkx as nx
t2 = cKDTree(c[miss]); pairs = t2.query_pairs(0.003)
G = nx.Graph(); G.add_nodes_from(range(len(miss))); G.add_edges_from(pairs)
for comp in sorted(nx.connected_components(G), key=len, reverse=True)[:15]:
    idx = miss[list(comp)]; v = c[idx]
    print(len(idx), 'area %.2e' % m.area_faces[idx].sum(), v.min(0).round(4), v.max(0).round(4))
np.save(sys.argv[2], miss)
