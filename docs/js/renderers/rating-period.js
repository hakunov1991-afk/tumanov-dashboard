/**
 * Rating Period Selector — клиентский рендер рейтинга за выбранный период.
 * Загружает rating-db.json (содержит taken/mql/byCircle/mqlCost/margin на месяц/менеджера).
 * 9 колонок: #, Брокер, Взято, MQL, % сжигания, Маржа, Затраты MQL, Личный вклад, Статус.
 * Сортировка по Личному вкладу (маржа − затраты), DESC.
 */
var RatingPeriod = (function() {

  var CIRCLE_COSTS = { 1: 100, 2: 10, 3: 10, 4: 0 };

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

      // По умолчанию — последние 3 ПОЛНЫХ месяца (исключаем текущий)
      var fullKeys = allKeys.filter(function(k) { return data.months[k] && data.months[k].isFinal; });
      var defaultTo = fullKeys.length > 0 ? fullKeys[fullKeys.length - 1] : allKeys[allKeys.length - 1];
      var defaultFrom = fullKeys.length >= 3
        ? fullKeys[fullKeys.length - 3]
        : (fullKeys[0] || allKeys[0]);

      var html = '<div class="card"><div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">';
      html += '<span>\uD83C\uDFC6 Рейтинг за период</span>';
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:400;text-transform:none">';
      html += '<label>От: <select id="rating-from" style="padding:3px 6px;border-radius:4px;border:1px solid #ccc;font-size:12px">';
      for (var i = 0; i < allKeys.length; i++) {
        var sel = (allKeys[i] === defaultFrom) ? ' selected' : '';
        html += '<option value="' + allKeys[i] + '"' + sel + '>' + formatMonthKey(allKeys[i]) + '</option>';
      }
      html += '</select></label>';
      html += '<label>До: <select id="rating-to" style="padding:3px 6px;border-radius:4px;border:1px solid #ccc;font-size:12px">';
      for (var j = 0; j < allKeys.length; j++) {
        var sel2 = (allKeys[j] === defaultTo) ? ' selected' : '';
        html += '<option value="' + allKeys[j] + '"' + sel2 + '>' + formatMonthKey(allKeys[j]) + '</option>';
      }
      html += '</select></label>';
      html += '<button id="rating-calc" style="padding:4px 12px;background:#0088CC;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600">Рассчитать</button>';
      html += '</div></div>';

      html += '<div id="rating-table-area"></div></div>';
      container.innerHTML = html;

      var fromSel = document.getElementById('rating-from');
      var toSel = document.getElementById('rating-to');

      function recalc() {
        var from = fromSel.value;
        var to = toSel.value;
        var selected = allKeys.filter(function(k) { return k >= from && k <= to; });
        if (!selected.length) return;

        var managers = (data._meta && data._meta.managerNames) || {};
        var rows = calcRating(data, selected, managers);
        var periodStr = formatMonthKey(selected[0]) + ' — ' + formatMonthKey(selected[selected.length - 1]);
        var dateStr = new Date().toLocaleString('ru-RU');

        var area = document.getElementById('rating-table-area');
        area.innerHTML = renderTable(rows, periodStr, dateStr);

        area.addEventListener('click', function(e) {
          var td = e.target.closest('td[data-ids]');
          if (!td) return;
          try {
            var ids = JSON.parse(td.getAttribute('data-ids'));
            if (ids && ids.length) showPopup(ids);
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
      var totalTaken = 0, totalMql = 0, totalMargin = 0, totalCost = 0;
      var allTakenIds = [], allMqlIds = [], allMarginIds = [];
      var costLeadIds = [];
      var circleCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

      for (var ki = 0; ki < monthKeys.length; ki++) {
        var mk = monthKeys[ki];
        var d = data.months[mk] && data.months[mk].managers && data.months[mk].managers[mId];
        if (!d) continue;
        totalTaken += d.taken || 0;
        totalMql += d.mql || 0;
        totalMargin += d.margin || 0;
        if (d.takenIds) allTakenIds = allTakenIds.concat(d.takenIds);
        if (d.mqlIds) allMqlIds = allMqlIds.concat(d.mqlIds);
        if (d.marginLeadIds) allMarginIds = allMarginIds.concat(d.marginLeadIds);

        if (d.byCircle) {
          for (var c = 1; c <= 4; c++) {
            var ids = d.byCircle[c] || [];
            circleCounts[c] += ids.length;
            costLeadIds = costLeadIds.concat(ids);
            totalCost += ids.length * (CIRCLE_COSTS[c] || 0);
          }
        } else if (d.mqlCost) {
          // обратная совместимость со старой DB
          totalCost += d.mqlCost;
        }
      }

      var burnPct = totalTaken > 0 ? Math.round((totalTaken - totalMql) / totalTaken * 100) : 0;
      var contribution = Math.round(totalMargin - totalCost);

      // Тултип-разбивка по кругам
      var costParts = [];
      for (var c2 = 1; c2 <= 4; c2++) {
        if (circleCounts[c2] > 0) {
          var sub = circleCounts[c2] * (CIRCLE_COSTS[c2] || 0);
          costParts.push('К' + c2 + ' ($' + CIRCLE_COSTS[c2] + ') × ' + circleCounts[c2] + ' = $' + sub);
        }
      }

      scores.push({
        name: name,
        taken: totalTaken, takenIds: allTakenIds,
        mql: totalMql, mqlIds: allMqlIds,
        burnPct: burnPct,
        margin: Math.round(totalMargin), marginIds: allMarginIds,
        cost: totalCost, costIds: costLeadIds, costNote: costParts.join('\n'),
        contribution: contribution,
      });
    }

    scores.sort(function(a, b) { return b.contribution - a.contribution; });
    return scores;
  }

  function fmtMoney(v) {
    if (v === 0) return '0';
    var sign = v < 0 ? '−' : '';
    var abs = Math.abs(v).toLocaleString('ru-RU').replace(/,/g, ' ');
    return sign + '$' + abs;
  }

  function renderTable(scores, periodStr, dateStr) {
    var html = '<div style="padding:8px 16px;font-size:11px;color:#64748b">Период: ' + esc(periodStr) + ' | Рассчитано: ' + esc(dateStr) + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';
    html += '<tr><th>#</th><th>Брокер</th><th>Взято в работу (тег MQL)</th><th>Прошёл шаг MQL</th><th>% сжигания</th><th>Валовая маржа</th><th>Затраты на MQL ($)</th><th>Личный вклад ($)</th><th>Статус</th></tr>';

    for (var i = 0; i < scores.length; i++) {
      var s = scores[i];
      var place = i + 1;
      var isLoss = s.contribution <= 0;
      var status, statusStyle;
      if (place === 1) { status = 'Лидер'; statusStyle = 'background-color:#dcfce7;color:#166534;font-weight:700'; }
      else if (place === 2) { status = 'ТОП 2'; statusStyle = 'background-color:#dbeafe;color:#1e40af;font-weight:600'; }
      else if (place === 3) { status = 'ТОП 3'; statusStyle = 'background-color:#e0e7ff;color:#3730a3;font-weight:600'; }
      else if (isLoss) { status = 'убыточный'; statusStyle = 'background-color:#fef2f2;color:#dc2626;font-weight:600'; }
      else { status = 'рентабельный'; statusStyle = 'background-color:#f0fdf4;color:#15803d'; }

      var burnStyle = '';
      if (s.burnPct <= 20) burnStyle = 'background-color:#bbf7d0;color:#166534';
      else if (s.burnPct <= 35) burnStyle = 'background-color:#fef9c3;color:#854d0e';
      else if (s.burnPct <= 50) burnStyle = 'background-color:#fed7aa;color:#9a3412';
      else burnStyle = 'background-color:#fecaca;color:#991b1b';

      var placeStyle = '';
      if (place === 1) placeStyle = 'background-color:#fef08a;font-weight:700';
      else if (place <= 3) placeStyle = 'background-color:#e0f2fe;font-weight:600';

      var contribStyle = isLoss ? 'color:#dc2626;font-weight:700' : 'font-weight:700';

      var takenAttr = s.takenIds.length > 0 ? ' data-ids=\'' + JSON.stringify(s.takenIds) + '\' class="cell-clickable"' : '';
      var mqlAttr = s.mqlIds.length > 0 ? ' data-ids=\'' + JSON.stringify(s.mqlIds) + '\' class="cell-clickable"' : '';
      var marginAttr = s.marginIds.length > 0 ? ' data-ids=\'' + JSON.stringify(s.marginIds) + '\' class="cell-clickable"' : '';
      var costAttr = s.costIds.length > 0 ? ' data-ids=\'' + JSON.stringify(s.costIds) + '\' class="cell-clickable" title="' + esc(s.costNote) + '"' : '';

      var nameDisp = (place === 1 ? '🥇 ' : '') + esc(s.name);

      html += '<tr>';
      html += '<td style="' + placeStyle + '">' + place + '</td>';
      html += '<td style="text-align:left;font-weight:500">' + nameDisp + '</td>';
      html += '<td' + takenAttr + '>' + s.taken + '</td>';
      html += '<td' + mqlAttr + '>' + s.mql + '</td>';
      html += '<td style="' + burnStyle + '">' + s.burnPct + '%</td>';
      html += '<td' + marginAttr + '>' + fmtMoney(s.margin) + '</td>';
      html += '<td' + costAttr + '>' + fmtMoney(s.cost) + '</td>';
      html += '<td style="' + contribStyle + '">' + (isLoss ? '(' + fmtMoney(Math.abs(s.contribution)) + ')' : fmtMoney(s.contribution)) + '</td>';
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
