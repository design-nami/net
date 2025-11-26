document.addEventListener('DOMContentLoaded', function () {
  // PC / マウス環境だけで動かす（タッチ主体のデバイスは何もしない）
  if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) {
    return;
  }

  // data-project ごとに、対応する .hover-item のリストを集約
  var projectMap = {};
  var hoverItems = document.querySelectorAll('.hover-item[data-project]');
  hoverItems.forEach(function (el) {
    var id = el.getAttribute('data-project');
    if (!id) return;
    if (!projectMap[id]) projectMap[id] = [];
    projectMap[id].push(el);
  });

  function uniquePush(all, list) {
    list.forEach(function (el) {
      if (all.indexOf(el) === -1) all.push(el);
    });
  }

  // B列カードとの連動
  var cards = document.querySelectorAll('.b-card[data-project]');
  cards.forEach(function (card) {
    var id = card.getAttribute('data-project');
    if (!id) return;

    // このカードで光らせるべき project ID のセット
    var ids = [id];

    // book-系とのペアリング（例: grow <-> book-grow）
    var bookId = "book-" + id;
    if (projectMap[bookId]) {
      ids.push(bookId);
    }
    if (id.indexOf("book-") === 0) {
      var baseId = id.slice(5);
      if (projectMap[baseId]) {
        ids.push(baseId);
      }
    }

    var targets = [];
    ids.forEach(function (pid) {
      var list = projectMap[pid];
      if (list && list.length) {
        uniquePush(targets, list);
      }
    });
    if (!targets.length) return;

    card.addEventListener('mouseenter', function () {
      targets.forEach(function (t) { t.classList.add('is-linked'); });
    });
    card.addEventListener('mouseleave', function () {
      targets.forEach(function (t) { t.classList.remove('is-linked'); });
    });
  });

  // A-3（グラス）との連動: palindrome-glass
  var a3 = document.querySelector('.a-3-wrapper');
  if (a3) {
    var glassTargets = projectMap["palindrome-glass"] || [];
    if (glassTargets.length) {
      a3.addEventListener('mouseenter', function () {
        glassTargets.forEach(function (t) { t.classList.add('is-linked'); });
      });
      a3.addEventListener('mouseleave', function () {
        glassTargets.forEach(function (t) { t.classList.remove('is-linked'); });
      });
    }
  }
});
