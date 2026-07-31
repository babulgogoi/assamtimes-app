document.addEventListener('DOMContentLoaded', function () {
  var likeBtn = document.getElementById('likeBtn');

  if (likeBtn) {
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

  function copyCurrentUrl(btn, message) {
    var url = window.location.href;

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

  document.querySelectorAll('.js-copy-link').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyCurrentUrl(btn, btn.getAttribute('data-copied-message') || 'Link copied!');
    });
  });

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

(function () {
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

  function initAll() {
    document.querySelectorAll('#fb-video-iframe, .fb-video-iframe').forEach(loadFbEmbed);
  }

  document.addEventListener('DOMContentLoaded', initAll);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(initAll, 250);
  });
})();

(function () {
  var dataEl = document.getElementById('galleryData');
  if (!dataEl) return;

  var images = JSON.parse(dataEl.textContent);
  if (!images.length) return;

  var lightbox = document.getElementById('galleryLightbox');
  var lightboxImage = document.getElementById('galleryLightboxImage');
  var lightboxCaption = document.getElementById('galleryLightboxCaption');
  var closeBtn = document.getElementById('galleryLightboxClose');
  var prevBtn = document.getElementById('galleryLightboxPrev');
  var nextBtn = document.getElementById('galleryLightboxNext');
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

  document.querySelectorAll('.gallery-lightbox-trigger').forEach(function (el) {
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
})();

(function () {
  var printBtn = document.getElementById('btnPrint');
  var fontDownBtn = document.getElementById('btnFontDown');
  var fontResetBtn = document.getElementById('btnFontReset');
  var fontUpBtn = document.getElementById('btnFontUp');
  var darkBtn = document.getElementById('btnDarkMode');
  var hcBtn = document.getElementById('btnHighContrast');
  if (!printBtn && !fontDownBtn && !darkBtn && !hcBtn) return; // not an article page

  // ── FONT SIZE ──
  var SIZES = [14, 16, 18, 20, 22]; // px
  var DEFAULT_IDX = 1; // 16px
  var sizeIdx = DEFAULT_IDX;
  try {
    var saved = localStorage.getItem('at_fontsize');
    if (saved !== null) sizeIdx = parseInt(saved, 10);
  } catch (e) {
    // localStorage can throw in sandboxed/private-browsing contexts — just
    // fall back to the default size rather than fail.
  }

  // article-detail__body is this template's actual class — the body/
  // article-body names in the original spec don't exist here.
  var articleBody = document.querySelector('.article-detail__body');

  function applySize(idx) {
    sizeIdx = Math.max(0, Math.min(SIZES.length - 1, idx));
    if (articleBody) articleBody.style.fontSize = SIZES[sizeIdx] + 'px';
    try {
      localStorage.setItem('at_fontsize', sizeIdx);
    } catch (e) {
      // ignore — worst case the size resets next visit
    }
  }

  if (sizeIdx !== DEFAULT_IDX) applySize(sizeIdx);

  if (fontDownBtn) fontDownBtn.addEventListener('click', function () { applySize(sizeIdx - 1); });
  if (fontResetBtn) fontResetBtn.addEventListener('click', function () { applySize(DEFAULT_IDX); });
  if (fontUpBtn) fontUpBtn.addEventListener('click', function () { applySize(sizeIdx + 1); });

  // ── DARK MODE ──
  // The class is applied to <body>, but the anti-flash apply-before-paint
  // script (layout.ejs) has to run before <body> exists in the DOM, so
  // that one targets document.documentElement instead and the very first
  // line here re-applies it to body once body is actually available.
  var isDark = false;
  try {
    isDark = localStorage.getItem('at_darkmode') === '1';
  } catch (e) {
    // ignore — defaults to light
  }

  function applyDark(on) {
    isDark = on;
    document.body.classList.toggle('dark-mode', on);
    if (darkBtn) {
      darkBtn.textContent = on ? '☀️' : '🌙';
      darkBtn.classList.toggle('is-dark', on);
    }
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

  applyDark(isDark);

  if (darkBtn) {
    darkBtn.addEventListener('click', function () { applyDark(!isDark); });
  }

  // ── HIGH CONTRAST ──
  var isHC = false;
  try {
    isHC = localStorage.getItem('at_highcontrast') === '1';
  } catch (e) {
    // ignore — defaults to off
  }

  function applyHC(on) {
    isHC = on;
    document.body.classList.toggle('high-contrast', on);
    if (hcBtn) hcBtn.classList.toggle('is-active', on);
    try {
      localStorage.setItem('at_highcontrast', on ? '1' : '0');
    } catch (e) {
      // ignore — worst case it doesn't persist
    }
    if (on && isDark) applyDark(false);
  }

  applyHC(isHC);

  if (hcBtn) {
    hcBtn.addEventListener('click', function () { applyHC(!isHC); });
  }

  // ── PRINT ──
  if (printBtn) {
    printBtn.addEventListener('click', function () { window.print(); });
  }
})();
