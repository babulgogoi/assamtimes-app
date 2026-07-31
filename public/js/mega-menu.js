(function () {
  var hamburger = document.getElementById('btnHamburger');
  var megaMenu = document.getElementById('megaMenu');
  var closeBtn = document.getElementById('btnMenuClose');
  var backdrop = document.getElementById('menuBackdrop');
  var mobileMenu = document.getElementById('mobileMenu');
  var mobileNav = mobileMenu ? mobileMenu.querySelector('.mobile-menu__nav') : null;
  var mobileBackdrop = document.getElementById('mobileMenuBackdrop');
  if (!hamburger || !megaMenu) return;

  // Same breakpoint as the CSS (.mobile-menu's 600px media queries) —
  // above it, the hamburger drives the desktop mega menu; at or below it,
  // the simple vertical mobile menu instead.
  function isMobile() {
    return window.innerWidth <= 600;
  }

  function openMegaMenu() {
    megaMenu.classList.add('is-open');
    megaMenu.setAttribute('aria-hidden', 'false');
    hamburger.classList.add('is-open');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      if (closeBtn) closeBtn.focus();
    }, 300);
  }

  function closeMegaMenu() {
    megaMenu.classList.remove('is-open');
    megaMenu.setAttribute('aria-hidden', 'true');
    hamburger.classList.remove('is-open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    hamburger.focus();
  }

  function openMobileMenu() {
    if (!mobileMenu) return;
    // Matches the header's real measured height (~71px at the top of the
    // page vs ~46px once .site-header--stuck shrinks it on scroll) — same
    // reasoning as the breaking-news-bar's offsetHeight sync below. Body
    // scroll is locked for the duration, so the header can't change height
    // while the menu is open — one measurement at open-time is enough.
    var header = document.querySelector('.site-header');
    if (mobileNav && header) {
      mobileNav.style.paddingTop = header.offsetHeight + 'px';
    }
    mobileMenu.classList.add('is-open');
    mobileMenu.setAttribute('aria-hidden', 'false');
    hamburger.classList.add('is-open');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    var firstLink = mobileMenu.querySelector('a');
    if (firstLink) firstLink.focus();
  }

  function closeMobileMenu() {
    if (!mobileMenu) return;
    mobileMenu.classList.remove('is-open');
    mobileMenu.setAttribute('aria-hidden', 'true');
    hamburger.classList.remove('is-open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    hamburger.focus();
  }

  hamburger.addEventListener('click', function () {
    if (isMobile()) {
      if (mobileMenu && mobileMenu.classList.contains('is-open')) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    } else if (megaMenu.classList.contains('is-open')) {
      closeMegaMenu();
    } else {
      openMegaMenu();
    }
  });

  if (closeBtn) closeBtn.addEventListener('click', closeMegaMenu);
  if (backdrop) backdrop.addEventListener('click', closeMegaMenu);
  if (mobileBackdrop) mobileBackdrop.addEventListener('click', closeMobileMenu);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (mobileMenu && mobileMenu.classList.contains('is-open')) {
      closeMobileMenu();
    } else if (megaMenu.classList.contains('is-open')) {
      closeMegaMenu();
    }
  });

  // Close when a menu link is clicked (navigating away).
  var links = megaMenu.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', closeMegaMenu);
  }
  if (mobileMenu) {
    var mobileLinks = mobileMenu.querySelectorAll('a');
    for (var j = 0; j < mobileLinks.length; j++) {
      mobileLinks[j].addEventListener('click', closeMobileMenu);
    }
  }

  // Focus trap inside the mega menu while it's open (desktop only — the
  // mobile menu is a short single link list, no internal trap needed).
  megaMenu.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.slice
      .call(megaMenu.querySelectorAll('a, button, input, [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !el.disabled; });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
})();
