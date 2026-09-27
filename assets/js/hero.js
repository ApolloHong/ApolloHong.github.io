/*
 * Hero: a live, rotatable 3-D view of a cross-sectional lead–lag strategy.
 *
 *   leader      r_L,t = σ_t ε_t,   σ²_t = ω + α r²_{t−1} + β σ²_{t−1}   (GARCH(1,1)),  ε ~ Student-t(4), rare jumps
 *   followers   r_i,t = b_i r_L,t−ℓ_i + g_i r_L,t + η_i,t,  η with its own GARCH-t noise;  (b_i, ℓ_i) are hidden
 *               and re-drawn at regime shifts
 *   inference   for every follower, Bayesian linear regression on each candidate lag ℓ = 1..5 plus a
 *               "no relationship" model, with exponential forgetting; the model posterior p(ℓ | data) comes
 *               from accumulated predictive likelihoods (Bayesian model averaging)
 *   portfolio   rank followers by the posterior forecast of the next return; long the top 3, short the bottom 3
 *
 * Every line, arc and distribution on screen is produced by these equations; nothing is scripted.
 */
(function () {
  const canvas = document.querySelector('.hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hud = document.querySelector('[data-hud]');
  const tip = document.querySelector('.hero-tip');
  const hero = canvas.closest('.hero');

  const css = (n, f) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || f;
  const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let C;
  const readColors = () => {
    C = {
      bg: hex(css('--bg', '#07090d')), bg2: hex(css('--bg-2', '#0c1016')), grid: hex(css('--grid', '#131923')),
      line: hex(css('--line-2', '#2c3545')), muted: hex(css('--muted', '#7a8394')), ink: hex(css('--ink', '#e8ebf0')),
      ink2: hex(css('--ink-2', '#b4bbc7')), signal: hex(css('--signal', '#f2b441')), bid: hex(css('--bid', '#3cc6a8')), ask: hex(css('--ask', '#ff6b5e')),
    };
  };
  readColors();
  const MONO = "'JetBrains Mono', ui-monospace, monospace";
  const MATH = "'STIX Two Text', 'Times New Roman', Times, serif";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------- random numbers ----------
  let spare = null;
  const randn = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = Math.random();
    const v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  const NU = 4;
  const studentT = () => { let c = 0; for (let k = 0; k < NU; k++) { const g = randn(); c += g * g; } return (randn() / Math.sqrt(c / NU)) * Math.sqrt((NU - 2) / NU); };
  const tPdf = (x) => Math.pow(1 + (x * x) / (NU - 2), -(NU + 1) / 2); // unit-variance t₄ shape, peak 1

  // ---------- model ----------
  const LAGS = 5, HIST = 150, KSIDE = 3, LEAK = 0.97, TAU2 = 0.6, DS = 0.99, DE = 0.985, NOISE = 2.6;
  const GA = 0.08, GB = 0.9, GW = 0.02;
  const NF = window.innerWidth < 760 ? 9 : 15;
  const LOG2PI = Math.log(2 * Math.PI);
  const logN = (y, m, v) => -0.5 * (LOG2PI + Math.log(v) + ((y - m) * (y - m)) / v);

  const leader = { s2: 1, lastE2: 1, C: 0, r: [], z: [], sd: [] };
  const drawTruth = (f) => {
    f.lag = 1 + Math.floor(Math.random() * LAGS);
    f.beta = Math.random() < 0.2 ? 0 : (Math.random() < 0.2 ? -1 : 1) * (0.3 + Math.random() * 0.4);
  };
  const fol = Array.from({ length: NF }, (_, i) => {
    const f = {
      name: 'S' + String(i + 1).padStart(2, '0'), g: 0.15 + Math.random() * 0.3, s2: NOISE, lastE2: NOISE, C: 0, r: [], z: [],
      Sxx: new Float64Array(LAGS + 1), Sxy: new Float64Array(LAGS + 1), ev: new Float64Array(LAGS + 1), p: new Float64Array(LAGS + 1),
      m: new Float64Array(LAGS + 1), v: new Float64Array(LAGS + 1).fill(TAU2), res: NOISE, mu: 0, sd: 1.7, zs: 0, side: 0,
    };
    drawTruth(f);
    return f;
  });
  const S = { t: 0, shocks: [], shifts: [], pnl: 0, ic: 0, acc: 0 };
  const rL = (k) => leader.r[leader.r.length - 1 - k] || 0; // leader return k ticks ago

  function mapLag(f) { let b = 0; for (let l = 1; l <= LAGS; l++) if (f.p[l] > f.p[b]) b = l; return b; }
  function spearman(a, b) {
    const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
    const ra = rank(a), rb = rank(b), n = a.length;
    let d = 0; for (let i = 0; i < n; i++) d += (ra[i] - rb[i]) ** 2;
    return 1 - (6 * d) / (n * (n * n - 1));
  }

  function step() {
    S.t++;
    // leader: GARCH(1,1) with t₄ shocks and rare jumps
    leader.s2 = GW + GA * leader.lastE2 + GB * leader.s2;
    let r = Math.sqrt(leader.s2) * studentT();
    if (Math.random() < 0.006) r += (Math.random() < 0.5 ? -1 : 1) * (3 + 2 * Math.random()) * Math.sqrt(leader.s2);
    leader.lastE2 = r * r;
    if (Math.abs(r) > 2.2 * Math.sqrt(leader.s2)) S.shocks.push(S.t);
    leader.r.push(r);
    leader.C = LEAK * leader.C + r;
    leader.z.push(leader.C); leader.sd.push(Math.sqrt(leader.s2));

    // regime shift: some hidden lead–lag links change
    if (S.t % 320 === 0) {
      for (let k = 0; k < 3; k++) drawTruth(fol[Math.floor(Math.random() * NF)]);
      S.shifts.push(S.t);
    }

    const realized = [];
    let pnl = 0;
    for (const f of fol) {
      f.s2 = GW * NOISE + GA * f.lastE2 + GB * f.s2;
      const eta = Math.sqrt(f.s2) * studentT();
      f.lastE2 = eta * eta;
      const y = f.beta * rL(f.lag) + f.g * rL(0) + eta;
      realized.push(y);
      pnl += f.side * y;

      // Bayesian update for each candidate lag, and for the null model (index 0)
      const s2e = f.res;
      f.ev[0] = DE * f.ev[0] + logN(y, 0, s2e);
      for (let l = 1; l <= LAGS; l++) {
        const x = rL(l);
        f.ev[l] = DE * f.ev[l] + logN(y, f.m[l] * x, s2e + x * x * f.v[l]);
        f.Sxx[l] = DS * f.Sxx[l] + x * x;
        f.Sxy[l] = DS * f.Sxy[l] + x * y;
        const prec = 1 / TAU2 + f.Sxx[l] / s2e;
        f.m[l] = f.Sxy[l] / s2e / prec;
        f.v[l] = 1 / prec;
      }
      let mx = -Infinity;
      for (let l = 0; l <= LAGS; l++) mx = Math.max(mx, f.ev[l]);
      let z = 0;
      for (let l = 0; l <= LAGS; l++) { f.p[l] = Math.exp(f.ev[l] - mx); z += f.p[l]; }
      for (let l = 0; l <= LAGS; l++) f.p[l] /= z;
      const map = mapLag(f);
      const resid = y - (map ? f.m[map] * rL(map) : 0);
      f.res = 0.98 * f.res + 0.02 * resid * resid;
      f.C = LEAK * f.C + y;
      f.r.push(y); f.z.push(f.C);
    }
    S.pnl += (pnl / KSIDE) * 0.01;

    // realised rank IC of last tick's forecasts
    S.ic = 0.97 * S.ic + 0.03 * spearman(fol.map((f) => f.mu), realized);

    // posterior predictive for the next tick (model average over lags) → cross-sectional ranking
    for (const f of fol) {
      let mu = 0, e2 = 0;
      for (let l = 1; l <= LAGS; l++) {
        const x = rL(l - 1), mean = f.m[l] * x;
        mu += f.p[l] * mean;
        e2 += f.p[l] * (f.v[l] * x * x + mean * mean);
      }
      f.mu = mu;
      f.sd = Math.sqrt(f.res + Math.max(0, e2 - mu * mu));
      f.zs = mu / Math.sqrt(f.res);
    }
    const order = [...fol].sort((a, b) => b.zs - a.zs);
    fol.forEach((f) => (f.side = 0));
    order.slice(0, KSIDE).forEach((f) => { if (f.zs > 0.12) f.side = 1; });
    order.slice(-KSIDE).forEach((f) => { if (f.zs < -0.12) f.side = -1; });

    let hit = 0;
    for (const f of fol) hit += mapLag(f) === (f.beta === 0 ? 0 : f.lag) ? 1 : 0;
    S.acc = hit / NF;

    for (const arr of [leader.r, leader.z, leader.sd, ...fol.map((f) => f.r), ...fol.map((f) => f.z)]) {
      if (arr.length > HIST + LAGS + 2) arr.shift();
    }
    while (S.shocks.length && S.shocks[0] < S.t - HIST) S.shocks.shift();
    while (S.shifts.length && S.shifts[0] < S.t - HIST) S.shifts.shift();
  }
  for (let i = 0; i < 520; i++) step();

  // ---------- emphasis driven by the headline word ----------
  const MODES = {
    noise: { rib: 1, arc: 0.35, bar: 0.5, bell: 0.5 },
    leadlag: { rib: 0.55, arc: 1, bar: 0.45, bell: 0.4 },
    cross: { rib: 0.6, arc: 0.35, bar: 1, bell: 0.6 },
    uncertainty: { rib: 0.6, arc: 0.35, bar: 0.6, bell: 1 },
  };
  const w = { ...MODES.noise };
  let target = MODES.noise;
  document.addEventListener('heromode', (e) => { if (MODES[e.detail]) target = MODES[e.detail]; });

  // ---------- camera ----------
  let dpr = 1, W = 0, H = 0, mobile = false;
  let yaw0 = -0.34, pitch = 0.78, drag = null, hoverRow = -2, userMoved = 0;
  const cam = { yaw: yaw0, cx: 0, cy: 0, sc: 1 };
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mobile = W < 760;
    cam.cx = mobile ? W * 0.5 : W * 0.6;
    cam.cy = mobile ? H * 0.8 : H * 0.53;
    cam.sc = mobile ? W * 0.36 : Math.min(W * 0.215, H * 0.44);
  }
  const DIST = 7;
  function P(x, y, z) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const d = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    const f = DIST / (DIST + d);
    return [cam.cx + x1 * cam.sc * f, cam.cy - z2 * cam.sc * f, d];
  }

  // ---------- scene geometry ----------
  const XH = 0.95, X0 = -1.25, FLOOR = -0.22, KZ = 0.024;
  const DX = (XH - X0) / (HIST - 1);
  const rowY = (j) => (j < 0 ? -0.95 : -0.68 + (1.5 * j) / (NF - 1));
  const poly = (pts) => { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); };

  function draw(now, frac) {
    for (const k in w) w[k] += (target[k] - w[k]) * 0.05;
    ctx.clearRect(0, 0, W, H);
    const n = leader.z.length;
    const X = (i) => XH - (n - 1 - i + frac) * DX;
    const fade = (i) => (mobile ? 0.3 + 0.7 * (i / n) : 0.08 + 0.92 * smooth(0.05, 0.8, i / n));
    const yFront = rowY(-1) - 0.12, yBack = rowY(NF - 1) + 0.1;

    // floor and grid
    ctx.lineWidth = 1;
    const fl = [P(X0, yFront, FLOOR), P(XH + 0.55, yFront, FLOOR), P(XH + 0.55, yBack, FLOOR), P(X0, yBack, FLOOR)];
    const gfl = ctx.createLinearGradient(fl[0][0], 0, fl[1][0], 0);
    gfl.addColorStop(0, rgba(C.bg2, 0)); gfl.addColorStop(0.5, rgba(C.bg2, 0.55)); gfl.addColorStop(1, rgba(C.bg2, 0.8));
    ctx.fillStyle = gfl;
    poly(fl); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(C.grid, 1);
    ctx.beginPath();
    for (let i = n - 1 - (S.t % 25); i >= 0; i -= 25) {
      const a = P(X(i), yFront, FLOOR), b = P(X(i), yBack, FLOOR);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    for (let j = -1; j < NF; j++) {
      const a = P(X0, rowY(j), FLOOR), b = P(XH + 0.55, rowY(j), FLOOR);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();

    // regime-shift markers on the floor
    ctx.font = `10px ${MONO}`;
    for (const s of S.shifts) {
      const i = n - 1 - (S.t - s);
      if (i < 0) continue;
      const a = P(X(i), yFront, FLOOR), b = P(X(i), yBack, FLOOR);
      ctx.strokeStyle = rgba(C.signal, 0.4); ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = rgba(C.signal, 0.7); ctx.fillText('regime shift', a[0] + 4, a[1] + 12);
    }

    // cross-section plane at "now"
    ctx.fillStyle = rgba(C.signal, 0.035);
    ctx.strokeStyle = rgba(C.signal, 0.22);
    poly([P(XH, yFront, FLOOR), P(XH, yBack, FLOOR), P(XH, yBack, 0.34), P(XH, yFront, 0.34)]); ctx.closePath(); ctx.fill(); ctx.stroke();

    // rows, far to near (painter's algorithm)
    const rows = [-1, ...fol.map((_, j) => j)];
    rows.sort((a, b) => P(0, rowY(b), 0)[2] - P(0, rowY(a), 0)[2]);
    const heads = [];
    for (const j of rows) {
      const isL = j < 0, f = isL ? null : fol[j], y = rowY(j);
      const zs = isL ? leader.z : f.z;
      const off = zs.length - n;
      const zAt = (i) => zs[i + off] * KZ;
      const pts = [];
      for (let i = 0; i < n; i++) pts.push(P(X(i), y, zAt(i)));

      // curtain to the floor: gives the ridgeline its body and hides the rows behind it
      const f0 = P(X(0), y, FLOOR), f1 = P(X(n - 1), y, FLOOR);
      const cur = ctx.createLinearGradient(f0[0], 0, f1[0], 0);
      cur.addColorStop(0, rgba(C.bg, 0.25)); cur.addColorStop(0.35, rgba(C.bg, 0.8)); cur.addColorStop(1, rgba(C.bg, 0.92));
      ctx.fillStyle = cur;
      ctx.beginPath(); ctx.moveTo(f0[0], f0[1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(f1[0], f1[1]); ctx.closePath(); ctx.fill();

      const hov = hoverRow === j;
      if (isL) {
        // conditional-volatility ribbon (GARCH σ_t): widens in volatile clusters
        ctx.fillStyle = rgba(C.signal, 0.16);
        ctx.beginPath();
        for (let i = 0; i < n; i++) { const p = P(X(i), y, zAt(i) + 0.014 * leader.sd[i + off]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        for (let i = n - 1; i >= 0; i--) { const p = P(X(i), y, zAt(i) - 0.014 * leader.sd[i + off]); ctx.lineTo(p[0], p[1]); }
        ctx.closePath(); ctx.fill();
      }
      const sideCol = !f || f.side === 0 ? null : f.side > 0 ? C.bid : C.ask;
      ctx.lineWidth = isL ? 2 : hov ? 2.2 : 1.2;
      for (let i = 1; i < n; i++) {
        const recent = i > n * 0.72;
        const col = isL ? C.signal : recent && sideCol ? sideCol : C.ink;
        const a = isL ? 0.95 * fade(i) : (recent && sideCol ? 0.95 : (0.3 + 0.35 * w.rib) * (hov ? 1.8 : 1)) * fade(i);
        ctx.strokeStyle = rgba(col, Math.min(1, a));
        ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      }

      // predictive distribution of the next return, standing in the future half-space
      const zNow = zAt(n - 1);
      const mu = isL ? 0 : f.mu, sd = isL ? leader.sd[leader.sd.length - 1] : f.sd;
      const zc = zNow * LEAK + mu * KZ;
      const span = isL ? 4.5 : 3;
      const bellW = (0.12 + 0.08 * w.bell) * (isL ? 1.4 : 1);
      const bcol = isL ? C.signal : sideCol || C.muted;
      const bell = (pdf) => { const out = []; for (let u = -span; u <= span + 1e-9; u += 0.15) out.push(P(XH + 0.02 + pdf(u) * bellW, y, zc + u * sd * KZ)); return out; };
      const bp = bell(isL ? tPdf : (u) => Math.exp(-0.5 * u * u));
      const b0 = P(XH + 0.02, y, zc - span * sd * KZ), b1 = P(XH + 0.02, y, zc + span * sd * KZ);
      ctx.fillStyle = rgba(bcol, (sideCol || isL ? 0.3 : 0.12) * (0.5 + 0.5 * w.bell));
      ctx.beginPath(); ctx.moveTo(b0[0], b0[1]); for (const p of bp) ctx.lineTo(p[0], p[1]); ctx.lineTo(b1[0], b1[1]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(bcol, (sideCol || isL ? 0.9 : 0.45) * (0.5 + 0.5 * w.bell));
      ctx.lineWidth = 1;
      poly(bp); ctx.stroke();
      if (isL) {
        // same-variance Gaussian, dashed: the gap between the two in the tails is the excess kurtosis
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = rgba(C.ink, 0.5 * w.bell + 0.15);
        poly(bell((u) => Math.exp(-0.5 * u * u))); ctx.stroke();
        ctx.setLineDash([]);
      }
      const hp = P(XH, y, zNow);
      ctx.fillStyle = rgba(isL ? C.signal : sideCol || C.ink2, 1);
      ctx.beginPath(); ctx.arc(hp[0], hp[1], isL ? 3 : 2, 0, Math.PI * 2); ctx.fill();

      // cross-sectional signal: posterior z-score as a bar, with long / short labels
      if (!isL) {
        const bz = clamp(f.zs * 0.45, -0.14, 0.14);
        const a = P(XH + 0.44, y, 0), b = P(XH + 0.44, y, bz);
        ctx.strokeStyle = rgba(sideCol || C.muted, (sideCol ? 1 : 0.5) * (0.45 + 0.55 * w.bar));
        ctx.lineWidth = sideCol ? 4 : 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.lineCap = 'butt';
        if (!mobile) {
          const lp = P(XH + 0.52, y, 0);
          ctx.font = `${sideCol ? 600 : 400} 10px ${MONO}`;
          ctx.fillStyle = sideCol ? rgba(sideCol, 1) : rgba(C.muted, 0.75);
          ctx.fillText(f.name + (f.side > 0 ? '  LONG' : f.side < 0 ? '  SHORT' : ''), lp[0], lp[1] + 3);
        }
      }
      heads.push({ j, x: hp[0], y: hp[1] });
    }

    // lead–lag propagation: arcs from a leader shock at s to each follower at s + ℓ̂
    const lz = (i) => leader.z[i + leader.z.length - n] * KZ;
    for (const s of S.shocks) {
      const i0 = n - 1 - (S.t - s);
      if (i0 < 0) continue;
      for (let j = 0; j < NF; j++) {
        const f = fol[j], l = mapLag(f), conf = f.p[l];
        if (!l || conf < 0.6 || S.t - s > 70) continue;
        const fz = (i) => f.z[i + f.z.length - n] * KZ;
        const A = [X(i0), rowY(-1), lz(i0)];
        const i1 = i0 + l;
        const prog = clamp((S.t + frac - s) / l, 0, 1);
        const B = i1 <= n - 1 ? [X(i1), rowY(j), fz(i1)] : [XH, rowY(j), fz(n - 1)];
        const Cc = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, Math.max(A[2], B[2]) + 0.16];
        ctx.strokeStyle = rgba(C.signal, (0.1 + 0.55 * w.arc) * conf * (1 - (S.t - s) / 70));
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        let last;
        for (let q = 0; q <= 24; q++) {
          const u = (q / 24) * prog, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
          const p = P(a * A[0] + b * Cc[0] + c * B[0], a * A[1] + b * Cc[1] + c * B[1], a * A[2] + b * Cc[2] + c * B[2]);
          q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
          last = p;
        }
        ctx.stroke();
        if (prog < 1) { // signal still in flight
          ctx.fillStyle = rgba(C.signal, 0.95);
          ctx.beginPath(); ctx.arc(last[0], last[1], 2.6, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // labels
    if (!mobile) {
      ctx.font = `italic 14px ${MATH}`;
      const lh = heads.find((h) => h.j === -1);
      ctx.fillStyle = rgba(C.signal, 0.95);
      if (lh) ctx.fillText('leader: Student-t tails vs Gaussian', lh.x + 30, lh.y + 26);
      const pp = P(XH + 0.02, yBack, 0.4);
      ctx.fillStyle = rgba(C.ink2, 0.9);
      ctx.fillText('posterior predictive  p(r | ℱ)', pp[0] - 60, pp[1]);
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = rgba(C.muted, 0.9);
      const tp = P(X0 + 0.5, yFront - 0.06, FLOOR);
      ctx.fillText('time →', tp[0], tp[1] + 14);
      const cp = P(XH, yFront, FLOOR);
      ctx.fillText('cross-section at t', cp[0] - 40, cp[1] + 18);
    }
    return heads;
  }

  // ---------- HUD ----------
  const sgn = (v, d) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
  function updateHud() {
    if (!hud) return;
    const r = leader.r.slice(-HIST);
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    let m2 = 0, m4 = 0;
    for (const x of r) { const d = x - m; m2 += d * d; m4 += d * d * d * d; }
    m2 /= r.length; m4 /= r.length;
    const vals = {
      t: String(S.t).padStart(6, '0'),
      vol: leader.sd[leader.sd.length - 1].toFixed(2),
      kurt: sgn(m4 / (m2 * m2) - 3, 1),
      acc: Math.round(S.acc * 100) + '%',
      ic: sgn(S.ic, 3),
      ls: fol.filter((f) => f.side > 0).length + ' / ' + fol.filter((f) => f.side < 0).length,
      pnl: sgn(S.pnl, 2) + '%',
    };
    for (const k in vals) { const el = hud.querySelector(`[data-k="${k}"]`); if (el) el.textContent = vals[k]; }
  }

  // ---------- interaction: drag to rotate, hover a stock ----------
  let heads = [];
  const showTip = (mx, my) => {
    if (!tip) return;
    if (hoverRow === -2) { tip.classList.remove('on'); return; }
    let html;
    if (hoverRow === -1) {
      html = `<b>Leader</b> · index future<br>GARCH σ<sub>t</sub> <b>${leader.sd[leader.sd.length - 1].toFixed(2)}</b> · Student-t₄ shocks + jumps`;
    } else {
      const f = fol[hoverRow], l = mapLag(f);
      const bars = Array.from(f.p).map((p, k) => `<span class="pl"><i style="height:${Math.max(2, p * 26)}px${k === l ? ';background:var(--signal)' : ''}"></i>${k === 0 ? '∅' : k}</span>`).join('');
      html = `<b>${f.name}</b> · ${f.side > 0 ? '<span class="L">LONG</span>' : f.side < 0 ? '<span class="S">SHORT</span>' : 'flat'}<br>
        posterior over lag ℓ <span class="pls">${bars}</span><br>
        β̂ <b>${l ? f.m[l].toFixed(2) : '0'}</b> · E[r<sub>t+1</sub>] <b>${sgn(f.mu, 3)}</b> · z <b>${sgn(f.zs, 2)}</b><br>
        <span class="k">hidden truth: ${f.beta === 0 ? 'no link' : 'lag ' + f.lag + ', β ' + f.beta.toFixed(2)}</span>`;
    }
    tip.innerHTML = html;
    tip.classList.add('on');
    const hw = hero.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(mx + 16, 8, hw - tw - 8) + 'px';
    tip.style.top = clamp(my - th - 14, 70, hero.clientHeight - th - 60) + 'px';
  };
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
  canvas.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('dragging'); });
  canvas.addEventListener('pointerleave', () => { hoverRow = -2; tip && tip.classList.remove('on'); });
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (drag) {
      yaw0 += (e.clientX - drag.x) * 0.006;
      pitch = clamp(pitch + (e.clientY - drag.y) * 0.004, 0.12, 1.2);
      drag = { x: e.clientX, y: e.clientY };
      userMoved = performance.now();
      if (!raf) { cam.yaw = yaw0; heads = draw(performance.now(), acc); }
      return;
    }
    let best = -2, bd = 26 * 26;
    for (const h of heads) { const d = (h.x - mx) ** 2 + (h.y - my) ** 2; if (d < bd) { bd = d; best = h.j; } }
    hoverRow = best;
    showTip(mx, my);
    if (!raf) heads = draw(performance.now(), acc);
  });

  // ---------- loop ----------
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const TPS = 6;
  let raf = 0, last = 0, acc = 0, visible = true, hudT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    acc += dt * TPS;
    while (acc >= 1) { step(); acc -= 1; }
    const idle = now - userMoved > 4000;
    cam.yaw = yaw0 + (idle ? 0.1 * Math.sin(now / 9000) : 0);
    heads = draw(now, acc);
    if (now - hudT > 250) { updateHud(); hudT = now; }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    if (reduce.matches || !visible || document.hidden) {
      cam.yaw = yaw0;
      for (let k = 0; k < 60; k++) heads = draw(0, 0); // let the emphasis weights settle
      updateHud();
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  resize(); start();
  window.addEventListener('resize', () => { resize(); heads = draw(performance.now(), acc); });
  document.addEventListener('visibilitychange', start);
  document.addEventListener('themechange', () => { readColors(); if (!raf) heads = draw(performance.now(), acc); });
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
