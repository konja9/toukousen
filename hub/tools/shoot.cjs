// Captures the title screen of each game for the index cards.
// Usage: node hub/tools/shoot.cjs [id ...]      (default: every game in games.json)
// Needs each game's dist/ built, and Playwright (the Chromium that ships with it).
// Screenshots are taken in the night theme. A game's optional "shoot" list in games.json
// plays a few steps first: a string is a key to press (e.g. "Space", "Digit4"), a
// number is milliseconds to wait, and { "until": "<js expression>" } waits until the
// expression is true in the page (game clocks run slow in software rendering, so
// conditions are more reliable than fixed waits). Without it the title screen is captured.

const fs = require('fs');
const path = require('path');
const http = require('http');

const hub = path.resolve(__dirname, '..');
const root = path.resolve(hub, '..');
const games = JSON.parse(fs.readFileSync(path.join(hub, 'games.json'), 'utf8'));
const only = process.argv.slice(2);

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      /* try the next place */
    }
  }
  throw new Error('Playwright is not installed');
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(dir, url.endsWith('/') ? url + 'index.html' : url);
      if (!file.startsWith(dir) || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

(async () => {
  const { chromium } = playwright();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const g of games) {
    if (only.length && !only.includes(g.id)) continue;
    const dist = path.join(root, g.dir, 'dist');
    const server = await serve(dist);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://localhost:${server.address().port}/index.html`);
    // every game exposes window.__game; give the title reveal time to finish
    await page.waitForFunction('window.__game !== undefined', null, { timeout: 180000 });
    await page.waitForTimeout(Number(process.env.SETTLE || (g.shoot ? 3000 : 6000)));
    for (const step of g.shoot || []) {
      if (typeof step === 'number') await page.waitForTimeout(step);
      else if (step && typeof step === 'object' && step.until) await page.waitForFunction(step.until, null, { timeout: 180000 });
      else await page.keyboard.press(step);
    }
    await page.screenshot({ path: path.join(hub, 'shots', g.shot), type: 'jpeg', quality: 82 });
    console.log(`shots/${g.shot}`);
    await page.close();
    server.close();
  }
  await browser.close();
})();
