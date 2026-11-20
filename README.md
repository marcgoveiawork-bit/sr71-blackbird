# SR-71 Blackbird: a scroll-driven 3D story

A single-page, scroll-driven 3D website about the Lockheed SR-71 Blackbird, set in a pitch-black studio.
Designed by Marc Pio Goveia as a personal learning project in cinematic web design.

**Live site:** https://marcgoveiawork-bit.github.io/sr71-blackbird/ (open it on any phone or computer)

## The story

| Chapter | What happens |
|---|---|
| Loader | A J58 compressor face spins up with the loading progress, then the page "flies through" the inlet |
| Poster | Giant SR-71 / BLACKBIRD type on the studio floor; the jet taxis onto it, top-down, casting a real shadow |
| Titanium | Walkaround |
| Drawn by hand | Front view against white blueprint linework; the text pins while the sheet scrolls away |
| Exterior tour | Inlet spikes, chines, cockpit, canted fins, J58 nozzles, each with a red marker on the model |
| Takeoff | Pinned: green triethylborane ignition, orange afterburners, side-on lift-off as the gear retracts |
| Climb, Mach 3.2 | Black void, speed streaks, heat glow on the airframe |
| Records | Animated record figures |
| Gone, but never caught | The jet shrinks into the distance and disappears |
| Finale | Closing poster scrolls into place; the jet flies in from the left into the gap |

Everything is driven by scroll position, so scrolling back up plays it all in reverse.

## Run it locally

The page loads its files by relative path, so it needs a local web server (opening `index.html` directly won't work):

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## How it works (`main.js`)

1. **SCENE**: three.js stage: the jet, black studio, floor with real shadows, poster type (drawn on a canvas),
   blueprint backdrop pinned to the camera, afterburner shaders, heat-glow fresnel shell, speed streaks.
2. **KEYS**: one "camera + lighting state" per chapter (`KEYS` object). Each key inherits from the one before,
   so it only lists what changes. `look` can name an anchor on the jet; `at: [section, from, to]` places a key
   inside a pinned (sticky) section.
3. **SCROLL**: every frame, the page measures where each section is on screen and blends the two nearest keys.
   Because this is recomputed from the live layout, the 3D scene can't drift out of step with the text.
4. **RENDER**: applies the blended state (camera orbit, jet attitude, gear, flames, heat, lights) and renders with bloom.

Rules baked into the code:
- The Sketchfab model has no gear doors, so once the gear is up the camera always stays above the jet.
- The gear retracts by shrinking into its bays, so it never pokes through the top of the airframe.

Handy in the browser console: `goTo('mach3')`, `goKey('liftoff')`, `scrollToY(0.5)`.

## Files

| Path | What |
|---|---|
| `index.html` | Page, styles, chapter text, loader |
| `main.js` | The 3D scene and scroll engine |
| `assets/sr71.json`, `assets/blueprint.json` | Model and blueprint packed as base64 (the claude.ai page host doesn't serve `.glb`/`.png`) |
| `source/` | Original `.glb` models and the extracted blueprint linework |
| `tools/` | Blueprint extraction, Onshape model repair (mirror-patching, gear doors, canopy glass), screenshot script |
| `versions/onshape/` | The earlier version built on my own Onshape model, with repairs and projected decals |

## Credits

- 3D model: [Sr71](https://sketchfab.com/3d-models/sr71-908985d8ec544638bcd661bc315597ad) by manilov.ap,
  licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/).
- `versions/onshape/` uses my own model, built in Onshape.
- Libraries: [three.js](https://threejs.org), [Lenis](https://lenis.darkroom.engineering) (loaded from jsDelivr).
- Fonts: Anton, Exo 2, Great Vibes, Barlow, Barlow Condensed (Google Fonts).
- The blueprint linework was extracted from a reference blueprint image; check its source before publishing widely.

A fan tribute and learning project. Not affiliated with Lockheed Martin or the US Air Force.
