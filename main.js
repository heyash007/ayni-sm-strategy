(function () {
  'use strict';

  var DESIGNS_URL = 'content/designs.json';
  var STEPS_URL = 'content/steps.json';
  var DESIGN_DIR = 'assets/designs/';
  var POSTER_DIR = 'assets/designs/posters/';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Every project has a page at project.html?id=<id>. The id defaults to the file name.
  function idOf(d) { return d.id || d.file.replace(/\.[^.]+$/, ''); }
  function stepUrl(d) { return 'research.html#step-' + Number(d.step); }
  function projectUrl(d) { return 'project.html?id=' + encodeURIComponent(idOf(d)); }
  function typeOf(f) { return /\.(mp4|mov|webm)$/i.test(f.file) ? 'video' : 'image'; }

  function posterFor(d) {
    return POSTER_DIR + d.file.replace(/\.[^.]+$/, '') + '.jpg';
  }

  // Builds an <img> or <video> for one design. The browser keeps the file's own aspect
  // ratio unless CSS crops it (the carousel cards crop with object-fit: cover).
  function makeMedia(d, opts) {
    var m;
    if (d.type === 'video') {
      m = document.createElement('video');
      m.muted = true;
      m.defaultMuted = true;
      m.loop = true;
      m.setAttribute('muted', '');
      m.setAttribute('playsinline', '');
      m.playsInline = true;
      m.preload = 'metadata';
      m.poster = posterFor(d);
      m.src = DESIGN_DIR + d.file;
      m.setAttribute('aria-label', d.alt);
      m.addEventListener('loadeddata', function () { m.classList.add('loaded'); });
      var p = new Image();
      p.onload = function () { m.classList.add('loaded'); };
      p.src = m.poster;
    } else {
      m = document.createElement('img');
      m.alt = d.alt;
      m.decoding = 'async';
      m.loading = opts && opts.eager ? 'eager' : 'lazy';
      m.addEventListener('load', function () { m.classList.add('loaded'); });
      m.src = DESIGN_DIR + d.file;
    }
    var wasLoaded = m.complete && d.type !== 'video';
    m.className = 'media' + (wasLoaded ? ' loaded' : '');
    return m;
  }

  // Sound. Browsers only autoplay muted video, so videos start muted and a "Sound" button
  // (a user gesture) turns audio on. The files keep their audio tracks.
  var soundOn = false;
  function playVideo(v) {
    v.muted = !soundOn;
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () {
        // the browser refused audio: fall back to silent playback
        v.muted = true;
        var q = v.play();
        if (q && q.catch) q.catch(function () {});
      });
    }
  }
  function addSoundButton(getVideos, getCurrent) {
    if (reduced) return null;
    var b = el('button', 'sound', 'Sound off');
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    function label() {
      b.textContent = soundOn ? 'Sound on' : 'Sound off';
      b.setAttribute('aria-pressed', String(soundOn));
    }
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      soundOn = !soundOn;
      var vids = getVideos();
      var cur = getCurrent();
      vids.forEach(function (v) {
        if (!soundOn) { v.muted = true; return; }
        // inside this click, give every video permission to play with sound, silently
        v.muted = false;
        v.volume = 0;
        var p = v.play();
        if (p && p.then) {
          p.then(function () {
            v.volume = 1;
            if (v !== cur) v.pause();
          }).catch(function () { v.muted = true; v.volume = 1; });
        }
      });
      if (!soundOn) vids.forEach(function (v) { v.volume = 1; });
      label();
    });
    b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    // sits at the right end of the fixed header
    (document.querySelector('.header-end') || document.querySelector('.site-header')).appendChild(b);
    label();
    return b;
  }

  // Plays videos only while they are on screen (poster only with reduced motion).
  function playWhenVisible(videos) {
    if (reduced || !videos.length || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = en.target;
        if (en.isIntersecting) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.4 });
    videos.forEach(function (v) { io.observe(v); });
  }

  function measure(d) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(im.naturalWidth / im.naturalHeight); };
      im.onerror = function () { resolve(4 / 5); };
      im.src = d.type === 'video' ? posterFor(d) : DESIGN_DIR + d.file;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Carousel geometry                                                   */
  /* ------------------------------------------------------------------ */
  // The hero is one fixed card in the centre; it never moves. The small cards ride a closed 3D
  // circle round it, driven by one continuous rotation value (pos). d is a card's signed
  // distance, in cards, from the front (wrapped into -n/2..n/2) and maps to an angle round the
  // circle: 0 is the front (in front of the hero, passing over it), +/-90 the sides, +/-180 the
  // back (behind the hero). The ring is closed (pose at +n/2 equals pose at -n/2), so looping
  // has no gap or jump, and cards at the back are simply hidden by the hero.
  // Nothing fades: the card arriving at the centre stays visible, in front of the hero, whose
  // picture changes to that project. Lengths are in hero-card widths (cw).
  var RZ = 0.8;     // depth of the circle: front cards are closer (bigger), back cards further
  var TY = 0.5;     // tilt: cards round the back sit a little higher
  var CARD = 0.26;  // physical size of a small card relative to the hero (all the same)
  var TURN = 28;    // degrees a card turns at the sides of the circle
  var ANCHORS_T = [0, 1, 2, 3];
  var ANCHORS_A = [0, 28, 52, 78]; // degrees for the first three cards each side; then the back

  // Angle for |d| through the anchor angles, then on to 180 at the very back (monotone cubic
  // Hermite, so the motion has no corners). Small rings fall back to an even circle.
  function angleOf(t, n) {
    var half = n / 2;
    if (half <= 3) return t * 360 / n;
    var xs = ANCHORS_T.concat([half]), ys = ANCHORS_A.concat([180]), k = xs.length - 1, m = [], del = [], i;
    for (i = 0; i < k; i++) del[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
    m[0] = del[0];
    for (i = 1; i < k; i++) m[i] = 2 / (1 / del[i - 1] + 1 / del[i]);
    m[k] = del[k - 1];
    for (i = 0; i < k; i++) {
      if (t <= xs[i + 1] || i === k - 1) {
        var h = xs[i + 1] - xs[i], u = clamp((t - xs[i]) / h, 0, 1), u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] +
               (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
      }
    }
    return 180;
  }

  function pose(d, cw, n, rx) {
    var t = Math.abs(d);
    var th = (d < 0 ? -1 : 1) * angleOf(t, n) * Math.PI / 180;
    var c = Math.cos(th), sn = Math.sin(th);
    return {
      x: cw * (rx || 1.35) * sn,
      y: -cw * TY * (1 - c) / 2,
      z: cw * RZ * c,                              // front of the circle is closest to the viewer
      a: TURN * sn,
      persp: cw * 3.14,
      zIndex: 50 + Math.round(c * 40)              // front half over the hero (50), back half under it
    };
  }
  window.AyniCarousel = { pose: pose };

  /* ------------------------------------------------------------------ */
  /* Homepage carousel                                                   */
  /* ------------------------------------------------------------------ */
  function initGallery() {
    var root = document.getElementById('gallery');
    var stage = document.getElementById('stage');

    getJSON(DESIGNS_URL).then(function (all) {
      var designs = all.filter(function (d) { return !d.researchOnly; });
      if (!designs.length) return;
      return Promise.all(designs.map(measure)).then(function (aspects) { build(designs, aspects); });
    }).catch(function (e) {
      stage.textContent = 'Could not load designs. Preview with a local server (see README).';
      stage.className = 'stage ready';
      console.error(e);
    });

    function build(designs, aspects) {
      var n = designs.length;
      var vw, vh, cw, ch, rx = 1.35;
      var pos = 0, target = 0;
      var shownIdx = -1;
      var drag = null;
      var suppressClick = false;
      var wheelTimer = null;
      var lastInput = performance.now();
      var lastStep = 0;
      var hovering = false;
      function touched() { lastInput = performance.now(); }

      var status = el('p', 'sr-only');
      status.setAttribute('aria-live', 'polite');
      root.appendChild(status);

      // the fixed hero: one frame whose picture (a stack of layers) follows the centre project
      var hero = el('div', 'card hero');
      var heroHead = el('div', 'card-head');
      var heroTitle = el('span', 'card-title');
      var heroCta = el('a', 'card-cta', 'View case study');
      heroHead.appendChild(heroTitle);
      heroHead.appendChild(heroCta);
      var heroLink = el('a', 'card-media');
      var layers = designs.map(function (d) {
        var layer = el('div', 'hero-layer');
        layer.appendChild(makeMedia(d, { eager: true }));
        heroLink.appendChild(layer);
        return layer;
      });
      hero.appendChild(heroHead);
      hero.appendChild(heroLink);
      stage.appendChild(hero);
      var videos = designs.map(function (d, i) {
        return d.type === 'video' ? layers[i].querySelector('video') : null;
      });

      // the small cards that revolve round it (still pictures; videos show their poster frame)
      var cards = designs.map(function (d, i) {
        var card = el('div', 'card orbit');
        var link = el('a', 'card-media');
        link.href = stepUrl(d);
        link.setAttribute('aria-label', d.title + ', open research step ' + Number(d.step) + ', ' + (i + 1) + ' of ' + n);
        var img = document.createElement('img');
        img.className = 'media';
        img.alt = d.alt;
        img.decoding = 'async';
        img.addEventListener('load', function () { img.classList.add('loaded'); });
        img.src = d.type === 'video' ? posterFor(d) : DESIGN_DIR + d.file;
        link.appendChild(img);
        link.addEventListener('focus', function () { target = nearTo(i); touched(); });
        card.appendChild(link);
        stage.appendChild(card);
        return card;
      });

      function wrap(d) { return d - n * Math.round(d / n); }
      function mod(i) { return ((i % n) + n) % n; }
      // the copy of index i (i + k*n) that is closest to the current position
      function nearTo(i) { return i + n * Math.round((pos - i) / n); }

      function size() {
        vw = root.clientWidth;
        vh = root.clientHeight;
        // about 350 x 430 at 1280 x 800; a larger share of the screen on phones
        cw = vw < 700 ? vw * 0.6 : clamp(vw * 0.2734, 260, 640);
        cw = Math.min(cw, (vh * 0.6) / 1.2286);
        ch = cw * 1.2286;
        rx = vw < 700 ? 0.9 : 1.35;
        hero.style.width = cw.toFixed(1) + 'px';
        hero.style.height = ch.toFixed(1) + 'px';
        hero.style.marginLeft = (-cw / 2).toFixed(1) + 'px';
        hero.style.marginTop = (-ch / 2).toFixed(1) + 'px';
        cards.forEach(function (c) {
          var w = cw * CARD, h = ch * CARD; // every small card is the same size, cropped to the hero's shape
          c.style.width = w.toFixed(1) + 'px';
          c.style.height = h.toFixed(1) + 'px';
          c.style.marginLeft = (-w / 2).toFixed(1) + 'px';
          c.style.marginTop = (-h / 2).toFixed(1) + 'px';
        });
      }

      function setPlaying(idx) {
        videos.forEach(function (v, i) {
          if (!v) return;
          if (i === idx && !reduced) {
            playVideo(v);
          } else {
            v.pause();
          }
        });
      }

      function frame(dt, now) {
        // keep revolving: after a pause, step to the next project every few seconds
        if (!reduced && !drag && !hovering && !document.hidden && now - lastInput > 2500 && now - lastStep > 3200) {
          target = Math.round(target) + 1;
          lastStep = now;
        }
        if (reduced) {
          pos = target;
        } else {
          pos += (target - pos) * (1 - Math.pow(0.0003, dt)); // swift, but eases to a stop
          if (Math.abs(target - pos) < 0.0005) pos = target; // lands exactly on a project
        }
        if (pos >= n && target >= n) { pos -= n; target -= n; }
        else if (pos < 0 && target < 0) { pos += n; target += n; }

        var near = mod(Math.round(pos));
        for (var i = 0; i < n; i++) {
          var p = pose(wrap(i - pos), cw, n, rx);
          var c = cards[i];
          c.style.transform = 'perspective(' + p.persp.toFixed(0) + 'px) translate3d(' + p.x.toFixed(2) + 'px,' + p.y.toFixed(2) + 'px,' + p.z.toFixed(2) + 'px) rotateY(' + p.a.toFixed(3) + 'deg)';
          c.style.zIndex = String(p.zIndex);
          // the card melts into the hero as it lands on it
          var dd = Math.min(1, Math.abs(wrap(i - pos)) / 0.35);
          c.style.opacity = reduced ? '1' : (dd * dd * (3 - 2 * dd)).toFixed(3);
        }

        // the hero stays put; only its picture, title and link change
        if (near !== shownIdx) {
          if (shownIdx >= 0) layers[shownIdx].classList.remove('on');
          layers[near].classList.add('on');
          shownIdx = near;
          var d = designs[near];
          heroTitle.textContent = d.title;
          heroCta.href = stepUrl(d);
          heroLink.href = stepUrl(d);
          heroLink.setAttribute('aria-label', d.title + ', open research step ' + Number(d.step));
          status.textContent = d.title + ', project ' + (near + 1) + ' of ' + n;
          setPlaying(near);
        }
      }

      var last = performance.now();
      function loop(now) {
        var dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        frame(dt, now);
        requestAnimationFrame(loop);
      }

      size();
      window.addEventListener('resize', size);

      // drag / swipe, with a snap to the nearest project on release
      root.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.card-cta')) return;
        touched();
        drag = { x: e.clientX, t: target, moved: false, lx: e.clientX, lt: performance.now(), v: 0 };
      });
      window.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x;
        if (Math.abs(dx) > 6) drag.moved = true;
        if (!drag.moved) return;
        root.classList.add('dragging');
        var now = performance.now();
        var per = cw * 0.8; // pixels of drag per card
        var tNew = drag.t - dx / per;
        var dtm = Math.max(1, now - drag.lt) / 1000;
        drag.v = (tNew - target) / dtm;
        drag.lt = now;
        target = tNew;
        touched();
      });
      function endDrag() {
        if (!drag) return;
        var moved = drag.moved;
        if (moved) target = Math.round(target + clamp(drag.v, -6, 6) * 0.15);
        suppressClick = moved;
        touched();
        drag = null;
        root.classList.remove('dragging');
        setTimeout(function () { suppressClick = false; }, 0);
      }
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);

      // trackpad / wheel: glide, then snap when the gesture pauses
      root.addEventListener('wheel', function (e) {
        e.preventDefault();
        var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        target += clamp(delta, -150, 150) * 0.006;
        touched();
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(function () { target = Math.round(target); }, 120);
      }, { passive: false });

      // any card opens its project page (the links do this natively); a drag does not count as a click
      stage.addEventListener('click', function (e) {
        if (suppressClick) e.preventDefault();
      });

      // pause the automatic revolving while the mouse is over a card, so it can be clicked
      stage.addEventListener('pointerover', function (e) {
        if (e.pointerType === 'mouse' && e.target.closest('.card')) hovering = true;
      });
      stage.addEventListener('pointerout', function (e) {
        if (e.pointerType === 'mouse' && !e.relatedTarget) hovering = false;
        else if (e.pointerType === 'mouse' && !e.relatedTarget.closest('.card')) hovering = false;
      });

      window.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { target = Math.round(target) + 1; e.preventDefault(); touched(); }
        else if (e.key === 'ArrowLeft') { target = Math.round(target) - 1; e.preventDefault(); touched(); }
      });

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) videos.forEach(function (v) { if (v) v.pause(); });
        else setPlaying(shownIdx);
      });


      stage.classList.add('ready');
      requestAnimationFrame(function (t) { last = t; loop(t); });
    }
  }


  /* ------------------------------------------------------------------ */
  /* Designs page: same-size grid, videos open full screen               */
  /* ------------------------------------------------------------------ */
  var ICON_MUTED = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 9.5v5h3.6L11 18.5v-13L6.6 9.5z"/><path d="M15 9.5l5 5M20 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
  var ICON_SOUND = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 9.5v5h3.6L11 18.5v-13L6.6 9.5z"/><path d="M14.5 9a4.2 4.2 0 0 1 0 6M17.2 6.5a8 8 0 0 1 0 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';

  function openViewer(d, opener, onOpen) {
    var lb = el('div', 'viewer');
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    var isImg = typeOf(d) === 'image';
    lb.setAttribute('aria-label', isImg ? 'Image viewer' : 'Video player');
    var v = document.createElement(isImg ? 'img' : 'video');
    v.src = 'assets/designs/' + d.file;
    if (isImg) {
      v.alt = d.alt || '';
    } else {
      v.poster = posterFor(d);
      v.controls = true;
      v.loop = true;
      v.autoplay = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('aria-label', d.alt || d.title || 'Video');
    }
    var close = el('button', 'viewer-close', 'Close');
    close.type = 'button';
    close.setAttribute('aria-label', isImg ? 'Close image' : 'Close video');
    lb.appendChild(v);
    lb.appendChild(close);
    document.body.appendChild(lb);
    document.body.classList.add('no-scroll');
    if (onOpen) onOpen();
    function shut() {
      document.removeEventListener('keydown', onKey);
      if (!isImg) v.pause();
      lb.remove();
      document.body.classList.remove('no-scroll');
      if (opener) opener.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') shut();
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === close ? v : close).focus(); }
    }
    document.addEventListener('keydown', onKey);
    close.addEventListener('click', shut);
    lb.addEventListener('click', function (e) { if (e.target === lb || (isImg && e.target === v)) shut(); });
    close.focus();
    // opened by a click, so the browser allows sound; fall back to muted if it does not
    if (!isImg) {
      var p = v.play();
      if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
    }
  }

  function initDesigns() {
    var root = document.getElementById('designs');
    getJSON(DESIGNS_URL).then(function (all) {
      var designs = all.filter(function (d) { return !d.researchOnly; });
      // the street interviews sit at the end of the grid (order elsewhere is unchanged)
      designs = designs.filter(function (d) { return !d.gridLast; }).concat(designs.filter(function (d) { return d.gridLast; }));
      var grid = el('ul', 'grid');
      var thumbs = [];
      designs.forEach(function (d) {
        var li = el('li', 'tile');
        var isVideo = typeOf(d) === 'video';
        var a = el('button', 'tile-link');
        var m;
        if (isVideo) {
          a.type = 'button';
          a.setAttribute('aria-label', 'Play video full screen: ' + (d.alt || d.title));
          m = makeMedia(d, { eager: true });
          m.removeAttribute('aria-label');
          m.setAttribute('aria-hidden', 'true');
          m.className = 'tile-img';
          thumbs.push(m);
        } else {
          a.type = 'button';
          a.setAttribute('aria-label', 'View full screen: ' + (d.alt || d.title));
          a.addEventListener('click', function () { openViewer(d, a); });
          m = el('img', 'tile-img');
          m.src = DESIGN_DIR + d.file;
          m.alt = '';
          m.loading = 'lazy';
          m.decoding = 'async';
        }
        a.appendChild(m);
        li.appendChild(a);
        if (isVideo) {
          // audio toggle only: a sibling of the tile button, so it never opens the viewer
          var mute = el('button', 'tile-audio');
          mute.type = 'button';
          function paint() {
            mute.innerHTML = m.muted ? ICON_MUTED : ICON_SOUND;
            mute.setAttribute('aria-label', m.muted ? 'Unmute video' : 'Mute video');
            mute.setAttribute('aria-pressed', String(!m.muted));
          }
          m._paint = paint;
          mute.addEventListener('click', function (e) {
            e.stopPropagation();
            var on = m.muted;
            thumbs.forEach(function (t) { t.muted = true; t._paint(); }); // one video speaks at a time
            if (on) {
              m.muted = false;
              m.volume = 1;
              var p = m.play();
              if (p && p.catch) p.catch(function () { m.muted = true; paint(); });
            }
            paint();
          });
          paint();
          li.appendChild(mute);
          a.addEventListener('click', function () {
            openViewer(d, a, function () { thumbs.forEach(function (t) { t.muted = true; t._paint(); }); });
          });
        }
        grid.appendChild(li);
      });
      root.appendChild(grid);
      playWhenVisible(thumbs);
    }).catch(function (e) {
      root.textContent = 'Could not load the designs. Preview with a local server (see README).';
      console.error(e);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Case-study page                                                     */
  /* ------------------------------------------------------------------ */
  function initProject() {
    var main = document.getElementById('project');
    var id = new URLSearchParams(location.search).get('id');

    Promise.all([getJSON(DESIGNS_URL), getJSON(STEPS_URL)]).then(function (res) {
      var designs = res[0];
      var steps = res[1].steps;
      var idx = -1;
      designs.forEach(function (d, i) { if (idOf(d) === id) idx = i; });
      if (idx < 0) {
        main.appendChild(el('p', 'case-missing', 'Project not found.'));
        return;
      }
      var d = designs[idx];
      var step = steps.filter(function (s) { return s.step === Number(d.step); })[0];
      document.title = d.title + ' | Case study for Ayni';

      var text = el('div', 'case-text');
      text.appendChild(el('p', 'step-label', 'Case study ' + (idx + 1) + ' of ' + designs.length));
      text.appendChild(el('h1', 'case-title', d.title));

      // Each section uses the project's own text when supplied. Audience insight and
      // strategy fall back to the research step the project belongs to. Nothing is invented.
      var sections = [
        ['Project introduction', d.intro || d.caption],
        ['Objective', d.objective],
        ['Audience insight', d.audience || (step && step.insight)],
        ['Strategy', d.strategy || (step && step.paragraph)],
        ['My role', d.role],
        ['Execution', d.execution],
        ['Results', d.results]
      ];
      sections.forEach(function (s) {
        if (!s[1] && s[0] === 'Results') return; // only shown where supplied
        var sec = el('section', 'case-section');
        sec.appendChild(el('h2', null, s[0]));
        sec.appendChild(el('p', s[1] ? null : 'tbd', s[1] || 'To be added.'));
        text.appendChild(sec);
      });

      if (step) {
        var r = el('a', 'case-link', 'Research behind this: step ' + step.step + ', ' + step.title);
        r.href = 'research.html#step-' + step.step;
        text.appendChild(r);
      }
      var nav = el('nav', 'case-nav');
      nav.setAttribute('aria-label', 'Other projects');
      var prev = designs[(idx - 1 + designs.length) % designs.length];
      var next = designs[(idx + 1) % designs.length];
      var pa = el('a', null, 'Previous: ' + prev.title);
      pa.href = projectUrl(prev);
      var na = el('a', null, 'Next: ' + next.title);
      na.href = projectUrl(next);
      nav.appendChild(pa);
      nav.appendChild(na);
      text.appendChild(nav);

      var gallery = el('div', 'case-gallery');
      var files = [d].concat((d.gallery || []).map(function (g) {
        return { file: g.file, type: g.type || typeOf(g), alt: g.alt || d.alt, title: d.title };
      }));
      if (files.length === 1) gallery.classList.add('single');
      var videos = [];
      files.forEach(function (f) {
        var fig = el('figure', 'design');
        var m = makeMedia(f, { eager: true });
        fig.appendChild(m);
        gallery.appendChild(fig);
        if (f.type === 'video') videos.push(m);
      });
      playWhenVisible(videos);

      main.appendChild(text);
      main.appendChild(gallery);
    }).catch(function (e) {
      main.textContent = 'Could not load this project. Preview with a local server (see README).';
      console.error(e);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Research page                                                       */
  /* ------------------------------------------------------------------ */
  // A content funnel: an inverted triangle in three bands, the content behind each band, then how the mix shifts.
  function buildFunnel(f) {
    var fig = el('figure', 'funnel');
    fig.setAttribute('aria-label', 'Content funnel: what content sits at the top, middle and bottom');
    var tri = el('div', 'funnel-tri');
    tri.setAttribute('aria-hidden', 'true');
    f.tiers.forEach(function (t, i) {
      var band = el('div', 'tri-band band-' + (i + 1));
      var txt = el('div', 'tri-text');
      txt.appendChild(el('span', 'tri-name', t.name));
      txt.appendChild(el('span', 'tri-stage', t.stage));
      var ul = el('ul', 'tri-items');
      (t.inside || t.items).forEach(function (x) { ul.appendChild(el('li', null, x)); });
      txt.appendChild(ul);
      band.appendChild(txt);
      tri.appendChild(band);
    });
    fig.appendChild(tri);
    if (f.note) fig.appendChild(el('p', 'funnel-note', f.note));
    var mix = el('div', 'funnel-mix');
    mix.appendChild(el('h3', 'funnel-mix-title', f.mixTitle));
    var rows = el('ul', 'funnel-mix-rows');
    f.mix.forEach(function (m) {
      var li = el('li');
      li.appendChild(el('span', 'mix-when', m.when));
      var txt = el('span', 'mix-text', m.text);
      li.appendChild(txt);
      if (m.split) {
        var bar = el('span', 'mix-bar');
        ['Top', 'Middle', 'Bottom'].forEach(function (label, k) {
          var seg = el('span', 'mix-seg seg-' + (k + 1), label + ' ' + m.split[k] + '%');
          seg.style.flexGrow = m.split[k];
          bar.appendChild(seg);
        });
        txt.appendChild(bar);
      }
      rows.appendChild(li);
    });
    mix.appendChild(rows);
    fig.appendChild(mix);
    return fig;
  }

  function initResearch() {
    var main = document.getElementById('steps');

    Promise.all([getJSON(STEPS_URL), getJSON(DESIGNS_URL)]).then(function (res) {
      var data = res[0];
      var designs = res[1];
      var total = data.steps.length;
      var videos = [];

      data.steps.forEach(function (s) {
        var sec = el('section', 'step');
        sec.id = 'step-' + s.step;
        sec.setAttribute('aria-labelledby', 'step-' + s.step + '-title');

        var text = el('div', 'step-text');
        var head = el('div', 'step-head');
        var h = el('h2', 'step-title', s.title);
        h.id = 'step-' + s.step + '-title';
        head.appendChild(h);
        head.appendChild(el('p', 'step-summary', s.summary));
        if (s.step === 1) {
          head.appendChild(el('p', 'step-note step-note-body', 'Ayni is pre-launch, so this ICP is built from the brief Parul shared, public market data and my own interviews with college students. A full ICP is usually far more detailed, with deeper segment profiles, customer journey mapping and validated data. Since this project shows how I would approach the work, I\u2019ve kept it short and focused on the essentials. It defines who we target at launch. After launch, I\u2019d validate and refine it with first-party data: waitlist sign-ups, Instagram Insights audience demographics, engagement signals (saves, shares, DMs), UTM-tracked site traffic and post-purchase surveys, then compare how each segment converts.'));
        } else {
          head.appendChild(el('p', 'step-note', s.note || 'Working assumptions based on the brief. To be validated with the Ayni team.'));
        }
        if (s.market) {
          head.appendChild(el('h3', 'step-sub', 'Market size'));
          head.appendChild(el('p', 'step-market', s.market));
          head.appendChild(el('h3', 'step-sub', 'Target audience'));
        }
        String(s.paragraph).split(/\n\s*\n/).forEach(function (t) { head.appendChild(el('p', 'step-para', t)); });

        if (s.table) {
          var wrap = el('div', 'step-table');
          var scroller = el('div', 'table-wrap');
          scroller.tabIndex = 0;
          scroller.setAttribute('role', 'region');
          scroller.setAttribute('aria-label', 'Competitor comparison, scrolls sideways');
          var tbl = el('table', 'compare');
          var thead = el('thead');
          var hr = el('tr');
          s.table.headers.forEach(function (h) {
            var th = el('th', null, h);
            th.scope = 'col';
            hr.appendChild(th);
          });
          thead.appendChild(hr);
          tbl.appendChild(thead);
          var tbody = el('tbody');
          s.table.rows.forEach(function (r) {
            var tr = el('tr');
            r.forEach(function (c, k) {
              var cell = el(k === 0 ? 'th' : 'td', null, c);
              if (k === 0) cell.scope = 'row';
              tr.appendChild(cell);
            });
            tbody.appendChild(tr);
          });
          tbl.appendChild(tbody);
          scroller.appendChild(tbl);
          wrap.appendChild(scroller);
          head.appendChild(wrap);
        }
        text.appendChild(head);

        var media = el('div', 'step-media');
        var mine = designs.filter(function (d) { return Number(d.step) === s.step && d.research !== false; });
        if (mine.length === 1) media.classList.add('single');
        if (s.funnel) media.appendChild(buildFunnel(s.funnel));
        if (!mine.length && !s.funnel) {
          media.appendChild(el('div', 'design-empty', 'Designs coming'));
        }
        mine.forEach(function (d) {
          var fig = el('figure', 'design' + (d.tall ? ' tall' : '') + (d.wide ? ' wide' : ''));
          var m = makeMedia(d);
          fig.appendChild(m);
          media.appendChild(fig);
          if (d.type === 'video') {
            videos.push(m);
            // click to watch the full video in the full-screen player
            fig.classList.add('playable');
            fig.tabIndex = 0;
            fig.setAttribute('role', 'button');
            fig.setAttribute('aria-label', 'Play video full screen: ' + (d.alt || d.title));
            m.removeAttribute('aria-label');
            fig.addEventListener('click', function () { openViewer(d, fig); });
            fig.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(d, fig); }
            });
          }
        });

        sec.appendChild(media);
        sec.appendChild(text);
        main.appendChild(sec);
      });

      var c = data.closing;
      if (c) {
        var closing = el('section', 'closing');
        closing.id = 'closing';
        var left = el('div');
        left.appendChild(el('h2', null, c.heading));
        var ul = el('ul');
        c.checklist.forEach(function (t) { ul.appendChild(el('li', null, t)); });
        left.appendChild(ul);
        var right = el('div', 'contact');
        right.appendChild(el('h2', null, c.contactHeading));
        right.appendChild(el('p', null, c.contactText));
        var a = el('a', null, c.email);
        a.href = 'mailto:' + c.email;
        right.appendChild(a);
        closing.appendChild(left);
        closing.appendChild(right);
        main.appendChild(closing);
      }

      playWhenVisible(videos);

      // one step per page: the pager shows a single step (then the closing page) at a time
      var pages = Array.prototype.slice.call(main.children).filter(function (p) { return p.tagName === 'SECTION'; });
      var cur = 0;
      var pager = el('nav', 'pager');
      pager.setAttribute('aria-label', 'Research steps');
      var prev = el('button', 'pager-btn pager-prev');
      var next = el('button', 'pager-btn pager-next');
      prev.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      next.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      var count = el('p', 'sr-only');
      count.setAttribute('aria-live', 'polite');
      var bar = el('div', 'pager-progress');
      var fill = el('span');
      bar.appendChild(fill);
      prev.type = next.type = 'button';
      prev.setAttribute('aria-label', 'Previous step');
      next.setAttribute('aria-label', 'Next step');
      pager.appendChild(bar);
      pager.appendChild(prev);
      pager.appendChild(next);
      pager.appendChild(count);
      document.body.appendChild(pager);

      function show(i, fromUser) {
        cur = clamp(i, 0, pages.length - 1);
        pages.forEach(function (p, k) { p.hidden = k !== cur; });
        count.textContent = cur < total ? 'Step ' + (cur + 1) + ' of ' + total : 'Week one';
        fill.style.width = ((cur + 1) / pages.length * 100) + '%';
        prev.disabled = cur === 0;
        next.disabled = cur === pages.length - 1;
        try { history.replaceState(null, '', '#' + pages[cur].id); } catch (e) {}
        if (fromUser) window.scrollTo(0, 0);
        if (typeof fitTitles === 'function') fitTitles();
      }
      prev.addEventListener('click', function () { show(cur - 1, true); });
      next.addEventListener('click', function () { show(cur + 1, true); });
      document.addEventListener('keydown', function (e) {
        if (e.altKey || e.ctrlKey || e.metaKey || document.querySelector('.viewer') || /input|textarea|select/i.test(e.target.tagName)) return;
        if (e.key === 'ArrowRight') show(cur + 1, true);
        else if (e.key === 'ArrowLeft') show(cur - 1, true);
      });
      // one headline size for every step, small enough that the longest title fits on one line
      function fitTitles() {
        var titles = Array.prototype.slice.call(main.querySelectorAll('.step-title'));
        var vis = titles.filter(function (h) { return h.offsetParent; })[0];
        if (!vis) return;
        var avail = vis.clientWidth;
        var cs = getComputedStyle(vis);
        var probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;' +
          'font-family:' + cs.fontFamily + ';font-weight:' + cs.fontWeight + ';letter-spacing:-0.035em;font-size:100px';
        document.body.appendChild(probe);
        var size = Math.min(56, Math.max(32, window.innerWidth * 0.05)); // the same clamp the stylesheet uses
        titles.forEach(function (h) {
          probe.textContent = h.textContent;
          size = Math.min(size, Math.floor(avail / probe.offsetWidth * 100 * 0.98));
        });
        probe.remove();
        size = Math.max(size, 16);
        titles.forEach(function (h) { h.style.fontSize = size + 'px'; });
      }
      window.addEventListener('resize', fitTitles);
      var start = 0;
      if (location.hash) {
        pages.forEach(function (p, k) { if ('#' + p.id === location.hash) start = k; });
      }
      show(start, false);
      fitTitles();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitles);
    }).catch(function (e) {
      main.textContent = 'Could not load the research content. Preview with a local server (see README).';
      console.error(e);
    });
  }

  var page = document.body.dataset.page;
  if (page === 'gallery') initGallery();
  else if (page === 'designs') initDesigns();
  else if (page === 'research') initResearch();
  else if (page === 'project') initProject();
})();
