// Merge the exterior SR-71 parts from Onshape glTF exports into one compressed GLB.
// usage: node build-model.mjs <modelDir> <out.glb>
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, quantize, reorder, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import path from 'path';

const [dir, out] = process.argv.slice(2);
const PARTS = {
  body: 'lockheed blackbird SR71 - blackbird body__Fillet83.gltf',
  rudder_l: 'lockheed blackbird SR71 - blackbird rudder lh__Fillet73.gltf',
  rudder_r: 'lockheed blackbird SR71 - blackbird rudder rh__Mirror1.gltf',
  canopy_front: 'lockheed blackbird SR71 - blackbird canopy__Mirror1[2].gltf',
  canopy_rear: 'lockheed blackbird SR71 - blackbird canopy__Mirror1[1].gltf',
};

await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = new Document();
for (const [name, file] of Object.entries(PARTS)) {
  const part = await io.read(path.join(dir, file));
  part.getRoot().listNodes().forEach(n => n.setName(name));
  part.getRoot().listMeshes().forEach(m => m.setName(name));
  part.getRoot().listMaterials().forEach(m => m.setName(name));
  mergeDocuments(doc, part);
}
// repair patches (nacelle panel, gear doors, canopy glass) made by fix/patch.py; keep their own names
if (process.env.PATCHES) {
  const patch = await io.read(process.env.PATCHES);
  patch.getRoot().listNodes().forEach(n => n.getMesh()?.setName(n.getName()));
  mergeDocuments(doc, patch);
}
// one scene holding every part
const scenes = doc.getRoot().listScenes();
const main = scenes[0];
for (const s of scenes.slice(1)) { s.listChildren().forEach(c => main.addChild(c)); s.dispose(); }
doc.getRoot().setDefaultScene(main);

const before = doc.getRoot().listAccessors().filter(a => a.getType() === 'SCALAR').reduce((t, a) => t + a.getCount() / 3, 0);
await doc.transform(
  unpartition(), dedup(), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.45, error: 0.0004 }),
  prune(), reorder({ encoder: MeshoptEncoder }), quantize(),
);
const after = doc.getRoot().listAccessors().filter(a => a.getType() === 'SCALAR').reduce((t, a) => t + a.getCount() / 3, 0);
if (process.env.MESHOPT) doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(out, doc);
console.log('triangles', Math.round(before), '->', Math.round(after));
