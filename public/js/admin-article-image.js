// Instant AJAX image upload + preview for the article admin form.
// - Featured image: uploads on file-select, shows a preview, reveals ALT/
//   caption fields (ALT pre-filled from the title), "× Remove" clears it.
// - Gallery images: uploads each selected file, renders an editable card grid
//   (thumb + ALT + caption + remove), capped at 10, stored as JSON in a hidden
//   field the server reads.
// Progressive enhancement: if this script doesn't run, the plain file inputs
// still submit with the main form via the old multipart path.
(function () {
  'use strict';

  var UPLOAD_URL = '/admin/articles/upload-image';
  var MAX_GALLERY = 10;

  function titleValue() {
    var t = document.querySelector('[name="title"]');
    return t ? t.value.trim() : '';
  }

  // A gallery entry may be stored as a bare filename (legacy), a full
  // /uploads/... path, or an absolute URL — normalise any of them to a
  // usable src.
  function toUrl(s) {
    if (!s) return '';
    if (/^https?:\/\//.test(s) || s.charAt(0) === '/') return s;
    return '/uploads/articles/' + s;
  }

  function csrfToken() {
    var el = document.getElementById('csrfTokenField');
    return el ? el.value : '';
  }

  // Uploads one File to the AJAX endpoint. Resolves with the JSON payload,
  // rejects with an Error whose message is safe to show the user.
  function uploadImage(file, type) {
    var fd = new FormData();
    fd.append('image', file);
    fd.append('type', type);
    // Sent both as a form field and as the x-csrf-token header below — Brave's
    // default (non-private) browsing mode strips custom headers on this
    // specific request (confirmed via its own DevTools Network tab; Private
    // Window and Firefox both send the header fine), so the field is a
    // fallback csrfVerify already checks first.
    fd.append('_csrf', csrfToken());
    return fetch(UPLOAD_URL, {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { 'x-csrf-token': csrfToken() },
    })
      .then(function (res) {
        return res.json().catch(function () { return { success: false }; }).then(function (data) {
          if (!res.ok || !data.success) {
            throw new Error(data && data.error ? data.error : 'Upload failed. Please try again.');
          }
          return data;
        });
      });
  }

  // ---- Featured image ------------------------------------------------------
  function initFeatured() {
    var fileInput = document.getElementById('featuredFile');
    if (!fileInput) return;

    var existing = document.getElementById('featuredExisting');
    var previewWrap = document.getElementById('featuredPreviewWrap');
    var preview = document.getElementById('featuredPreview');
    var fields = document.getElementById('featuredFields');
    var altInput = document.getElementById('featuredAlt');
    var status = document.getElementById('featuredStatus');
    var removeLink = document.getElementById('featuredRemove');

    function showImage(url) {
      preview.src = url;
      previewWrap.hidden = false;
      fields.hidden = false;
    }

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      status.textContent = 'Uploading…';
      status.className = 'admin-upload-status is-busy';

      uploadImage(file, 'featured').then(function (data) {
        existing.value = data.url;
        showImage(data.thumbUrl || data.url);
        // Pre-fill ALT from the title as a suggestion (only if still empty).
        if (altInput && !altInput.value.trim()) {
          altInput.value = titleValue();
        }
        // Clear the file input so the main form doesn't re-upload it.
        fileInput.value = '';
        status.textContent = '';
        status.className = 'admin-upload-status';
      }).catch(function (err) {
        status.textContent = err.message;
        status.className = 'admin-upload-status is-error';
        fileInput.value = '';
      });
    });

    if (removeLink) {
      removeLink.addEventListener('click', function (e) {
        e.preventDefault();
        existing.value = '';
        preview.src = '';
        previewWrap.hidden = true;
        fields.hidden = true;
        if (altInput) altInput.value = '';
        var cap = document.getElementById('featuredCaption');
        if (cap) cap.value = '';
        status.textContent = '';
        status.className = 'admin-upload-status';
      });
    }
  }

  // ---- Gallery -------------------------------------------------------------
  function initGallery() {
    var fileInput = document.getElementById('galleryFile');
    if (!fileInput) return;

    var hidden = document.getElementById('galleryData');
    var grid = document.getElementById('galleryGrid');
    var status = document.getElementById('galleryStatus');
    var initialTag = document.getElementById('galleryInitial');

    // State: array of { url, alt, caption }.
    var items = [];
    if (initialTag) {
      try {
        var parsed = JSON.parse(initialTag.textContent || '[]');
        if (Array.isArray(parsed)) {
          items = parsed.map(function (it) {
            if (typeof it === 'string') return { url: toUrl(it), alt: '', caption: '' };
            return { url: toUrl(it.url || it.filename || ''), alt: it.alt || '', caption: it.caption || '' };
          }).filter(function (it) { return it.url; });
        }
      } catch (e) { /* ignore malformed initial data */ }
    }

    function syncHidden() {
      hidden.value = JSON.stringify(items);
      fileInput.disabled = items.length >= MAX_GALLERY;
    }

    function makeCard(item, index) {
      var card = document.createElement('div');
      card.className = 'admin-gallery__item';

      var img = document.createElement('img');
      img.className = 'admin-img-preview__thumb admin-img-preview__thumb--small';
      img.src = item.url;
      img.alt = '';
      card.appendChild(img);

      var altField = document.createElement('input');
      altField.type = 'text';
      altField.value = item.alt || '';
      altField.maxLength = 200;
      altField.placeholder = 'Alt text';
      altField.addEventListener('input', function () { item.alt = altField.value; syncHidden(); });
      card.appendChild(altField);

      var capField = document.createElement('input');
      capField.type = 'text';
      capField.value = item.caption || '';
      capField.placeholder = 'Caption (optional)';
      capField.addEventListener('input', function () { item.caption = capField.value; syncHidden(); });
      card.appendChild(capField);

      var remove = document.createElement('a');
      remove.href = '#';
      remove.className = 'admin-img-remove';
      remove.innerHTML = '&times; Remove';
      remove.addEventListener('click', function (e) {
        e.preventDefault();
        var i = items.indexOf(item);
        if (i !== -1) items.splice(i, 1);
        render();
      });
      card.appendChild(remove);

      return card;
    }

    function render() {
      grid.innerHTML = '';
      items.forEach(function (item, index) { grid.appendChild(makeCard(item, index)); });
      syncHidden();
    }

    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      if (!files.length) return;

      var room = MAX_GALLERY - items.length;
      if (room <= 0) { fileInput.value = ''; return; }
      var toUpload = files.slice(0, room);

      status.textContent = 'Uploading ' + toUpload.length + ' image' + (toUpload.length > 1 ? 's' : '') + '…';
      status.className = 'admin-upload-status is-busy';

      // Sequential upload so per-image failures are isolated and order is kept.
      var chain = Promise.resolve();
      var failures = 0;
      toUpload.forEach(function (file) {
        chain = chain.then(function () {
          return uploadImage(file, 'gallery').then(function (data) {
            var n = items.length + 1;
            items.push({ url: data.url, alt: titleValue() ? titleValue() + ' — photo ' + n : '', caption: '' });
            render();
          }).catch(function () { failures++; });
        });
      });

      chain.then(function () {
        fileInput.value = '';
        status.textContent = failures ? (failures + ' image(s) could not be uploaded (only JPG, PNG, GIF, WebP allowed).') : '';
        status.className = failures ? 'admin-upload-status is-error' : 'admin-upload-status';
      });
    });

    render();
  }

  document.addEventListener('DOMContentLoaded', function () {
    initFeatured();
    initGallery();
  });
})();
