window.AT = window.AT || {};

(function () {
  // ── Copy-link buttons ── class-based (.js-copy-link), never id-scoped,
  // so one delegated listener handles every instance infinite-scroll.js
  // ever injects — no re-binding needed per instance. Each button carries
  // its own data-url (that instance's real canonical URL, see article.ejs)
  // so clicking one on an article that isn't the "active" one still copies
  // the right link rather than whatever's currently in the address bar.
  function copyUrl(btn) {
    var url = btn.getAttribute('data-url') || window.location.href;
    var message = btn.getAttribute('data-copied-message') || 'Link copied!';

    function flashMessage() {
      var original = btn.getAttribute('aria-label');
      btn.setAttribute('aria-label', message);
      btn.classList.add('is-copied');
      setTimeout(function () {
        btn.setAttribute('aria-label', original);
        btn.classList.remove('is-copied');
      }, 2000);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(flashMessage);
    } else {
      var temp = document.createElement('input');
      temp.value = url;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
      flashMessage();
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.js-copy-link');
    if (btn) copyUrl(btn);
  });

  // ── Like button ── genuinely per-instance (each article has its own
  // slug/like count), so this is called fresh for every suffix by
  // AT.initArticleInstance below rather than delegated.
  function initLikeButton(suffix) {
    var likeBtn = document.getElementById('likeBtn' + suffix);
    if (!likeBtn) return;

    var slug = likeBtn.getAttribute('data-slug');
    var storageKey = 'liked:' + slug;
    var countEl = likeBtn.querySelector('.like-btn__count');

    if (localStorage.getItem(storageKey)) {
      likeBtn.classList.add('is-liked');
      likeBtn.disabled = true;
    }

    likeBtn.addEventListener('click', function () {
      if (localStorage.getItem(storageKey)) return;
      likeBtn.disabled = true;

      fetch('/article/' + encodeURIComponent(slug) + '/like', { method: 'POST' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (typeof data.likes === 'number' && countEl) {
            countEl.textContent = data.likes;
          }
          localStorage.setItem(storageKey, '1');
          likeBtn.classList.add('is-liked');
        })
        .catch(function () {
          likeBtn.disabled = false;
        });
    });
  }

  // ── Sticky share (Design A only) ── operates on whichever
  // .article-detail/.article-detail__title it finds first in the document;
  // left un-suffixed on purpose — it only ever meaningfully applies to the
  // base/active article on screen, and Design B (the live design as of
  // this feature shipping) doesn't use this markup at all.
  document.addEventListener('DOMContentLoaded', function () {
    var stickyShare = document.querySelector('.sticky-share');
    var headline = document.querySelector('.article-detail__title');
    var articleEl = document.querySelector('.article-detail');

    if (stickyShare && headline && articleEl) {
      function positionStickyShare() {
        var rect = articleEl.getBoundingClientRect();
        var left = rect.left - stickyShare.offsetWidth - 24;
        stickyShare.style.left = Math.max(8, left) + 'px';
      }

      positionStickyShare();
      window.addEventListener('resize', positionStickyShare);

      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            stickyShare.classList.toggle('is-visible', entry.boundingClientRect.bottom < 0);
          });
        }, { threshold: 0 });
        observer.observe(headline);
      }
    }
  });

  // ── Facebook video embeds ── class-based (.fb-video-iframe), already
  // multi-instance-safe. root defaults to the whole document (original
  // behavior on page load); infinite-scroll.js passes the specific
  // container it just injected so re-running this doesn't re-fetch/reset
  // iframes that already loaded in earlier instances.
  function loadFbEmbed(iframe) {
    var container = iframe.closest('.fb-video-wrapper');
    var width = Math.round(container.getBoundingClientRect().width);
    if (width < 280) width = 280; // Facebook's minimum supported width

    var height = Math.round(width * (430 / 560)); // keep original aspect ratio
    var videoUrl = encodeURIComponent(iframe.getAttribute('data-fb-url'));

    var src = 'https://www.facebook.com/plugins/video.php' +
      '?height=' + height +
      '&href=' + videoUrl +
      '&show_text=true' +
      '&width=' + width +
      '&t=0';

    iframe.src = src;
    iframe.style.aspectRatio = width + '/' + height;
  }

  function initFbEmbeds(root) {
    (root || document).querySelectorAll('.fb-video-iframe').forEach(function (iframe) {
      // getAttribute, not the .src property — an iframe with src="" still
      // reads back a truthy .src (the current page's own URL, per the DOM
      // spec's URL-resolution behavior for empty src attributes), which
      // made this guard permanently skip loadFbEmbed for every embed.
      if (!iframe.getAttribute('src')) loadFbEmbed(iframe);
    });
  }

  document.addEventListener('DOMContentLoaded', function () { initFbEmbeds(document); });

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { initFbEmbeds(document); }, 250);
  });

  // ── Gallery lightbox ── one overlay PER instance (id suffixed, see
  // article-body-extras.ejs), rather than one shared overlay for the whole
  // page — simpler than rewiring every trigger to a single shared overlay,
  // and the extra hidden markup per gallery-bearing instance is
  // negligible.
  function initGalleryInstance(suffix) {
    var dataEl = document.getElementById('galleryData' + suffix);
    if (!dataEl) return;

    var images = JSON.parse(dataEl.textContent);
    if (!images.length) return;

    var lightbox = document.getElementById('galleryLightbox' + suffix);
    var lightboxImage = document.getElementById('galleryLightboxImage' + suffix);
    var lightboxCaption = document.getElementById('galleryLightboxCaption' + suffix);
    var closeBtn = document.getElementById('galleryLightboxClose' + suffix);
    var prevBtn = document.getElementById('galleryLightboxPrev' + suffix);
    var nextBtn = document.getElementById('galleryLightboxNext' + suffix);
    var currentIndex = 0;

    if (images.length <= 1) {
      prevBtn.style.display = 'none';
      nextBtn.style.display = 'none';
    }

    function show(index) {
      currentIndex = (index + images.length) % images.length;
      var img = images[currentIndex];
      lightboxImage.src = img.url;
      lightboxImage.alt = img.caption || '';
      lightboxCaption.textContent = img.caption || '';
      lightbox.hidden = false;
    }

    function close() {
      lightbox.hidden = true;
      lightboxImage.src = '';
    }

    document.querySelectorAll('.gallery-lightbox-trigger[data-suffix="' + suffix + '"]').forEach(function (el) {
      el.addEventListener('click', function () {
        show(Number(el.getAttribute('data-index')));
      });
    });

    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', function () { show(currentIndex - 1); });
    nextBtn.addEventListener('click', function () { show(currentIndex + 1); });

    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) close();
    });

    document.addEventListener('keydown', function (e) {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(currentIndex - 1);
      if (e.key === 'ArrowRight') show(currentIndex + 1);
    });
  }

  // ── Utility bar (print / font-size / dark mode / high contrast) ──
  // These are genuinely page-wide preferences (localStorage-backed,
  // applied to <body>/article bodies as a class or inline style), not
  // per-article state — so unlike the like button/gallery above, every
  // loaded instance's buttons stay wired to the SAME shared state and all
  // update in lockstep when any one of them is clicked, rather than only
  // the "active" instance's copy working.
  var SIZES = [14, 16, 18, 20, 22]; // px
  var DEFAULT_IDX = 1; // 16px
  var sizeIdx = DEFAULT_IDX;
  var isDark = false;
  var isHC = false;
  var utilityBars = []; // { fontDownBtn, fontResetBtn, fontUpBtn, darkBtn, hcBtn }

  try {
    var savedSize = localStorage.getItem('at_fontsize');
    if (savedSize !== null) sizeIdx = parseInt(savedSize, 10);
  } catch (e) {
    // localStorage can throw in sandboxed/private-browsing contexts — just
    // fall back to the default size rather than fail.
  }
  try {
    isDark = localStorage.getItem('at_darkmode') === '1';
  } catch (e) {
    // ignore — defaults to light
  }
  try {
    isHC = localStorage.getItem('at_highcontrast') === '1';
  } catch (e) {
    // ignore — defaults to off
  }

  function applyFontSize() {
    // Design A uses .article-detail__body, Design B uses .article-b-body —
    // both targeted (the original version only had the former, which meant
    // this control silently did nothing at all under Design B; fixed here
    // incidentally while already rewriting this for multi-instance support).
    document.querySelectorAll('.article-detail__body, .article-b-body').forEach(function (el) {
      el.style.fontSize = SIZES[sizeIdx] + 'px';
    });
  }

  function applySize(idx) {
    sizeIdx = Math.max(0, Math.min(SIZES.length - 1, idx));
    applyFontSize();
    try {
      localStorage.setItem('at_fontsize', sizeIdx);
    } catch (e) {
      // ignore — worst case the size resets next visit
    }
  }

  function applyDark(on) {
    isDark = on;
    document.body.classList.toggle('dark-mode', on);
    utilityBars.forEach(function (bar) {
      if (!bar.darkBtn) return;
      bar.darkBtn.textContent = on ? '☀️' : '🌙';
      bar.darkBtn.classList.toggle('is-dark', on);
    });
    try {
      localStorage.setItem('at_darkmode', on ? '1' : '0');
    } catch (e) {
      // ignore — worst case it doesn't persist
    }
    // Mutually exclusive with high contrast — the two color schemes
    // conflict (high contrast forces pure black/white over everything),
    // so turning one on turns the other off.
    if (on && isHC) applyHC(false);
  }

  function applyHC(on) {
    isHC = on;
    document.body.classList.toggle('high-contrast', on);
    utilityBars.forEach(function (bar) {
      if (bar.hcBtn) bar.hcBtn.classList.toggle('is-active', on);
    });
    try {
      localStorage.setItem('at_highcontrast', on ? '1' : '0');
    } catch (e) {
      // ignore — worst case it doesn't persist
    }
    if (on && isDark) applyDark(false);
  }

  function initUtilityBarInstance(suffix) {
    var printBtn = document.getElementById('btnPrint' + suffix);
    var fontDownBtn = document.getElementById('btnFontDown' + suffix);
    var fontResetBtn = document.getElementById('btnFontReset' + suffix);
    var fontUpBtn = document.getElementById('btnFontUp' + suffix);
    var darkBtn = document.getElementById('btnDarkMode' + suffix);
    var hcBtn = document.getElementById('btnHighContrast' + suffix);
    if (!printBtn && !fontDownBtn && !darkBtn && !hcBtn) return; // not an article page / no utility bar in this instance

    var bar = { fontDownBtn: fontDownBtn, fontResetBtn: fontResetBtn, fontUpBtn: fontUpBtn, darkBtn: darkBtn, hcBtn: hcBtn };
    utilityBars.push(bar);

    if (fontDownBtn) fontDownBtn.addEventListener('click', function () { applySize(sizeIdx - 1); });
    if (fontResetBtn) fontResetBtn.addEventListener('click', function () { applySize(DEFAULT_IDX); });
    if (fontUpBtn) fontUpBtn.addEventListener('click', function () { applySize(sizeIdx + 1); });
    if (darkBtn) darkBtn.addEventListener('click', function () { applyDark(!isDark); });
    if (hcBtn) hcBtn.addEventListener('click', function () { applyHC(!isHC); });
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });

    // Sync this newly-registered instance's buttons to whatever the
    // current shared state already is (e.g. dark mode was toggled on
    // before this instance was ever loaded via infinite scroll).
    if (darkBtn) {
      darkBtn.textContent = isDark ? '☀️' : '🌙';
      darkBtn.classList.toggle('is-dark', isDark);
    }
    if (hcBtn) hcBtn.classList.toggle('is-active', isHC);
  }

  // ── Public entry point ──
  // Called once with suffix='' on the initial page load (below), and again
  // by infinite-scroll.js with e.g. '-inline1' every time a new article is
  // injected into the page.
  window.AT.initArticleInstance = function (suffix) {
    suffix = suffix || '';
    initLikeButton(suffix);
    initGalleryInstance(suffix);
    initUtilityBarInstance(suffix);
  };
  window.AT.initFbEmbeds = initFbEmbeds;

  document.addEventListener('DOMContentLoaded', function () {
    window.AT.initArticleInstance('');
    // Apply persisted dark mode / high contrast / font size to the base
    // instance even if its buttons never get clicked this visit — matches
    // the original behavior (applyDark(isDark)/applyHC(isHC)/conditional
    // applySize used to run unconditionally here too).
    if (sizeIdx !== DEFAULT_IDX) applyFontSize();
    applyDark(isDark);
    applyHC(isHC);
  });
})();
