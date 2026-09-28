/*
 * Education band: two school coins over a line-art Shanghai / Paris skyline.
 * Coins tilt toward the pointer with a damped spring and flip on click; the skyline draws itself in when
 * scrolled into view, and its depth layers move with pointer parallax.
 */
(function () {
  const section = document.querySelector('.schools');
  if (!section) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sky = section.querySelector('.skyline');
  const layers = [...section.querySelectorAll('.skyline .layer')].map((el) => ({ el, depth: +el.dataset.depth || 0 }));

  const coins = [...section.querySelectorAll('[data-coin]')].map((el, i) => {
    const c = { body: el.querySelector('.coin-3d'), rx: 0, ry: 0, vx: 0, vy: 0, tx: 0, ty: 0, flip: 0, phase: i * 2.1 };
    c.body.addEventListener('click', () => { c.flip ^= 1; if (reduce) apply(c, true); });
    return c;
  });

  let lastMove = 0, px = 0, py = 0, ox = 0, oy = 0;
  section.addEventListener('pointermove', (e) => {
    lastMove = performance.now();
    const r = section.getBoundingClientRect();
    px = (e.clientX - r.left) / r.width - 0.5;
    py = (e.clientY - r.top) / r.height - 0.5;
    for (const c of coins) {
      const b = c.body.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const dx = Math.max(-1.5, Math.min(1.5, (e.clientX - cx) / b.width)), dy = Math.max(-1.5, Math.min(1.5, (e.clientY - cy) / b.height));
      c.tx = -dy * 24; c.ty = dx * 28;
      c.body.style.setProperty('--gx', 50 + dx * 40 + '%');
      c.body.style.setProperty('--gy', 50 + dy * 40 + '%');
    }
  });
  section.addEventListener('pointerleave', () => { lastMove = 0; px = py = 0; });

  function apply(c, snap) {
    const ty = c.ty + c.flip * 180;
    if (snap) { c.rx = c.tx; c.ry = ty; c.vx = c.vy = 0; }
    c.vx = (c.vx + (c.tx - c.rx) * 0.07) * 0.8; c.rx += c.vx;
    c.vy = (c.vy + (ty - c.ry) * 0.07) * 0.8; c.ry += c.vy;
    c.body.style.transform = `rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`;
    c.body.style.setProperty('--sheen', (c.ry * 1.6 + c.rx).toFixed(1) + 'deg');
    c.body.style.setProperty('--gp', (50 + c.ry * 0.8 - c.rx * 0.6).toFixed(1) + '%');
  }

  let raf = 0, visible = false;
  function frame(now) {
    const idle = now - lastMove > 1800;
    for (const c of coins) {
      if (idle) { c.tx = 6 * Math.sin(now / 2300 + c.phase); c.ty = 14 * Math.sin(now / 3100 + c.phase); }
      apply(c, false);
    }
    // depth parallax: nearer layers travel further
    ox += (px - ox) * 0.06; oy += (py - oy) * 0.06;
    for (const l of layers) l.el.setAttribute('transform', `translate(${(-ox * 28 * l.depth).toFixed(2)} ${(-oy * 10 * l.depth).toFixed(2)})`);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf); raf = 0;
    if (reduce || !visible || document.hidden) { for (const c of coins) apply(c, true); return; }
    raf = requestAnimationFrame(frame);
  }
  new IntersectionObserver((e) => {
    visible = e[0].isIntersecting;
    if (visible && sky) sky.classList.add('drawn');
    start();
  }, { rootMargin: '0px 0px -15% 0px' }).observe(section);
  document.addEventListener('visibilitychange', start);
  if (reduce && sky) sky.classList.add('drawn');
  for (const c of coins) apply(c, true);
})();
