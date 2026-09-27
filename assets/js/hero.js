/*
 * Hero canvas: a live toy model of a noisy market.
 *
 *   latent value   x_t = x_{t-1} + σx·ε_t   (+ rare jumps: regime shifts)
 *   observation    y_t = x_t + σy·η_t        (σy ≫ σx  → low signal-to-noise)
 *   belief         Kalman filter  p(x_t | y_1:t) = N(m_t, P_t),
 *                  with P inflated when the innovation is implausible (changepoint)
 *   market maker   Avellaneda–Stoikov style quotes around the posterior mean:
 *                  r = m − q·γ·σ²,  bid/ask = r ∓ δ,  δ grows with posterior uncertainty
 *
 * Everything drawn on screen is produced by these equations; nothing is scripted.
 */
(function () {
  const canvas = document.querySelector('.hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hud = document.querySelector('[data-hud]');

  const css = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const hex = (h) => {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let C;
  const readColors = () => {
    C = {
      grid: hex(css('--grid', '#161c26')),
      muted: hex(css('--muted', '#7a8394')),
      ink: hex(css('--ink', '#e8ebf0')),
      signal: hex(css('--signal', '#f2b441')),
      bid: hex(css('--bid', '#3cc6a8')),
      ask: hex(css('--ask', '#ff6b5e')),
    };
  };
  readColors();

  // ---------- model ----------
  const SX = 0.008;      // latent volatility per tick
  const SY = 0.08;       // observation noise per tick
  const TICK = 0.01;     // price grid
  const GAMMA = 0.9;     // risk aversion
  const HISTORY = 420;   // ticks kept on screen

  // Box–Muller
  let spare = null;
  const randn = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    v = Math.random();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  const S = {
    t: 0, x: 100, m: 100, P: SY * SY,
    q: 0, cash: 0, fills: 0, jumpIn: 260, lastShift: -999,
    hist: [],
  };
  // order book: depth per level, indexed by offset from mid in ticks
  const LEVELS = 12;
  const book = { bid: new Array(LEVELS).fill(0).map(() => 3 + Math.random() * 6),
                 ask: new Array(LEVELS).fill(0).map(() => 3 + Math.random() * 6) };

  function step() {
    S.t++;
    // latent process with rare jumps
    let jump = 0;
    if (--S.jumpIn <= 0) {
      jump = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.14);
      S.jumpIn = 240 + Math.floor(Math.random() * 260);
    }
    S.x += SX * randn() + jump;
    const y = S.x + SY * randn();

    // Kalman predict / update
    S.P += SX * SX;
    const innov = y - S.m;
    const Sv = S.P + SY * SY;
    const K = S.P / Sv;
    S.m += K * innov;
    S.P *= 1 - K;
    // changepoint heuristic: a 3.2σ surprise means the prior was too confident,
    // so widen the posterior and let the next observations pull it over
    if (innov * innov > 3.2 * 3.2 * Sv) {
      S.P += innov * innov * 0.15;
      S.lastShift = S.t;
    }

    // market maker quotes (inventory-skewed reservation price)
    const sd = Math.sqrt(S.P);
    const r = S.m - S.q * GAMMA * (SX * SX * 60 + S.P);
    const half = 0.035 + 1.6 * sd;
    const bid = Math.round((r - half) / TICK) * TICK;
    const ask = Math.round((r + half) / TICK) * TICK;

    // an observed print that crosses our quote fills us (with some probability)
    let fill = 0;
    if (y <= bid && S.q < 6 && Math.random() < 0.7) { S.q++; S.cash -= bid; fill = 1; S.fills++; }
    else if (y >= ask && S.q > -6 && Math.random() < 0.7) { S.q--; S.cash += ask; fill = -1; S.fills++; }

    // book depth drifts; our own quote levels thicken a little
    for (let i = 0; i < LEVELS; i++) {
      const target = 3 + i * 0.9;
      book.bid[i] = Math.max(0.4, book.bid[i] + (target - book.bid[i]) * 0.04 + randn() * 0.6);
      book.ask[i] = Math.max(0.4, book.ask[i] + (target - book.ask[i]) * 0.04 + randn() * 0.6);
    }

    S.hist.push({ x: S.x, y, m: S.m, P: S.P, bid, ask, fill });
    if (S.hist.length > HISTORY) S.hist.shift();
  }

  for (let i = 0; i < HISTORY; i++) step(); // start with a full tape

  // ---------- emphasis driven by the headline word ----------
  const MODES = {
    noise:       { obs: 1.0, truth: 0.25, post: 0.55, quotes: 0.35, book: 0.5, dens: 0.4 },
    sparse:      { obs: 0.45, truth: 0.6, post: 1.0, quotes: 0.3, book: 0.4, dens: 1.0 },
    flow:        { obs: 0.5, truth: 0.2, post: 0.55, quotes: 1.0, book: 1.0, dens: 0.35 },
    uncertainty: { obs: 0.5, truth: 0.45, post: 1.0, quotes: 0.55, book: 0.45, dens: 1.0 },
  };
  const w = { ...MODES.noise };
  let target = MODES.noise;
  document.addEventListener('heromode', (e) => { if (MODES[e.detail]) target = MODES[e.detail]; });

  // ---------- layout ----------
  let dpr = 1, W = 0, H = 0, mobile = false;
  let center = 100, scale = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mobile = W < 760;
  }

  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  function draw(now, frac) {
    for (const k in w) w[k] += (target[k] - w[k]) * 0.05;

    ctx.clearRect(0, 0, W, H);
    const h = S.hist, n = h.length;
    const bookW = mobile ? 0 : Math.min(200, W * 0.14);
    const densW = mobile ? 40 : 90;
    const x1 = W - bookW - densW - (mobile ? 8 : 24);   // head of the tape
    const x0 = mobile ? 0 : W * 0.02;
    const top = mobile ? H * 0.7 : H * 0.14;
    const bot = mobile ? H * 0.96 : H * 0.86;
    const dx = (x1 - x0) / (HISTORY - 1);

    // auto-range on the posterior, eased
    let lo = Infinity, hi = -Infinity;
    for (let i = Math.floor(n * 0.3); i < n; i++) { lo = Math.min(lo, h[i].m); hi = Math.max(hi, h[i].m); }
    const span = Math.max(0.9, (hi - lo) * 1.6);
    center += ((lo + hi) / 2 - center) * 0.04;
    scale += ((bot - top) / span - scale) * 0.04;
    const Y = (p) => (top + bot) / 2 - (p - center) * scale;
    // older ticks fade towards the headline side
    const fade = (i) => (mobile ? 0.25 + 0.75 * (i / n) : 0.06 + 0.94 * smooth(0.15, 0.75, i / n));
    const X = (i) => x0 + (i + HISTORY - n - frac) * dx;

    // grid: price levels + scrolling time lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(C.grid, 1);
    ctx.fillStyle = rgba(C.muted, 0.5);
    ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textBaseline = 'middle';
    const stepP = span > 2.5 ? 0.5 : 0.25;
    ctx.beginPath();
    for (let p = Math.ceil((center - span) / stepP) * stepP; p < center + span; p += stepP) {
      const yy = Math.round(Y(p)) + 0.5;
      if (yy < top - 30 || yy > bot + 30) continue;
      ctx.moveTo(x0, yy); ctx.lineTo(x1, yy);
      if (!mobile) ctx.fillText(p.toFixed(2), x1 + 6, yy);
    }
    const every = 40;
    for (let i = n - 1 - ((S.t) % every); i >= 0; i -= every) {
      const xx = Math.round(X(i)) + 0.5;
      ctx.moveTo(xx, top - 20); ctx.lineTo(xx, bot + 20);
    }
    ctx.stroke();

    // posterior credible band ±2σ
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(h[i].m + 2 * Math.sqrt(h[i].P)));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(h[i].m - 2 * Math.sqrt(h[i].P)));
    ctx.closePath();
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, rgba(C.signal, 0));
    g.addColorStop(0.5, rgba(C.signal, 0.05 * w.post));
    g.addColorStop(1, rgba(C.signal, 0.16 * w.post));
    ctx.fillStyle = g;
    ctx.fill();

    // observations: the noise cloud
    for (let i = 0; i < n; i++) {
      const a = 0.7 * w.obs * fade(i);
      ctx.fillStyle = rgba(C.ink, a);
      ctx.fillRect(X(i) - 0.9, Y(h[i].y) - 0.9, 1.8, 1.8);
    }

    // latent truth (hidden in practice — drawn dashed)
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(C.ink, 0.35 * w.truth);
    ctx.beginPath();
    for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(h[i].x));
    ctx.stroke();
    ctx.setLineDash([]);

    // quotes as step lines + fills
    const qFrom = Math.floor(n * 0.35);
    for (const side of ['bid', 'ask']) {
      ctx.strokeStyle = rgba(side === 'bid' ? C.bid : C.ask, 0.55 * w.quotes);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = qFrom; i < n; i++) {
        const yy = Y(h[i][side]);
        if (i === qFrom) ctx.moveTo(X(i), yy);
        else { ctx.lineTo(X(i), Y(h[i - 1][side])); ctx.lineTo(X(i), yy); }
      }
      ctx.stroke();
    }
    for (let i = qFrom; i < n; i++) {
      const f = h[i].fill;
      if (!f) continue;
      const xx = X(i), yy = Y(f > 0 ? h[i].bid : h[i].ask);
      ctx.fillStyle = rgba(f > 0 ? C.bid : C.ask, 0.9 * w.quotes);
      ctx.beginPath();
      if (f > 0) { ctx.moveTo(xx, yy + 1); ctx.lineTo(xx - 4, yy + 7); ctx.lineTo(xx + 4, yy + 7); }
      else { ctx.moveTo(xx, yy - 1); ctx.lineTo(xx - 4, yy - 7); ctx.lineTo(xx + 4, yy - 7); }
      ctx.fill();
    }

    // posterior mean
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = rgba(C.signal, 0.95 * fade(0));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = fade(i);
      if (i % 8 === 0 && i > 0) {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(X(i - 1), Y(h[i - 1].m));
        ctx.strokeStyle = rgba(C.signal, 0.95 * a);
      }
      ctx.lineTo(X(i), Y(h[i].m));
    }
    ctx.stroke();

    // regime-shift marker
    const since = S.t - S.lastShift;
    if (since < HISTORY) {
      const i = n - 1 - since;
      if (i >= 0) {
        const xx = Math.round(X(i)) + 0.5;
        ctx.strokeStyle = rgba(C.signal, 0.35);
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xx, top - 10); ctx.lineTo(xx, bot + 10); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(C.signal, 0.75);
        ctx.fillText('changepoint · P↑', xx + 6, top - 4);
      }
    }

    // head: current belief and its density
    const last = h[n - 1];
    const hx = X(n - 1), hy = Y(last.m);
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    ctx.fillStyle = rgba(C.signal, 0.18 + 0.12 * pulse);
    ctx.beginPath(); ctx.arc(hx, hy, 6 + 3 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba(C.signal, 1);
    ctx.beginPath(); ctx.arc(hx, hy, 2.6, 0, Math.PI * 2); ctx.fill();

    const sd = Math.sqrt(last.P);
    const dX = x1 + (mobile ? 6 : 52);
    ctx.beginPath();
    ctx.moveTo(dX, Y(last.m - 4 * sd));
    for (let k = -4; k <= 4.001; k += 0.1) {
      const dens = Math.exp(-0.5 * k * k);
      ctx.lineTo(dX + dens * (densW - (mobile ? 6 : 58)) * 1.4, Y(last.m + k * sd));
    }
    ctx.lineTo(dX, Y(last.m + 4 * sd));
    ctx.closePath();
    ctx.fillStyle = rgba(C.signal, 0.12 * w.dens + 0.04);
    ctx.fill();
    ctx.strokeStyle = rgba(C.signal, 0.35 + 0.6 * w.dens);
    ctx.lineWidth = 1;
    ctx.stroke();

    if (!mobile) {
      ctx.fillStyle = rgba(C.signal, 0.85);
      ctx.fillText('p(x | y₁:ₜ)', dX, Y(last.m - 4 * sd) - 12);
      ctx.fillStyle = rgba(C.ink, 0.45 * w.obs + 0.1);
      ctx.fillText('y  observed', X(Math.floor(n * 0.62)), Y(h[Math.floor(n * 0.62)].m) + 3.2 * sd * scale + 26);
      ctx.fillStyle = rgba(C.ink, 0.5 * w.truth + 0.1);
      ctx.fillText('x  latent', X(Math.floor(n * 0.5)), Y(h[Math.floor(n * 0.5)].x) - 3.2 * sd * scale - 26);

      // order book ladder
      const bx = W - bookW - 4;
      const lvlH = Math.max(6, Math.min(14, TICK * scale));
      const midTick = Math.round(last.m / TICK) * TICK;
      const maxD = 16;
      for (let i = 0; i < LEVELS; i++) {
        for (const side of ['bid', 'ask']) {
          const p = side === 'bid' ? midTick - (i + 1) * TICK : midTick + (i + 1) * TICK;
          const yy = Y(p);
          if (yy < top - 40 || yy > bot + 40) continue;
          const len = Math.min(1, book[side][i] / maxD) * (bookW - 30);
          const ours = Math.abs(p - last[side]) < TICK / 2;
          ctx.fillStyle = rgba(side === 'bid' ? C.bid : C.ask, (ours ? 0.85 : 0.28) * (0.4 + 0.6 * w.book));
          ctx.fillRect(bx, yy - lvlH / 2 + 1, len, lvlH - 2);
        }
      }
      ctx.fillStyle = rgba(C.muted, 0.8);
      ctx.fillText('L2 depth', bx, top - 4);
    }
  }

  // ---------- HUD ----------
  const fmt = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  function updateHud() {
    if (!hud) return;
    const last = S.hist[S.hist.length - 1];
    const pnl = S.cash + S.q * last.m;
    const vals = {
      t: S.t.toString().padStart(6, '0'),
      snr: ((SX * SX) / (SY * SY)).toFixed(3),
      mu: last.m.toFixed(3),
      sigma: Math.sqrt(last.P).toFixed(4),
      spread: (last.ask - last.bid).toFixed(2),
      q: fmt(S.q, 0),
      pnl: fmt(pnl, 2),
      fills: S.fills,
    };
    for (const k in vals) {
      const el = hud.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = vals[k];
    }
  }

  // ---------- loop ----------
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TPS = 14; // simulation ticks per second
  let raf = 0, last = 0, acc = 0, visible = true, hudT = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    acc += dt * TPS;
    while (acc >= 1) { step(); acc -= 1; }
    draw(now, acc);
    if (now - hudT > 180) { updateHud(); hudT = now; }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (reduce.matches) { for (let i = 0; i < 200; i++) draw(0, 0); updateHud(); return; } // let the auto-range settle
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  resize(); draw(0, 0); updateHud(); start();
  window.addEventListener('resize', () => { resize(); draw(performance.now(), acc); });
  document.addEventListener('visibilitychange', start);
  document.addEventListener('themechange', () => { readColors(); if (!raf) draw(performance.now(), acc); });
  reduce.addEventListener?.('change', start);
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; start(); }).observe(canvas);
})();

/* Headline word cycler — also tells the canvas which layer to emphasise. */
(function () {
  const el = document.querySelector('[data-cycle]');
  if (!el) return;
  const items = JSON.parse(el.dataset.cycle);
  const emit = (i) => document.dispatchEvent(new CustomEvent('heromode', { detail: items[i].mode }));
  emit(0);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0, len = items[0].text.length, deleting = false;
  const tick = () => {
    const word = items[i].text;
    if (deleting) {
      len--;
      el.textContent = word.slice(0, len);
      if (len === 0) { deleting = false; i = (i + 1) % items.length; setTimeout(tick, 300); }
      else setTimeout(tick, 38);
    } else {
      len++;
      el.textContent = items[i].text.slice(0, len);
      if (len === items[i].text.length) { emit(i); deleting = true; setTimeout(tick, 2600); }
      else setTimeout(tick, 70);
    }
  };
  setTimeout(() => { deleting = true; tick(); }, 2600);
})();

/* Project filter chips. */
(function () {
  const chips = document.querySelectorAll('[data-filter]');
  const cards = document.querySelectorAll('[data-cats]');
  chips.forEach((chip) => chip.addEventListener('click', () => {
    const f = chip.dataset.filter;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    cards.forEach((card) => {
      card.hidden = f !== 'all' && !card.dataset.cats.split(' ').includes(f);
    });
  }));
})();
