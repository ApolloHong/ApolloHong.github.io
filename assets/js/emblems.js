/*
 * School emblems as 3-D coins: spring-damped tilt toward the pointer, click to flip, and a dial around
 * each coin that plots a live GARCH(1,1) return series with Student-t shocks plus its conditional volatility.
 */
(function () {
  const section = document.querySelector('.schools');
  if (!section) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let C;
  const readColors = () => { C = { line: hex(css('--line-2')), muted: hex(css('--muted')), signal: hex(css('--signal')), bid: hex(css('--bid')), ask: hex(css('--ask')) }; };
  readColors();

  let spare = null;
  const randn = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0; while (u === 0) u = Math.random();
    const v = Math.random(), r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  const tShock = () => { let c = 0; for (let k = 0; k < 4; k++) { const g = randn(); c += g * g; } return (randn() / Math.sqrt(c / 4)) * Math.SQRT1_2; };
  const NB = 132;

  const coins = [...section.querySelectorAll('[data-coin]')].map((el, i) => {
    const c = {
      el, body: el.querySelector('.coin-3d'), canvas: el.querySelector('.coin-ring'),
      rx: 0, ry: 0, vx: 0, vy: 0, tx: 0, ty: 0, flip: 0, phase: i * 2.1, s2: 1, e2: 1, rets: [], vols: [], dir: i ? -1 : 1,
    };
    for (let k = 0; k < NB; k++) garch(c);
    c.body.addEventListener('click', () => { c.flip ^= 1; if (reduce) apply(c, true); });
    return c;
  });
  function garch(c) {
    c.s2 = 0.03 + 0.09 * c.e2 + 0.88 * c.s2;
    const r = Math.sqrt(c.s2) * tShock();
    c.e2 = r * r;
    c.rets.push(r); c.vols.push(Math.sqrt(c.s2));
    if (c.rets.length > NB) { c.rets.shift(); c.vols.shift(); }
  }

  // pointer: every coin leans toward the cursor; the glare follows it across the face
  let lastMove = 0;
  section.addEventListener('pointermove', (e) => {
    lastMove = performance.now();
    for (const c of coins) {
      const r = c.body.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = Math.max(-1.5, Math.min(1.5, (e.clientX - cx) / r.width)), dy = Math.max(-1.5, Math.min(1.5, (e.clientY - cy) / r.height));
      c.tx = -dy * 26; c.ty = dx * 30;
      c.body.style.setProperty('--gx', 50 + dx * 40 + '%');
      c.body.style.setProperty('--gy', 50 + dy * 40 + '%');
    }
  });
  section.addEventListener('pointerleave', () => { lastMove = 0; });

  function apply(c, snap) {
    const ty = c.ty + c.flip * 180;
    if (snap) { c.rx = c.tx; c.ry = ty; c.vx = c.vy = 0; }
    c.vx = (c.vx + (c.tx - c.rx) * 0.07) * 0.8; c.rx += c.vx;
    c.vy = (c.vy + (ty - c.ry) * 0.07) * 0.8; c.ry += c.vy;
    c.body.style.transform = `rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`;
    c.body.style.setProperty('--sheen', (c.ry * 1.6 + c.rx).toFixed(1) + 'deg');
    c.body.style.setProperty('--gp', (50 + c.ry * 0.8 - c.rx * 0.6).toFixed(1) + '%');
  }

  function ring(c, now) {
    const cv = c.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2), S = cv.clientWidth;
    if (!S) return;
    if (cv.width !== Math.round(S * dpr)) { cv.width = cv.height = Math.round(S * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const m = S / 2, r0 = S * 0.338, r1 = S * 0.358, rot = c.dir * now * 0.00006;
    // dial ticks
    ctx.strokeStyle = rgba(C.line, 0.9); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2 + rot * 0.3, len = k % 10 === 0 ? 6 : 2.5;
      ctx.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0);
      ctx.lineTo(m + Math.cos(a) * (r0 + len), m + Math.sin(a) * (r0 + len));
    }
    ctx.stroke();
    // radial return bars: sign by colour, magnitude by length, oldest faintest
    const n = c.rets.length;
    ctx.lineWidth = Math.max(1.2, (Math.PI * 2 * r1) / NB * 0.5);
    ctx.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k / NB) * Math.PI * 2 + rot, r = c.rets[k];
      const len = Math.min(S * 0.075, Math.abs(r) * S * 0.026 + 1.5);
      ctx.strokeStyle = rgba(r >= 0 ? C.bid : C.ask, 0.2 + 0.8 * (k / n));
      ctx.beginPath();
      ctx.moveTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1);
      ctx.lineTo(m + Math.cos(a) * (r1 + len), m + Math.sin(a) * (r1 + len));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // conditional volatility as an inner arc gauge
    const vol = c.vols[n - 1], frac = Math.min(1, vol / 3);
    ctx.strokeStyle = rgba(C.line, 0.6); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m, m, S * 0.322, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    ctx.strokeStyle = rgba(C.signal, 0.95); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(m, m, S * 0.322, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * frac)); ctx.stroke();
    // radar sweep
    const sw = (now * 0.0012 * c.dir) % (Math.PI * 2);
    const g = ctx.createConicGradient ? ctx.createConicGradient(sw, m, m) : null;
    if (g && now) {
      g.addColorStop(0, rgba(C.signal, 0.22)); g.addColorStop(0.08, rgba(C.signal, 0)); g.addColorStop(1, rgba(C.signal, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(m, m, r1 + S * 0.08, 0, Math.PI * 2); ctx.arc(m, m, r0, 0, Math.PI * 2, true); ctx.fill();
    }
  }

  let raf = 0, visible = false, lastTick = 0;
  function frame(now) {
    const idle = now - lastMove > 1800;
    if (now - lastTick > 110) { lastTick = now; for (const c of coins) garch(c); }
    for (const c of coins) {
      if (idle) { c.tx = 7 * Math.sin(now / 2300 + c.phase); c.ty = 16 * Math.sin(now / 3100 + c.phase); }
      apply(c, false);
      ring(c, now);
    }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf); raf = 0;
    if (reduce || !visible || document.hidden) { for (const c of coins) { apply(c, true); ring(c, 0); } return; }
    raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; start(); }, { rootMargin: '80px' }).observe(section);
  document.addEventListener('visibilitychange', start);
  document.addEventListener('themechange', () => { readColors(); if (!raf) for (const c of coins) ring(c, 0); });
  window.addEventListener('resize', () => { if (!raf) for (const c of coins) ring(c, 0); });
  for (const c of coins) apply(c, true);
})();
