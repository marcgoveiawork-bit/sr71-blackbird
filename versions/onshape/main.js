// SR-71 Blackbird: scroll-driven 3D story.
// How it works, in four parts:
//   1. SCENE    three.js stage: the jet, sky dome, hangar floor, runway, flames, heat glow.
//   2. KEYS     one "camera + lighting state" per <section data-key> in the HTML.
//   3. SCROLL   GSAP ScrollTrigger scrubs a timeline that tweens one `state` object between keys;
//               Lenis smooths the scroll itself.
//   4. RENDER   every frame reads `state` and applies it to the scene.
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

/* ---------------------------------------------------------------- 1. SCENE */
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.05, 3000);

// Reflections: a tiny black "photo studio" with a few softbox strips, baked into an environment map.
// Black paint only looks black if what it reflects is mostly dark; the strips give it crisp highlights.
function studioEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x08090b, side: THREE.BackSide })));
  const strip = (w, h, pos, look, bright, tint = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(bright), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); env.add(m);
  };
  strip(36, 4, [0, 22, 0], [0, 0, 0], 3);                 // long overhead softbox
  strip(4, 16, [-26, 6, 6], [0, 0, 0], 1.6, 0xcfe0ff);    // cool side strips
  strip(4, 16, [26, 6, -6], [0, 0, 0], 1.6, 0xcfe0ff);
  strip(20, 2, [0, 4, -30], [0, 0, 0], 1.2, 0xffe2c4);    // warm kicker behind
  return env;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(studioEnvironment(), 0.03).texture;

const keyLight = new THREE.DirectionalLight(0xfff1e0, 2);   keyLight.position.set(5, 9, 6);
const rimA = new THREE.DirectionalLight(0x9fc7ff, 3);       rimA.position.set(-6, 3, -9);
const rimB = new THREE.DirectionalLight(0xc8dcff, 2);       rimB.position.set(7, 1.5, -7);
scene.add(keyLight, rimA, rimB);

// Sky dome: one shader that blends hangar -> dusk -> stratosphere via state.sky (0..2).
const SKIES = [ // zenith, horizon, ground, limb glow, studio spot
  { z: '#040506', h: '#0c0e11', g: '#040405', limb: 0, spot: 1 },
  { z: '#16243d', h: '#9a6448', g: '#08090b', limb: 0, spot: 0 },
  { z: '#000000', h: '#0c2f66', g: '#041026', limb: 1, spot: 0 },
].map(s => ({ ...s, z: new THREE.Color(s.z), h: new THREE.Color(s.h), g: new THREE.Color(s.g) }));
const skyU = {
  uZ: { value: new THREE.Color() }, uH: { value: new THREE.Color() }, uG: { value: new THREE.Color() },
  uLimb: { value: 0 }, uSpot: { value: 0 },
};
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: skyU,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `
    uniform vec3 uZ, uH, uG; uniform float uLimb, uSpot; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 c = h > 0. ? mix(uH, uZ, pow(smoothstep(0., 1., h), .55)) : mix(uH, uG, smoothstep(0., .18, -h));
      c += vec3(.25,.55,1.) * uLimb * (exp(-abs(h + .012) * 160.) * .75 + exp(-abs(h) * 22.) * .16); // Earth's blue limb
      c += vec3(.05,.055,.06) * uSpot * pow(max(h, 0.), 2.);                                       // hangar ceiling light
      gl_FragColor = vec4(c, 1.);
    }`,
}));
sky.renderOrder = -2;
scene.add(sky);

// Stars, fading in with altitude.
const starGeo = new THREE.BufferGeometry();
{
  const p = [];
  for (let i = 0; i < 2600; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(900);
    if (v.y < -60) v.y *= -1; // keep them above the horizon
    p.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
scene.add(stars);

// Small helper: radial-gradient canvas texture (floor fade, shadow, glow sprites).
function radialTexture(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Hangar floor + soft contact shadow.
const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 64), new THREE.MeshLambertMaterial({ // matte: no grazing glare
  color: 0x060607, transparent: true,
  alphaMap: radialTexture([[0, '#fff'], [0.55, '#fff'], [1, '#000']]),
}));
floor.rotation.x = -Math.PI / 2;
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(9, 13), new THREE.MeshBasicMaterial({
  map: radialTexture([[0, 'rgba(0,0,0,.85)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false,
}));
shadow.rotation.x = -Math.PI / 2;
scene.add(floor, shadow);

// Runway: asphalt strip, edge lights and centre-line dashes that stream past.
const runway = new THREE.Group();
const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(40, 900), new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.95, transparent: true }));
asphalt.rotation.x = -Math.PI / 2;
const SPACING = 6, ROWS = 150;
const edgeLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true }), ROWS * 2);
const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.02, 2.2), new THREE.MeshBasicMaterial({ color: 0x8a8d92, transparent: true }), ROWS);
runway.add(asphalt, edgeLights, dashes);
scene.add(runway);
let runOffset = 0;
const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s3 = new THREE.Vector3();
function updateRunway(dt, speed) {
  runOffset = (runOffset + dt * speed * 140) % SPACING;
  const stretch = 1 + speed * 14;
  for (let i = 0; i < ROWS; i++) {
    const z = -300 + i * SPACING - runOffset;
    s3.set(1, 1, stretch);
    edgeLights.setMatrixAt(i * 2, m4.compose(v3.set(-9, 0.06, z), q0, s3));
    edgeLights.setMatrixAt(i * 2 + 1, m4.compose(v3.set(9, 0.06, z), q0, s3));
    s3.set(1, 1, 1 + speed * 2);
    dashes.setMatrixAt(i, m4.compose(v3.set(0, 0.01, z), q0, s3));
  }
  edgeLights.instanceMatrix.needsUpdate = dashes.instanceMatrix.needsUpdate = true;
}

// The jet. Hierarchy: jet (flown by the story) > upright (turns the Onshape Z-up export to Y-up and scales it)
// > model (re-centred; everything inside uses the original Onshape coordinates).
const jet = new THREE.Group(), upright = new THREE.Group(), model = new THREE.Group();
jet.add(upright); upright.add(model); scene.add(jet);
upright.rotation.x = Math.PI / 2; // the export's "up" is -Z and the nose points +Y; this makes up = +Y and nose = +Z

// Feature points for the exterior tour, in the model's own coordinates (metres-ish from Onshape).
const ANCHORS = {
  spike: [-0.106, -0.163, -0.0067],
  chine: [-0.052, 0.02, -0.004],
  cockpit: [0, 0.048, -0.012],
  fins: [-0.096, -0.37, -0.075],
  nozzle: [-0.106, -0.423, -0.0067],
};
const anchors = {};
for (const [k, p] of Object.entries(ANCHORS)) { anchors[k] = new THREE.Object3D(); anchors[k].position.set(...p); model.add(anchors[k]); }

// Paint: near-black with a soft clear coat, like the real "iron ball" paint.
// DoubleSide: hairline cracks between CAD surface patches and the open vent slots then show the dark
// inside of the airframe instead of the sky behind it.
const paint = new THREE.MeshPhysicalMaterial({ color: 0x0b0c0e, metalness: 0.25, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.22, side: THREE.DoubleSide });

/* Projected decals: markings are "sprayed" onto the paint by the shader, like a slide projector.
   Each decal is a box in space; any paint pixel inside the box (and facing the projector) takes its colour
   from one region of a single texture atlas. No UVs needed, and it works on any mesh. */
const MAX_DECALS = 8;
const decalU = {
  uDecalMap: { value: null },
  uDecalInv: { value: Array.from({ length: MAX_DECALS }, () => new THREE.Matrix4()) },
  uDecalDir: { value: Array.from({ length: MAX_DECALS }, () => new THREE.Vector3()) },
  uDecalRect: { value: Array.from({ length: MAX_DECALS }, () => new THREE.Vector4()) },
  uDecalCount: { value: 0 },
};
paint.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, decalU);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDecalPos;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvDecalPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vDecalPos;
      uniform sampler2D uDecalMap; uniform int uDecalCount;
      uniform mat4 uDecalInv[${MAX_DECALS}]; uniform vec3 uDecalDir[${MAX_DECALS}]; uniform vec4 uDecalRect[${MAX_DECALS}];`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);           // view-space normal -> world
        for (int i = 0; i < ${MAX_DECALS}; i++) {
          if (i >= uDecalCount) break;
          vec3 p = (uDecalInv[i] * vec4(vDecalPos, 1.0)).xyz;                 // position inside the decal box
          if (any(greaterThan(abs(p), vec3(0.5)))) continue;
          float facing = smoothstep(0.15, 0.4, dot(nW, uDecalDir[i]));         // only surfaces facing the projector
          vec4 r = uDecalRect[i];
          vec4 d = texture2D(uDecalMap, r.xy + (p.xy + 0.5) * r.zw);
          diffuseColor.rgb = mix(diffuseColor.rgb, d.rgb, d.a * facing * 0.92);
        }
      }`);
};
const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1520, metalness: 0.2, roughness: 0.04, clearcoat: 1, envMapIntensity: 2 });

// Heat glow: an additive fresnel shell drawn over the airframe, brightest on edges facing away from you.
const heatU = { uHeat: { value: 0 } };
const heatMat = new THREE.ShaderMaterial({
  uniforms: heatU, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uHeat; varying vec3 vN; varying vec3 vV;
    void main(){
      if (dot(vN, vN) < 1e-10) discard;   // no usable normal: draw nothing rather than a NaN pixel (bloom would smear it)
      float f = pow(1. - abs(dot(normalize(vN), vV)), 3.2);
      vec3 c = mix(vec3(.9,.18,.03), vec3(1.,.55,.25), f) * f * uHeat * 0.9; gl_FragColor = vec4(c, 1.); }`,
});

// Afterburner: two cones (outer orange, inner hot core) + shock diamonds, per engine.
const flameU = { uI: { value: 0 }, uT: { value: 0 }, uGreen: { value: 0 } };
function flameMat(inner) {
  return new THREE.ShaderMaterial({
    uniforms: { ...flameU, uInner: { value: inner ? 1 : 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying float vT; uniform float uT;
      void main(){ vT = .5 - position.y / .16; vec3 p = position; p.xz *= 1. + .06 * sin(uT * 40. + position.y * 90.);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.); }`,
    fragmentShader: `uniform float uI, uInner, uGreen, uT; varying float vT;
      void main(){ float a = pow(clamp(vT,0.,1.), uInner > .5 ? 2.5 : 1.4) * uI;
        vec3 outer = mix(vec3(1.,.32,.08), vec3(1.,.62,.3), vT);
        vec3 core  = vec3(.75,.85,1.);
        vec3 c = mix(outer, core, uInner);
        c = mix(c, vec3(.35,1.,.45), uGreen);                       // triethylborane ignition flash
        gl_FragColor = vec4(c * a * (uInner > .5 ? 1.15 : .6) * (.9 + .1 * sin(uT * 60.)), 1.); }`,
  });
}
const diamondTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,190,120,.6)'], [1, 'rgba(255,120,40,0)']]);
const flames = [], diamonds = [];
const flameLight = new THREE.PointLight(0xff7a30, 0, 30, 1.6);
model.add(flameLight);
flameLight.position.set(0, -0.47, -0.0067);
for (const x of [-0.106, 0.106]) {
  const g = new THREE.Group();
  g.position.set(x, -0.423, -0.0067);
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.0135, 0.16, 32, 1, true), flameMat(false));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.16, 24, 1, true), flameMat(true));
  for (const m of [outer, inner]) { m.rotation.x = Math.PI; m.position.y = -0.08; g.add(m); } // tip points backwards (-Y)
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: diamondTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.position.y = -0.022 - i * 0.024; s.scale.setScalar(0.016 - i * 0.002); g.add(s); diamonds.push(s);
  }
  model.add(g); flames.push(g);
}

// Post-processing: bloom makes flames, limb and heat glow bleed like a camera lens.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ----------------------------------------------------------------- 2. KEYS */
// Every field the story can animate, with its default. Each key below overrides some of them.
const DEFAULT = {
  cam: [8, 2, 10], look: [0, 0, 0], fov: 32,     // camera position, what it looks at, lens
  yaw: 0, pitch: 0, roll: 0, jy: 0, jz: 0,      // jet attitude and position (pitch < 0 = nose up)
  sky: 0, floor: 1, runway: 0, speed: 0, stars: 0,
  env: 1, key: 2, rim: 2, exposure: 1, bloom: 0.35,
  flame: 0, green: 0, heat: 0, shake: 0,
  shift: 0,                                     // slide the jet sideways in frame, away from the text (-1..1)
};
// Each key inherits everything from the key before it, so it only lists what changes.
// `look` may name an anchor; `cam` is then an offset from that anchor.
// `shift` slides the jet across the frame: + moves it right (text on the left), - moves it left.
const KEYS = {
  intro:    { cam: [8.5, 2.0, 10.5], look: [0, -0.3, 0.6], env: 0.15, key: 0, rim: 2.2, shift: 0.22 },
  titanium: { cam: [-9.5, 3.4, -6.5], look: [0, -0.2, 0], env: 1, key: 2.2, rim: 2, shift: -0.2 },
  spike:    { look: 'spike', cam: [-3.4, 1.1, 3.2], fov: 30, rim: 1.2, bloom: 0.25, shift: 0.22 },
  chine:    { look: 'chine', cam: [-2.6, 2.8, 3.6], shift: -0.22 },
  cockpit:  { look: 'cockpit', cam: [2.6, 1.5, 2.6], shift: 0.22 },
  fins:     { look: 'fins', cam: [4.2, 2.4, -3.2], fov: 32, shift: -0.22 },
  engines:  { look: 'nozzle', cam: [3.0, 0.4, -4.6], fov: 34, rim: 2.6, key: 1.6, env: 2.4, bloom: 0.25, shift: 0.22 },
  ignite:   { between: ['engines', 'takeoff', 0.35], look: [0, 0.2, -2], cam: [-4.5, 0.6, -12], fov: 38, flame: 0.7, green: 1, bloom: 0.9, sky: 0.6, floor: 0.2, runway: 0.7, speed: 0.15, env: 0.8, key: 0.8, shift: 0 },
  takeoff:  { look: [0, 0.7, 2], cam: [-5, 0.3, -15.5], fov: 42, sky: 1, floor: 0, runway: 1, speed: 1, flame: 1, green: 0, jy: 1.0, pitch: -0.13, env: 0.7, key: 0.9, rim: 2.5, bloom: 0.9, shake: 1, shift: -0.15 },
  climb:    { look: [0, 0.6, 1.5], cam: [9, -3.8, -11], fov: 36, sky: 1.65, runway: 0, speed: 0, stars: 0.35, pitch: -0.32, roll: 0.18, env: 0.6, key: 1.2, bloom: 0.8, shake: 0.4, shift: 0.1 },
  mach3:    { look: [0, 0.6, 0.5], cam: [19, -1.5, 5.5], fov: 30, sky: 2, stars: 1, flame: 0.75, heat: 0.8, pitch: 0, roll: 0, env: 0.6, key: 1.6, rim: 3, bloom: 0.8, shake: 0.15, shift: -0.5 },
  records:  { look: [0, 0, 0], cam: [-9, 20, -20], fov: 34, heat: 0.7, roll: -0.08, shift: 0.42 },
  outro:    { look: [0, 0.5, 30], cam: [2.5, 2.2, -54], fov: 30, flame: 1, heat: 0.6, jz: 130, jy: 3, pitch: -0.05, bloom: 0.9, shift: 0 },
};

// Camera moves are stored as an orbit around `look` (radius, azimuth, elevation) so that tweening
// between two keys swings the camera around the jet instead of cutting straight through it.
function toOrbit(off) {
  const r = off.length();
  return { r, az: Math.atan2(off.x, off.z), el: Math.asin(off.y / r) };
}
function resolveKey(name, prevAz, inherited) {
  const k = { ...inherited, ...KEYS[name] };
  const look = typeof k.look === 'string'
    ? anchors[k.look].getWorldPosition(new THREE.Vector3())
    : new THREE.Vector3(...k.look);
  const camPos = typeof k.look === 'string' ? look.clone().add(new THREE.Vector3(...k.cam)) : new THREE.Vector3(...k.cam);
  const o = toOrbit(camPos.clone().sub(look));
  if (prevAz !== undefined) while (o.az - prevAz > Math.PI) o.az -= 2 * Math.PI; // take the short way round
  if (prevAz !== undefined) while (prevAz - o.az > Math.PI) o.az += 2 * Math.PI;
  const out = { lx: look.x, ly: look.y, lz: look.z, r: o.r, az: o.az, el: o.el };
  for (const f in DEFAULT) if (f !== 'cam' && f !== 'look') out[f] = k[f];
  return { out, merged: k };
}

/* --------------------------------------------------------------- 3. SCROLL */
gsap.registerPlugin(ScrollTrigger);
const lenis = reduceMotion ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
if (lenis) {
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(t => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

const story = document.getElementById('story');
const sections = [...story.querySelectorAll('section[data-key]')];
const state = {};
let master;

// Scroll progress (0..1 over the whole story) at which a section sits centred on screen.
function centredProgress(sec) {
  const span = story.offsetHeight - innerHeight;
  return clamp01((sec.offsetTop + sec.offsetHeight / 2 - innerHeight / 2) / span);
}

function buildTimeline() {
  master?.scrollTrigger?.kill(); master?.kill();
  // 1. where each key lands on the scroll
  const stops = sections.map(sec => ({ name: sec.dataset.key, p: centredProgress(sec) }));
  stops[0].p = 0;
  for (const [name, k] of Object.entries(KEYS)) if (k.between) {
    const [a, b, f] = k.between, pa = stops.find(s => s.name === a).p, pb = stops.find(s => s.name === b).p;
    stops.push({ name, p: lerp(pa, pb, f) });
  }
  stops.sort((a, b) => a.p - b.p);
  // 2. resolve each key into plain numbers, then tween state from one to the next
  let prevAz, inherited = DEFAULT;
  const resolved = stops.map(s => {
    const { out, merged } = resolveKey(s.name, prevAz, inherited);
    prevAz = out.az; inherited = merged;
    return { ...s, r: out };
  });
  Object.assign(state, resolved[0].r);
  master = gsap.timeline({ scrollTrigger: { trigger: story, start: 'top top', end: 'bottom bottom', scrub: reduceMotion ? true : 0.8 } });
  for (let i = 1; i < resolved.length; i++) {
    const a = resolved[i - 1], b = resolved[i];
    master.to(state, { ...b.r, duration: Math.max(0.0001, b.p - a.p), ease: 'sine.inOut' }, a.p);
  }
  master.to({}, { duration: Math.max(0.0001, 1 - resolved.at(-1).p) }, resolved.at(-1).p); // pad to exactly 1
}

// Text reveals, the 3D callout marker, chapter rail and record counters.
const marker = document.getElementById('marker'), markerLabel = marker.querySelector('b');
let markerAnchor = null;
const rail = document.getElementById('rail');
function setupOverlays() {
  sections.forEach((sec, i) => {
    const copy = sec.querySelector('.copy');
    const dot = document.createElement('a');
    dot.href = '#'; dot.setAttribute('aria-label', 'Chapter ' + (i + 1) + ': ' + (sec.querySelector('h1,h2')?.textContent || ''));
    dot.addEventListener('click', e => {
      e.preventDefault();
      const y = sec.offsetTop + sec.offsetHeight / 2 - innerHeight / 2;
      lenis ? lenis.scrollTo(y, { duration: 1.8 }) : scrollTo(0, y);
    });
    rail.append(dot);
    ScrollTrigger.create({
      trigger: sec, start: 'top 62%', end: 'bottom 38%',
      onToggle: self => {
        copy.classList.toggle('on', self.isActive || i === 0 && self.progress < 0.5);
        dot.classList.toggle('on', self.isActive);
        if (sec.dataset.anchor) {
          if (self.isActive) { markerAnchor = anchors[sec.dataset.anchor]; markerLabel.textContent = sec.dataset.label; }
          else if (markerAnchor === anchors[sec.dataset.anchor]) markerAnchor = null;
        }
      },
    });
  });
  sections[0].querySelector('.copy').classList.add('on');
  document.querySelectorAll('[data-count]').forEach(el => {
    const small = el.querySelector('small').outerHTML, target = +el.dataset.count, dec = +el.dataset.dec, o = { v: 0 };
    const show = () => { el.innerHTML = o.v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + small; };
    ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => gsap.to(o, { v: target, duration: reduceMotion ? 0 : 2.2, ease: 'power2.out', onUpdate: show }) });
  });
}

/* --------------------------------------------------------------- 4. RENDER */
const look = new THREE.Vector3(), tmp = new THREE.Vector3();
const cA = new THREE.Color(), cB = new THREE.Color();
let floorY = 0, last = performance.now();
function mixSky(t) {
  const i = Math.min(1, Math.floor(t)), f = t - i, a = SKIES[i], b = SKIES[i + 1];
  skyU.uZ.value.copy(a.z).lerp(b.z, f); skyU.uH.value.copy(a.h).lerp(b.h, f); skyU.uG.value.copy(a.g).lerp(b.g, f);
  skyU.uLimb.value = lerp(a.limb, b.limb, f); skyU.uSpot.value = lerp(a.spot, b.spot, f);
}
function render() {
  const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000), t = now / 1000; last = now;
  const s = state;

  // jet: attitude from the story, plus a gentle bob once airborne
  const air = clamp01(s.sky - 0.5);
  jet.position.set(0, s.jy + Math.sin(t * 0.9) * 0.06 * air, s.jz);
  jet.rotation.set(s.pitch + Math.sin(t * 0.7) * 0.01 * air, s.yaw, s.roll + Math.sin(t * 0.5) * 0.02 * air, 'YXZ');

  // camera: orbit around the look point, with a little handheld shake
  look.set(s.lx, s.ly, s.lz);
  const shake = reduceMotion ? 0 : s.shake * 0.05;
  camera.position.set(
    look.x + s.r * Math.cos(s.el) * Math.sin(s.az) + Math.sin(t * 23) * shake,
    look.y + s.r * Math.sin(s.el) + Math.sin(t * 31 + 1) * shake,
    look.z + s.r * Math.cos(s.el) * Math.cos(s.az));
  camera.lookAt(look);
  const aspect = innerWidth / innerHeight;
  const fov = aspect < 1 ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(s.fov) / 2) * Math.min(1.9, 0.9 / aspect))) : s.fov;
  camera.fov = fov;
  const W = innerWidth, H = innerHeight, narrow = W < 700;
  camera.setViewOffset(W, H, narrow ? 0 : -s.shift * W * 0.5, narrow ? H * 0.16 : 0, W, H); // on phones the text sits low, so lift the jet
  camera.updateProjectionMatrix();

  // environment
  mixSky(s.sky);
  sky.position.copy(camera.position); stars.position.copy(camera.position);
  stars.material.opacity = s.stars;
  floor.material.opacity = s.floor; shadow.material.opacity = s.floor;
  floor.visible = shadow.visible = s.floor > 0.01;
  floor.position.y = floorY; shadow.position.y = floorY + 0.01;
  runway.visible = s.runway > 0.01;
  runway.position.y = floorY - 1.0;
  asphalt.material.opacity = edgeLights.material.opacity = dashes.material.opacity = s.runway;
  if (runway.visible) updateRunway(dt, s.speed);

  // lighting
  scene.environmentIntensity = s.env;
  keyLight.intensity = s.key; rimA.intensity = s.rim; rimB.intensity = s.rim * 0.6;
  renderer.toneMappingExposure = s.exposure;
  bloom.strength = s.bloom;

  // engines and heat
  flameU.uI.value = s.flame; flameU.uT.value = t; flameU.uGreen.value = s.green;
  for (const f of flames) f.scale.set(1, 0.55 + 0.6 * s.flame + Math.sin(t * 30) * 0.03, 1);
  diamonds.forEach((d, i) => { d.material.opacity = clamp01(s.flame * 1.4 - 0.4) * (0.7 + 0.3 * Math.sin(t * 50 + i)); });
  flameLight.intensity = s.flame * 6;
  heatU.uHeat.value = s.heat;
  updateDecals();

  // callout marker follows its 3D anchor
  if (markerAnchor) {
    markerAnchor.getWorldPosition(tmp).project(camera);
    marker.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px)`;
  }
  marker.classList.toggle('on', !!markerAnchor);

  composer.render();
}

/* ----------------------------------------------------------------- 5. LOAD */
const bar = document.getElementById('bar');
// The model ships as base64 inside a JSON file (the page host serves .json but not .glb).
// Locally you can skip that step and load 'assets/sr71.glb' with GLTFLoader().load(...) directly.
async function fetchModel(url) {
  const res = await fetch(url);
  const total = +res.headers.get('content-length') || 7.0e6, reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length;
    bar.style.setProperty('--p', Math.min(100, got / total * 100).toFixed(0) + '%');
  }
  const b64 = JSON.parse(await new Blob(chunks).text())[0];
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}
fetchModel('assets/sr71.json').then(buf => new GLTFLoader().parse(buf, '', onModel, onFail)).catch(onFail);
function onFail(err) { document.querySelector('#loader div').textContent = 'The model could not load: ' + (err?.message || err); }
async function onModel(gltf) {
  const root = gltf.scene;
  // One node per part: body, rudder_l/r, canopy_front/rear (frames), plus the repair patches
  // body_patch, gear_doors and canopy_glass. Only canopy_glass gets the glass material.
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  meshes.forEach(o => {
    let p = o; while (p.parent && p.parent !== root) p = p.parent;
    const part = p.name || o.name;
    o.material = part === 'canopy_glass' ? glass : paint;
    if (part !== 'canopy_glass') o.add(new THREE.Mesh(o.geometry, heatMat));
  });
  model.add(root);

  // centre the model and scale it to 10 units nose-to-tail
  const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  model.position.copy(c).negate();
  upright.scale.setScalar(10 / size.y);
  jet.updateMatrixWorld(true);
  floorY = new THREE.Box3().setFromObject(root).min.y - 0.35;

  await buildDecals(meshes.filter(m => m.material === paint));
  buildTimeline();
  setupOverlays();
  gsap.ticker.add(render);
  document.getElementById('loader').classList.add('done');
  // handy for debugging in the browser console: goTo('mach3')
  window.goTo = key => { const sec = sections.find(s => s.dataset.key === key); const y = sec.offsetTop + sec.offsetHeight / 2 - innerHeight / 2; lenis ? lenis.scrollTo(y, { immediate: true }) : scrollTo(0, y); };
  window.ready = true;
}

/* ---------------------------------------------------------------- 6. DECALS */
// Markings, drawn fresh on a canvas (no copied artwork). Regions are in atlas UV space: [x, y, w, h].
const ATLAS = 2048;
const REGIONS = { usaf: [0, 0, 1, 0.125], insignia: [0, 0.125, 0.5, 0.25], number: [0.5, 0.125, 0.5, 0.125], walkway: [0, 0.375, 0.5, 0.625] };
async function drawAtlas() {
  try { await document.fonts.load('700 200px "Barlow Condensed"'); } catch {}
  const c = document.createElement('canvas'); c.width = c.height = ATLAS;
  const g = c.getContext('2d');
  const box = k => { const [x, y, w, h] = REGIONS[k]; return [x * ATLAS, (1 - y - h) * ATLAS, w * ATLAS, h * ATLAS]; }; // canvas y runs down
  const ink = '#dcdcd6';
  // "U.S. AIR FORCE"
  { const [x, y, w, h] = box('usaf'); g.fillStyle = ink; g.font = `700 ${h * 0.78}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('U.S. AIR FORCE', x + w / 2, y + h / 2 + h * 0.04); }
  // tail number
  { const [x, y, w, h] = box('number'); g.fillStyle = ink; g.font = `700 ${h * 0.82}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('17972', x + w / 2, y + h / 2 + h * 0.04); }
  // national insignia: star in a disc, bars with a red stripe, blue outline
  { const [x, y, w, h] = box('insignia'); const cx = x + w / 2, cy = y + h / 2, R = h * 0.42;
    const blue = '#2a3a6e', white = '#e2e2dc', red = '#a3262c';
    const bar = (pad) => { g.fillRect(cx - R * 2.05 - pad, cy - R * 0.33 - pad, R * 4.1 + pad * 2, R * 0.66 + pad * 2); };
    g.fillStyle = blue; bar(R * 0.1); g.beginPath(); g.arc(cx, cy, R + R * 0.1, 0, 7); g.fill();
    g.fillStyle = white; bar(0); g.fillStyle = red; g.fillRect(cx - R * 2.05, cy - R * 0.1, R * 4.1, R * 0.2);
    g.fillStyle = blue; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    g.fillStyle = white; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.38 : R; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    g.fill(); }
  // walkway: thin red outline (the "safe to step" area on top of the fuselage)
  { const [x, y, w, h] = box('walkway'); g.strokeStyle = '#b3242a'; g.lineWidth = w * 0.025;
    const m = g.lineWidth; g.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Where each decal goes, in world units with the jet at rest (nose +Z, up +Y, 10 units long).
// `from` is the projector position, `to` a point it aims through; the decal is centred where that ray hits the skin.
const DECALS = [
  { k: 'usaf', from: [ 5, 4, 1.3], to: [0, -0.3, 1.3], size: [2.1, 0.27] },
  { k: 'usaf', from: [-5, 4, 1.3], to: [0, -0.3, 1.3], size: [2.1, 0.27] },
  { k: 'insignia', from: [ 5, 4, -0.5], to: [0, -0.3, -0.5], size: [0.8, 0.4] },
  { k: 'insignia', from: [-5, 4, -0.5], to: [0, -0.3, -0.5], size: [0.8, 0.4] },
  { k: 'number', from: [ 6, 0.4, -3.55], to: [0, 0.4, -3.55], size: [0.9, 0.22] },
  { k: 'number', from: [-6, 0.4, -3.55], to: [0, 0.4, -3.55], size: [0.9, 0.22] },
  { k: 'walkway', from: [0, 6, -1.1], to: [0, -0.3, -1.1], size: [0.34, 2.8], up: [0, 0, 1] },
];
const decals = [];
async function buildDecals(targets) {
  decalU.uDecalMap.value = await drawAtlas();
  const rc = new THREE.Raycaster(), m = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  jet.updateMatrixWorld(true);
  for (const d of DECALS) {
    const from = new THREE.Vector3(...d.from), dir = new THREE.Vector3(...d.to).sub(from).normalize();
    rc.set(from, dir);
    const hit = rc.intersectObjects(targets, false)[0];
    if (!hit) { console.warn('decal missed', d.k); continue; }
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); // lie flat on the surface it lands on
    if (n.dot(dir) > 0) n.negate();
    const up = new THREE.Vector3(...(d.up || [0, 1, 0]));
    const x = new THREE.Vector3().crossVectors(up, n).normalize(), y = new THREE.Vector3().crossVectors(n, x);
    m.makeBasis(x, y, n).setPosition(hit.point).scale(new THREE.Vector3(d.size[0], d.size[1], 0.5));
    const o = new THREE.Object3D();
    o.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m));    // store relative to the model so it flies with the jet
    model.add(o);
    decals.push({ o, rect: REGIONS[d.k] });
  }
  decalU.uDecalCount.value = decals.length;
}
const zAxis = new THREE.Vector3();
function updateDecals() {
  decals.forEach((d, i) => {
    decalU.uDecalInv.value[i].copy(d.o.matrixWorld).invert();
    decalU.uDecalDir.value[i].setFromMatrixColumn(d.o.matrixWorld, 2).normalize();
    decalU.uDecalRect.value[i].set(...d.rect);
  });
}

let resizeTimer;
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (master) { buildTimeline(); ScrollTrigger.refresh(); } }, 200);
});
