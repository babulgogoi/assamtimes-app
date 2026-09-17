(function () {
  if (!('IntersectionObserver' in window)) return; // graceful no-op on old browsers
  if (!window.AT || !window.AT.initArticleInstance) return; // article.js failed to load — nothing to hook into

  var AUTO_LOAD_CAP = 3;
  var mainEl = document.getElementById('main-content');
  if (!mainEl) return;

  var baseEl = document.querySelector('[data-instance-suffix=""]');
  if (!baseEl) return; // not an article page

  var baseSeedEl = document.getElementById('infiniteScrollSeed');
  if (!baseSeedEl) return;
  var baseSeed;
  try {
    baseSeed = JSON.parse(baseSeedEl.textContent);
  } catch (e) {
    return;
  }

  var loadedCount = 0;
  var isFetching = false;
  var manualModeOnly = false;
  var loadMoreBtn = null;
  var nextSlug = baseSeed.nextSlug;
  var excludeIds = (baseSeed.excludeIds || []).slice();

  // instances[suffix] = { slug, canonicalUrl, title, metaDescription,
  // ogImage, tracking, el, hydrated, viewed }
  var instances = {};
  instances[''] = {
    slug: baseSeed.slug,
    canonicalUrl: window.location.href,
    title: document.title,
    metaDescription: null,
    ogImage: null,
    tracking: null,
    el: baseEl,
    hydrated: true, // article.js's own DOMContentLoaded handler already did this
    viewed: true, // server already counted this on the normal page load
  };

  // ── "Active article" detection ── a thin marker just under each
  // instance's <h1> (article.ejs's .infinite-scroll-active-marker), not
  // the whole (very tall) article element — watching the tall element
  // itself would report "intersecting" for nearly its entire time on
  // screen, giving no clean signal for exactly when the reader has
  // reached it. rootMargin shrinks the observed viewport to a thin band
  // near vertical center, so a marker only crosses it once per scroll pass.
  var activeObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var suffix = entry.target.getAttribute('data-suffix') || '';
          setActive(suffix);
        }
      });
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
  );

  // ── Prefetch trigger ── a sentinel near the bottom of each instance's
  // content (article.ejs, right after article-body-extras/before the
  // author box) — rootMargin extends the trigger zone downward so the
  // fetch starts a bit before the reader actually reaches it.
  var prefetchObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) fetchNext(false);
      });
    },
    { rootMargin: '0px 0px 600px 0px', threshold: 0 }
  );

  function observeSentinel(suffix) {
    var sentinel = document.querySelector('.infinite-scroll-sentinel[data-suffix="' + suffix + '"]');
    if (sentinel) prefetchObserver.observe(sentinel);
  }

  function observeMarker(suffix) {
    var marker = document.querySelector('.infinite-scroll-active-marker[data-suffix="' + suffix + '"]');
    if (marker) activeObserver.observe(marker);
  }

  observeSentinel('');
  observeMarker('');

  function updateHead(instance) {
    document.title = instance.title;

    var canonicalLink = document.querySelector('link[rel="canonical"]');
    if (canonicalLink) canonicalLink.href = instance.canonicalUrl;

    if (instance.metaDescription) {
      var descTag = document.querySelector('meta[name="description"]');
      if (descTag) descTag.setAttribute('content', instance.metaDescription);
    }

    [
      ['meta[property="og:title"]', instance.title],
      ['meta[property="og:url"]', instance.canonicalUrl],
      ['meta[property="og:description"]', instance.metaDescription],
      ['meta[property="og:image"]', instance.ogImage],
      ['meta[name="twitter:title"]', instance.title],
      ['meta[name="twitter:description"]', instance.metaDescription],
      ['meta[name="twitter:image"]', instance.ogImage],
    ].forEach(function (pair) {
      if (!pair[1]) return;
      var tag = document.querySelector(pair[0]);
      if (tag) tag.setAttribute('content', pair[1]);
    });
  }

  function fireTracking(instance) {
    if (typeof window.gtag !== 'function' || !instance.tracking) return;
    window.gtag('event', 'page_view', {
      page_title: instance.title,
      page_location: instance.canonicalUrl,
    });
    window.gtag('event', 'article_view', instance.tracking);
  }

  function markViewed(instance) {
    if (instance.viewed) return;
    instance.viewed = true;
    fetch('/article/' + encodeURIComponent(instance.slug) + '/view', { method: 'POST' }).catch(function () {
      // Best-effort — a failed view-count ping shouldn't disrupt the
      // reading experience.
    });
  }

  function hydrateExpensive(suffix, instance) {
    // The two genuinely expensive per-instance bindings (a remote hCaptcha
    // script load/render, and — deliberately NOT implemented for injected
    // instances at all, see below — live-blog polling) are deferred until
    // an instance actually becomes active, rather than done eagerly for
    // every prefetched instance the reader may never reach.
    var captchaEl = instance.el && instance.el.querySelector('.h-captcha');
    if (captchaEl && !captchaEl.hasAttribute('data-hcaptcha-widget-id')) {
      ensureHcaptcha(captchaEl);
    }
    // Live-blog auto-refresh is intentionally NOT started for injected
    // instances (liveblog.js is only ever loaded on a normal page load —
    // see article.ejs's `<% if (!isInline) %>` guard). A live-blog article
    // reached via infinite scroll still displays its entries as of fetch
    // time, just without the 30s auto-refresh poll, to avoid multiple
    // competing pollers running at once for a feature this scroll pattern
    // will rarely even encounter.
  }

  function setActive(suffix) {
    var instance = instances[suffix];
    if (!instance) return;

    // Head/tracking/hydration must run regardless of whether pushState
    // itself succeeds — found via real testing that a thrown pushState
    // (SecurityError on any origin mismatch) aborted this whole function
    // before any of the rest ran, silently leaving <title>/canonical/GA
    // stuck on the previous article. Also pass just pathname+search (not
    // the full absolute URL) to pushState — same-origin by construction,
    // so it can't throw for that reason at all; the absolute canonicalUrl
    // is still what <link rel=canonical>/OG tags get, just not this call.
    try {
      var url = new URL(instance.canonicalUrl);
      if (window.location.pathname !== url.pathname) {
        history.pushState({ suffix: suffix }, '', url.pathname + url.search);
      }
    } catch (e) {
      console.warn('infinite-scroll: pushState failed', e);
    }

    updateHead(instance);
    fireTracking(instance);
    markViewed(instance);
    hydrateExpensive(suffix, instance);
  }

  window.addEventListener('popstate', function () {
    // Every earlier-loaded instance is still in the DOM (nothing is ever
    // removed), so returning to a previous article in the chain is just a
    // scroll + head update, not a re-fetch.
    var path = window.location.pathname;
    var suffix = null;
    Object.keys(instances).forEach(function (s) {
      var inst = instances[s];
      try {
        if (new URL(inst.canonicalUrl).pathname === path) suffix = s;
      } catch (e) {
        // ignore malformed canonicalUrl, shouldn't happen
      }
    });
    if (suffix === null) return; // URL isn't one of ours (or a hash-only change) — leave it alone
    var instance = instances[suffix];
    updateHead(instance);
    if (instance.el) instance.el.scrollIntoView({ block: 'start' });
  });

  var hcaptchaLoading = null;
  function ensureHcaptcha(captchaEl) {
    function render() {
      if (window.hcaptcha && !captchaEl.hasAttribute('data-hcaptcha-widget-id')) {
        var id = window.hcaptcha.render(captchaEl, { sitekey: captchaEl.getAttribute('data-sitekey') });
        captchaEl.setAttribute('data-hcaptcha-widget-id', id);
      }
    }

    if (window.hcaptcha) {
      render();
      return;
    }
    if (hcaptchaLoading) {
      hcaptchaLoading.then(render);
      return;
    }
    hcaptchaLoading = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      document.head.appendChild(script);
    });
    hcaptchaLoading.then(render);
  }

  function showLoadMore() {
    if (loadMoreBtn || !nextSlug) return;
    loadMoreBtn = document.createElement('button');
    loadMoreBtn.type = 'button';
    loadMoreBtn.className = 'infinite-scroll-load-more';
    loadMoreBtn.textContent = 'Load more articles';
    loadMoreBtn.addEventListener('click', function () {
      loadMoreBtn.remove();
      loadMoreBtn = null;
      fetchNext(true);
    });
    mainEl.appendChild(loadMoreBtn);
  }

  function fetchNext(manual) {
    if (isFetching || !nextSlug) return;
    if (!manual && (manualModeOnly || loadedCount >= AUTO_LOAD_CAP)) {
      manualModeOnly = true;
      showLoadMore();
      return;
    }
    isFetching = true;

    var instanceNum = loadedCount + 1;
    var suffix = '-inline' + instanceNum;
    var url = '/article/' + encodeURIComponent(nextSlug) + '/inline' +
      '?instance=' + instanceNum +
      '&exclude=' + encodeURIComponent(excludeIds.join(','));

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('inline fetch failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        loadedCount++;

        var wrapper = document.createElement('div');
        wrapper.className = 'infinite-scroll-instance';
        wrapper.innerHTML = data.html;
        mainEl.appendChild(wrapper);

        var el = wrapper.querySelector('[data-instance-suffix="' + suffix + '"]');
        instances[suffix] = {
          slug: data.slug,
          canonicalUrl: data.canonicalUrl,
          title: data.title,
          metaDescription: data.metaDescription,
          ogImage: data.ogImage,
          tracking: data.tracking,
          el: el,
          hydrated: true,
          viewed: false,
        };

        window.AT.initArticleInstance(suffix);
        window.AT.initFbEmbeds(wrapper);
        if (window.twttr && window.twttr.widgets) window.twttr.widgets.load(wrapper);

        nextSlug = data.nextSlug;
        excludeIds = data.excludeIds;

        observeSentinel(suffix);
        observeMarker(suffix);

        if (loadedCount >= AUTO_LOAD_CAP) manualModeOnly = true;
        if (manualModeOnly) showLoadMore();
      })
      .catch(function (err) {
        console.warn('infinite-scroll: failed to load next article', err);
      })
      .finally(function () {
        isFetching = false;
      });
  }
})();
