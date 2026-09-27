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
