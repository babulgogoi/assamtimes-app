(function () {
  var widget = document.getElementById('starRating');
  if (!widget) return;

  var stars = Array.prototype.slice.call(widget.querySelectorAll('.star-rating__star'));
  var summary = document.getElementById('starRatingSummary');
  var STORAGE_KEY = 'at_site_rating';

  function paintUpTo(value) {
    stars.forEach(function (star) {
      star.classList.toggle('is-active', Number(star.getAttribute('data-value')) <= value);
    });
  }

  function renderSummary(average, count) {
    if (!count) {
      summary.textContent = 'No ratings yet — be the first!';
      return;
    }
    summary.textContent = average.toFixed(1) + ' / 5 average from ' + count + ' rating' + (count === 1 ? '' : 's');
  }

  var voted = parseInt(localStorage.getItem(STORAGE_KEY), 10);
  var hasVoted = Number.isInteger(voted) && voted >= 1 && voted <= 5;

  if (hasVoted) {
    paintUpTo(voted);
    stars.forEach(function (star) {
      star.disabled = true;
    });
  } else {
    stars.forEach(function (star) {
      star.addEventListener('mouseenter', function () {
        paintUpTo(Number(star.getAttribute('data-value')));
      });
      star.addEventListener('mouseleave', function () {
        paintUpTo(hasVoted ? voted : 0);
      });
      star.addEventListener('click', function () {
        var value = Number(star.getAttribute('data-value'));
        fetch('/accessibility/rate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating: value }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Rating failed');
            return res.json();
          })
          .then(function (data) {
            localStorage.setItem(STORAGE_KEY, String(value));
            hasVoted = true;
            voted = value;
            paintUpTo(value);
            renderSummary(data.average, data.count);
            stars.forEach(function (s) {
              s.disabled = true;
            });
          })
          .catch(function () {
            alert('Could not submit your rating. Please try again.');
          });
      });
    });
  }
})();
