(function () {
  // Shared by the header's bell icon and the bigger labeled button on
  // /subscribe — both stay in sync since they're really one subscription.
  var buttons = Array.prototype.slice.call(document.querySelectorAll('.js-push-subscribe'));
  if (!buttons.length) return;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isStandalone() {
    return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  }

  // iOS only exposes a usable PushManager once installed to the home
  // screen, but service worker registration itself works in a regular
  // Safari tab too — so still show the button there and explain the
  // "Add to Home Screen" step on click, rather than hiding it outright.
  var supported = ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) || isIOS();
  if (!supported) return;

  var vapidKey = buttons[0].getAttribute('data-vapid-key');
  if (!vapidKey) return;

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  var subscribed = false;

  function setSubscribedState(isSubscribed) {
    subscribed = isSubscribed;
    buttons.forEach(function (btn) {
      btn.classList.toggle('is-subscribed', subscribed);
      btn.title = subscribed ? 'Unsubscribe from push notifications' : 'Subscribe to push notifications';
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', subscribed ? 'true' : 'false');
    });
  }

  function postSubscription(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function subscribeUser() {
    return navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      })
      .then(function (subscription) {
        return postSubscription('/push/subscribe', subscription.toJSON());
      })
      .then(function () {
        setSubscribedState(true);
      });
  }

  function unsubscribeUser() {
    return navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (subscription) {
        if (!subscription) return;
        var endpoint = subscription.endpoint;
        return subscription.unsubscribe().then(function () {
          return postSubscription('/push/unsubscribe', { endpoint: endpoint });
        });
      })
      .then(function () {
        setSubscribedState(false);
      });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then(function (reg) {
        buttons.forEach(function (btn) { btn.hidden = false; });
        if (!reg.pushManager) return null;
        return reg.pushManager.getSubscription();
      })
      .then(function (subscription) {
        setSubscribedState(!!subscription);
      })
      .catch(function () {
        // Registration can fail on some iOS Safari versions outside
        // standalone mode — still show the button so the click handler
        // below can explain the Home Screen step instead of doing nothing.
        buttons.forEach(function (btn) { btn.hidden = false; });
      });
  } else {
    buttons.forEach(function (btn) { btn.hidden = false; });
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (isIOS() && !isStandalone()) {
        alert('To get push notifications on iPhone/iPad, first add Assam Times to your Home Screen: tap the Share icon, then "Add to Home Screen". Open it from there and tap Subscribe again.');
        return;
      }

      if (window.Notification && Notification.permission === 'denied') {
        alert('Notifications are blocked for this site. Enable them in your browser settings to subscribe.');
        return;
      }

      if (subscribed) {
        unsubscribeUser().catch(function () {
          alert('Could not unsubscribe. Please try again.');
        });
        return;
      }

      Notification.requestPermission()
        .then(function (permission) {
          if (permission !== 'granted') return;
          return subscribeUser();
        })
        .catch(function () {
          alert('Could not subscribe to notifications. Please try again.');
        });
    });
  });
})();
