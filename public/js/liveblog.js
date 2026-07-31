(function () {
  var section = document.getElementById('liveblogSection');
  if (!section || section.dataset.status !== 'live') return;

  var articleId = section.dataset.articleId;
  var container = document.getElementById('liveblogEntries');
  var countEl = document.getElementById('liveEntryCount');
  var lastEntryTime = null;

  document.querySelectorAll('.entry-time').forEach(function (t) {
    var dt = t.getAttribute('datetime');
    if (!lastEntryTime || dt > lastEntryTime) lastEntryTime = dt;
  });

  function buildEntryNode(entry) {
    var div = document.createElement('div');
    div.className = 'liveblog-entry new-entry' + (entry.is_key_event ? ' is-key-event' : '');
    div.dataset.entryId = entry.id;

    var created = new Date(entry.created_at);
    var time = created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    var date = created.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    var header =
      (entry.is_key_event ? '<span class="key-event-badge">&#11088; Key Event</span>' : '') +
      '<time class="entry-time" datetime="' + entry.created_at + '">' + time +
      ' <span class="entry-date">' + date + '</span></time>' +
      (entry.author_name ? '<span class="entry-author">by ' + entry.author_name + '</span>' : '');

    div.innerHTML = '<div class="entry-header">' + header + '</div><div class="entry-content">' + entry.content_html + '</div>';
    return div;
  }

  function markEnded() {
    clearInterval(pollInterval);
    section.dataset.status = 'ended';
    var badge = document.querySelector('.liveblog-live-badge');
    if (badge) badge.outerHTML = '<div class="liveblog-ended-badge">Coverage Ended</div>';
    var updatingText = document.querySelector('.liveblog-updating');
    if (updatingText) updatingText.remove();
  }

  function checkForUpdates() {
    var url = '/api/liveblog/' + articleId + '/entries' + (lastEntryTime ? '?since=' + encodeURIComponent(lastEntryTime) : '');

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.liveblog_status === 'ended') {
          markEnded();
          return;
        }

        if (!data.entries || !data.entries.length) return;

        var empty = container.querySelector('.liveblog-empty');
        if (empty) empty.remove();

        data.entries.forEach(function (entry) {
          if (container.querySelector('[data-entry-id="' + entry.id + '"]')) return;
          if (!lastEntryTime || entry.created_at > lastEntryTime) lastEntryTime = entry.created_at;

          var node = buildEntryNode(entry);
          var pinned = container.querySelector('.is-pinned');
          if (pinned) {
            pinned.after(node);
          } else {
            container.prepend(node);
          }

          requestAnimationFrame(function () {
            node.style.opacity = '0';
            node.style.transform = 'translateY(-10px)';
            requestAnimationFrame(function () {
              node.style.transition = 'opacity 0.4s, transform 0.4s';
              node.style.opacity = '1';
              node.style.transform = 'translateY(0)';
            });
          });
        });

        if (countEl) countEl.textContent = container.querySelectorAll('.liveblog-entry').length + ' updates';
      })
      .catch(function (err) {
        console.warn('Liveblog poll error:', err.message);
      });
  }

  var pollInterval = setInterval(checkForUpdates, 30000);
  window.addEventListener('beforeunload', function () {
    clearInterval(pollInterval);
  });
})();
