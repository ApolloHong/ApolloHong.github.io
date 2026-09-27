/*
 * Lab: four small models computed live in the browser.
 *   surface — SSVI implied-volatility surface with no-arbitrage checks (Gatheral & Jacquier, 2014)
 *   dbdp    — deep backward dynamic programming for a d-dimensional HJB equation (Huré, Pham & Warin, 2020)
 *   sb      — Schrödinger bridge via log-domain Sinkhorn / IPF, sampled as Brownian bridges
 *   kyle    — continuous-time Kyle (1985) / Back (1992) insider-trading equilibrium
 *   lob     — order book under Hawkes order flow and informed trading: VPIN-adjusted spread, adverse-selection markouts
 *   exec    — smart order routing across venues with transient (propagator) market impact and the square-root law
 */
(function () {
  const root = document.documentElement;
  const lab = document.getElementById('lab');
  if (!lab) return;

  // ---------- shared helpers ----------
  const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let C = {};
  const readColors = () => {
    for (const k of ['bg', 'bg-2', 'ink', 'ink-2', 'muted', 'line', 'line-2', 'grid', 'signal', 'bid', 'ask', 'seq-0', 'seq-1']) {
      C[k.replace('-', '')] = hex(css('--' + k) || '#888888');
    }
  };
  readColors();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONO = "'JetBrains Mono', ui-monospace, monospace";
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  let spare = null;
  const randn = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = Math.random();
    const v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  function surface(canvas, onResize) {
    const ctx = canvas.getContext('2d');
    const s = { ctx, W: 0, H: 0, dpr: 1 };
    let ready = false;
    const fit = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.W = canvas.clientWidth; s.H = canvas.clientHeight;
      canvas.width = Math.round(s.W * s.dpr); canvas.height = Math.round(s.H * s.dpr);
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      if (ready && onResize) onResize();   // not during construction: the caller hasn't stored `s` yet
    };
    new ResizeObserver(fit).observe(canvas);
    fit();
    ready = true;
    return s;
  }
  const $ = (panel, sel) => panel.querySelector(sel);
  const setOut = (panel, name, text) => { const o = panel.querySelector(`[data-out="${name}"]`); if (o) o.textContent = text; };
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';

  function tipAt(tip, fig, x, y, html) {
    tip.innerHTML = html;
    tip.classList.add('on');
    const fw = fig.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(x + 14, 8, fw - tw - 8) + 'px';
    tip.style.top = clamp(y - th - 12, 8, fig.clientHeight - th - 8) + 'px';
  }

  // Simple axis helper for 2-D panes.
  function frame(ctx, x0, y0, w, h, xr, yr) {
    return {
      X: (v) => x0 + ((v - xr[0]) / (xr[1] - xr[0])) * w,
      Y: (v) => y0 + h - ((v - yr[0]) / (yr[1] - yr[0])) * h,
      x0, y0, w, h, xr, yr,
    };
  }
  function drawAxes(ctx, f, xt, yt, xl, yl) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(C.grid, 1);
    ctx.beginPath();
    for (const v of yt) { const y = Math.round(f.Y(v)) + 0.5; ctx.moveTo(f.x0, y); ctx.lineTo(f.x0 + f.w, y); }
    ctx.stroke();
    ctx.strokeStyle = rgba(C.line2, 1);
    ctx.beginPath();
    ctx.moveTo(f.x0, f.y0 + f.h + 0.5); ctx.lineTo(f.x0 + f.w, f.y0 + f.h + 0.5);
    ctx.stroke();
    ctx.fillStyle = rgba(C.muted, 1);
    ctx.font = `10px ${MONO}`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (const [v, lab] of xt) ctx.fillText(lab, f.X(v), f.y0 + f.h + 6);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    for (const v of yt) ctx.fillText(typeof v === 'number' ? +v.toFixed(3) + '' : v, f.x0 - 6, f.Y(v));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (xl) { ctx.textAlign = 'right'; ctx.fillText(xl, f.x0 + f.w, f.y0 + f.h + 30); ctx.textAlign = 'left'; }
    if (yl) ctx.fillText(yl, f.x0, f.y0 - 10);
  }

  // =====================================================================
  // 1. SSVI implied-volatility surface
  // =====================================================================
  function SurfaceDemo(panel) {
    const fig = $(panel, '.lab-fig'), canvas = $(panel, 'canvas'), tip = $(panel, '.tip');
    const P = { s0: 0.30, sInf: 0.20, rho: -0.65, eta: 1.1 };
    const GAMMA = 0.5, KAPPA = 1.6;
    const NK = 30, NT = 24, KMAX = 0.5, TMIN = 0.06, TMAX = 2.0;
    const IVLO = 0.05, IVHI = 0.65;
    let yaw = -0.62, pitch = 0.5, drag = null, hover = null, idle = 0, running = false, raf = 0, dirty = true;
    let iv = [], S;

    const atm = (T) => P.sInf + (P.s0 - P.sInf) * Math.exp(-KAPPA * T);
    const theta = (T) => atm(T) ** 2 * T;
    const phi = (th) => P.eta / (th ** GAMMA * (1 + th) ** (1 - GAMMA));
    const w = (k, th) => { const p = phi(th); return (th / 2) * (1 + P.rho * p * k + Math.sqrt((p * k + P.rho) ** 2 + 1 - P.rho ** 2)); };
    const vol = (k, T) => Math.sqrt(w(k, theta(T)) / T);
    const kAt = (i) => -KMAX + (2 * KMAX * i) / (NK - 1);
    const TAt = (j) => TMIN + ((TMAX - TMIN) * j) / (NT - 1);

    function compute() {
      iv = [];
      for (let i = 0; i < NK; i++) { iv.push([]); for (let j = 0; j < NT; j++) iv[i].push(vol(kAt(i), TAt(j))); }
      // no-arbitrage checks (Gatheral–Jacquier 2014, Thms 4.1 & 4.2), on a fine θ / T grid
      let fly = true, cal = true, prevTh = 0;
      const r = Math.abs(P.rho);
      for (let q = 1; q <= 400; q++) {
        const T = (q / 400) * TMAX, th = theta(T), p = phi(th);
        if (th * p * (1 + r) >= 4 || th * p * p * (1 + r) > 4) fly = false;
        if (th < prevTh) cal = false;
        prevTh = th;
      }
      const b1 = $(panel, '[data-badge="fly"]'), b2 = $(panel, '[data-badge="cal"]');
      b1.className = 'badge ' + (fly ? 'ok' : 'bad'); b1.textContent = 'no butterfly arbitrage' + (fly ? '' : ' (violated)');
      b2.className = 'badge ' + (cal ? 'ok' : 'bad'); b2.textContent = 'no calendar arbitrage' + (cal ? '' : ' (violated)');
      const h = 1e-3;
      setOut(panel, 'atm1m', pct(vol(0, 1 / 12)));
      setOut(panel, 'atm2y', pct(vol(0, 2)));
      setOut(panel, 'skew', ((vol(h, 1) - vol(-h, 1)) / (2 * h)).toFixed(3));
      setOut(panel, 'wing', pct(vol(Math.log(0.8), 0.25) - vol(0, 0.25)));
      dirty = true;
    }

    const zOf = (v) => ((v - IVLO) / (IVHI - IVLO)) * 1.25 - 0.45;
    const FLOOR = zOf(IVLO);
    function proj(x, y, z) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      const sc = Math.min(S.W * 0.3, S.H * 0.4);
      return { x: S.W * 0.5 + x1 * sc, y: S.H * 0.55 - (z * cp + y1 * sp) * sc, d: y1 * cp - z * sp };
    }
    const vx = (i) => kAt(i) / KMAX, vy = (j) => ((TAt(j) - TMIN) / (TMAX - TMIN)) * 2 - 1;

    function draw() {
      const { ctx, W, H } = S;
      ctx.clearRect(0, 0, W, H);
      // floor + frame
      const fl = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => proj(x, y, FLOOR));
      ctx.fillStyle = rgba(C.bg2, 1);
      ctx.strokeStyle = rgba(C.line2, 1);
      ctx.lineWidth = 1;
      ctx.beginPath(); fl.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = rgba(C.grid, 1);
      ctx.beginPath();
      for (let q = 1; q < 4; q++) {
        const t = -1 + q * 0.5;
        let a = proj(t, -1, FLOOR), b = proj(t, 1, FLOOR); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        a = proj(-1, t, FLOOR); b = proj(1, t, FLOOR); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      // vertical axis at the back corner
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const back = corners.reduce((b, c) => (proj(c[0], c[1], FLOOR).d > proj(b[0], b[1], FLOOR).d ? c : b));
      ctx.strokeStyle = rgba(C.line2, 1);
      ctx.fillStyle = rgba(C.muted, 1);
      ctx.font = `10px ${MONO}`;
      ctx.beginPath();
      const a0 = proj(back[0], back[1], FLOOR), a1 = proj(back[0], back[1], zOf(0.6));
      ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke();
      for (const v of [0.2, 0.4, 0.6]) { const p = proj(back[0], back[1], zOf(v)); ctx.fillText(pct(v, 0), p.x + 6, p.y + 3); }
      const top = proj(back[0], back[1], zOf(0.6)); ctx.fillText('implied vol', top.x + 6, top.y - 12);

      // quads, far to near
      const q = [];
      for (let i = 0; i < NK - 1; i++) for (let j = 0; j < NT - 1; j++) {
        const pts = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => proj(vx(a), vy(b), zOf(iv[a][b])));
        const avg = (iv[i][j] + iv[i + 1][j] + iv[i + 1][j + 1] + iv[i][j + 1]) / 4;
        q.push({ pts, avg, d: (pts[0].d + pts[1].d + pts[2].d + pts[3].d) / 4 });
      }
      q.sort((a, b) => b.d - a.d);
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = rgba(C.bg, 0.55);
      for (const f of q) {
        const t = clamp((f.avg - IVLO) / (IVHI - IVLO), 0, 1);
        ctx.fillStyle = rgba(mix(C.seq0, C.seq1, Math.pow(t, 0.8)), 0.96);
        ctx.beginPath();
        f.pts.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }

      // edge labels on the floor
      ctx.fillStyle = rgba(C.muted, 1);
      for (const [k, l] of [[-0.4, 'k=-0.4'], [0, 'ATM'], [0.4, 'k=+0.4']]) { const p = proj(k / KMAX, -1.12, FLOOR); ctx.fillText(l, p.x - 14, p.y + 12); }
      for (const [T, l] of [[0.25, '3M'], [1, '1Y'], [2, '2Y']]) { const p = proj(1.12, ((T - TMIN) / (TMAX - TMIN)) * 2 - 1, FLOOR); ctx.fillText(l, p.x + 4, p.y + 4); }
      const p = proj(1.35, 0, FLOOR); ctx.fillText('maturity T', p.x, p.y + 4);

      // hover: highlight the smile at that maturity
      if (hover) {
        const j = hover.j;
        ctx.strokeStyle = rgba(C.ink, 0.95);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < NK; i++) { const r = proj(vx(i), vy(j), zOf(iv[i][j])); i ? ctx.lineTo(r.x, r.y) : ctx.moveTo(r.x, r.y); }
        ctx.stroke();
        const r = proj(vx(hover.i), vy(j), zOf(iv[hover.i][j]));
        ctx.fillStyle = rgba(C.ink, 1);
        ctx.beginPath(); ctx.arc(r.x, r.y, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(C.bg, 1); ctx.lineWidth = 2; ctx.stroke();
      }
      dirty = false;
    }

    function loop() {
      if (!drag && !hover && !reduce && ++idle > 90) { yaw += 0.0022; dirty = true; }
      if (dirty) draw();
      raf = requestAnimationFrame(loop);
    }

    canvas.classList.add('grab');
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); tip.classList.remove('on'); hover = null; });
    canvas.addEventListener('pointerup', () => { drag = null; idle = 0; });
    canvas.addEventListener('pointerleave', () => { hover = null; tip.classList.remove('on'); dirty = true; idle = 0; });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      idle = 0;
      if (drag) {
        yaw += (e.clientX - drag.x) * 0.008;
        pitch = clamp(pitch + (e.clientY - drag.y) * 0.005, 0.12, 1.25);
        drag = { x: e.clientX, y: e.clientY };
        dirty = true;
        return;
      }
      let best = null, bd = 22 * 22;
      for (let i = 0; i < NK; i++) for (let j = 0; j < NT; j++) {
        const r = proj(vx(i), vy(j), zOf(iv[i][j])), dd = (r.x - mx) ** 2 + (r.y - my) ** 2;
        if (dd < bd) { bd = dd; best = { i, j }; }
      }
      hover = best; dirty = true;
      if (best) {
        const k = kAt(best.i), T = TAt(best.j);
        tipAt(tip, fig, mx, my, `k <b>${k.toFixed(2)}</b> · K/F <b>${Math.exp(k).toFixed(2)}</b><br>T <b>${T.toFixed(2)}y</b> · σ <b>${pct(iv[best.i][best.j])}</b>`);
      } else tip.classList.remove('on');
    });

    panel.querySelectorAll('input[data-p]').forEach((inp) => {
      const upd = () => { P[inp.dataset.p] = +inp.value; setOut(panel, inp.dataset.p, (+inp.value).toFixed(2)); compute(); };
      inp.addEventListener('input', upd);
      inp.value = P[inp.dataset.p];
      setOut(panel, inp.dataset.p, P[inp.dataset.p].toFixed(2));
    });
    $(panel, '[data-act="reset"]').addEventListener('click', () => {
      Object.assign(P, { s0: 0.30, sInf: 0.20, rho: -0.65, eta: 1.1 });
      panel.querySelectorAll('input[data-p]').forEach((inp) => { inp.value = P[inp.dataset.p]; setOut(panel, inp.dataset.p, P[inp.dataset.p].toFixed(2)); });
      compute();
    });

    S = surface(canvas, () => { dirty = true; if (!running) draw(); });
    compute();
    return {
      start() { if (running) return; running = true; draw(); raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      redraw() { dirty = true; draw(); },
    };
  }

  // =====================================================================
  // 2. Deep backward scheme for a d-dimensional HJB equation
  //    ∂t u + Δu − λ‖∇u‖² = 0,  u(T,x) = ln((1+‖x‖²)/2),  x ∈ R^d
  // =====================================================================
  function DbdpDemo(panel) {
    const fig = $(panel, '.lab-fig'), canvas = $(panel, 'canvas'), tip = $(panel, '.tip');
    const DIMS = [1, 2, 5, 10, 20, 50, 100, 200];
    const T = 1, LAMBDA = 1, FAN = 70;
    const st = { d: 100, N: 20, M: 2000 };
    let res = null, shown = 0, running = false, timer = 0, S;
    const history = [];

    // Lanczos log-gamma
    function lgamma(z) {
      const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
      if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
      z -= 1; let x = c[0];
      for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
      const t = z + g + 0.5;
      return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
    }
    // Hopf–Cole: u(0,0) = −(1/λ) ln E[exp(−λ g(√(2T) ξ))];  with λ=1, e^{−g} = 2/(1+2T r²), r ~ chi_d
    function exact(d) {
      const lc = (1 - d / 2) * Math.log(2) - lgamma(d / 2);
      const R = Math.sqrt(d) + 12, n = 8000, h = R / n;
      let acc = 0;
      for (let q = 0; q <= n; q++) {
        const r = q * h;
        const dens = r === 0 ? (d === 1 ? Math.exp(lc) : 0) : Math.exp(lc + (d - 1) * Math.log(r) - r * r / 2);
        acc += (q === 0 || q === n ? 0.5 : 1) * dens * (2 / (1 + 2 * T * r * r));
      }
      return -Math.log(acc * h) / LAMBDA;
    }

    // least squares on ψ(L) = [1, L, L², L³], L standardised; returns coefficients and scaling
    function fitCubic(L, y) {
      const n = L.length;
      let mu = 0, sd = 0;
      for (let i = 0; i < n; i++) mu += L[i];
      mu /= n;
      for (let i = 0; i < n; i++) sd += (L[i] - mu) ** 2;
      sd = Math.sqrt(sd / n) || 1;
      const A = Array.from({ length: 4 }, () => new Float64Array(5));
      for (let i = 0; i < n; i++) {
        const z = (L[i] - mu) / sd, f = [1, z, z * z, z * z * z];
        for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) A[r][c] += f[r] * f[c]; A[r][4] += f[r] * y[i]; }
      }
      for (let r = 0; r < 4; r++) A[r][r] += 1e-8 * n;
      for (let c = 0; c < 4; c++) {             // Gaussian elimination with partial pivoting
        let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
        [A[c], A[p]] = [A[p], A[c]];
        for (let r = 0; r < 4; r++) if (r !== c) { const m = A[r][c] / A[c][c]; for (let k = c; k < 5; k++) A[r][k] -= m * A[c][k]; }
      }
      const b = [0, 1, 2, 3].map((r) => A[r][4] / A[r][r]);
      const val = (Lv) => { const z = (Lv - mu) / sd; return b[0] + b[1] * z + b[2] * z * z + b[3] * z * z * z; };
      const dL = (Lv) => { const z = (Lv - mu) / sd; return (b[1] + 2 * b[2] * z + 3 * b[3] * z * z) / sd; };
      return { val, dL };
    }

    function run() {
      const t0 = performance.now();
      const { d, N, M } = st, dt = T / N, sq = Math.sqrt(2 * dt);
      // forward: X_{n+1} = X_n + √2 ΔW, stored as s = ‖X‖² per step
      const X = new Float64Array(M * d);
      const s = Array.from({ length: N + 1 }, () => new Float64Array(M));
      const fan = Array.from({ length: N + 1 }, () => new Float64Array(FAN));
      for (let n = 1; n <= N; n++) {
        for (let i = 0; i < M; i++) {
          let acc = 0, o = i * d;
          for (let k = 0; k < d; k++) { X[o + k] += sq * randn(); acc += X[o + k] * X[o + k]; }
          s[n][i] = acc;
          if (i < FAN) fan[n][i] = X[o];
        }
      }
      // backward: Y_n = E[ Y_{n+1} − λ‖∇u_{n+1}‖² Δt | X_n ], fitted on features of ‖X_n‖²
      let Y = new Float64Array(M), G = new Float64Array(M);
      for (let i = 0; i < M; i++) {
        const v = s[N][i];
        Y[i] = Math.log((1 + v) / 2);
        G[i] = (4 * v) / (1 + v) ** 2;             // ‖∇g‖² with g' = 1/(1+s)
      }
      const steps = [];
      let y0 = 0;
      for (let n = N - 1; n >= 0; n--) {
        const target = new Float64Array(M);
        for (let i = 0; i < M; i++) target[i] = Y[i] - LAMBDA * G[i] * dt;
        const L = new Float64Array(M);
        for (let i = 0; i < M; i++) L[i] = Math.log(1 + s[n][i]);
        const sample = [];
        for (let i = 0; i < Math.min(M, 500); i++) sample.push([L[i], target[i]]);
        if (n === 0) {                               // X_0 = 0 for every path: the regression is a mean
          y0 = target.reduce((a, b) => a + b, 0) / M;
          steps.push({ n, sample, fit: null, y: y0 });
          break;
        }
        const f = fitCubic(L, target);
        let ss = 0, sr = 0, mean = 0;
        for (let i = 0; i < M; i++) mean += target[i];
        mean /= M;
        for (let i = 0; i < M; i++) {
          const yi = f.val(L[i]), gs = f.dL(L[i]) / (1 + s[n][i]); // ∂u/∂s
          ss += (target[i] - mean) ** 2; sr += (target[i] - yi) ** 2;
          Y[i] = yi; G[i] = 4 * s[n][i] * gs * gs;
        }
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < M; i++) { lo = Math.min(lo, L[i]); hi = Math.max(hi, L[i]); }
        steps.push({ n, sample, fit: f.val, lo, hi, r2: 1 - sr / ss, y: mean });
      }
      const ms = performance.now() - t0;
      const ref = exact(d);
      res = { d, N, M, fan, steps, y0, ref, ms };
      history.unshift({ d, N, M, y0, ref });
      if (history.length > 5) history.pop();
      renderHistory();
      shown = 0;
      clearInterval(timer);
      if (reduce) { shown = steps.length; draw(); finish(); return; }
      timer = setInterval(() => { shown++; draw(); if (shown >= steps.length) { clearInterval(timer); finish(); } }, 140);
      draw();
      setOut(panel, 'y0', '…'); setOut(panel, 'err', '…');
      setOut(panel, 'ref', ref.toFixed(4));
      setOut(panel, 'ms', ms.toFixed(0) + ' ms');
    }
    function finish() {
      setOut(panel, 'y0', res.y0.toFixed(4));
      setOut(panel, 'ref', res.ref.toFixed(4));
      setOut(panel, 'err', pct(Math.abs(res.y0 - res.ref) / Math.abs(res.ref), 2));
      setOut(panel, 'ms', res.ms.toFixed(0) + ' ms');
    }
    function renderHistory() {
      const el = $(panel, '[data-history]');
      el.innerHTML = history.map((h) => `<div><span class="k">d=${h.d} · N=${h.N} · M=${h.M}</span><span class="v">${h.y0.toFixed(3)} <span class="k">vs</span> ${h.ref.toFixed(3)}</span></div>`).join('');
    }

    function draw() {
      if (!res) return;
      const { ctx, W, H } = S;
      ctx.clearRect(0, 0, W, H);
      const narrow = W < 620;
      const pad = 44;
      const w1 = narrow ? W - pad - 24 : (W - pad * 2 - 48) * 0.5, h1 = narrow ? (H - 150) / 2 : H - 130;
      const idx = Math.max(0, Math.min(shown, res.steps.length) - 1);
      const done = !res.steps[idx].fit;
      // at n = 0 every path starts at the origin, so keep showing the last real regression
      const cur = done && idx > 0 ? res.steps[idx - 1] : res.steps[idx];
      const tNow = shown ? res.steps[idx].n / res.N : 1;

      // left: forward paths of the first coordinate
      let amp = 0;
      for (const row of res.fan) for (const v of row) amp = Math.max(amp, Math.abs(v));
      amp = Math.ceil(amp * 1.1 * 2) / 2 || 1;
      const f1 = frame(ctx, pad, 56, w1, h1, [0, 1], [-amp, amp]);
      drawAxes(ctx, f1, [[0, '0'], [0.5, '0.5'], [1, 'T=1']], [-amp, 0, amp], 'time t', 'X¹ₜ — first of d coordinates');
      ctx.lineWidth = 1;
      for (let i = 0; i < FAN; i++) {
        ctx.strokeStyle = rgba(C.ink, 0.22);
        ctx.beginPath();
        for (let n = 0; n <= res.N; n++) { const x = f1.X(n / res.N), y = f1.Y(res.fan[n][i]); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      // the part of time already solved backward
      ctx.fillStyle = rgba(C.signal, 0.08);
      ctx.fillRect(f1.X(tNow), f1.y0, f1.X(1) - f1.X(tNow), f1.h);
      ctx.strokeStyle = rgba(C.signal, 0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f1.X(tNow), f1.y0 - 4); ctx.lineTo(f1.X(tNow), f1.y0 + f1.h); ctx.stroke();
      ctx.fillStyle = rgba(C.signal, 1);
      ctx.font = `10px ${MONO}`;
      ctx.fillText(`← backward sweep, tₙ = ${tNow.toFixed(2)}`, clamp(f1.X(tNow) + 6, f1.x0, f1.x0 + f1.w - 170), f1.y0 + 12);

      // right: the regression performed at the current step
      const ox = narrow ? pad : pad * 2 + w1 + 20, oy = narrow ? 56 + h1 + 70 : 56;
      let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity;
      for (const [a, b] of cur.sample) { xl = Math.min(xl, a); xh = Math.max(xh, a); yl = Math.min(yl, b); yh = Math.max(yh, b); }
      if (xh - xl < 0.5) { xl -= 0.5; xh += 0.5; }
      if (yh - yl < 0.5) { yl -= 0.25; yh += 0.25; }
      const f2 = frame(ctx, ox, oy, w1, h1, [xl, xh], [yl, yh]);
      const yt = [yl, (yl + yh) / 2, yh].map((v) => +v.toFixed(2));
      drawAxes(ctx, f2, [[xl, xl.toFixed(1)], [xh, xh.toFixed(1)]], yt, 'ln(1 + ‖Xₙ‖²)', `regression target at step n = ${cur.n}`);
      ctx.fillStyle = rgba(C.ink, 0.35);
      for (const [a, b] of cur.sample) ctx.fillRect(f2.X(a) - 1.2, f2.Y(b) - 1.2, 2.4, 2.4);
      if (done) {
        ctx.fillStyle = rgba(C.bg2, 0.92);
        ctx.fillRect(f2.x0 + 4, f2.y0 + 2, 250, 44);
        ctx.fillStyle = rgba(C.signal, 1);
        ctx.fillText(`Y₀ (scheme) = ${res.y0.toFixed(4)}`, f2.x0 + 12, f2.y0 + 18);
        ctx.fillStyle = rgba(C.bid, 1);
        ctx.fillText(`u(0,0) exact = ${res.ref.toFixed(4)}`, f2.x0 + 12, f2.y0 + 36);
      }
      if (cur.fit) {
        ctx.strokeStyle = rgba(C.signal, 1);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let q = 0; q <= 80; q++) { const L = xl + ((xh - xl) * q) / 80, x = f2.X(L), y = f2.Y(cur.fit(L)); q ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
        ctx.fillStyle = rgba(C.ink2, 1);
        ctx.textAlign = 'right';
        ctx.fillText(`R² = ${cur.r2.toFixed(3)}`, f2.x0 + f2.w - 4, f2.y0 + f2.h - 8);
        ctx.textAlign = 'left';
      } else {
        ctx.strokeStyle = rgba(C.signal, 1);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(f2.x0, f2.Y(res.y0)); ctx.lineTo(f2.x0 + f2.w, f2.Y(res.y0)); ctx.stroke();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = rgba(C.bid, 1);
        ctx.beginPath(); ctx.moveTo(f2.x0, f2.Y(res.ref)); ctx.lineTo(f2.x0 + f2.w, f2.Y(res.ref)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(C.ink2, 1);
        ctx.fillText(`Y₀ = ${res.y0.toFixed(4)}   exact = ${res.ref.toFixed(4)}`, f2.x0 + 8, f2.y0 + 14);
      }
    }

    const dSel = $(panel, 'input[data-p="d"]'), nSel = $(panel, 'input[data-p="N"]'), mSel = $(panel, 'input[data-p="M"]');
    const sync = () => {
      st.d = DIMS[+dSel.value]; st.N = +nSel.value; st.M = +mSel.value;
      setOut(panel, 'd', st.d); setOut(panel, 'N', st.N); setOut(panel, 'M', st.M);
    };
    [dSel, nSel, mSel].forEach((el) => el.addEventListener('input', sync));
    [dSel, nSel, mSel].forEach((el) => el.addEventListener('change', run));
    dSel.value = DIMS.indexOf(st.d); nSel.value = st.N; mSel.value = st.M; sync();
    $(panel, '[data-act="run"]').addEventListener('click', run);

    canvas.addEventListener('pointermove', (e) => {
      if (!res) return;
      const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const cur = res.steps[Math.max(0, Math.min(shown, res.steps.length) - 1)];
      tipAt(tip, fig, mx, my, `d <b>${res.d}</b> · paths <b>${res.M}</b> · steps <b>${res.N}</b><br>step n <b>${cur.n}</b> · E[target] <b>${cur.y.toFixed(3)}</b>`);
    });
    canvas.addEventListener('pointerleave', () => tip.classList.remove('on'));

    S = surface(canvas, () => draw());
    return {
      start() { if (running) return; running = true; if (!res) run(); else draw(); },
      stop() { running = false; },
      redraw() { draw(); },
    };
  }

  // =====================================================================
  // 3. Schrödinger bridge: Gaussian → target, via Sinkhorn/IPF + Brownian bridges
  // =====================================================================
  function SbDemo(panel) {
    const fig = $(panel, '.lab-fig'), canvas = $(panel, 'canvas'), tip = $(panel, '.tip');
    const mini = $(panel, 'canvas.mini');
    const N = 240, K = 48;
    const st = { eps: 0.08, target: 'moons' };
    let src, tgt, paths, errs = [], cost = 0, iters = 0, tau = 0, hold = 0, playing = !reduce, running = false, raf = 0, last = 0, S, M;

    const gauss2 = (s) => [randn() * s, randn() * s];
    const TARGETS = {
      moons: () => {
        const t = Math.random() * Math.PI, up = Math.random() < 0.5;
        return up ? [Math.cos(t) - 0.5 + randn() * 0.06, Math.sin(t) - 0.25 + randn() * 0.06]
          : [1 - Math.cos(t) - 0.5 + randn() * 0.06, -Math.sin(t) + 0.25 + randn() * 0.06];
      },
      ring: () => { const k = Math.floor(Math.random() * 8), a = (k * Math.PI) / 4; return [1.15 * Math.cos(a) + randn() * 0.07, 1.15 * Math.sin(a) + randn() * 0.07]; },
      spiral: () => { const t = Math.sqrt(Math.random()) * 3.4 * Math.PI, r = 0.1 + t / (3.4 * Math.PI) * 1.2; return [r * Math.cos(t) + randn() * 0.04, r * Math.sin(t) + randn() * 0.04]; },
      checker: () => {
        for (;;) {
          const x = Math.random() * 2.6 - 1.3, y = Math.random() * 2.6 - 1.3;
          if ((Math.floor((x + 1.3) / 0.65) + Math.floor((y + 1.3) / 0.65)) % 2 === 0) return [x, y];
        }
      },
    };

    function solve() {
      src = Array.from({ length: N }, () => gauss2(0.55));
      tgt = Array.from({ length: N }, TARGETS[st.target]);
      const eps = st.eps, Cm = new Float64Array(N * N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const dx = src[i][0] - tgt[j][0], dy = src[i][1] - tgt[j][1];
        Cm[i * N + j] = (dx * dx + dy * dy) / 2;
      }
      // log-domain Sinkhorn = IPF on the static Schrödinger problem
      const f = new Float64Array(N), g = new Float64Array(N), la = Math.log(1 / N);
      errs = [];
      const lse = new Float64Array(N);
      for (iters = 1; iters <= 400; iters++) {
        for (let i = 0; i < N; i++) {
          let m = -Infinity; const o = i * N;
          for (let j = 0; j < N; j++) { const v = (g[j] - Cm[o + j]) / eps; lse[j] = v; if (v > m) m = v; }
          let acc = 0; for (let j = 0; j < N; j++) acc += Math.exp(lse[j] - m);
          f[i] = eps * la - eps * (m + Math.log(acc));
        }
        for (let j = 0; j < N; j++) {
          let m = -Infinity;
          for (let i = 0; i < N; i++) { const v = (f[i] - Cm[i * N + j]) / eps; lse[i] = v; if (v > m) m = v; }
          let acc = 0; for (let i = 0; i < N; i++) acc += Math.exp(lse[i] - m);
          g[j] = eps * la - eps * (m + Math.log(acc));
        }
        // after the g-update the column marginals are exact; measure the row marginals
        let err = 0;
        for (let i = 0; i < N; i++) {
          let r = 0; const o = i * N;
          for (let j = 0; j < N; j++) r += Math.exp((f[i] + g[j] - Cm[o + j]) / eps);
          err += Math.abs(r - 1 / N);
        }
        errs.push(err);
        if (err < 1e-5) break;
      }
      iters = Math.min(iters, 400);
      // sample the coupling row-wise and draw a Brownian bridge (variance ε) for each pair
      paths = new Float32Array(N * (K + 1) * 2);
      cost = 0;
      const sqe = Math.sqrt(eps);
      for (let i = 0; i < N; i++) {
        const o = i * N;
        let u = Math.random() / N, j = 0, c = 0;
        for (; j < N; j++) { c += Math.exp((f[i] + g[j] - Cm[o + j]) / eps); if (c >= u) break; }
        j = Math.min(j, N - 1);
        cost += 2 * Cm[o + j] / N;
        const wx = new Float64Array(K + 1), wy = new Float64Array(K + 1), sdt = Math.sqrt(1 / K);
        for (let k = 1; k <= K; k++) { wx[k] = wx[k - 1] + sdt * randn(); wy[k] = wy[k - 1] + sdt * randn(); }
        for (let k = 0; k <= K; k++) {
          const t = k / K, b = (i * (K + 1) + k) * 2;
          paths[b] = (1 - t) * src[i][0] + t * tgt[j][0] + sqe * (wx[k] - t * wx[K]);
          paths[b + 1] = (1 - t) * src[i][1] + t * tgt[j][1] + sqe * (wy[k] - t * wy[K]);
        }
      }
      setOut(panel, 'iters', iters);
      setOut(panel, 'merr', errs[errs.length - 1].toExponential(1));
      setOut(panel, 'cost', cost.toFixed(3));
      setOut(panel, 'epsv', st.eps.toFixed(3));
      tau = reduce ? 1 : 0; hold = 0;
      drawMini();
      draw();
    }

    function pos(i, t) {
      const x = t * K, k = Math.min(K - 1, Math.floor(x)), a = x - k, b = (i * (K + 1) + k) * 2;
      return [paths[b] * (1 - a) + paths[b + 2] * a, paths[b + 1] * (1 - a) + paths[b + 3] * a];
    }

    function draw() {
      if (!paths) return;
      const { ctx, W, H } = S;
      ctx.clearRect(0, 0, W, H);
      const sc = Math.min(W, H) * 0.27, cx = W / 2, cy = H / 2 + 6;
      const P = (p) => [cx + p[0] * sc, cy - p[1] * sc];
      // faint grid
      ctx.strokeStyle = rgba(C.grid, 1); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let q = -3; q <= 3; q++) { const a = P([q * 0.5, 0])[0], b = P([0, q * 0.5])[1]; ctx.moveTo(a, 30); ctx.lineTo(a, H - 40); ctx.moveTo(20, b); ctx.lineTo(W - 20, b); }
      ctx.stroke();
      // target samples (hollow) and source (tiny)
      ctx.strokeStyle = rgba(C.bid, 0.55); ctx.lineWidth = 1;
      for (const p of tgt) { const [x, y] = P(p); ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = rgba(C.muted, 0.5);
      for (const p of src) { const [x, y] = P(p); ctx.fillRect(x - 1, y - 1, 2, 2); }
      // trails and particles
      const t = tau, t0 = Math.max(0, t - 0.3);
      ctx.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        ctx.strokeStyle = rgba(C.signal, 0.22);
        ctx.beginPath();
        for (let q = 0; q <= 10; q++) { const [x, y] = P(pos(i, t0 + ((t - t0) * q) / 10)); q ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.fillStyle = rgba(C.signal, 1);
      for (let i = 0; i < N; i++) { const [x, y] = P(pos(i, t)); ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill(); }
      // time bar
      ctx.fillStyle = rgba(C.muted, 1); ctx.font = `10px ${MONO}`;
      ctx.fillText(`t = ${t.toFixed(2)}`, W - 80, 24);
      ctx.fillStyle = rgba(C.line2, 1); ctx.fillRect(W - 180, 36, 160, 2);
      ctx.fillStyle = rgba(C.signal, 1); ctx.fillRect(W - 180, 36, 160 * t, 2);
      const slider = $(panel, 'input[data-p="t"]'); if (document.activeElement !== slider) slider.value = t.toFixed(3);
    }

    function drawMini() {
      const { ctx, W, H } = M;
      ctx.clearRect(0, 0, W, H);
      if (!errs.length) return;
      const lo = -6, hi = 0, n = errs.length;
      const f = frame(ctx, 34, 10, W - 44, H - 34, [1, Math.max(2, n)], [lo, hi]);
      drawAxes(ctx, f, [[1, '1'], [Math.max(2, n), String(n)]], [lo, -3, hi], null, null);
      ctx.fillStyle = rgba(C.muted, 1);
      ctx.fillText('iteration', f.x0 + f.w / 2 - 24, f.y0 + f.h + 16);
      ctx.strokeStyle = rgba(C.signal, 1); ctx.lineWidth = 2;
      ctx.beginPath();
      errs.forEach((e, k) => { const x = f.X(k + 1), y = f.Y(clamp(Math.log10(e), lo, hi)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }

    function loop(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (playing) {
        if (tau < 1) tau = Math.min(1, tau + dt / 3.4);
        else if ((hold += dt) > 1.6) { tau = 0; hold = 0; }
        draw();
      }
      raf = requestAnimationFrame(loop);
    }

    const epsIn = $(panel, 'input[data-p="eps"]');
    const epsVal = () => Math.pow(10, +epsIn.value);
    epsIn.addEventListener('input', () => setOut(panel, 'eps', epsVal().toFixed(3)));
    epsIn.addEventListener('change', () => { st.eps = epsVal(); solve(); });
    epsIn.value = Math.log10(st.eps); setOut(panel, 'eps', st.eps.toFixed(3));
    $(panel, 'select[data-p="target"]').addEventListener('change', (e) => { st.target = e.target.value; solve(); });
    const tIn = $(panel, 'input[data-p="t"]');
    tIn.addEventListener('input', () => { playing = false; tau = +tIn.value; playBtn.textContent = 'Play'; draw(); });
    const playBtn = $(panel, '[data-act="play"]');
    playBtn.textContent = playing ? 'Pause' : 'Play';
    playBtn.addEventListener('click', () => { playing = !playing; if (playing && tau >= 1) tau = 0; playBtn.textContent = playing ? 'Pause' : 'Play'; });
    $(panel, '[data-act="resample"]').addEventListener('click', solve);

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      tipAt(tip, fig, e.clientX - rect.left, e.clientY - rect.top, `ε <b>${st.eps.toFixed(3)}</b> · t <b>${tau.toFixed(2)}</b><br>Sinkhorn iters <b>${iters}</b> · E‖X₁−X₀‖² <b>${cost.toFixed(3)}</b>`);
    });
    canvas.addEventListener('pointerleave', () => tip.classList.remove('on'));

    S = surface(canvas, () => draw());
    M = surface(mini, () => drawMini());
    return {
      start() { if (running) return; running = true; if (!paths) solve(); last = 0; raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      redraw() { draw(); drawMini(); },
    };
  }

  // =====================================================================
  // 4. Kyle–Back insider-trading equilibrium (a signalling game)
  // =====================================================================
  function KyleDemo(panel) {
    const fig = $(panel, '.lab-fig'), canvas = $(panel, 'canvas'), tip = $(panel, '.tip');
    const WORLDS = 36, N = 250;
    const st = { sv: 1.0, su: 1.0 };
    let sim, tau = 0, hold = 0, running = false, raf = 0, last = 0, hoverT = null, S;

    function simulate() {
      const { sv, su } = st, lam = sv / su, dt = 1 / N, sdt = Math.sqrt(dt);
      sim = { v: [], P: [], X: null, Z: null, lam };
      for (let w = 0; w < WORLDS; w++) {
        const v = sv * randn(), P = new Float32Array(N + 1);
        const X = new Float32Array(N + 1), Z = new Float32Array(N + 1);
        for (let n = 0; n < N; n++) {
          const t = n / N, beta = su / (sv * (1 - t));    // insider's trading intensity
          const dX = beta * (v - P[n]) * dt, dZ = su * sdt * randn();
          X[n + 1] = X[n] + dX; Z[n + 1] = Z[n] + dZ;
          P[n + 1] = P[n] + lam * (dX + dZ);               // market maker: P = E[v | order flow]
        }
        sim.v.push(v); sim.P.push(P);
        if (w === 0) { sim.X = X; sim.Z = Z; }
      }
      setOut(panel, 'lam', lam.toFixed(3));
      setOut(panel, 'profit', (sv * su).toFixed(3));
      setOut(panel, 'pvol', sv.toFixed(2));
      setOut(panel, 'half', '50%');
      tau = reduce ? 1 : 0; hold = 0;
      draw();
    }

    function draw() {
      if (!sim) return;
      const { ctx, W, H } = S;
      ctx.clearRect(0, 0, W, H);
      const pad = 46, top = 50, gap = 64;
      const h1 = (H - top - gap - 78) * 0.64, h2 = (H - top - gap - 78) * 0.36;
      const w = W - pad - 64;
      const A = Math.ceil(st.sv * 3 * 2) / 2;
      const f1 = frame(ctx, pad, top, w, h1, [0, 1], [-A, A]);
      drawAxes(ctx, f1, [[0, '0'], [0.5, '0.5'], [1, '1']], [-A, 0, A], null, 'price Pₜ = E[v | order flow], 36 simulated markets');
      const nNow = Math.round(tau * N);

      // posterior band for the highlighted market: P ± 2√Σ, Σ_t = σ_v²(1−t)
      const P0 = sim.P[0];
      ctx.fillStyle = rgba(C.signal, 0.1);
      ctx.beginPath();
      for (let n = 0; n <= nNow; n++) ctx.lineTo(f1.X(n / N), f1.Y(P0[n] + 2 * st.sv * Math.sqrt(1 - n / N)));
      for (let n = nNow; n >= 0; n--) ctx.lineTo(f1.X(n / N), f1.Y(P0[n] - 2 * st.sv * Math.sqrt(1 - n / N)));
      ctx.closePath(); ctx.fill();

      ctx.lineWidth = 1;
      for (let w0 = 1; w0 < WORLDS; w0++) {
        const P = sim.P[w0];
        ctx.strokeStyle = rgba(C.ink, 0.2);
        ctx.beginPath();
        for (let n = 0; n <= nNow; n++) { const x = f1.X(n / N), y = f1.Y(clamp(P[n], -A, A)); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
      // true values v, revealed on the right edge
      for (let w0 = 0; w0 < WORLDS; w0++) {
        const y = f1.Y(clamp(sim.v[w0], -A, A));
        ctx.fillStyle = w0 === 0 ? rgba(C.signal, 1) : rgba(C.ink, 0.45);
        ctx.fillRect(f1.X(1) + 6, y - 0.75, w0 === 0 ? 14 : 8, 1.5);
      }
      ctx.fillStyle = rgba(C.muted, 1); ctx.font = `10px ${MONO}`;
      ctx.fillText('true v', f1.X(1) + 6, f1.y0 - 10 + 20);
      ctx.strokeStyle = rgba(C.signal, 1); ctx.lineWidth = 2;
      ctx.beginPath();
      for (let n = 0; n <= nNow; n++) { const x = f1.X(n / N), y = f1.Y(clamp(P0[n], -A, A)); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();

      // order flow of the highlighted market (same units, one axis)
      let B = 0;
      for (let n = 0; n <= N; n++) B = Math.max(B, Math.abs(sim.X[n]), Math.abs(sim.Z[n]));
      B = Math.ceil(B * 1.1 * 2) / 2 || 1;
      const f2 = frame(ctx, pad, top + h1 + gap, w, h2, [0, 1], [-B, B]);
      drawAxes(ctx, f2, [[0, '0'], [0.5, '0.5'], [1, 't = 1']], [-B, 0, B], 'time t', 'cumulative order flow, highlighted market');
      const line = (arr, col, lw) => {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        for (let n = 0; n <= nNow; n++) { const x = f2.X(n / N), y = f2.Y(arr[n]); n ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      };
      line(sim.Z, rgba(C.muted, 1), 1.5);
      line(sim.X, rgba(C.signal, 1), 2);
      if (nNow > 10) {
        ctx.fillStyle = rgba(C.ink2, 1);
        ctx.fillText('insider X', f2.X(nNow / N) + 6, f2.Y(sim.X[nNow]) + 3);
        ctx.fillText('noise Z', f2.X(nNow / N) + 6, f2.Y(sim.Z[nNow]) + 3);
      }

      if (hoverT !== null && hoverT <= tau) {
        const n = Math.round(hoverT * N), x = f1.X(hoverT);
        ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, f1.y0); ctx.lineTo(x, f2.y0 + f2.h); ctx.stroke();
        ctx.fillStyle = rgba(C.signal, 1);
        ctx.beginPath(); ctx.arc(x, f1.Y(P0[n]), 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    function loop(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (tau < 1) { tau = Math.min(1, tau + dt / 5); draw(); }
      else if ((hold += dt) > 2.2) simulate();
      raf = requestAnimationFrame(loop);
    }

    panel.querySelectorAll('input[data-p]').forEach((inp) => {
      inp.value = st[inp.dataset.p]; setOut(panel, inp.dataset.p, (+inp.value).toFixed(2));
      inp.addEventListener('input', () => { st[inp.dataset.p] = +inp.value; setOut(panel, inp.dataset.p, (+inp.value).toFixed(2)); simulate(); });
    });
    $(panel, '[data-act="redraw"]').addEventListener('click', simulate);

    canvas.addEventListener('pointermove', (e) => {
      if (!sim) return;
      const rect = canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const t = clamp((mx - 46) / (S.W - 46 - 64), 0, 1);
      hoverT = t;
      const n = Math.round(t * N);
      tipAt(tip, fig, mx, my, `t <b>${t.toFixed(2)}</b> · Pₜ <b>${sim.P[0][n].toFixed(3)}</b> · v <b>${sim.v[0].toFixed(3)}</b><br>posterior sd √Σₜ <b>${(st.sv * Math.sqrt(1 - t)).toFixed(3)}</b> · insider Xₜ <b>${sim.X[n].toFixed(2)}</b>`);
      if (!running || tau >= 1) draw();
    });
    canvas.addEventListener('pointerleave', () => { hoverT = null; tip.classList.remove('on'); draw(); });

    S = surface(canvas, () => draw());
    return {
      start() { if (running) return; running = true; if (!sim) simulate(); last = 0; if (!reduce) raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      redraw() { draw(); },
    };
  }

  // ---------- shared orbit camera for the 3-D demos ----------
  function orbit(canvas, cam, onClick) {
    let down = null, moved = 0;
    canvas.classList.add('grab');
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; moved = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw += dx * 0.007;
      cam.pitch = clamp(cam.pitch + dy * 0.005, 0.1, 1.3);
      down = { x: e.clientX, y: e.clientY };
      cam.touched = performance.now();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (down && moved < 5 && onClick) { const r = canvas.getBoundingClientRect(); onClick(e.clientX - r.left, e.clientY - r.top); }
      down = null;
    });
  }
  function project(cam, S, x, y, z) {
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
    const d = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    const f = cam.dist / (cam.dist + d), sc = Math.min(S.W * cam.sc, S.H * cam.sc * 1.45);
    return [S.W * cam.cx + x1 * sc * f, S.H * cam.cy - z2 * sc * f, d];
  }
  const pathOf = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); };

  // =====================================================================
  // 5. Order book under Hawkes order flow, informed trading and adverse selection
  //    market orders:  λ±_t = μ + μᴵ±_t + a_self Σ e^{−β(t−tᵢ)} (same side) + a_cross Σ e^{−β(t−tⱼ)} (other side)
  //                    branching ratio n = (a_self + a_cross)/β < 1
  //    informed flow:  after a toxic event the hidden value v jumps; informed traders buy (sell) while v > mid (< mid)
  //    market maker:   Avellaneda–Stoikov spread plus ψ·VPIN; P&L = spread capture + markout (adverse selection)
  // =====================================================================
  function LobDemo(panel) {
    const canvas = $(panel, 'canvas'), mini = $(panel, 'canvas.mini');
    const L = 20, ROWS = 46, TPS = 12, K = 1.5, BETA = 0.3, MU = 0.28, JUMP = 5, HMK = 12, PSI = 10, KEEP = 240;
    const P = { alpha: 0.6, n: 0.7, gamma: 0.3 };
    const cam = { yaw: -0.42, pitch: 0.66, dist: 6, cx: 0.47, cy: 0.58, sc: 0.29, touched: 0 };
    const st = {
      t: 0, sig2: 1, vN: 0.05, vD: 1, h: 1, mid: 0, v: 0, inf: 0, kB: 0, kS: 0, lamB: MU, lamS: MU,
      bid: new Float64Array(L), ask: new Float64Array(L), waves: [], hist: [], fills: [], cap: 0, as: 0, pnl: [], parts: [], idle: 0,
    };
    let S, M, running = false, raf = 0, last = 0, acc = 0, hudT = 0;

    const pois = (lam) => { lam = Math.min(lam, 12); const e = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > e); return k - 1; };
    const vpin = () => st.vN / Math.max(st.vD, 1e-6);
    const spread = () => P.gamma * st.sig2 * 2 + (2 / P.gamma) * Math.log(1 + P.gamma / K) + PSI * vpin();
    const profile = (d, h) => (d < h ? 0 : 10 * (1 - Math.exp(-(d - h + 0.6) / 3.2)) * (0.8 + 0.3 * Math.exp(-((d - h - 5) ** 2) / 24)));
    for (let d = 0; d < L; d++) { st.bid[d] = profile(d + 1, 1); st.ask[d] = profile(d + 1, 1); }

    function eat(q, n) { // market orders consume the touch
      let rem = n * 1.3;
      for (let d = Math.max(0, Math.ceil(st.h) - 1); d < L && rem > 0; d++) { const take = Math.min(q[d], rem); q[d] -= take; rem -= take; }
    }
    function step() {
      st.t++;
      const aS = 0.75 * P.n * BETA, aC = 0.25 * P.n * BETA;
      const gap = st.v - st.mid, muI = Math.abs(gap) > 0.5 ? st.inf : 0;
      st.inf *= 0.975;
      if (st.inf < 0.02) st.v = st.mid;
      st.lamB = MU + (gap > 0 ? muI : 0) + aS * st.kB + aC * st.kS;
      st.lamS = MU + (gap < 0 ? muI : 0) + aS * st.kS + aC * st.kB;
      const nB = pois(st.lamB), nS = pois(st.lamS), dec = Math.exp(-BETA);
      st.kB = st.kB * dec + nB; st.kS = st.kS * dec + nS;

      // price impact of net flow; the market maker fills every market order at the half-spread
      const dm = 0.35 * (nB - nS) + 0.15 * randn();
      st.mid += dm;
      st.sig2 += (dm * dm * 4 - st.sig2) * 0.03;
      st.cap += (nB + nS) * st.h;
      if (nB) st.fills.push({ t: st.t, dir: 1, q: nB, m: st.mid - dm });
      if (nS) st.fills.push({ t: st.t, dir: -1, q: nS, m: st.mid - dm });
      while (st.fills.length && st.t - st.fills[0].t >= HMK) { const f = st.fills.shift(); st.as -= f.dir * f.q * (st.mid - f.m); }
      st.vN = 0.95 * st.vN + 0.05 * Math.abs(nB - nS);
      st.vD = 0.95 * st.vD + 0.05 * (nB + nS);
      st.h += (spread() / 2 - st.h) * 0.25;

      const hits = { bid: new Float32Array(L), ask: new Float32Array(L) };
      for (const side of ['bid', 'ask']) {
        const q = st[side];
        for (let d = 0; d < L; d++) {
          const dd = d + 1;
          let hit = 0;
          for (const w of st.waves) {
            const age = st.t - w.t0, front = st.h + age * 0.75;
            hit += w.amp * (w.side === side ? 1 : 0.35) * Math.exp(-age / 26) * Math.exp(-((dd - front) ** 2) / 5);
          }
          hit = Math.min(0.95, hit);
          hits[side][d] = hit;
          q[d] += (profile(dd, st.h) * (1 - hit) - q[d]) * 0.12 + randn() * 0.25 * Math.sqrt(Math.max(q[d], 0.4));
          if (q[d] < 0) q[d] = 0;
          if (dd < st.h) q[d] *= 0.4;
        }
      }
      eat(st.ask, nB); eat(st.bid, nS);
      for (let k = 0; k < Math.min(nB, 4); k++) st.parts.push({ side: 'ask', t0: st.t + Math.random() });
      for (let k = 0; k < Math.min(nS, 4); k++) st.parts.push({ side: 'bid', t0: st.t + Math.random() });
      st.parts = st.parts.filter((p) => st.t - p.t0 < 4);
      st.waves = st.waves.filter((w) => st.t - w.t0 < 90);
      st.hist.push({ bid: Float32Array.from(st.bid), ask: Float32Array.from(st.ask), hb: hits.bid, ha: hits.ask, h: st.h, lB: st.lamB, lS: st.lamS });
      if (st.hist.length > ROWS) st.hist.shift();
      st.pnl.push([st.cap, st.as]);
      if (st.pnl.length > KEEP) st.pnl.shift();
      if (!reduce && ++st.idle > TPS * 7) toxic(Math.random() < 0.5 ? 'ask' : 'bid');
    }
    function toxic(side) { // 'ask': informed buyers lift the offer; 'bid': informed sellers hit the bid
      st.idle = 0;
      st.v = st.mid + (side === 'ask' ? 1 : -1) * JUMP * (0.5 + P.alpha);
      st.inf = 0.4 + 1.6 * P.alpha;
      st.waves.push({ t0: st.t, side, amp: 0.3 + 0.5 * P.alpha });
    }
    for (let i = 0; i < KEEP; i++) { st.idle = 0; step(); }

    function draw(frac = 0) {
      const { ctx, W, H } = S;
      ctx.clearRect(0, 0, W, H);
      const Pj = (x, y, z) => project(cam, S, x, y, z);
      const n = st.hist.length, Y = (r) => 1 - (2 * r) / (ROWS - 1), Z = (q) => (q / 14) * 0.55, WL = 1.14, LZ = (l) => Math.min(l, 6) / 6 * 0.62;
      ctx.strokeStyle = rgba(C.grid, 1); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let o = -L; o <= L; o += 5) { const a = Pj(o / L, 1, 0), b = Pj(o / L, -1, 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      for (let r = 0; r < ROWS; r += 5) { const a = Pj(-WL, Y(r), 0), b = Pj(WL, Y(r), 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();

      // Hawkes intensity walls: λ⁻ (sell orders) behind the bids, λ⁺ (buy orders) behind the asks
      for (const [key, x, col] of [['lS', -WL, C.bid], ['lB', WL, C.ask]]) {
        const pts = st.hist.map((row, r) => Pj(x, Y(r + ROWS - n), LZ(row[key])));
        const f0 = Pj(x, Y(ROWS - n), 0), f1 = Pj(x, Y(ROWS - 1), 0);
        const g = ctx.createLinearGradient(0, Math.min(...pts.map((p) => p[1])), 0, f1[1]);
        g.addColorStop(0, rgba(col, 0.35)); g.addColorStop(1, rgba(col, 0.03));
        ctx.fillStyle = g;
        pathOf(ctx, [f0, ...pts, f1]); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(col, 0.95); ctx.lineWidth = 1.5;
        pathOf(ctx, pts); ctx.stroke();
      }

      const mid0 = Pj(0, 1, 0), mid1 = Pj(0, -1.05, 0);
      ctx.strokeStyle = rgba(C.signal, 0.35); ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mid0[0], mid0[1]); ctx.lineTo(mid1[0], mid1[1]); ctx.stroke(); ctx.setLineDash([]);

      const order = [...Array(n).keys()].sort((a, b) => Pj(0, Y(b), 0)[2] - Pj(0, Y(a), 0)[2]);
      for (const r of order) {
        const row = st.hist[r], y = Y(r + ROWS - n), rec = 0.25 + 0.75 * (r / (n - 1));
        for (const side of ['bid', 'ask']) {
          const sgn = side === 'bid' ? -1 : 1, q = row[side], hits = side === 'bid' ? row.hb : row.ha, col = side === 'bid' ? C.bid : C.ask;
          const pts = [];
          for (let d = L - 1; d >= 0; d--) pts.push(Pj((sgn * (d + 1)) / L, y, Z(q[d])));
          const base0 = Pj(sgn, y, 0), base1 = Pj(sgn / L, y, 0);
          ctx.fillStyle = rgba(C.bg, 0.9);
          pathOf(ctx, [base0, ...pts, base1]); ctx.closePath(); ctx.fill();
          ctx.fillStyle = rgba(col, 0.05 + 0.2 * rec);
          ctx.fill();
          ctx.lineWidth = r === n - 1 ? 2 : 1.1;
          for (let k = 1; k < pts.length; k++) {
            const hit = hits[L - 1 - k];
            ctx.strokeStyle = rgba(mix(col, C.signal, clamp(hit * 1.6, 0, 1)), (0.35 + 0.65 * rec) * (hit > 0.05 ? 1 : 0.85));
            ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
          }
        }
      }

      // incoming market orders, falling onto the touch of the newest book
      const hNow = st.hist[n - 1].h, yF = Y(ROWS - 1);
      for (const p of st.parts) {
        const age = clamp((st.t + frac - p.t0) / 2.5, 0, 1), sgn = p.side === 'bid' ? -1 : 1;
        const q = p.side === 'bid' ? st.bid : st.ask, zt = Z(q[clamp(Math.ceil(hNow) - 1, 0, L - 1)]);
        const pt = Pj((sgn * (hNow + 0.5)) / L, yF, zt + (1 - age) * 0.7);
        ctx.fillStyle = rgba(p.side === 'bid' ? C.bid : C.ask, 1 - age * 0.6);
        ctx.beginPath(); ctx.arc(pt[0], pt[1], 2.6, 0, Math.PI * 2); ctx.fill();
      }

      const a = Pj(-hNow / L, yF - 0.08, 0), b = Pj(hNow / L, yF - 0.08, 0);
      ctx.strokeStyle = rgba(C.signal, 0.95); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1] - 5); ctx.lineTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 5); ctx.stroke();
      ctx.font = `11px ${MONO}`; ctx.fillStyle = rgba(C.signal, 1); ctx.textAlign = 'center';
      ctx.fillText(`spread ${(2 * hNow).toFixed(1)}`, (a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 22);
      ctx.fillStyle = rgba(C.muted, 1);
      let p = Pj(-WL, 1, LZ(6) + 0.08); ctx.fillText('λ⁻ sells (Hawkes)', p[0], p[1]);
      p = Pj(WL, 1, LZ(6) + 0.08); ctx.fillText('λ⁺ buys (Hawkes)', p[0], p[1]);
      p = Pj(-0.55, -1.15, 0); ctx.fillText('bids', p[0], p[1] + 14);
      p = Pj(0.55, -1.15, 0); ctx.fillText('asks', p[0], p[1] + 14);
      ctx.textAlign = 'left';
    }

    function drawMini() {
      const { ctx, W, H } = M;
      ctx.clearRect(0, 0, W, H);
      const n = st.pnl.length, c0 = st.pnl[0][0], a0 = st.pnl[0][1];
      const cap = st.pnl.map((p) => p[0] - c0), as = st.pnl.map((p) => p[1] - a0), net = cap.map((c, i) => c + as[i]);
      let lo = 0, hi = 1;
      for (const arr of [cap, as, net]) for (const v of arr) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const f = frame(ctx, 40, 8, W - 88, H - 22, [0, n - 1], [lo, hi]);
      drawAxes(ctx, f, [], [Math.round(lo), 0, Math.round(hi)], null, null);
      const line = (arr, col, lw, lab) => {
        ctx.strokeStyle = col; ctx.lineWidth = lw;
        ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(f.X(i), f.Y(v)) : ctx.moveTo(f.X(i), f.Y(v)))); ctx.stroke();
        ctx.fillStyle = col; ctx.fillText(lab, f.x0 + f.w + 6, f.Y(arr[n - 1]) + 3);
      };
      ctx.font = `10px ${MONO}`;
      line(cap, rgba(C.bid, 1), 1.5, 'spread');
      line(as, rgba(C.ask, 1), 1.5, 'adverse');
      line(net, rgba(C.signal, 1), 2, 'net');
    }

    function hud() {
      const c0 = st.pnl[0][0], a0 = st.pnl[0][1], lp = st.pnl[st.pnl.length - 1];
      setOut(panel, 'spread', (2 * st.h).toFixed(2));
      setOut(panel, 'vpin', vpin().toFixed(2));
      setOut(panel, 'cap', '+' + (lp[0] - c0).toFixed(0));
      setOut(panel, 'as', (lp[1] - a0 >= 0 ? '+' : '−') + Math.abs(lp[1] - a0).toFixed(0));
      drawMini();
    }
    function loop(now) {
      const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      acc += dt * TPS;
      while (acc >= 1) { step(); acc -= 1; }
      if (!cam.touched || now - cam.touched > 5000) cam.yaw = -0.42 + 0.12 * Math.sin(now / 7000);
      draw(acc);
      if (now - hudT > 250) { hudT = now; hud(); }
      raf = requestAnimationFrame(loop);
    }

    const fire = (side) => { toxic(side); if (!running || reduce) { for (let i = 0; i < 10; i++) step(); draw(); hud(); } };
    orbit(canvas, cam, (x) => fire(x < S.W / 2 ? 'bid' : 'ask'));
    panel.querySelectorAll('input[data-p]').forEach((inp) => {
      inp.value = P[inp.dataset.p]; setOut(panel, inp.dataset.p, (+inp.value).toFixed(2));
      inp.addEventListener('input', () => { P[inp.dataset.p] = +inp.value; setOut(panel, inp.dataset.p, (+inp.value).toFixed(2)); });
    });
    $(panel, '[data-act="buy"]').addEventListener('click', () => fire('ask'));
    $(panel, '[data-act="sell"]').addEventListener('click', () => fire('bid'));

    S = surface(canvas, () => draw());
    M = surface(mini, () => drawMini());
    return {
      start() { if (running) return; running = true; hud(); if (reduce) { draw(); return; } last = 0; raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      redraw() { draw(); drawMini(); },
    };
  }

  // =====================================================================
  // 6. Smart order routing across venues + transient market impact
  //    schedule   q_k from x(t) = sinh(κ(1−t))/sinh κ  (κ = 0: TWAP)
  //    routing    min Σ fᵢxᵢ + cᵢ xᵢ^{3/2}/√Vᵢ  s.t. Σ xᵢ = q_k  ⇒  fᵢ + (3/2) cᵢ √(xᵢ/Vᵢ) = μ  (dark pool capped)
  //    impact     I_t = A Σ_{s≤t} q_s G(t−s),  G(τ) = (1 + τ/τ₀)^{−β},  A calibrated so a TWAP peaks at Yσ√(Q/V)
  // =====================================================================
  function ExecDemo(panel) {
    const canvas = $(panel, 'canvas'), mini = $(panel, 'canvas.mini'), allocEl = $(panel, '[data-alloc]');
    const VEN = [
      { id: 'XNYS', fee: 0.30, V: 0.26, c: 1.0 },
      { id: 'XNAS', fee: 0.30, V: 0.30, c: 1.0 },
      { id: 'BATS', fee: 0.20, V: 0.17, c: 1.1 },
      { id: 'IEXG', fee: 0.09, V: 0.08, c: 0.9 },
      { id: 'DARK', fee: 0.10, V: 0.19, c: 0.45, dark: true },
    ];
    const VCOL = () => [C.signal, C.bid, C.ask, [96, 150, 245], [176, 120, 245]];
    const NE = 40, NP = 44, NT = NE + NP, SIG = 200, YC = 0.7, TAU0 = 2, K0 = 6;
    const P = { q: -2, urg: 1.5, beta: 0.5 };
    const cam = { yaw: -0.42, pitch: 0.52, dist: 7, cx: 0.5, cy: 0.56, sc: 0.29, touched: 0 };
    let S, M, running = false, raf = 0, last = 0, cur = 0, hold = 0, plan = null;

    function build() {
      const Q = Math.pow(10, P.q), kap = P.urg;
      const xr = (t) => (kap < 1e-6 ? 1 - t : Math.sinh(kap * (1 - t)) / Math.sinh(kap));
      const q = [];
      for (let k = 0; k < NE; k++) q.push(Q * (xr(k / NE) - xr((k + 1) / NE)));
      const vk = 1 / NE; // each step trades against 1/NE of the day's volume
      const alloc = [], vcost = [];
      const liq = VEN.map((v) => v.V);
      for (let k = 0; k < NE; k++) {
        for (let i = 0; i < VEN.length; i++) liq[i] = VEN[i].V * Math.exp(0.35 * randn()) * 0.5 + liq[i] * 0.5; // venue liquidity drifts
        const cap = q[k] * (0.15 + 0.35 * Math.random());
        const xs = (mu) => VEN.map((v, i) => {
          if (mu <= v.fee) return 0;
          const x = liq[i] * vk * ((mu - v.fee) / (1.5 * K0 * v.c)) ** 2;
          return v.dark ? Math.min(x, cap) : x;
        });
        let lo = 0, hi = 1e4;
        for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; const s = xs(mid).reduce((a, b) => a + b, 0); if (s > q[k]) hi = mid; else lo = mid; }
        const x = xs((lo + hi) / 2), tot = x.reduce((a, b) => a + b, 0) || 1;
        const xn = x.map((v) => (v * q[k]) / tot);
        alloc.push(xn);
        let c = 0;
        xn.forEach((v, i) => { if (v > 0) c += v * (VEN[i].fee + K0 * VEN[i].c * Math.sqrt(v / (liq[i] * vk))); });
        vcost.push(c);
      }
      const G = (tau) => Math.pow(1 + tau / TAU0, -P.beta);
      const prop = (sched) => { const I = new Float64Array(NT); for (let t = 0; t < NT; t++) { let s = 0; for (let j = 0; j <= Math.min(t, NE - 1); j++) s += sched[j] * G(t - j); I[t] = s; } return I; };
      const twap = prop(new Array(NE).fill(Q / NE));
      const sqrtLaw = YC * SIG * Math.sqrt(Q);
      const A = sqrtLaw / twap[NE - 1];
      const I = prop(q).map((v) => v * A);
      let impCost = 0, feeCost = 0;
      for (let k = 0; k < NE; k++) { impCost += q[k] * I[k]; feeCost += vcost[k]; }
      impCost /= Q; feeCost /= Q;
      const share = VEN.map((_, i) => alloc.reduce((a, x) => a + x[i], 0) / Q);
      let peak = 0; for (const v of I) peak = Math.max(peak, v);
      plan = { Q, q, alloc, I, sqrtLaw, peak, resid: I[NT - 1], impCost, feeCost, share, amax: Math.max(...alloc.flat()) };

      setOut(panel, 'qv', (Q * 100).toFixed(Q < 0.01 ? 2 : 1) + '% ADV');
      setOut(panel, 'urg', kap.toFixed(1));
      setOut(panel, 'beta', P.beta.toFixed(2));
      setOut(panel, 'is', (impCost + feeCost).toFixed(1) + ' bp');
      setOut(panel, 'fees', feeCost.toFixed(1) + ' bp');
      setOut(panel, 'peak', peak.toFixed(1) + ' bp');
      setOut(panel, 'resid', plan.resid.toFixed(1) + ' bp');
      const cols = VCOL();
      allocEl.innerHTML = VEN.map((v, i) => `<span style="flex:${Math.max(share[i], 0.001)};background:${rgba(cols[i], 0.9)}" title="${v.id} ${(share[i] * 100).toFixed(0)}%"><b>${v.id}</b>${(share[i] * 100).toFixed(0)}%</span>`).join('');
      drawMini();
    }

    const X = (k) => -1.1 + (2.2 * k) / (NT - 1), LY = (i) => -0.85 + i * 0.36, WALL = 0.98;
    function draw() {
      if (!plan) return;
      const { ctx, W, H } = S;
      ctx.clearRect(0, 0, W, H);
      const Pj = (x, y, z) => project(cam, S, x, y, z), cols = VCOL();
      const Imax = Math.max(plan.peak, plan.sqrtLaw) * 1.15, IZ = (v) => (v / Imax) * 0.75;
      // floor, lanes and impact wall grid
      ctx.strokeStyle = rgba(C.grid, 1); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < NT; k += 8) { let a = Pj(X(k), -1.05, 0), b = Pj(X(k), WALL, 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); a = Pj(X(k), WALL, 0); b = Pj(X(k), WALL, 0.8); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      for (const z of [0.2, 0.4, 0.6, 0.8]) { const a = Pj(X(0), WALL, z), b = Pj(X(NT - 1), WALL, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
      VEN.forEach((v, i) => {
        const a = Pj(X(0), LY(i), 0), b = Pj(X(NE - 1), LY(i), 0);
        ctx.strokeStyle = rgba(cols[i], 0.25); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const l = Pj(X(0) - 0.08, LY(i), 0);
        ctx.font = `600 10px ${MONO}`; ctx.fillStyle = rgba(cols[i], 1); ctx.textAlign = 'right'; ctx.fillText(v.id, l[0], l[1] + 3);
      });
      ctx.textAlign = 'left';

      // impact on the back wall: build-up while trading, decay after (the "wake")
      const kNow = Math.min(cur, NT - 1), kc = Math.floor(kNow);
      const wall = [];
      for (let k = 0; k <= kc; k++) wall.push(Pj(X(k), WALL, IZ(plan.I[k])));
      if (wall.length > 1) {
        const f0 = Pj(X(0), WALL, 0), f1 = Pj(X(kc), WALL, 0);
        const g = ctx.createLinearGradient(0, Math.min(...wall.map((p) => p[1])), 0, f0[1]);
        g.addColorStop(0, rgba(C.signal, 0.4)); g.addColorStop(1, rgba(C.signal, 0.02));
        ctx.fillStyle = g; pathOf(ctx, [f0, ...wall, f1]); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(C.signal, 1); ctx.lineWidth = 2.2; pathOf(ctx, wall); ctx.stroke();
      }
      const s0 = Pj(X(0), WALL, IZ(plan.sqrtLaw)), s1 = Pj(X(NT - 1), WALL, IZ(plan.sqrtLaw));
      ctx.setLineDash([4, 4]); ctx.strokeStyle = rgba(C.ink, 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
      const e0 = Pj(X(NE - 1), -1.05, 0), e1 = Pj(X(NE - 1), WALL, 0.8);
      ctx.strokeStyle = rgba(C.muted, 0.6);
      ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(Pj(X(NE - 1), WALL, 0)[0], Pj(X(NE - 1), WALL, 0)[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `10px ${MONO}`; ctx.fillStyle = rgba(C.ink2, 0.9);
      ctx.fillText('√-law  Yσ√(Q/V)', s0[0] + 4, s0[1] - 6);
      const el = Pj(X(NE - 1), WALL, 0.84); ctx.fillStyle = rgba(C.muted, 1); ctx.fillText('execution ends · impact decays', el[0] - 60, el[1]);
      const wl = Pj(X(0), WALL, 0.86); ctx.fillText('price impact (bp)', wl[0], wl[1]);

      // child orders routed to each venue, back lanes first
      const dx = (X(1) - X(0)) * 0.34;
      for (let i = VEN.length - 1; i >= 0; i--) {
        for (let k = 0; k <= Math.min(kc, NE - 1); k++) {
          const hgt = (plan.alloc[k][i] / plan.amax) * 0.5;
          if (hgt < 0.004) continue;
          const x = X(k), y = LY(i);
          const fr = [Pj(x - dx, y - 0.06, 0), Pj(x + dx, y - 0.06, 0), Pj(x + dx, y - 0.06, hgt), Pj(x - dx, y - 0.06, hgt)];
          const tp = [Pj(x - dx, y - 0.06, hgt), Pj(x + dx, y - 0.06, hgt), Pj(x + dx, y + 0.06, hgt), Pj(x - dx, y + 0.06, hgt)];
          const fresh = k > kNow - 3 ? 1 : 0.75;
          ctx.fillStyle = rgba(cols[i], 0.55 * fresh); pathOf(ctx, fr); ctx.closePath(); ctx.fill();
          ctx.fillStyle = rgba(mix(cols[i], [255, 255, 255], 0.25), 0.85 * fresh); pathOf(ctx, tp); ctx.closePath(); ctx.fill();
        }
      }
      // routing pulses at the cursor
      if (kc < NE) {
        const ph = kNow - kc;
        VEN.forEach((v, i) => {
          if (plan.alloc[kc][i] <= 0) return;
          const r = 0.05 + 0.18 * ph, ring = [];
          for (let a = 0; a <= 24; a++) ring.push(Pj(X(kc) + r * Math.cos((a / 24) * 2 * Math.PI), LY(i) + r * 0.6 * Math.sin((a / 24) * 2 * Math.PI), 0));
          ctx.strokeStyle = rgba(cols[i], 0.8 * (1 - ph)); ctx.lineWidth = 1.2; pathOf(ctx, ring); ctx.stroke();
        });
      }
      // cursor plane and head of the impact curve
      const c0 = Pj(X(kNow), -1.05, 0), c1 = Pj(X(kNow), WALL, 0), c2 = Pj(X(kNow), WALL, 0.8);
      ctx.strokeStyle = rgba(C.ink, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
      const hd = Pj(X(kc), WALL, IZ(plan.I[kc]));
      ctx.fillStyle = rgba(C.signal, 0.25); ctx.beginPath(); ctx.arc(hd[0], hd[1], 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(C.signal, 1); ctx.beginPath(); ctx.arc(hd[0], hd[1], 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(C.signal, 1); ctx.fillText(plan.I[kc].toFixed(1) + ' bp', hd[0] + 10, hd[1] - 8);
      const tl = Pj(0, -1.2, 0); ctx.fillStyle = rgba(C.muted, 1); ctx.textAlign = 'center'; ctx.fillText('time →', tl[0], tl[1] + 14); ctx.textAlign = 'left';
    }

    function drawMini() {
      if (!M || !plan) return;
      const { ctx, W, H } = M;
      ctx.clearRect(0, 0, W, H);
      const xs = [], ymax = Math.max(YC * SIG * Math.sqrt(0.1), plan.peak) * 1.1;
      const f = frame(ctx, 36, 8, W - 46, H - 30, [0, 10], [0, ymax]);
      drawAxes(ctx, f, [[0, '0'], [5, '5%'], [10, '10%']], [0, Math.round(ymax / 2), Math.round(ymax)], null, null);
      ctx.strokeStyle = rgba(C.ink2, 0.8); ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const q = (i / 60) * 10, y = YC * SIG * Math.sqrt(q / 100); i ? ctx.lineTo(f.X(q), f.Y(y)) : ctx.moveTo(f.X(q), f.Y(y)); }
      ctx.stroke();
      const qx = plan.Q * 100;
      ctx.strokeStyle = rgba(C.ink, 0.8); ctx.beginPath(); ctx.arc(f.X(qx), f.Y(plan.sqrtLaw), 4, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = rgba(C.signal, 1); ctx.beginPath(); ctx.arc(f.X(qx), f.Y(plan.peak), 4, 0, Math.PI * 2); ctx.fill();
    }

    function loop(now) {
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (cur < NT - 1) cur = Math.min(NT - 1, cur + dt * 11);
      else if ((hold += dt) > 1.8) { cur = 0; hold = 0; }
      if (!cam.touched || now - cam.touched > 5000) cam.yaw = -0.42 + 0.12 * Math.sin(now / 8000);
      draw();
      raf = requestAnimationFrame(loop);
    }

    orbit(canvas, cam, null);
    panel.querySelectorAll('input[data-p]').forEach((inp) => {
      inp.value = P[inp.dataset.p];
      inp.addEventListener('input', () => { P[inp.dataset.p] = +inp.value; build(); if (!running || reduce) draw(); });
    });
    S = surface(canvas, () => draw());
    M = surface(mini, () => drawMini());
    build();
    return {
      start() { if (running) return; running = true; if (reduce) { cur = NT - 1; draw(); return; } last = 0; raf = requestAnimationFrame(loop); },
      stop() { running = false; cancelAnimationFrame(raf); },
      redraw() { build(); draw(); },
    };
  }

  // ---------- tabs, visibility, theme ----------
  const makers = { lob: LobDemo, exec: ExecDemo, surface: SurfaceDemo, dbdp: DbdpDemo, sb: SbDemo, kyle: KyleDemo };
  const demos = {};
  const tabs = [...lab.querySelectorAll('[role="tab"]')];
  let active = tabs[0].dataset.demo, visible = false;

  function sync() {
    for (const [k, d] of Object.entries(demos)) if (k !== active || !visible) d.stop();
    if (!visible) return;
    const panel = document.getElementById('lab-' + active);
    if (!demos[active]) demos[active] = makers[active](panel);
    demos[active].start();
  }
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    active = tab.dataset.demo;
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById('lab-' + t.dataset.demo).hidden = !on;
    });
    sync();
  }));
  lab.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.dataset.demo === active);
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1;
    if (j >= 0) { tabs[j].click(); tabs[j].focus(); }
  });
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; sync(); }, { rootMargin: '100px' }).observe(lab);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden && lab.getBoundingClientRect().top < window.innerHeight; sync(); });
  document.addEventListener('themechange', () => { readColors(); Object.values(demos).forEach((d) => d.redraw()); });
})();
