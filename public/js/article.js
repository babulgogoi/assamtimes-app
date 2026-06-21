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

  var copyBtn = document.getElementById('copyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      copyCurrentUrl(copyBtn, 'Link copied!');
    });
  }

  var igBtn = document.getElementById('shareInstagram');
  if (igBtn) {
    igBtn.addEventListener('click', function () {
      copyCurrentUrl(igBtn, 'Link copied — paste into your Instagram story/bio');
    });
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
