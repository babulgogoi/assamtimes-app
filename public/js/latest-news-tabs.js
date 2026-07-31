// AJAX category tabs for the "Latest News" homepage section, Design B only.
// The grid is already server-rendered (unfiltered) on first load for SEO —
// clicking a tab re-fetches just that category from /api/latest-news and
// swaps the grid content in place, no full page reload.
(function () {
  'use strict';

  var tabsWrap = document.querySelector('.ln-tabs');
  var grid = document.getElementById('ln-grid');
  if (!tabsWrap || !grid) return;

  var tabs = tabsWrap.querySelectorAll('.ln-tab');
  var active = 'All';

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildCard(a) {
    var thumb = a.featured_image_thumb
      ? '<img src="' + escapeHtml(a.featured_image_thumb) + '" alt="' + escapeHtml(a.title) + '" loading="lazy" width="230" height="172">'
      : '';
    var date = a.published_at
      ? new Date(a.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
    var meta = date + (a.author_name ? ' &bull; ' + escapeHtml(a.author_name) : '');
    return '<a href="/article/' + encodeURIComponent(a.slug) + '" class="ln-cell">' +
      thumb +
      '<h4>' + escapeHtml(a.title) + '</h4>' +
      '<p>' + meta + '</p>' +
      '</a>';
  }

  function loadCategory(cat) {
    if (cat === active) return;
    active = cat;

    tabs.forEach(function (t) {
      var isActive = t.getAttribute('data-category') === cat;
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    grid.style.opacity = '0.5';
    var url = '/api/latest-news?limit=8' + (cat !== 'All' ? '&category=' + encodeURIComponent(cat) : '');

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (articles) {
        grid.innerHTML = articles.map(buildCard).join('');
        grid.style.opacity = '1';
      })
      .catch(function () {
        grid.style.opacity = '1';
      });
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      loadCategory(t.getAttribute('data-category'));
    });
  });
})();
