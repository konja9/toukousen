// Assembles the series index into hub/dist:
//   hub/dist/index.html        the index page (a fragment: the Artifact adds the document skeleton)
//   hub/dist/_local.html       the same page wrapped in a full document, for checking locally
//   hub/dist/<id>/...          each game's own production build
//   hub/dist/shots/*.jpg       the cards' screenshots
//   hub/dist/files.json        { published path: source file } for publishing with the Artifact tool
//
// Usage: node hub/build.mjs [--skip-build]
//   --skip-build  reuse each game's existing dist/ instead of running `npm run build`

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hub = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(hub, '..');
const out = path.join(hub, 'dist');
const skipBuild = process.argv.includes('--skip-build');

const games = JSON.parse(fs.readFileSync(path.join(hub, 'games.json'), 'utf8'));
const ids = new Set();
for (const g of games) {
  for (const k of ['id', 'no', 'dir', 'title', 'ja', 'genre', 'genreJa', 'tagline', 'desc', 'controls', 'record', 'added', 'shot']) {
    if (g[k] === undefined) throw new Error(`games.json: "${g.id ?? '?'}" is missing "${k}"`);
  }
  if (!/^[a-z0-9-]+$/.test(g.id)) throw new Error(`games.json: id "${g.id}" must be lowercase letters, digits or -`);
  if (ids.has(g.id)) throw new Error(`games.json: duplicate id "${g.id}"`);
  ids.add(g.id);
  if (!fs.existsSync(path.join(hub, 'shots', g.shot))) throw new Error(`hub/shots/${g.shot} is missing (run: node hub/tools/shoot.cjs ${g.id})`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const g of games) {
  const dir = path.join(root, g.dir);
  if (!skipBuild) {
    if (!fs.existsSync(path.join(dir, 'node_modules'))) execSync('npm ci', { cwd: dir, stdio: 'inherit' });
    console.log(`building ${g.id} (${g.dir})`);
    execSync('npm run build', { cwd: dir, stdio: 'inherit' });
  }
  const dist = path.join(dir, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${g.dir}/dist/index.html not found — build it first`);
  fs.cpSync(dist, path.join(out, g.id), { recursive: true });
}

fs.mkdirSync(path.join(out, 'shots'));
for (const g of games) fs.copyFileSync(path.join(hub, 'shots', g.shot), path.join(out, 'shots', g.shot));

const src = (f) => fs.readFileSync(path.join(hub, 'src', f), 'utf8');
const page = src('index.html')
  .replace('/*STYLE*/', () => src('hub.css'))
  .replace('/*SCRIPT*/', () => src('hub.js'))
  .replace('/*GAMES*/', () => JSON.stringify(games).replace(/</g, '\\u003c'));
fs.writeFileSync(path.join(out, 'index.html'), page);
fs.writeFileSync(
  path.join(out, '_local.html'),
  `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n</head>\n<body>\n${page}\n</body>\n</html>\n`,
);

// every published file except the page itself
const files = {};
let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const rel = path.relative(out, p).split(path.sep).join('/');
      bytes += fs.statSync(p).size;
      if (rel === 'index.html' || rel === '_local.html' || rel === 'files.json') continue;
      files[rel] = p;
    }
  }
};
walk(out);
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 2));
console.log(`hub/dist: ${games.length} games, ${Object.keys(files).length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
