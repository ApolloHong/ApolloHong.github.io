(function () {
  var root = document.documentElement;

  // theme toggle — canvases listen for 'themechange' and re-read their colours
  var toggles = document.querySelectorAll('[data-theme-toggle]');
  var label = function () {
    var light = root.getAttribute('data-theme') === 'light';
    toggles.forEach(function (b) {
      b.setAttribute('aria-pressed', String(light));
      b.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    });
  };
  toggles.forEach(function (b) {
    b.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      label();
      document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
    });
  });
  label();

  // nav background once the page scrolls
  var nav = document.getElementById('nav');
  if (nav && !nav.classList.contains('solid')) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // glass surfaces: pointer spotlight, crosshair and live coordinates on hover
  var fine = window.matchMedia('(hover: hover)').matches;
  [['.card, .cred', true, true], ['.lab-panel', false, false], ['.tb, .metric, .pr', false, true]].forEach(function (g) {
    document.querySelectorAll(g[0]).forEach(function (el) {
      el.classList.add('q');
      if (g[1]) { el.classList.add('xhair'); var c = document.createElement('span'); c.className = 'coord'; c.setAttribute('aria-hidden', 'true'); el.appendChild(c); }
      if (g[2]) el.classList.add('lift');
      if (!fine) return;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        var c = el.querySelector(':scope > .coord');
        if (c) c.textContent = 'x ' + x.toFixed(3) + '  y ' + (1 - y).toFixed(3);
      });
    });
  });

  // principle cards: tap / Enter pins the quote open
  document.querySelectorAll('.pr').forEach(function (el) {
    var toggle = function () { var o = el.classList.toggle('open'); el.setAttribute('aria-expanded', String(o)); };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  // reveal on scroll; anything already on screen is shown straight away
  var els = [].slice.call(document.querySelectorAll('.reveal'));
  var show = function (el) { el.classList.add('in'); };
  if (!('IntersectionObserver' in window)) { els.forEach(show); return; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach(function (el) { io.observe(el); });
  var check = function () {
    els.forEach(function (el) { if (el.getBoundingClientRect().top < window.innerHeight) show(el); });
  };
  window.addEventListener('load', check);
  window.addEventListener('hashchange', check);
  setTimeout(check, 400);
})();
