document.addEventListener('DOMContentLoaded', function () {
  // Hamburger + nav menu now live in mega-menu.js (the old inline
  // .site-header__nav dropdown was replaced by the mega menu overlay).
  var searchToggle = document.getElementById('searchToggle');
  var searchBar = document.getElementById('siteSearchBar');
  var searchInput = document.getElementById('siteSearchInput');
  if (!searchToggle || !searchBar) return;

  function openSearch() {
    searchBar.hidden = false;
    searchToggle.setAttribute('aria-expanded', 'true');
    if (searchInput) searchInput.focus();
  }

  function closeSearch() {
    searchBar.hidden = true;
    searchToggle.setAttribute('aria-expanded', 'false');
  }

  searchToggle.addEventListener('click', function () {
    if (searchBar.hidden) {
      openSearch();
    } else {
      closeSearch();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !searchBar.hidden) {
      closeSearch();
      searchToggle.focus();
    }
  });

  document.addEventListener('click', function (e) {
    if (searchBar.hidden) return;
    if (searchBar.contains(e.target) || searchToggle.contains(e.target)) return;
    closeSearch();
  });
});

(function () {
  var header = document.querySelector('.site-header');
  var sentinel = document.getElementById('headerSentinel');
  if (!header || !sentinel || !('IntersectionObserver' in window)) return;

  // A scroll-position check (e.g. getBoundingClientRect().top <= 0 on
  // DOMContentLoaded) races against images/fonts/ads still settling the
  // page's layout — it can lock in the wrong state before anything has
  // scrolled. A sentinel placed right above the header sidesteps that:
  // IntersectionObserver re-fires whenever its visibility actually
  // changes, for any reason, not just on scroll.
  var observer = new IntersectionObserver(
    function (entries) {
      header.classList.toggle('site-header--stuck', !entries[0].isIntersecting);
    },
    { threshold: 0 }
  );
  observer.observe(sentinel);
})();

(function () {
  // A previously-dismissed bar is already gone by the time this runs —
  // removed by an inline blocking script right after the bar's markup in
  // layout.ejs (before first paint, avoiding the layout shift this used to
  // cause by hiding it here instead, after the deferred script had already
  // let it paint visible). This guard just means there's nothing left to
  // wire up in that case.
  var bar = document.getElementById('breakingBar');
  if (!bar) return;

  var articleId = bar.getAttribute('data-article-id');

  // Auto-rotate breaking headlines every 4s — background/label stay put,
  // only the active <a> swaps (display:none/block), so this never resizes
  // .breaking-ticker or shifts anything else on the page.
  var tickerInterval = null;
  var items = document.querySelectorAll('.ticker-item');
  if (items.length > 1) {
    var current = 0;
    tickerInterval = setInterval(function () {
      items[current].style.display = 'none';
      items[current].classList.remove('active');
      current = (current + 1) % items.length;
      items[current].style.display = 'block';
      items[current].classList.add('active');
    }, 4000);
  }

  var dismissBtn = document.getElementById('breakingDismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function () {
      bar.style.display = 'none';
      if (tickerInterval) clearInterval(tickerInterval);
      try {
        sessionStorage.setItem('breakingDismissed', articleId);
      } catch (e) {
        // ignore — worst case it reappears on the next page view
      }
    });
  }

  // The bar sticks just below the header, but the header's own height
  // isn't fixed — it shrinks when .site-header--stuck kicks in on scroll
  // (the logo goes from 350px to 200px wide) — so this can't be a single
  // CSS constant. Sync it to the header's real measured height instead,
  // and keep it synced whenever that height actually changes.
  var header = document.querySelector('.site-header');
  if (header) {
    // +15 matches .breaking-news-bar's own margin-top:15px in style.css —
    // that margin only creates the gap while the bar sits in normal flow
    // (top of page, unscrolled); once scroll makes it actually stick,
    // margin no longer contributes, so the gap has to be baked into `top`
    // itself too or it'd visibly collapse to 0 right at the moment the
    // bar starts sticking.
    var GAP = 15;
    var syncTop = function () {
      bar.style.top = (header.offsetHeight + GAP) + 'px';
    };
    // ResizeObserver.observe() fires its callback once immediately with the
    // element's current size (per spec) — calling syncTop() manually right
    // before .observe() made that happen twice back-to-back, and the second
    // call's offsetHeight read landed right after the first call's
    // style.top write, forcing a synchronous layout recalc (confirmed via
    // instrumented trace: two offsetHeight reads a few ms apart, both from
    // this function, before any other script wrote to the DOM). The CSS
    // default (.breaking-news-bar{top:99px}) already covers the instant
    // before ResizeObserver's first callback fires, so no manual priming
    // call is needed on this path.
    if ('ResizeObserver' in window) {
      new ResizeObserver(syncTop).observe(header);
    } else {
      syncTop();
      window.addEventListener('resize', syncTop);
    }
  }
})();
