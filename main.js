// SR-71 Blackbird: scroll-driven 3D story, all in a black photo studio (Sketchfab model).
// How it works:
//   1. SCENE   three.js stage: the jet, black studio, floor with real shadows, poster type, blueprint
//              backdrop, flames, heat glow, speed streaks.
//   2. KEYS    one "camera + lighting state" per <section data-key> in the HTML.
//   3. SCROLL  every frame, read where each section sits on screen and blend the two nearest keys.
//              Because this is recomputed from the live layout each frame, the 3D scene can never drift
//              out of step with the text (fonts loading, phone toolbars resizing the page, etc.).
//   4. RENDER  apply the blended state to the scene.
// To add a chapter: add a <section data-key="name"> to the HTML and a KEYS.name entry below.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = t => t * t * (3 - 2 * t);

/* ---------------------------------------------------------------- 1. SCENE */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;               // the jet casts a real shadow on the studio floor and poster type
renderer.shadowMap.type = THREE.PCFShadowMap;
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  const el = document.getElementById('loader'); el.classList.remove('done', 'gone');
  window.loader.msg('The graphics driver reset. Reload the page to continue.');
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 3000);

// Reflections: a tiny black "photo studio" with softbox strips, baked into an environment map.
function studioEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x08090b, side: THREE.BackSide })));
  const strip = (w, h, pos, bright, tint = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(bright), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  strip(36, 4, [0, 22, 0], 3);
  strip(4, 16, [-26, 6, 6], 1.6, 0xcfe0ff);
  strip(4, 16, [26, 6, -6], 1.6, 0xcfe0ff);
  strip(20, 2, [0, 4, -30], 1.2, 0xffe2c4);
  return env;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnvironment(), 0.03).texture;

const keyLight = new THREE.DirectionalLight(0xfff1e0, 2);   keyLight.position.set(5, 12, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
Object.assign(keyLight.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
keyLight.shadow.bias = -0.0004; keyLight.shadow.normalBias = 0.02; keyLight.shadow.radius = 2;
const rimA = new THREE.DirectionalLight(0x9fc7ff, 3);       rimA.position.set(-6, 3, -9);
const rimB = new THREE.DirectionalLight(0xc8dcff, 2);       rimB.position.set(7, 1.5, -7);
scene.add(keyLight, rimA, rimB);

// Studio backdrop: pitch black.
scene.background = new THREE.Color(0x000000);
scene.add(camera);                                   // so things can be pinned to the screen (the blueprint)

function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Hangar floor + soft contact shadow.
const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshLambertMaterial({
  color: 0x000000, transparent: true, alphaMap: radialTexture([[0, '#fff'], [0.55, '#fff'], [1, '#000']]),
}));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 12), new THREE.MeshBasicMaterial({
  map: radialTexture([[0, 'rgba(0,0,0,.85)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false,
}));
shadow.rotation.x = -Math.PI / 2;
scene.add(floor, shadow);

// Speed streaks: thin lines rushing past in flight, the only cue of speed in the black studio.
// They live in a field around the camera and fade out with distance, so the field never shows an edge.
const STREAKS = 220, FIELD = 60;
const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.018, 1),
  new THREE.MeshBasicMaterial({ color: 0xcfd8e6, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }), STREAKS);
const streakPos = Array.from({ length: STREAKS }, () => new THREE.Vector3((Math.random() - 0.5) * 2 * FIELD, (Math.random() - 0.5) * FIELD, (Math.random() - 0.5) * 2 * FIELD));
streaks.frustumCulled = false;
scene.add(streaks);
const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), s3 = new THREE.Vector3(), v3 = new THREE.Vector3(), col = new THREE.Color();
const wrap = (v, r) => ((v + r) % (2 * r) + 2 * r) % (2 * r) - r;
function updateStreaks(dt, speed) {
  streaks.visible = speed > 0.01;
  if (!streaks.visible) return;
  s3.set(1, 1, 1 + speed * 7);
  for (let i = 0; i < STREAKS; i++) {
    const p = streakPos[i];
    p.z -= dt * speed * 120;                                          // air streams backwards (-Z) past the jet
    // position relative to the camera, wrapped so the field always surrounds it
    v3.set(wrap(p.x - camera.position.x, FIELD), wrap(p.y - camera.position.y, FIELD / 2), wrap(p.z - camera.position.z, FIELD));
    const d = v3.length();
    const fade = Math.min(1, speed) * 0.4 * clamp01((d - 2) / 4) * clamp01((FIELD * 0.9 - d) / (FIELD * 0.5)); // fade near and far
    streaks.setColorAt(i, col.setScalar(fade));
    streaks.setMatrixAt(i, m4.compose(v3.add(camera.position), q0, s3));
  }
  streaks.instanceMatrix.needsUpdate = true; streaks.instanceColor.needsUpdate = true;
}

// Opening poster: big type printed on the studio floor. The jet taxis onto it and shadows it.
const POSTER_H = 13.4, POSTER_W = POSTER_H * 0.715;                 // world units (the jet is 10 long)
const posterMat = new THREE.MeshLambertMaterial({ transparent: true, emissive: 0xffffff, emissiveIntensity: 0.32 });
const poster = new THREE.Mesh(new THREE.PlaneGeometry(POSTER_W, POSTER_H), posterMat);
poster.rotation.set(-Math.PI / 2, 0, Math.PI);                      // lie flat, readable from above with the nose pointing up-screen
poster.receiveShadow = true;
scene.add(poster);
async function drawPoster() {
  try { await document.fonts.load('400 200px Anton'); } catch {}
  const W = 1430, H = 2000, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const FONT = px => `400 ${px}px Anton, Impact, "Arial Narrow", sans-serif`;
  // draw `text` filling `width`, its capitals spanning top..bottom (squashed or stretched vertically to fit)
  const big = (text, top, bottom, width) => {
    g.font = FONT(200); const m = g.measureText(text);
    const capH = m.actualBoundingBoxAscent, sx = width / m.width, sy = (bottom - top) / capH;
    g.save(); g.translate(W / 2, bottom); g.scale(sx, sy); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#f2f2ee'; g.fillText(text, 0, 0); g.restore();
  };
  big('SR-71', H * 0.08, H * 0.44, W * 0.84);
  big('BLACKBIRD', H * 0.70, H * 0.91, W * 0.84);
  // label bars across the middle, with the spec underneath
  const by = H * 0.535, bh = H * 0.05;
  g.fillStyle = '#f2f2ee'; g.fillRect(W * 0.08, by, W * 0.84, bh);
  g.fillStyle = '#000'; g.font = FONT(bh * 0.78); g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText('ENGINES', W * 0.1, by + bh / 2);
  g.textAlign = 'right'; g.fillText('SPEED', W * 0.9, by + bh / 2);
  g.fillStyle = '#f2f2ee'; g.font = FONT(H * 0.034); g.textBaseline = 'top';
  g.textAlign = 'left'; g.fillText('J58 TURBOJETS', W * 0.08, by + bh + H * 0.02);
  g.textAlign = 'right'; g.fillText('MACH 3.2', W * 0.92, by + bh + H * 0.02);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  posterMat.map = posterMat.emissiveMap = t; posterMat.needsUpdate = true;
}

// Blueprint scene: the white linework (extracted from a blueprint scan) on a screen pinned to the camera,
// sized so the whole sheet fits the window. state.bpY slides it up and out of view.
const BP_ASPECT = 2020 / 1314, BP_DIST = 40;                        // far behind the jet
const bpMat = new THREE.MeshBasicMaterial({ color: 0xaab6c8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
const blueprint = new THREE.Mesh(new THREE.PlaneGeometry(BP_ASPECT, 1), bpMat);
blueprint.renderOrder = -1;
camera.add(blueprint);
function placeBlueprint(s, W, H) {
  const visH = 2 * BP_DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), perPx = visH / H;
  const h = Math.min(visH, (visH * W / H) / BP_ASPECT) * 0.94;      // "contain": the whole sheet on screen
  blueprint.scale.set(h, h, 1);
  // the view offset slides the picture sideways for the text; slide the sheet back so it stays centred
  const offX = W < 700 ? 0 : -s.shift * W * 0.5;
  blueprint.position.set(offX * perPx, s.bpY * (visH + h) / 2 * 1.05, -BP_DIST);
}
async function loadBlueprint() {
  const url = JSON.parse(await (await fetch('assets/blueprint.json')).text())[0];
  const t = await new THREE.TextureLoader().loadAsync(url);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  bpMat.map = t; bpMat.needsUpdate = true;
}

// The jet. `jet` is flown by the story; `model` holds the Sketchfab scene, turned and scaled so that
// the jet is 10 units long, nose toward +Z, up +Y. Everything else on the jet (anchors, flames) is placed
// directly in those jet units.
const jet = new THREE.Group(), model = new THREE.Group();
jet.add(model); scene.add(jet);

// Feature points for the exterior tour (jet units). The camera key for each sits on the same side.
const ANCHORS = {
  spike: [-1.285, -0.22, 0.05],
  chine: [-0.46, -0.2, 1.6],
  cockpit: [0, 0.06, 2.95],
  fins: [1.18, 0.5, -3.46],
  nozzle: [1.325, -0.155, -4.1],
};
const anchors = {};
for (const [k, p] of Object.entries(ANCHORS)) { anchors[k] = new THREE.Object3D(); anchors[k].position.set(...p); jet.add(anchors[k]); }

// Heat glow: an additive fresnel shell drawn over the airframe.
const heatU = { uHeat: { value: 0 } };
const heatMat = new THREE.ShaderMaterial({
  uniforms: heatU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalMatrix * normal; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uHeat; varying vec3 vN; varying vec3 vV;
    void main(){
      if (dot(vN, vN) < 1e-10) discard;   // no usable normal: draw nothing rather than a NaN pixel
      float f = pow(1. - abs(dot(normalize(vN), vV)), 3.2);
      vec3 c = mix(vec3(.9,.18,.03), vec3(1.,.55,.25), f) * f * uHeat * 0.9; gl_FragColor = vec4(c, 1.); }`,
});

// Afterburner: two cones (outer orange, inner hot core) + shock diamonds, per engine. Jet units.
const FLAME_LEN = 2.4;
const flameU = { uI: { value: 0 }, uT: { value: 0 }, uGreen: { value: 0 } };
function flameMat(inner) {
  return new THREE.ShaderMaterial({
    uniforms: { ...flameU, uInner: { value: inner ? 1 : 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying float vT; uniform float uT;
      void main(){ vT = .5 - position.y / ${FLAME_LEN.toFixed(2)}; vec3 p = position; p.xz *= 1. + .06 * sin(uT * 40. + position.y * 6.);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.); }`,
    fragmentShader: `uniform float uI, uInner, uGreen, uT; varying float vT;
      void main(){ float a = pow(clamp(vT,0.,1.), uInner > .5 ? 2.5 : 1.4) * uI;
        vec3 c = mix(mix(vec3(1.,.32,.08), vec3(1.,.62,.3), vT), vec3(.75,.85,1.), uInner);
        c = mix(c, vec3(.35,1.,.45), uGreen);                        // triethylborane ignition flash
        gl_FragColor = vec4(c * a * (uInner > .5 ? 1.15 : .6) * (.9 + .1 * sin(uT * 60.)), 1.); }`,
  });
}
const diamondTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,190,120,.6)'], [1, 'rgba(255,120,40,0)']]);
const flames = [], diamonds = [];
const flameLight = new THREE.PointLight(0xff7a30, 0, 30, 1.6);
flameLight.position.set(0, -0.15, -4.8);
jet.add(flameLight);
for (const x of [-1.325, 1.325]) {
  const g = new THREE.Group();
  g.position.set(x, -0.155, -4.1);
  g.rotation.x = -Math.PI / 2;                          // cones are built along +Y; point them backwards (-Z)
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.2, FLAME_LEN, 32, 1, true), flameMat(false));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.1, FLAME_LEN, 24, 1, true), flameMat(true));
  for (const m of [outer, inner]) { m.position.y = FLAME_LEN / 2; g.add(m); }   // wide base at the nozzle, tip trailing behind
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: diamondTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
    s.position.y = 0.33 + i * 0.36; s.scale.setScalar(0.25 - i * 0.03); g.add(s); diamonds.push(s);
  }
  jet.add(g); flames.push(g);
}

// Landing gear: the model's gear parts, grouped into three legs that fold away on takeoff.
const GEAR = {
  nose: ['Sphere01', 'Sphere02', 'Box02', 'Cylinder12', 'Cylinder11', 'Object03', 'stvnos1', 'stvorknos', 'Box04', 'Box03', 'Cylinder10', 'Cylinder09', 'Box11', 'Cylinder08', 'Cylinder07', 'Torus05', 'Cylinder06', 'Torus04', 'Cylinder05'],
  mainA: ['Torus01', 'Box05', 'Cylinder13', 'Torus03', 'Cylinder04', 'Torus02', 'Cylinder03', 'Cylinder02', 'Object09', 'Box07', 'Box06', 'Cylinder15', 'Object08', 'Cylinder14', 'Object06', 'Object04'],
  mainB: ['Torus08', 'Box10', 'Cylinder21', 'Torus07', 'Cylinder20', 'Torus06', 'Cylinder19', 'Cylinder18', 'Object11', 'Box09', 'Box08', 'Cylinder17', 'Object10', 'Cylinder16', 'Object07', 'Object05'],
};
const legs = [];
function buildGear(root) {
  for (const [leg, names] of Object.entries(GEAR)) {
    const parts = names.map(n => root.getObjectByName(n)).filter(Boolean);
    if (!parts.length) continue;
    const box = new THREE.Box3(); parts.forEach(p => box.expandByObject(p));
    const pivot = new THREE.Group();
    const c = box.getCenter(new THREE.Vector3());
    pivot.position.set(c.x, box.max.y, c.z);           // fold from the top of the leg, inside the body
    jet.add(pivot); pivot.updateMatrixWorld(true);
    parts.forEach(p => pivot.attach(p));               // keep each part where it is in the world
    legs.push({ pivot, side: leg === 'nose' ? 0 : Math.sign(c.x) });
  }
}
function updateGear(g) {
  for (const { pivot, side } of legs) {
    const t = 1 - g;                                     // 0 = down, 1 = stowed
    // fold a little and shrink toward the top of the leg (the gear bay), so no part ever rises
    // above the bay and pokes through the top of the airframe
    if (side === 0) pivot.rotation.x = -t * 0.55;            // nose leg tips forward
    else pivot.rotation.z = -side * t * 0.55;                // main legs tip inward
    pivot.scale.setScalar(Math.max(0.001, 1 - smooth(t)));
    pivot.visible = g > 0.01;
  }
}

// Post-processing: bloom makes flames, limb and heat glow bleed like a camera lens.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ----------------------------------------------------------------- 2. KEYS */
const DEFAULT = {
  cam: [8, 2, 10], look: [0, 0, 0], fov: 32,     // camera position, what it looks at, lens
  yaw: 0, pitch: 0, roll: 0, jy: 0, jz: 0,      // jet attitude and position (pitch < 0 = nose up)
  floor: 1, gear: 1, speed: 0,                  // studio floor, landing gear (1 = down), speed streaks
  poster: 0, bp: 0, bpY: 0,                     // opening poster type, blueprint backdrop (+ how far it has scrolled away)
  vis: 1,                                       // 0 hides the jet (used while it is repositioned off screen)
  env: 1, key: 2, rim: 2, exposure: 1, bloom: 0.35,
  flame: 0, green: 0, heat: 0, shake: 0,
  shift: 0,                                     // slide the jet sideways in frame, away from the text (-1..1)
  lift: 1,                                      // on phones, lift the picture above the text (0 = keep centred)
  low: 0,                                       // 1 = low raking key light (long shadows across the poster type)
  pz: 1,                                        // on phones, multiply the camera distance (pull back for wide shots)
};// Each key inherits everything from the key before it, so it only lists what changes.
// `look` may name an anchor; `cam` is then an offset from that anchor.
// Rule: once the gear is up the camera stays above the jet, because the model has no gear doors.
const KEYS = {
  poster:   { cam: [0, 25, -0.3], look: [0, 0, 0], fov: 32, jz: -19, poster: 1, env: 0.5, key: 3.2, rim: 1.2, bloom: 0, lift: 0, low: 1 },
  arrive:   { jz: 0, shift: 0.34 },
  titanium: { cam: [-9.5, 3.4, -6.5], look: [0, -0.2, 0], fov: 32, poster: 0, low: 0, env: 1, key: 2.2, rim: 2, bloom: 0.35, shift: -0.2, lift: 1 },
  // blueprint: the text pins (see .pin in the HTML) while the sheet is shown whole, then slides up and away
  blueprint:{ at: ['blueprint', 0, 0.3], cam: [0, 0.75, 10], look: [0, 0.15, 0], fov: 32, bp: 1, bpY: 0, floor: 0, env: 1.1, key: 2, rim: 2.4, shift: 0.2 },
  bpout:    { at: ['blueprint', 0.85, 1], bpY: 1 },
  // spike leaves bpY at 1: once the blueprint has slid away it never slides back in while scrolling forward
  spike:    { look: 'spike', cam: [-3.4, 1.1, 3.2], fov: 30, bp: 0, floor: 1, rim: 1.2, bloom: 0.25, shift: -0.22 },
  chine:    { look: 'chine', cam: [-2.6, 2.8, 3.6], shift: 0.22 },
  cockpit:  { look: 'cockpit', cam: [2.6, 1.5, 2.6], shift: -0.22 },
  fins:     { look: 'fins', cam: [4.2, 2.4, -3.2], fov: 32, shift: 0.22 },
  engines:  { look: 'nozzle', cam: [3.0, 0.4, -4.6], fov: 34, rim: 2.6, key: 1.6, env: 2.4, shift: -0.22 },
  // takeoff chapter is pinned: its text holds while the engines light green, turn orange and the jet lifts off
  ignite:   { at: ['takeoff', 0, 0.22], look: [0, 0, -2], cam: [-4.5, 1.4, -12], fov: 38, flame: 0.7, green: 1, bloom: 0.9, env: 0.9, key: 1, shift: 0.15 },
  spool:    { at: ['takeoff', 0.36], flame: 1, green: 0 },
  // low side view (lit side, just below the wings) while the gear comes up, so the retraction is seen side-on
  liftoff:  { at: ['takeoff', 0.6], look: [0, 1.1, 0.3], cam: [17, 0.25, 3.5], fov: 33, shift: 0.08, jy: 1.1, pitch: -0.1, gear: 0.5, floor: 0.3, speed: 0.5, shake: 0.6, key: 1.6, env: 1.2 },
  takeoff:  { at: ['takeoff', 0.88, 1], look: [0, 2.2, 2], cam: [-6, 5.5, -14], fov: 40, floor: 0, gear: 0, speed: 1, flame: 1, green: 0, jy: 2.2, pitch: -0.12, env: 0.9, key: 1.2, rim: 2.5, bloom: 0.9, shake: 1, shift: 0.15 },
  climb:    { look: [0, 2.6, 1], cam: [11, 8, -12], fov: 36, pitch: -0.3, roll: 0.15, env: 0.8, key: 1.4, bloom: 0.8, shake: 0.4, shift: -0.12 },
  mach3:    { look: [0, 2.2, 0.5], cam: [22, 6, 6], fov: 30, speed: 1.4, flame: 0.75, heat: 0.8, pitch: 0, roll: 0, env: 0.7, key: 1.6, rim: 3, bloom: 0.8, shake: 0.15, shift: 0.3 },
  records:  { look: [0, 2.2, 0], cam: [-9, 22, -20], fov: 34, speed: 0.8, heat: 0.7, roll: -0.08, shift: 0.42 },
  outro:    { look: [0, 3, 30], cam: [3, 10, -46], fov: 30, speed: 1, flame: 1, heat: 0.6, jz: 130, jy: 4, roll: 0, pitch: -0.05, bloom: 0.9, shift: 0 },
  // the jet shrinks into the distance and is gone...
  gone:     { between: ['outro', 'finaleIn', 0.45], jz: 420, jy: 8, vis: 0 },
  // ...is quietly moved off the left edge of the next shot...
  repo:     { between: ['outro', 'finaleIn', 0.85], look: [0, -0.55, 0], cam: [-18.5, 10.2, -1], fov: 30, jz: -70, jy: 0, roll: 0.35, pitch: -0.08, heat: 0, flame: 0.9, speed: 0.4, lift: 0, pz: 1.75, vis: 0 },
  // ...and once the closing poster has scrolled into place, flies in from the left into the gap in the type
  finaleIn: { at: ['finale', 0], vis: 1 },
  finale:   { at: ['finale', 0.45, 1], jz: 0, speed: 0.25 },  // (repo sets pz for phones)
};
const FIELDS = Object.keys(DEFAULT).filter(f => f !== 'cam' && f !== 'look');
const JET_FIELDS = new Set(['jz', 'jy', 'pitch', 'roll', 'yaw']);

// Camera moves are stored as an orbit around `look` (radius, azimuth, elevation) so that blending
// between two keys swings the camera around the jet instead of cutting straight through it.
function resolveKey(name, prevAz, inherited) {
  const k = { ...inherited, ...KEYS[name] };
  const anchored = typeof k.look === 'string';
  const look = anchored ? anchors[k.look].getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...k.look);
  const camPos = anchored ? look.clone().add(new THREE.Vector3(...k.cam)) : new THREE.Vector3(...k.cam);
  const off = camPos.sub(look), r = off.length();
  let az = Math.atan2(off.x, off.z);
  const el = Math.asin(off.y / r);
  if (prevAz !== undefined) { while (az - prevAz > Math.PI) az -= 2 * Math.PI; while (prevAz - az > Math.PI) az += 2 * Math.PI; }
  const out = { lx: look.x, ly: look.y, lz: look.z, r, az, el };
  for (const f of FIELDS) out[f] = k[f];
  return { out, merged: k };
}

/* --------------------------------------------------------------- 3. SCROLL */
const lenis = reduceMotion ? null : new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
const story = document.getElementById('story');
const sections = [...story.querySelectorAll('section[data-key]')];
const state = {}, target = {};
let stops = [];          // [{ name, y0, y1, r }] : the key is held still while scrollY is between y0 and y1
let layoutVersion = 0;

// Measure the page and work out, for every key, the scroll range where it is fully shown:
// the middle part of its section, centred on screen. Keys between sections (like `ignite`) get a point.
const HOLD = 0.3;        // fraction of each section's height during which its scene holds still
function layout() {
  const vh = innerHeight, top = story.getBoundingClientRect().top + scrollY;
  const secTop = name => { const sec = sections.find(s => s.dataset.key === name); return [top + sec.offsetTop, sec.offsetHeight]; };
  // a key's place: by default the middle of its section, centred on screen; with `at: [section, f0, f1]` a stretch
  // of that section's pinned scroll (0 = section top reaches the top of the window, 1 = its bottom reaches the bottom)
  const place = (name, fallback) => {
    const at = KEYS[name]?.at;
    if (!at) return fallback;
    const [t, h] = secTop(at[0]), y = f => t + f * (h - vh);
    return { name, y0: y(at[1]), y1: y(at[2] ?? at[1]) };
  };
  const list = sections.map(sec => {
    const c = top + sec.offsetTop + sec.offsetHeight / 2 - vh / 2, h = sec.offsetHeight * HOLD / 2;
    return place(sec.dataset.key, { name: sec.dataset.key, y0: c - h, y1: c + h });
  });
  for (const name of Object.keys(KEYS)) if (KEYS[name].at && !list.some(s => s.name === name)) list.push(place(name));
  list.sort((a, b) => a.y0 - b.y0);
  for (const [name, k] of Object.entries(KEYS)) if (k.between) {
    const [a, b, f] = k.between, A = list.find(s => s.name === a), B = list.find(s => s.name === b);
    const y = lerp(A.y1, B.y0, f); list.push({ name, y0: y, y1: y });
  }
  list.sort((a, b) => a.y0 - b.y0);
  list[0].y0 = -1e9; list.at(-1).y1 = 1e9;
  let prevAz, inherited = DEFAULT;
  stops = list.map(s => { const { out, merged } = resolveKey(s.name, prevAz, inherited); prevAz = out.az; inherited = merged; return { ...s, r: out }; });
  layoutVersion++;
}

// The state the scene should show at scroll position y.
function sample(y, into) {
  let i = 0;
  while (i < stops.length - 1 && y > stops[i].y1) i++;
  const b = stops[i], a = stops[i - 1];
  if (!a || y >= b.y0) { Object.assign(into, b.r); return; }          // inside a hold
  const t = smooth(clamp01((y - a.y1) / (b.y0 - a.y1)));               // between two holds
  for (const f in b.r) into[f] = lerp(a.r[f], b.r[f], t);
}

// Which section's text is on screen: the one under the middle of the viewport.
function activeSection() {
  const mid = innerHeight / 2;
  return sections.find(sec => { const r = sec.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; }) || null;
}

// Rail, counters and the 3D callout marker.
const marker = document.getElementById('marker'), markerLabel = marker.querySelector('b');
const rail = document.getElementById('rail');
const dots = sections.map((sec, i) => {
  const dot = document.createElement('a');
  dot.href = '#'; dot.setAttribute('aria-label', 'Chapter ' + (i + 1) + ': ' + (sec.querySelector('h1,h2')?.textContent || ''));
  dot.addEventListener('click', e => {
    e.preventDefault();
    const y = sec.getBoundingClientRect().top + scrollY + sec.offsetHeight / 2 - innerHeight / 2;
    lenis ? lenis.scrollTo(y, { duration: 1.8 }) : scrollTo(0, y);
  });
  rail.append(dot);
  return dot;
});
// One more dot for the very end (the jet in its place on the closing poster), so the poster doesn't look like the end
const endDot = document.createElement('a');
endDot.href = '#'; endDot.setAttribute('aria-label', 'The end');
endDot.addEventListener('click', e => { e.preventDefault(); const y = document.documentElement.scrollHeight - innerHeight; lenis ? lenis.scrollTo(y, { duration: 1.8 }) : scrollTo(0, y); });
rail.append(endDot);
const hint = document.getElementById('hint');
const finaleMore = document.querySelector('.finale .more');
function runCounters(sec) {
  sec.querySelectorAll('[data-count]').forEach(el => {
    if (el.dataset.done) return; el.dataset.done = 1;
    const small = el.querySelector('small').outerHTML, end = +el.dataset.count, dec = +el.dataset.dec, t0 = performance.now(), dur = reduceMotion ? 1 : 2200;
    const step = now => {
      const t = clamp01((now - t0) / dur), v = end * (1 - (1 - t) ** 3);
      el.innerHTML = v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + small;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
let current = null;
function updateOverlays() {
  const sec = activeSection();
  if (sec !== current) {
    sections.forEach(s => { if (!s.dataset.static) s.querySelector('.copy').classList.toggle('on', s === sec); });
    if (sec) runCounters(sec);
    current = sec;
  }
  // rail: the finale's own dot until the jet has arrived; the last dot only at the very end
  const finaleStop = stops.find(st => st.name === 'finale');
  const atEnd = !!finaleStop && scrollY >= finaleStop.y0 - 4;
  sections.forEach((s, i) => dots[i].classList.toggle('on', s === sec && !(s.dataset.key === 'finale' && atEnd)));
  endDot.classList.toggle('on', atEnd);
  finaleMore.classList.toggle('on', sec?.dataset.key === 'finale' && !atEnd);
  hint.classList.toggle('on', scrollY < 40 && !touring);
  if (!sec && scrollY < innerHeight) sections[0].querySelector('.copy').classList.add('on');
  // marker: only while that section is showing, and only if its point is in front of the camera and on screen
  const anchor = sec?.dataset.anchor && anchors[sec.dataset.anchor];
  let show = false;
  if (anchor) {
    const p = anchor.getWorldPosition(tmp).project(camera);
    show = p.z < 1 && Math.abs(p.x) < 0.95 && Math.abs(p.y) < 0.95;
    marker.style.transform = `translate(${(p.x * 0.5 + 0.5) * innerWidth}px, ${(-p.y * 0.5 + 0.5) * innerHeight}px)`;
    markerLabel.textContent = sec.dataset.label;
  }
  marker.classList.toggle('on', show);
}

/* --------------------------------------------------------------- 4. RENDER */
const look = new THREE.Vector3(), tmp = new THREE.Vector3();
let floorY = 0, last = performance.now(), loaded = false;
const jetUp = new THREE.Vector3(), toCam = new THREE.Vector3();function frame(now) {
  requestAnimationFrame(frame);
  lenis?.raf(now);
  if (!loaded) return;
  const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;

  // ease the shown state toward the state for the current scroll position
  sample(scrollY, target);
  const k = reduceMotion ? 1 : 1 - Math.exp(-Math.min(0.25, (now - (frame.prev ?? now)) / 1000) * 9); // time-based, even on slow devices
  frame.prev = now;
  const hidden = target.vis < 0.5;                                    // jet out of sight: move it instantly, no easing
  for (const f in target) {
    const snap = state[f] === undefined || !Number.isFinite(state[f]) || f === 'vis' || (hidden && JET_FIELDS.has(f));
    state[f] = snap ? target[f] : lerp(state[f], target[f], k);
  }
  const s = state;

  // jet: attitude from the story, plus a gentle bob once airborne
  const air = clamp01(1 - s.floor);
  jet.position.set(0, s.jy + Math.sin(t * 0.9) * 0.06 * air, s.jz);
  jet.rotation.set(s.pitch + Math.sin(t * 0.7) * 0.01 * air, s.yaw, s.roll + Math.sin(t * 0.5) * 0.02 * air, 'YXZ');
  updateGear(s.gear);
  jet.visible = s.vis > 0.5;

  // camera: orbit around the look point, with a little handheld shake
  look.set(s.lx, s.ly, s.lz);
  const shake = reduceMotion ? 0 : s.shake * 0.05, r = s.r * (innerWidth < 700 ? s.pz : 1);
  camera.position.set(
    look.x + r * Math.cos(s.el) * Math.sin(s.az) + Math.sin(t * 23) * shake,
    look.y + r * Math.sin(s.el) + Math.sin(t * 31 + 1) * shake,
    look.z + r * Math.cos(s.el) * Math.cos(s.az));
  // safety net for the rule above: with the gear up, never let the camera see the jet's underside
  if (s.gear < 0.1) {
    jetUp.set(0, 1, 0).applyQuaternion(jet.quaternion);
    toCam.subVectors(camera.position, jet.position);
    const need = toCam.length() * 0.1 - toCam.dot(jetUp);          // keep at least ~6 degrees above the wing plane
    if (need > 0) camera.position.addScaledVector(jetUp, need);
  }
  camera.lookAt(look);
  const W = innerWidth, H = innerHeight, aspect = W / H, narrow = W < 700;
  camera.fov = aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(s.fov) / 2) * Math.min(2.2, 0.95 / aspect))) : s.fov;
  camera.setViewOffset(W, H, narrow ? 0 : -s.shift * W * 0.5, narrow ? H * 0.16 * s.lift : 0, W, H); // on phones the text sits low: lift the jet
  camera.updateProjectionMatrix();

  // studio
  floor.material.opacity = s.floor; shadow.material.opacity = s.floor * 0.5;
  floor.visible = shadow.visible = s.floor > 0.01;
  floor.position.y = floorY; shadow.position.y = floorY + 0.01;
  renderer.shadowMap.autoUpdate = floor.visible;                       // no floor, no shadow pass
  posterMat.opacity = s.poster; poster.visible = s.poster > 0.01; poster.position.y = floorY + 0.004;
  bpMat.opacity = s.bp * 0.5; blueprint.visible = s.bp > 0.01;
  if (blueprint.visible) placeBlueprint(s, W, H);
  updateStreaks(dt, s.speed);

  // lighting
  scene.environmentIntensity = s.env;
  keyLight.position.set(lerp(5, 9, s.low), lerp(12, 4.2, s.low), lerp(6, 6.5, s.low)); // high studio light, or low and raking
  keyLight.intensity = s.key; rimA.intensity = s.rim; rimB.intensity = s.rim * 0.6;
  renderer.toneMappingExposure = s.exposure;
  bloom.strength = s.bloom;

  // engines and heat
  flameU.uI.value = s.flame; flameU.uT.value = t; flameU.uGreen.value = s.green;
  for (const f of flames) f.scale.set(1, 0.55 + 0.6 * s.flame + Math.sin(t * 30) * 0.03, 1);
  diamonds.forEach((d, i) => { d.material.opacity = clamp01(s.flame * 1.4 - 0.4) * (0.7 + 0.3 * Math.sin(t * 50 + i)); });
  flameLight.intensity = s.flame * 6;
  heatU.uHeat.value = s.heat;

  updateOverlays();
  composer.render();
}
requestAnimationFrame(frame);

/* ----------------------------------------------------------------- 5. LOAD */
// The model ships as base64 inside a JSON file (the page host serves .json but not .glb).
async function fetchModel(url) {
  const res = await fetch(url);
  const total = +res.headers.get('content-length') || 3.3e6, reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length;
    window.loader.set(got / total * 0.75);
  }
  const b64 = JSON.parse(await new Blob(chunks).text())[0];
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}
function onFail(err) { window.loader.msg('The model could not load: ' + (err?.message || err)); }
fetchModel('assets/sr71.json').then(buf => new GLTFLoader().parse(buf, '', onModel, onFail)).catch(onFail);

const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1520, metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 2, transparent: true, opacity: 0.8 });
async function onModel(gltf) {
  const root = gltf.scene;
  // Sketchfab wraps the model in a node with a display rotation; drop it, then stand the model up.
  const wrap = root.children[0];
  wrap.matrix.identity(); wrap.matrix.decompose(wrap.position, wrap.quaternion, wrap.scale);
  wrap.rotation.x = -Math.PI / 2;
  model.add(root);
  model.rotation.y = Math.PI;                                 // the model's nose points -Z; turn it to +Z
  jet.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(10 / size.z);                         // 10 units nose to tail
  jet.updateMatrixWorld(true);
  model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
  jet.updateMatrixWorld(true);

  // Materials: keep the model's painted textures (markings, panel lines) but give them a clear-coated,
  // slightly metallic finish so they respond to the studio lighting. See-through parts become tinted glass.
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const m = o.material;
    if (m.transparent) { o.material = glass; continue; }
    o.material = new THREE.MeshPhysicalMaterial({
      map: m.map, color: m.color, roughness: 0.42, metalness: 0.2, clearcoat: 0.45, clearcoatRoughness: 0.25,
    });
    if (o.geometry.attributes.normal) o.add(new THREE.Mesh(o.geometry, heatMat));
  }
  meshes.forEach(o => { o.castShadow = true; o.frustumCulled = false; }); // never culled: the jet is always drawn when visible
  window.loader.set(0.8);

  floorY = new THREE.Box3().setFromObject(model).min.y;      // wheels on the floor (measure before the gear is regrouped)
  buildGear(root);
  await Promise.all([drawPoster(), loadBlueprint().catch(e => console.warn('blueprint', e))]);
  window.loader.set(0.9); window.loader.msg('Warming up the engines');
  await warmUp();
  layout();
  loaded = true;
  window.loader.done();
  // handy for debugging in the browser console: goTo('mach3')
  window.goTo = key => { const sec = sections.find(s => s.dataset.key === key); const y = sec.getBoundingClientRect().top + scrollY + sec.offsetHeight / 2 - innerHeight / 2; lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); };
  window.scrollToY = f => { const y = f * (document.documentElement.scrollHeight - innerHeight); lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); };
  window.goKey = (name, f = 0.5) => { const st = stops.find(s => s.name === name); const y = st.y0 < -1e8 ? 0 : st.y1 > 1e8 ? st.y0 + 50 : lerp(st.y0, st.y1, f); lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); };
  window.goBetween = (a, b, f) => { const A = stops.find(s => s.name === a), B = stops.find(s => s.name === b); const y = lerp(A.y1, B.y0, f); lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); };
  window.ready = true;
}

// Compile every shader and upload every texture before the page appears, with everything that can ever be
// shown switched on, so nothing has to get ready (and blink) in the middle of a scroll.
async function warmUp() {
  const show = [poster, blueprint, streaks, floor, shadow, jet, ...flames];
  const was = show.map(o => o.visible);
  show.forEach(o => { o.visible = true; });
  legs.forEach(l => { l.pivot.visible = true; });
  flameU.uI.value = 1; heatU.uHeat.value = 1;
  camera.position.set(14, 8, 14); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  try { await renderer.compileAsync(scene, camera); } catch { renderer.compile(scene, camera); }
  renderer.shadowMap.needsUpdate = true;
  composer.render();                                                  // first real frame: uploads textures, shadow map
  show.forEach((o, i) => { o.visible = was[i]; });
  window.loader.set(1);
}

/* ----------------------------------------------------------- 7. AUTO-PLAY */
// Glides through the whole story: a pause on each chapter so its text can be read, smooth moves between
// them, ending on the closing poster. Any wheel, touch, key or the Stop button hands control back.
let touring = false;
const tourBtn = document.getElementById('tourBtn'), tourStop = document.getElementById('tourStop');
const setY = y => (lenis ? lenis.scrollTo(y, { immediate: true, force: true }) : scrollTo(0, y));
function tourPlan() {
  const max = document.documentElement.scrollHeight - innerHeight, vh = innerHeight;
  const clampY = y => Math.min(max, Math.max(0, y));
  // waypoints: the start and end of every hold, in scroll order
  const pts = [];
  for (const st of stops) {
    const a = clampY(st.y0), b = clampY(st.y1);
    if (!pts.length || a > pts.at(-1).y + 1) pts.push({ y: a, hold: false });
    if (b > a + 1) pts.push({ y: b, hold: true });                  // reaching b means we crossed a hold
  }
  if (pts.at(-1).y < max - 1) pts.push({ y: max, hold: false });
  // each leg: holds glide slowly (text on screen), moves between holds take a few seconds with easing
  return pts.slice(1).map((p, i) => {
    const from = pts[i].y, dist = p.y - from;
    const dur = p.hold ? 3.4 : Math.min(6, Math.max(2.2, dist / vh * 1.6));
    return { from, to: p.y, dur, ease: !p.hold };
  }).filter(l => l.to > l.from + 1);
}
function startTour() {
  if (touring) return;
  touring = true; tourStop.classList.add('on'); tourStop.focus({ preventScroll: true });
  const legs = tourPlan();
  if (scrollY > 2) legs.unshift({ from: scrollY, to: legs[0]?.from ?? 0, dur: 1.5, ease: true });
  let i = 0, t0 = performance.now();
  const step = now => {
    if (!touring) return;
    const leg = legs[i];
    if (!leg) { stopTour(); return; }                               // finished: stay on the final page
    const t = Math.min(1, (now - t0) / 1000 / leg.dur);
    setY(lerp(leg.from, leg.to, leg.ease ? smooth(t) : t));
    if (t >= 1) { i++; t0 = now; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function stopTour() {
  touring = false; tourStop.classList.remove('on');
}
tourBtn.addEventListener('click', startTour);
tourStop.addEventListener('click', stopTour);
for (const ev of ['wheel', 'touchstart', 'keydown']) addEventListener(ev, e => {
  if (touring && !(ev === 'keydown' && (e.key === 'Enter' || e.key === ' ') && e.target === tourStop)) stopTour();
}, { passive: true });

// Re-measure whenever anything could move the sections: window size, web fonts arriving, content reflow.
let relayoutTimer;
const relayout = () => { clearTimeout(relayoutTimer); relayoutTimer = setTimeout(() => { if (loaded) { lenis?.resize(); layout(); } }, 120); };
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  relayout();
});
new ResizeObserver(relayout).observe(story);
document.fonts?.ready.then(relayout);
