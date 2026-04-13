/**
 * Rating Period Selector — выбор периода для рейтинга
 * Загружает rating-db.json, пересчитывает рейтинг на клиенте
 */
var RatingPeriod = (function() {

  var db = null;

  function loadDb() {
    if (db) return Promise.resolve(db);
    return fetch('data/rating-db.json?t=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(d) { db = d; return d; })
      .catch(function() { return null; });
  }

  function renderSelector(container, defaultMonths) {
    return loadDb().then(function(data) {
      if (!data || !data.months) {
        container.innerHTML = '<p>Нет данных рейтинга</p>';
        return;
      }

      var allKeys = Object.keys(data.months).sort();
      if (!allKeys.length) {
        container.innerHTML = '<p>Нет данных рейтинга</p>';
        return;
      }

      // UI: выбор месяцев от/до
      var html = '<div class="card"><div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">';
      html += '<span>\uD83C\uDFC6 Рейтинг за период</span>';
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:400;text-transform:none">';
      html += '<label>От: <select id="rating-from" style="padding:3px 6px;border-radius:4px;border:1px solid #ccc;font-size:12px">';
      for (var i = 0; i < allKeys.length; i++) {
        var sel = (defaultMonths && defaultMonths.indexOf(allKeys[i]) === 0) ? ' selected' : '';
        if (!defaultMonths && i === Math.max(0, allKeys.length - 3)) sel = ' selected';
        html += '<option value="' + allKeys[i] + '"' + sel + '>' + formatMonthKey(allKeys[i]) + '</option>';
      }
      html += '</select></label>';
      html += '<label>До: <select id="rating-to" style="padding:3px 6px;border-radius:4px;border:1px solid #ccc;font-size:12px">';
      for (var j = 0; j < allKeys.length; j++) {
        var sel2 = (j === allKeys.length - 1) ? ' selected' : '';
        html += '<option value="' + allKeys[j] + '"' + sel2 + '>' + formatMonthKey(allKeys[j]) + '</option>';
      }
      html += '</select></label>';
      html += '<button id="rating-calc" style="padding:4px 12px;background:#0088CC;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">Рассчитать</button>';
      html += '</div></div>';

      // Таблица
      html += '<div id="rating-table-area"></div></div>';
      container.innerHTML = html;

      // Рассчитать по умолчанию
      var fromSel = document.getElementById('rating-from');
      var toSel = document.getElementById('rating-to');

      function recalc() {
        var from = fromSel.value;
        var to = toSel.value;
        var selected = allKeys.filter(function(k) { return k >= from && k <= to; });
        if (!selected.length) return;

        var managers = data._meta.managerNames || {};
        var rows = calcRating(data, selected, managers);
        var periodStr = formatMonthKey(selected[0]) + ' — ' + formatMonthKey(selected[selected.length - 1]);
        var dateStr = new Date().toLocaleString('ru-RU');

        var area = document.getElementById('rating-table-area');
        area.innerHTML = renderTable(rows, periodStr, dateStr);

        // Привязать клики
        area.addEventListener('click', function(e) {
          var td = e.target.closest('td[data-ids]');
          if (!td) return;
          try {
            var ids = JSON.parse(td.getAttribute('data-ids'));
            if (ids && ids.length) ConfigRenderer && ConfigRenderer.render ? showPopup(ids) : null;
          } catch(err) {}
        });
      }

      document.getElementById('rating-calc').addEventListener('click', recalc);
      recalc();
    });
  }

  function calcRating(data, monthKeys, managers) {
    var scores = [];
    var managerIds = Object.keys(managers);

    for (var mi = 0; mi < managerIds.length; mi++) {
      var mId = managerIds[mi];
      var name = managers[mId];
      var totalTaken = 0, totalMql = 0;
      var allTakenIds = [], allMqlIds = [];

      for (var ki = 0; ki < monthKeys.length; ki++) {
        var mk = monthKeys[ki];
        var d = data.months[mk] && data.months[mk].managers && data.months[mk].managers[mId];
        if (!d) continue;
        totalTaken += d.taken;
        totalMql += d.mql;
        allTakenIds = allTakenIds.concat(d.takenIds || []);
        allMqlIds = allMqlIds.concat(d.mqlIds || []);
      }

      var burnPct = totalTaken > 0 ? Math.round((totalTaken - totalMql) / totalTaken * 100) : 0;
      scores.push({ name: name, taken: totalTaken, takenIds: allTakenIds, mql: totalMql, mqlIds: allMqlIds, burnPct: burnPct });
    }

    scores.sort(function(a, b) { return b.mql - a.mql; });
    return scores;
  }

  function renderTable(scores, periodStr, dateStr) {
    var html = '<div style="padding:8px 16px;font-size:11px;color:#64748b">Период: ' + esc(periodStr) + ' | Рассчитано: ' + esc(dateStr) + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';
    html += '<tr><th>#</th><th>Брокер</th><th>Взято в работу (тег MQL)</th><th>Прошёл шаг MQL</th><th>% сжигания</th><th>Статус</th></tr>';

    for (var i = 0; i < scores.length; i++) {
      var s = scores[i];
      var place = i + 1;
      var status, statusStyle;
      if (place === 1) { status = 'Лидер'; statusStyle = 'background-color:#dcfce7;color:#166534;font-weight:700'; }
      else if (place <= 3) { status = 'ТОП ' + place; statusStyle = 'background-color:#dbeafe;color:#1e40af;font-weight:600'; }
      else if (s.mql > 0) { status = 'рентабельный'; statusStyle = 'background-color:#f0fdf4;color:#15803d'; }
      else { status = 'убыточный'; statusStyle = 'background-color:#fef2f2;color:#dc2626;font-weight:600'; }

      // % сжигания цвет
      var burnStyle = '';
      if (s.burnPct <= 20) burnStyle = 'background-color:#bbf7d0;color:#166534';
      else if (s.burnPct <= 35) burnStyle = 'background-color:#fef9c3;color:#854d0e';
      else if (s.burnPct <= 50) burnStyle = 'background-color:#fed7aa;color:#9a3412';
      else burnStyle = 'background-color:#fecaca;color:#991b1b';

      // Место цвет
      var placeStyle = '';
      if (place === 1) placeStyle = 'background-color:#fef08a;font-weight:700';
      else if (place <= 3) placeStyle = 'background-color:#e0f2fe;font-weight:600';

      var takenAttr = s.takenIds.length > 0 ? ' data-ids=\'' + JSON.stringify(s.takenIds) + '\' class="cell-clickable"' : '';
      var mqlAttr = s.mqlIds.length > 0 ? ' data-ids=\'' + JSON.stringify(s.mqlIds) + '\' class="cell-clickable"' : '';

      html += '<tr>';
      html += '<td style="' + placeStyle + '">' + place + '</td>';
      html += '<td style="text-align:left;font-weight:500">' + esc(s.name) + '</td>';
      html += '<td' + takenAttr + '>' + s.taken + '</td>';
      html += '<td' + mqlAttr + '>' + s.mql + '</td>';
      html += '<td style="' + burnStyle + '">' + s.burnPct + '%</td>';
      html += '<td style="' + statusStyle + '">' + status + '</td>';
      html += '</tr>';
    }

    html += '</table></div>';
    return html;
  }

  function showPopup(ids) {
    var old = document.getElementById('deals-popup');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'deals-popup';
    overlay.className = 'deals-popup-overlay';
    var popup = document.createElement('div');
    popup.className = 'deals-popup';
    popup.innerHTML = '<div class="deals-popup-header"><span>Сделки (' + ids.length + ')</span><button class="deals-popup-close">&times;</button></div>' +
      '<div class="deals-popup-body"><div class="deals-popup-list">' +
      ids.map(function(id) { return '<a href="https://tumanovgroup.amocrm.ru/leads/detail/' + id + '" target="_blank" class="deal-link">' + id + '</a>'; }).join(', ') +
      '</div><button class="deals-popup-copy" onclick="navigator.clipboard.writeText(\'' + ids.join(', ') + '\')">Копировать все ID</button></div>';
    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay || e.target.classList.contains('deals-popup-close')) overlay.remove(); });
    document.addEventListener('keydown', function h(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', h); } });
  }

  function formatMonthKey(key) {
    var parts = key.split('-');
    var monthNames = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    return monthNames[parseInt(parts[1])] + ' ' + parts[0];
  }

  function esc(v) { return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  return { renderSelector: renderSelector };
})();
