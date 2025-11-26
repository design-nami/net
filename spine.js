document.addEventListener('DOMContentLoaded', function () {
  // Skip linking on touch-first / coarse pointer devices (smartphones, most tablets)
  if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) {
    return;
  }

  var cards = document.querySelectorAll('.b-card[data-project]');
  cards.forEach(function (card) {
    var id = card.getAttribute('data-project');
    if (!id) return;
    var targets = document.querySelectorAll('.hover-item[data-project="' + id + '"]');
    if (!targets.length) return;
    card.addEventListener('mouseenter', function () {
      targets.forEach(function (t) { t.classList.add('is-linked'); });
    });
    card.addEventListener('mouseleave', function () {
      targets.forEach(function (t) { t.classList.remove('is-linked'); });
    });
  });
});
