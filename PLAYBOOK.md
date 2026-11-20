# Aircraft scroll-site playbook

How the SR-71 Blackbird site was built, every problem we hit and how it was fixed, and how to start the next
aircraft (Concorde, F-22, anything) from this repo in one prompt. Written at the end of the first build so the next
one starts from a working base, not from zero.

- Live site: https://marcgoveiawork-bit.github.io/sr71-blackbird/
- Repo (the template): https://github.com/marcgoveiawork-bit/sr71-blackbird

---

## 1. Start the next project with this prompt

Create an empty GitHub repo first (e.g. `concorde`), make sure the Claude GitHub App can see it (step 9 below),
then paste this, editing the parts in brackets:

```text
New aircraft scroll site, built from my SR-71 template.

Template: marcgoveiawork-bit/sr71-blackbird. Attach it (read access) and read PLAYBOOK.md first.
It documents the architecture, the problems we already solved, and where every theme value lives.
Copy the template into my new repo marcgoveiawork-bit/[concorde], keep the same structure, fonts and features,
and reach a working first version before asking me anything optional.

Aircraft: [Aérospatiale/BAC Concorde]
3D model: [I'll upload a .glb / use Sketchfab model URL + licence / use my Onshape export]
Theme: studio [deep blue #0a1a33, not black], text [white], accent [white or light blue #8fc8ff]
  (accent = chapter dots, markers, kickers, units, loader ring, poster rule)
Poster opening: top line [CONCORDE], bottom line [MACH 2], bars [ENGINES / SPEED],
  specs [OLYMPUS 593 / MACH 2.04]
Chapters: same order as the SR-71 (walkaround, blueprint, 5-stop exterior tour, takeoff, cost, climb,
  cruise, records, outro, closing poster), with facts for this aircraft. Verify every fact with a
  web search and tell me which figures were disputed.
Engine effects: [afterburner reheat, no green flash] / [none]
Loader: the spinning engine face, recoloured to the accent.
Credit line: "Designed by Marc Pio Goveia."
When ready: push to main, tell me to enable GitHub Pages, and update a claude.ai preview.
```

Things to have ready before that prompt, so the first reply can be a working site:
- The model file (see section 6 for export settings), or the Sketchfab link plus its licence text.
- The theme colours, or "you pick from the aircraft's livery".
- Any reference images for the opening poster, blueprint scene or finale poster.

---

## 2. What the finished site is

Two files do everything: `index.html` (styles, chapter text, loader) and `main.js` (three.js scene + scroll engine).
No build step; libraries load from jsDelivr: three.js 0.187.0 and Lenis 1.3.27. GSAP was used at first and later removed.

| # | Piece | What it does |
|---|---|---|
| 1 | **J58 loader** | SVG engine face; 22 blades spin up with load progress; red ring + % counter; "Ready" then the page zooms through the inlet. Stays up until model, textures and all shaders are compiled (`warmUp()`), so nothing blinks mid-scroll. |
| 2 | **Poster opening** | Giant type (Anton) drawn on a canvas and laid on the studio floor. Camera top-down. First scroll: the jet taxis up from below onto the type, casting a real shadow from a low raking key light. |
| 3 | **Chapters** | One `<section data-key>` per chapter. Copy alternates left/right; the camera frames the jet away from the text with `shift`. |
| 4 | **Pinned chapters** | `.chap.pin`: text holds still (CSS `position: sticky`) while the scene keeps moving (blueprint slides away, engines light, jet lifts off). Keys placed inside them with `at: [section, from, to]`. |
| 5 | **Exterior tour** | 5 stops, each with a red ring marker pinned to a 3D point on the jet. |
| 6 | **Blueprint scene** | White linework extracted from a blueprint scan, pinned to the camera, fitted whole on screen, then slides up and away. |
| 7 | **Takeoff + cost** | Green TEB flash under "Lit by a green flash"; flame turns orange exactly as "The price of speed" takes over; side-on lift-off while the gear retracts. |
| 8 | **Flight** | Pitch-black void, white speed streaks around the camera, fresnel heat glow at Mach 3. |
| 9 | **Records** | Counters animate up every time the chapter comes back. |
| 10 | **Finale poster** | Jet flies away and vanishes; poster type (Exo 2 italic + Great Vibes) scrolls up and pins; jet flies in from the left into the gap. Credits live inside the poster so the final frame never moves. |
| 11 | **Navigation** | Red chapter dots on the right, plus an extra end dot that only lights when the jet is in place on the final poster; "Keep scrolling" cue until then. |
| 12 | **Auto-play tour** | Button next to "Scroll to begin". Pauses only where text is on screen, rolls through the finale like end credits, then a 10 s "Replaying in… / Stay on this page" countdown that loops (motion wallpaper). |
| 13 | **Full screen** | Corner toggle + "Full-screen tour" (full screen + auto-play in one click). Brief fade while the page re-measures. Hidden where unsupported (iPhone Safari). |

Everything is a function of scroll position, so scrolling up plays it all back in reverse.

### How `main.js` is organised

1. **SCENE**: renderer, studio environment map, lights, floor + shadows, poster plane, blueprint plane (child of
   the camera), speed streaks, the jet (`jet` group, `model` inside it), anchors, heat shell, flames, gear legs, bloom.
2. **KEYS**: `DEFAULT` lists every animatable field; `KEYS` has one entry per chapter, and each key **inherits from
   the previous one**, so it only lists what changes. Camera is stored as an orbit (radius, azimuth, elevation)
   around `look`, so blends swing around the jet instead of cutting through it.
3. **SCROLL**: `layout()` measures every section on the live page and turns keys into scroll ranges ("holds").
   `sample(scrollY)` blends the two nearest keys every frame. State eases toward the target with **time-based** easing.
4. **RENDER**: applies state: jet attitude, gear, camera (+ the "stay above the jet when gear is up" safety net),
   view offset (`shift`/`lift`), floor, poster, blueprint, streaks, lights, flames, heat, markers.
5. **LOAD**: model fetched as base64 JSON, materials upgraded, gear grouped, poster drawn, blueprint loaded, `warmUp()`.
6. **AUTO-PLAY / LOOP / FULL SCREEN**: route planning from the holds, countdown, fade, re-planning on resize.

Key fields worth knowing: `look`/`cam` (anchor name + offset allowed), `fov`, `jy`/`jz`/`pitch`/`roll`, `gear`
(1 = down), `floor`, `poster`, `bp`/`bpY`, `flame`, `green`, `heat`, `speed` (streaks), `shift` (slide the jet
away from the text, desktop), `lift` (phones: lift the picture above the text), `pz` (phones: pull the camera back),
`low` (low raking key light), `vis` (hide the jet while repositioning it), `env`/`key`/`rim`/`bloom`.

Key placement: `at: ['section', f0, f1]` (0 = section top at window top, 1 = section bottom at window bottom;
negatives and >1 allowed), `between: ['keyA', 'keyB', f]`, or nothing (centre of its own section).
A section with no `KEYS` entry adds no stop of its own (the cost chapter works this way).

---

## 3. How we got here (build timeline)

1. **Concept**: chose a real aircraft (SR-71) over a fictional brand; stack three.js + scroll; one continuous camera take.
2. **Your Onshape model**: exported as glTF. Merged and compressed 78 MB → 5 MB; first site with hangar, dusk runway,
   stratosphere sky, Earth limb, stars.
3. **Repairing the Onshape model**: canopy glass, gear-bay doors, a missing nacelle panel, crack-proof paint;
   markings added as projected decals.
4. **Switched to the Sketchfab model** (manilov.ap, CC BY 4.0) for its painted markings and landing gear; rebuilt the
   scroll engine to fix text/scene drift.
5. **All-black studio**: removed runway and sky; added the poster opening (your reference poster), the blueprint
   scene, speed streaks, gear retraction, camera-above rule.
6. **Polish**: pitch black, red accent, pinned blueprint, closing poster finale, J58 loader, end dot, scroll hint.
7. **Takeoff**: pinned chapter, green flash on cue, side-on retraction; then split into green flash + cost.
8. **GitHub**: repo + Pages; auto-play, replay loop, full screen; the "vanishing jet after resize" fix.

The earlier Onshape version is kept in `versions/onshape/`.

---

## 4. Problems we hit and how they were fixed

### Getting the model in

| Problem | Cause | Fix |
|---|---|---|
| Export choice | Onshape offers STEP/Parasolid/IGES (CAD, browsers can't read). | Export **glTF**, *Y axis up* ticked. STL loses parts and materials. |
| 78 MB file at "Fine" | GitHub web upload limit is 25 MB. | Re-export at Medium or zip; later compress with gltf-transform (weld, simplify, quantize). |
| Landing gear parts all at the origin | "Export unique parts as individual files" was ticked: positions are dropped, duplicates collapsed. | **Untick it.** One file keeps everything assembled. |
| Model up-axis / nose direction | Onshape: up = −Z, nose = +Y. Sketchfab: wrapper node with a display rotation, nose −Z. | Normalise in code: jet 10 units long, nose +Z, up +Y. For Sketchfab, reset the wrapper matrix, rotate −90° on X and 180° on Y. |
| `.glb` / `.bin` / `.png` refused by the claude.ai page host | The host only serves certain extensions. | Ship binary files as **base64 inside `.json`**, decode in the browser. Works on GitHub Pages too. |
| Meshopt compression | Needs WebAssembly, which the artifact CSP may block. | Skip meshopt; quantize only (KHR_mesh_quantization is native in three.js). |

### Repairing a CAD model (Onshape version)

| Problem | Cause | Fix (`tools/`) |
|---|---|---|
| See-through cockpit | Canopy parts were frames only, no glass. | Raycast the skin, fit a **Coons patch** over the opening, add a slightly domed glass mesh. |
| Open gear bays underneath | Doors missing in the export. | Same Coons-patch method: flush cover plates. |
| Missing panel on the left nacelle | One face absent on one side only. | Mirror check: faces whose mirror image is far from the surface on the other side → copy and mirror them. |
| Patch indices changed between runs | trimesh "processes" (merges/drops) faces on load. | Load with `process=False` everywhere. |
| Patches black from below | Wrong triangle winding. | Flip winding by side. |
| Hairline cracks and vent slots showing sky | Separate CAD surface patches don't share edges. | Paint material `side: DoubleSide`: cracks show the dark interior. |
| Markings | No textures on a CAD model. | **Projected decals** in the paint shader (canvas texture atlas; box projectors aimed by raycasts, aligned to the surface normal). Aiming horizontally missed: the forward fuselage is mostly the sloped chine top, so aim from above-side. |

### Look and lighting

| Problem | Cause | Fix |
|---|---|---|
| Black paint looked silver/chrome | RoomEnvironment reflections far too bright. | **Custom dark studio env map**: black sphere + 4 softbox strips, baked with PMREM. |
| White blow-outs | Bloom threshold too low. | Threshold 0.92, low default strength; raise only for flames. |
| Poster type glowing | Emissive white + bloom. | Bloom 0 on poster keys; emissive 0.32 so the shadow still reads. |
| Jet's shadow invisible on the poster type | High key light: shadow lands right under the jet. | `low` field: raking key light for the opening keys. |
| Grey "black" background | Sky dome gradient. | `scene.background` pure black; floor black; body `#000`. |
| Low-poly runway / sky with hard edges | Ground plane ended; colour bands. | Dropped them: everything happens in the black studio. |
| Streaks forming a visible square in the distance | Fixed box of streaks around the jet. | Field wraps around the **camera** and fades with distance (per-instance colour). |

### Scroll engine and timing

| Problem | Cause | Fix |
|---|---|---|
| Text and scene out of step; black frames; engine text over the runway | GSAP timeline built once at load; fonts / mobile toolbars changed the layout later. | Replaced with **live layout**: measure sections, sample every frame, re-measure on resize / font load / ResizeObserver. |
| Old floor reappearing in later scenes | Keys fell back to `DEFAULT` values. | **Keys inherit from the previous key.** |
| Jet behind the text | Centred framing. | `camera.setViewOffset` driven by `shift`; `lift` on phones. |
| Faded elements lingering on slow devices | Easing per frame, with frame time capped. | Time-based easing (`1 − e^(−dt·9)`), dt up to 0.25 s. |
| Hidden repositioning visible after fast scrolls | Jet position eased while hidden. | Snap `vis` and jet position fields when the jet is hidden. |
| A chapter's own stop blocking keys placed inside it | Every section created a key. | Sections without a `KEYS` entry add no stop. |
| **Jet vanished from the exterior tour (always in full screen)** | Anchored shots used the anchors' *world* position, measured whenever layout re-ran, e.g. with the jet parked off-screen at the start. | Read anchors in the jet's **resting pose** (`anchor.position`). Fade to black during screen-mode switches. |

### Story and UI details

| Problem | Fix |
|---|---|
| Gear-bay holes visible after retraction (no doors in the Sketchfab model) | Rule: camera stays above the jet once the gear is up, enforced by a safety net in render (`gear < 0.1`). |
| Gear poking through the top surface while retracting | Legs tip ~30° and **shrink toward the bay** instead of swinging 90°. Lift-off shot side-on, just below the wing line. |
| Blueprint half hidden | The invisible floor was in front of it → `floor: 0` in that scene. |
| Blueprint sliding back in while scrolling forward | Next key no longer resets `bpY`. |
| Text unreadable over the blueprint | Feathered, blurred, darkened backdrop (`backdrop-filter` + radial mask) on pinned copy. |
| Green flash happened before its text | Pinned takeoff chapter; flame turns orange exactly when the next chapter's text takes over. |
| Records counters ran once only | Re-run on every entry (cancel token). |
| Final poster looked like the end before the jet arrived | Extra end dot that lights only at the true end; "Keep scrolling" cue; jet arrives earlier. |
| Footer pushed the final poster up | Credits moved inside the pinned poster sheet. |
| Poster sheet only 440 px wide | Inherited `.copy{max-width}` → override for the finale. |
| Auto-play: nothing happened for ~5 s | First "leg" was the opening hold; tour now starts with a short ease-out move. |
| Auto-play: finale stuttered | Every invisible key was a stop. Route pauses only at text holds; finale is one continuous roll. |
| Countdown covered the credits | Moved to top-left (top-centre on phones). |
| Full screen changes the page size mid-tour | `retargetTour()` re-plans the route from the current position. |
| `legs` name clash (gear legs vs tour legs) | Tour route renamed `route`. |
| NaN pixels turned the whole canvas black | Exported patches had no normals → heat shader divided by zero → bloom smeared NaN. Export normals; shader discards zero normals. |

### Facts and licences

- Verify every figure with a web search; prefer official / encyclopaedic sources. Example: the "$50,000 per flight
  hour" figure didn't hold up; we used Cheney's **$85,000/h** and stated the higher fully loaded estimates as a range.
- Sketchfab CC BY 4.0: credit line with links in the page (done in the finale credits).
- Don't use manufacturer logos (Lockheed, Skunk Works). Keep "Not affiliated with…" in the credits.
- Blueprint scans are often copyrighted prints: check the source before sharing publicly.
- Write descriptions fresh; never copy poster or game text.

### Tooling notes (for Claude in the next session)

- The container can't run a local web server or reach `github.io`. Test with Playwright, serving files through
  `page.route()` and mapping jsDelivr URLs to local `node_modules` (`tools/screenshot.js`). Google Fonts don't load
  in tests: expect fallback fonts in screenshots.
- The first screenshot after load often catches the loader (it needs about 2 s plus a fade). Wait about 7 s first.
- The software renderer runs at a few FPS: allow 2.5–3.5 s after each jump before a screenshot.
- Headless full screen occasionally captures an all-black frame (HTML included). That's a capture glitch: re-sample
  that stretch densely before treating it as a bug.
- Check scroll engine changes with a sweep (30+ evenly spaced positions) and the auto-play test (click, sample,
  confirm the countdown and replay).

---

## 5. Style system to reuse

### Type

| Use | Font | Notes |
|---|---|---|
| Opening poster (on the 3D floor) | **Anton** 400 | Drawn on canvas, stretched to fill width; bars in the same font. |
| Closing poster titles | **Exo 2** 900 italic; subtitle 800 italic | `white-space: nowrap`. |
| Closing poster script line | **Great Vibes** | e.g. "The Untouchable". |
| Headings, kickers, numbers, buttons | **Barlow Condensed** 500/700 | h2 34–56 px; kicker 15 px in accent colour. |
| Body | **Barlow** 400 | 17 px, line-height 1.6, max ~34em. |

### Layout conventions

- Fixed full-screen WebGL canvas behind; chapters scroll over it; copy max-width 440 px, alternating left/right.
- Sections 130vh (tall 170vh; pinned 200–260vh; finale 300vh).
- Phones (<700 px): text low, picture lifted (`lift`), wide shots pulled back (`pz`), corner buttons icon-only.
- Buttons are pills with a 1 px accent border and 44 px targets. Chapter dots on the right; markers are a ring with a ping.

### Where the theme lives (change these per aircraft)

| What | Where |
|---|---|
| Background, text, dim text, accent | `index.html` → `:root{--bg; --ink; --dim; --red}` (rename `--red` to `--accent`). |
| Accent in translucent borders/fills | `index.html` → search `rgba(211,36,46` (border/hover tints use the accent's RGB). |
| Loader ring colour | `index.html` → `<circle id="ring" … stroke="#d3242e">`. |
| 3D background | `main.js` → `scene.background`. For a coloured studio also tint the floor colour and the `studioEnvironment()` sphere. |
| Poster type colour | `main.js` → `drawPoster()` (`'#f2f2ee'` text, `'#000'` background, which must match the studio). |
| Blueprint line tint | `main.js` → `bpMat` colour `0xaab6c8`. |
| Streak colour | `main.js` → streaks material `0xcfd8e6`. |
| Flame colours / green flash | `main.js` → `flameMat()` shader (set `green` to 0 everywhere for aircraft without TEB). |
| Heat glow | `main.js` → `heatMat` shader colour; `heat` field per key. |

Example, Concorde: studio `--bg:#08162b`, `scene.background` `0x08162b`, floor `0x08162b`, `--ink:#ffffff`,
accent `#ffffff` or `#8fc8ff`, poster text white on `#08162b`, blueprint tint `0xd8e6ff`, flames: reheat orange
for takeoff only, no green, no heat glow (Mach 2 skin heat was ~127 °C at the nose).

---

## 6. Per-aircraft checklist

1. **Model**
   - Onshape: glTF, *Y up* ticked, *unique parts as individual files* **unticked**, Medium/Fine. Name parts
     (`body`, `canopy_glass`, `gear_nose`, …).
   - Sketchfab: GLB with 2k textures; copy the licence + credit line.
   - Gear: decide whether it's modelled with doors. No doors → keep the camera-above rule.
2. **Normalise**: find nose direction and up axis (render top/side/front once), length 10 units, centre.
3. **Anchors** (`ANCHORS`, jet units): 5 tour points; each tour key's camera sits on the same side as its anchor.
4. **Gear** (`GEAR`): list part names per leg (inspect node names + bounding boxes).
5. **Engines**: nozzle positions → flame groups (`for (const x of [...])`), `FLAME_LEN`, cone radii.
6. **Poster texts** in `drawPoster()`; finale texts in `index.html`.
7. **Facts**: verify every number; flag disputed ones.
8. **Keys**: adjust `cam`/`look`/`shift` per chapter; run the 30-position sweep and the phone checks.
9. **GitHub**:
   - Create an empty repo.
   - Give the Claude GitHub App access to it: github.com/apps/claude/installations/select_target → your account →
     Repository access → add the repo. Reconnecting your account alone isn't enough.
   - Push to `main`, then Settings → Pages → Deploy from branch `main` / root.
   - Each project gets its own address (`…github.io/<repo>/`); they don't affect each other.
