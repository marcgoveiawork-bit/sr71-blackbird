// usage: node shot.js <rootDir> <page.html> '<json [[file, jsExpr], ...]>' [w h]
// Serves files from rootDir to the page via request interception (no server).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
(async () => {
  const [root, page, viewsJson, w = 1200, h = 900] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  p.on('console', m => console.log('console:', m.text()));
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.route('http://local.test/**', async route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = path.join(root, rel);
    if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  const NM = path.join(__dirname, 'tools/node_modules');
  await p.route('https://cdn.jsdelivr.net/npm/**', route => {
    const m = new URL(route.request().url()).pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
    const file = m && path.join(NM, m[1], m[2]);
    if (!file || !fs.existsSync(file)) { console.log('missing', route.request().url()); return route.fulfill({ status: 404, body: '' }); }
    route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: 'text/javascript' });
  });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await p.goto('http://local.test/' + page);
  await p.waitForFunction(() => window.ready, null, { timeout: 240000 });
  for (const [n, expr] of JSON.parse(viewsJson)) {
    await p.evaluate(expr);
    await p.waitForTimeout(+(process.env.WAIT || 300));
    await p.screenshot({ path: n });
  }
  await b.close();
})();
