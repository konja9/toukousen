(() => {
  'use strict';

  const games = JSON.parse(document.getElementById('games').textContent).sort((a, b) => a.no - b.no);
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------------------------------------------------------------- records
  // Each game saves its best in this page's localStorage when played here.
  const read = (key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const formats = {
    score: (v) => (typeof v === 'number' && v > 0 ? `ベスト ${Math.round(v).toLocaleString('ja-JP')} 点` : null),
    stages: (v, g) => {
      const n = v && typeof v === 'object' ? Object.keys(v).length : 0;
      return n ? `${n} / ${g.record.total} 図葉クリア` : null;
    },
    sheets: (v, g) => {
      if (!v || typeof v !== 'object') return null;
      const done = new Set();
      const unseen = new Set();
      for (const [k, b] of Object.entries(v)) {
        const id = k.split(':')[0];
        done.add(id);
        if (b && b.unseen) unseen.add(id);
      }
      return done.size ? `${done.size} / ${g.record.total} 図葉クリア · UNSEEN ${unseen.size}` : null;
    },
    glide: (v, g) => {
      const parts = [];
      if (typeof v === 'number' && v > 0) parts.push(`ベスト ${Math.round(v).toLocaleString('ja-JP')} 点`);
      const m = read(g.record.medals);
      let n = 0;
      if (m && typeof m === 'object') for (const b of Object.values(m)) for (let i = 0; i < 3; i++) if (b & (1 << i)) n++;
      if (n) parts.push(`メダル ◆ ${n}`);
      return parts.length ? parts.join(' · ') : null;
    },
    dive: (v) => (v && typeof v === 'object' && typeof v.sectors === 'number' ? `${v.sectors} 区画通過 · 最大深度 ${Math.round(v.depth)} m` : null),
  };
  const recordText = (g) => {
    const f = formats[g.record && g.record.type];
    return (f && f(read(g.record.key), g)) || null;
  };

  // ---------------------------------------------------------------- index
  const list = document.getElementById('sheets');
  list.innerHTML = games
    .map(
      (g) => `
    <li class="sheet" id="${esc(g.id)}">
      <figure class="frame" tabindex="0" role="button" aria-label="${esc(g.title)} を遊ぶ" data-play="${esc(g.id)}">
        <div class="clip"><img src="shots/${esc(g.shot)}" alt="${esc(g.title)} のタイトル画面" width="1280" height="720" /></div>
        <span class="tk"></span>
        <span class="play-hint">PLAY</span>
      </figure>
      <div class="meta">
        <p class="sheetno"><span>SHEET ${pad(g.no)}</span><span>${esc(g.added)}</span></p>
        <h3><span class="en">${esc(g.title)}</span><span class="ja">${esc(g.ja)}</span></h3>
        <p class="genre">${esc(g.genreJa)}<span>${esc(g.genre)}</span></p>
        <p class="tagline">${esc(g.tagline)}</p>
        <p class="desc">${esc(g.desc)}</p>
        <dl class="facts">
          <dt>操作</dt><dd>${esc(g.controls)}</dd>
          <dt>記録</dt><dd data-record="${esc(g.id)}">—</dd>
        </dl>
        <div class="actions">
          <button type="button" class="play" data-play="${esc(g.id)}">PLAY</button>
          <a href="${esc(g.id)}/index.html" target="_blank" rel="noopener">別のタブで開く ↗</a>
          <span class="pc-only">PC の広い画面で遊ぶゲームです</span>
        </div>
      </div>
    </li>`,
    )
    .join('');

  const latest = games.reduce((a, b) => (b.added > a.added || (b.added === a.added && b.no > a.no) ? b : a), games[0]);
  document.getElementById('count').textContent = pad(games.length);
  document.getElementById('latest').textContent = latest ? `${latest.title}（${latest.added}）` : '—';
  document.getElementById('nextno').textContent = pad(games.length + 1);

  const refreshRecords = () => {
    for (const g of games) {
      const el = list.querySelector(`[data-record="${g.id}"]`);
      if (!el) continue;
      const t = recordText(g);
      el.textContent = t || '未プレイ';
      el.classList.toggle('none', !t);
    }
  };
  refreshRecords();
  window.addEventListener('storage', refreshRecords);

  // ---------------------------------------------------------------- player
  const player = document.getElementById('player');
  const frame = document.getElementById('frame');
  const now = document.getElementById('now');
  let current = null;

  const open = (id) => {
    const g = games.find((x) => x.id === id);
    if (!g) return;
    current = g;
    now.textContent = `SHEET ${pad(g.no)} · ${g.title}`;
    frame.title = g.title;
    frame.src = `${g.id}/index.html`;
    player.hidden = false;
    document.body.classList.add('playing');
    field.stop();
    frame.addEventListener(
      'load',
      () => {
        try {
          frame.focus();
          frame.contentWindow && frame.contentWindow.focus();
        } catch {
          /* focus is best-effort */
        }
      },
      { once: true },
    );
  };

  const close = () => {
    if (!current) return;
    const id = current.id;
    current = null;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch {
      /* not in fullscreen */
    }
    frame.src = 'about:blank';
    player.hidden = true;
    document.body.classList.remove('playing');
    refreshRecords();
    field.start();
    const card = document.getElementById(id);
    if (card) card.querySelector('.frame').focus({ preventScroll: false });
  };

  list.addEventListener('click', (e) => {
    const t = e.target.closest('[data-play]');
    if (t) open(t.dataset.play);
  });
  list.addEventListener('keydown', (e) => {
    const t = e.target.closest('figure[data-play]');
    if (t && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open(t.dataset.play);
    }
  });
  document.getElementById('close').addEventListener('click', close);
  document.getElementById('fs').addEventListener('click', () => {
    try {
      const p = player.requestFullscreen && player.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* fullscreen is optional */
    }
    frame.focus();
  });

  // ---------------------------------------------------------------- contour field
  // 2D simplex noise (Gustavson), enough for a slowly drifting relief.
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const perm = new Uint8Array(512);
  {
    const p = Array.from({ length: 256 }, (_, i) => i);
    let s = 7;
    for (let i = 255; i > 0; i--) {
      s = (s * 16807) % 2147483647;
      const j = s % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  }
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  function noise(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    for (const [dx, dy, gi] of [
      [x0, y0, perm[ii + perm[jj]] & 7],
      [x1, y1, perm[ii + i1 + perm[jj + j1]] & 7],
      [x2, y2, perm[ii + 1 + perm[jj + 1]] & 7],
    ]) {
      let tt = 0.5 - dx * dx - dy * dy;
      if (tt > 0) {
        tt *= tt;
        n += tt * tt * (grad[gi][0] * dx + grad[gi][1] * dy);
      }
    }
    return 70 * n;
  }

  const canvas = document.getElementById('field');
  const hero = document.getElementById('top');
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const CELL = 12;
  const STEP = 10; // metres between isobaths
  let W = 0;
  let H = 0;
  let cols = 0;
  let rows = 0;
  let heights = new Float32Array(0);
  let pointer = null;
  let t = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = hero.clientWidth;
    H = hero.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(W / CELL) + 1;
    rows = Math.ceil(H / CELL) + 1;
    heights = new Float32Array(cols * rows);
  }

  // elevation in metres at a screen point
  function elevation(x, y) {
    const u = x / 420;
    const v = y / 420;
    const a = noise(u + t * 0.018, v - t * 0.006);
    const b = noise(u * 2.3 - 7 - t * 0.011, v * 2.3 + 3);
    const c = noise(u * 5.1 + 11, v * 5.1 - t * 0.02);
    return 160 + a * 95 + b * 38 + c * 9;
  }

  function draw() {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--field').trim() || '232, 233, 228';
    ctx.clearRect(0, 0, W, H);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) heights[j * cols + i] = elevation(i * CELL, j * CELL);
    const hot = pointer ? Math.round(elevation(pointer.x, pointer.y) / STEP) * STEP : null;
    // group segments by level so each level is stroked once
    const paths = new Map();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const n = j * cols + i;
        const a = heights[n];
        const b = heights[n + 1];
        const c = heights[n + cols + 1];
        const d = heights[n + cols];
        const lo = Math.min(a, b, c, d);
        const hi = Math.max(a, b, c, d);
        for (let L = Math.ceil(lo / STEP) * STEP; L <= hi; L += STEP) {
          const x0 = i * CELL;
          const y0 = j * CELL;
          const pts = [];
          if (a > L !== b > L) pts.push(x0 + ((L - a) / (b - a)) * CELL, y0);
          if (b > L !== c > L) pts.push(x0 + CELL, y0 + ((L - b) / (c - b)) * CELL);
          if (d > L !== c > L) pts.push(x0 + ((L - d) / (c - d)) * CELL, y0 + CELL);
          if (a > L !== d > L) pts.push(x0, y0 + ((L - a) / (d - a)) * CELL);
          if (pts.length < 4) continue;
          let arr = paths.get(L);
          if (!arr) paths.set(L, (arr = []));
          arr.push(pts[0], pts[1], pts[2], pts[3]);
          if (pts.length === 8) arr.push(pts[4], pts[5], pts[6], pts[7]);
        }
      }
    }
    for (const [L, arr] of paths) {
      const index = L % 50 === 0;
      const isHot = L === hot;
      ctx.strokeStyle = `rgba(${rgb}, ${isHot ? 0.95 : index ? 0.42 : 0.2})`;
      ctx.lineWidth = isHot ? 2.2 : index ? 1.2 : 0.8;
      ctx.beginPath();
      for (let k = 0; k < arr.length; k += 4) {
        ctx.moveTo(arr[k], arr[k + 1]);
        ctx.lineTo(arr[k + 2], arr[k + 3]);
      }
      ctx.stroke();
    }
    if (pointer && hot !== null) {
      ctx.font = "400 11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = `rgba(${rgb}, 0.9)`;
      ctx.fillText(`${hot} m`, pointer.x + 12, pointer.y - 10);
    }
  }

  let raf = 0;
  let last = 0;
  let visible = true;
  let running = false;
  function loop(ms) {
    raf = requestAnimationFrame(loop);
    if (ms - last < 66) return; // ~15 fps is plenty for a slow drift
    t += (ms - last) / 1000;
    last = ms;
    draw();
  }
  const field = {
    start() {
      running = true;
      cancelAnimationFrame(raf);
      if (reduce.matches || !visible) {
        draw();
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };

  resize();
  draw();
  field.start();
  window.addEventListener('resize', () => {
    resize();
    draw();
  });
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (reduce.matches) draw();
  });
  hero.addEventListener('pointerleave', () => {
    pointer = null;
    if (reduce.matches) draw();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (running) field.start();
    }).observe(hero);
  }
  reduce.addEventListener?.('change', () => running && field.start());
  // redraw in the other ink when the viewer's theme changes
  new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', draw);

  // #id in the link scrolls to that sheet
  const hash = location.hash.slice(1);
  if (hash && games.some((g) => g.id === hash)) document.getElementById(hash).scrollIntoView();
})();
