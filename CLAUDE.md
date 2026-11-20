# SR-71 Blackbird scroll site (template repo)

This repo is the template for Marc's aircraft scroll sites. Before changing anything here, or when starting a new
aircraft from it, read `PLAYBOOK.md`: architecture, the problems already solved, where theme values live, and the
per-aircraft checklist.

Rules carried over from the build:
- Keep the structure: `index.html` (styles, copy, loader) + `main.js` (scene + scroll engine), no build step.
- Camera keys inherit from the previous key; anchored shots read anchors in the jet's resting pose.
- If the model has no gear doors, the camera stays above the jet once the gear is up.
- Verify every fact with a web search; credit model licences in the finale credits; no manufacturer logos.
- Test with Playwright via `tools/screenshot.js` (no local server or github.io access in the cloud container);
  sweep 30+ scroll positions and run the auto-play before pushing.
- After each change: commit, push to `main` (GitHub Pages updates itself).
