/**
 * Config Renderer — универсальный рендерер, управляемый конфигом
 * Поддерживает новый формат данных: { v: число, ids: [id сделок] }
 * Клик по ячейке с ids → попап со списком сделок
 */
var ConfigRenderer = (function() {

  function render(container, sheetData, pageConfig) {
    // Поддержка нового формата (tables array) и старого (data array)
    var tables = null;
    var oldData = null;

    if (sheetData && sheetData.tables) {
      tables = sheetData.tables;
    } else if (sheetData && sheetData.data) {
      oldData = sheetData.data;
    } else {
      container.innerHTML = '<p class="text-slate-500">Нет данных</p>';
      return;
    }

    var html = '';

    if (tables) {
      // Новый формат: массив таблиц из Node.js скриптов
      for (var i = 0; i < tables.length; i++) {
        html += renderNewTable(tables[i]);
      }
    } else if (oldData) {
      // Старый формат: массив строк из GAS snapshot
      var pageTables = pageConfig.tables || [];
      for (var j = 0; j < pageTables.length; j++) {
        var tbl = pageTables[j];
        var fmt = tbl.formatting || {};
        if (fmt.type === 'rating') {
          html += renderRating(oldData, tbl);
        } else {
          html += renderOldTable(oldData, tbl);
        }
      }
    }

    container.innerHTML = html;

    // Привязываем клик-попапы после вставки в DOM
    bindCellClicks(container);
  }

  // ============ Новый формат таблиц (из Node.js) ============

  function renderNewTable(tbl) {
    if (!tbl) return '';

    var html = '<div class="card"><div class="card-header">' + esc(tbl.title || '') + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    // Заголовки
    if (tbl.headers) {
      for (var h = 0; h < tbl.headers.length; h++) {
        html += '<tr>';
        var hrow = tbl.headers[h];
        for (var hc = 0; hc < hrow.length; hc++) {
          html += '<th>' + esc(hrow[hc]) + '</th>';
        }
        html += '</tr>';
      }
    }

    // Данные
    var fmtFn = getFormattingFn(tbl.id);
    if (tbl.rows) {
      for (var r = 0; r < tbl.rows.length; r++) {
        html += renderDataRow(tbl.rows[r], false, fmtFn, tbl.id);
      }
    }

    // Итого
    if (tbl.totals) {
      html += renderDataRow(tbl.totals, true, null, tbl.id);
    }

    html += '</table></div></div>';
    return html;
  }

  // Маппинг ID таблицы → функция форматирования из Formatting
  function getFormattingFn(tableId) {
    if (!tableId) return null;
    var id = tableId.toLowerCase();
    if (id === 't1') return Formatting.T1;
    if (id === 't2') return Formatting.T2;
    if (id === 't3' || id === 't11') return Formatting.T3;
    if (id === 't8') return Formatting.T8;
    if (id === 't9') return Formatting.T9;
    if (id === 'bt') return Formatting.BT;
    return null;
  }

  function renderDataRow(row, isTotal, fmtFn, tableId) {
    if (!row) return '';
    var html = '<tr' + (isTotal ? ' class="total-row"' : '') + '>';
    var isDeltaTable = (tableId === 't1'); // T1 имеет дельта-столбцы

    for (var c = 0; c < row.length; c++) {
      var raw = row[c];
      var val, ids, style = '', cls = '';

      if (raw && typeof raw === 'object' && raw.v !== undefined) {
        val = raw.v;
        ids = raw.ids || null;
      } else {
        val = raw;
        ids = null;
      }

      // Стиль для итого
      if (isTotal) {
        style = ' style="font-weight:700;background-color:#eef2ff"';
      }

      // Дельта столбцы (последние 3 для T1)
      if (isDeltaTable && !isTotal && c > 0 && typeof val === 'string' && val.match(/^[+-]\d/)) {
        var num = parseInt(val);
        var dColor = num > 0 ? '#dc2626' : num < 0 ? '#16a34a' : '#999';
        style = ' style="color:' + dColor + ';font-weight:600"';
      }
      // Условное форматирование по правилам таблицы
      else if (!isTotal && c > 0 && fmtFn && val !== '' && val !== 0) {
        var numVal = typeof val === 'number' ? val : parseFloat(val);
        if (!isNaN(numVal) && numVal > 0) {
          var fmt = fmtFn(numVal);
          if (fmt) {
            style = ' style="background-color:' + fmt.bg + ';color:' + fmt.color + '"';
          }
        }
      }

      // Имя (первый столбец)
      if (c === 0) {
        cls = ' class="cell-name"';
      }

      // Кликабельная ячейка с ID сделок
      var dataAttr = '';
      if (ids && ids.length > 0) {
        dataAttr = ' data-ids=\'' + JSON.stringify(ids) + '\' title="Нажмите для просмотра сделок"';
        cls = (c === 0) ? ' class="cell-name cell-clickable"' : ' class="cell-clickable"';
      }

      html += '<td' + cls + style + dataAttr + '>' + esc(val) + '</td>';
    }

    html += '</tr>';
    return html;
  }

  // ============ Попап со сделками ============

  function bindCellClicks(container) {
    container.addEventListener('click', function(e) {
      var td = e.target.closest('td[data-ids]');
      if (!td) return;

      try {
        var ids = JSON.parse(td.getAttribute('data-ids'));
        if (!ids || !ids.length) return;
        showDealsPopup(ids, td);
      } catch (err) {}
    });
  }

  function showDealsPopup(ids, anchor) {
    // Удаляем старый попап
    var old = document.getElementById('deals-popup');
    if (old) old.remove();

    var overlay = document.createElement('div');
    overlay.id = 'deals-popup';
    overlay.className = 'deals-popup-overlay';

    var popup = document.createElement('div');
    popup.className = 'deals-popup';

    // Заголовок
    var header = document.createElement('div');
    header.className = 'deals-popup-header';
    header.innerHTML = '<span>Сделки (' + ids.length + ')</span><button class="deals-popup-close">&times;</button>';
    popup.appendChild(header);

    // Список ID с ссылками на AMO
    var body = document.createElement('div');
    body.className = 'deals-popup-body';

    var list = document.createElement('div');
    list.className = 'deals-popup-list';

    for (var i = 0; i < ids.length; i++) {
      var link = document.createElement('a');
      link.href = 'https://tumanovgroup.amocrm.ru/leads/detail/' + ids[i];
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'deal-link';
      link.textContent = ids[i];
      list.appendChild(link);

      if (i < ids.length - 1) {
        list.appendChild(document.createTextNode(', '));
      }
    }

    body.appendChild(list);

    // Кнопка копирования
    var copyBtn = document.createElement('button');
    copyBtn.className = 'deals-popup-copy';
    copyBtn.textContent = 'Копировать все ID';
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(ids.join(', ')).then(function() {
        copyBtn.textContent = 'Скопировано!';
        setTimeout(function() { copyBtn.textContent = 'Копировать все ID'; }, 1500);
      });
    });
    body.appendChild(copyBtn);

    popup.appendChild(body);
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Закрытие
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.classList.contains('deals-popup-close')) {
        overlay.remove();
      }
    });

    document.addEventListener('keydown', function closeOnEsc(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', closeOnEsc);
      }
    });
  }

  // ============ Старый формат (GAS snapshot) — renderOldTable ============

  function renderOldTable(data, tbl) {
    var toIdx = tbl.to === -1 ? data.length - 1 : tbl.to;
    var rows = data.slice(tbl.from, toIdx + 1);
    if (!rows.length) return '';

    var headerIdx = 0;
    for (var h = 0; h < rows.length; h++) {
      if (rows[h] && rows[h].some(function(v) { return v != null && v !== ''; })) {
        headerIdx = h;
        break;
      }
    }

    var headerRows = tbl.headerRows || 1;
    var fmt = tbl.formatting || {};
    var rules = (fmt.type === 'threshold') ? fmt.rules : null;

    var html = '<div class="card"><div class="card-header">' + esc(tbl.title) + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    for (var r = headerIdx; r < rows.length; r++) {
      var row = rows[r];
      if (!row) continue;

      var hasContent = row.some(function(v) { return v != null && v !== ''; });
      if (!hasContent) continue;

      var localIdx = r - headerIdx;
      var isHeader = localIdx < headerRows;
      var isTotal = !isHeader && row[0] && String(row[0]).toUpperCase().indexOf('ИТОГО') >= 0;
      if (!isTotal && !isHeader && r === rows.length - 1 && tbl.totalRow) isTotal = true;
      var tag = isHeader ? 'th' : 'td';

      html += '<tr>';
      for (var c = 0; c < row.length; c++) {
        var val = row[c] != null ? row[c] : '';
        var style = '';

        if (!isHeader && !isTotal && c > 0 && val !== '') {
          if (tbl.hasDelta && c >= row.length - 3) {
            var ds = Formatting.deltaStyle(val);
            style = ' style="color:' + ds.color + ';font-weight:600"';
            val = Formatting.formatDelta(val);
          } else if (rules) {
            var f = applyRules(val, rules);
            if (f) style = ' style="background-color:' + f.bg + ';color:' + f.color + '"';
          }
        }

        if (isTotal && !isHeader) {
          style = ' style="font-weight:700;background-color:#eef2ff"';
        }

        html += '<' + tag + style + '>' + esc(val) + '</' + tag + '>';
      }
      html += '</tr>';
    }

    html += '</table></div></div>';
    return html;
  }

  // ============ Rating table (старый формат) ============

  function renderRating(data, tbl) {
    var toIdx = tbl.to === -1 ? data.length - 1 : tbl.to;
    var rows = data.slice(tbl.from, toIdx + 1);
    if (!rows.length) return '';

    var fmt = tbl.formatting || {};
    var titleRows = fmt.titleRows || 0;
    var statusColors = fmt.statusColors || {};
    var currencyMarkers = fmt.currencyMarkers || [];
    var percentMarkers = fmt.percentMarkers || [];

    var html = '';

    for (var t = 0; t < titleRows && t < rows.length; t++) {
      if (rows[t]) {
        var titleText = rows[t].filter(function(v) { return v != null && v !== ''; }).join(' ');
        if (titleText) {
          html += '<p class="text-sm text-slate-500 mb-1">' + esc(titleText) + '</p>';
        }
      }
    }

    var headerRow = titleRows;
    for (var h = titleRows; h < Math.min(rows.length, titleRows + 5); h++) {
      if (rows[h] && rows[h].some(function(v) {
        return String(v).indexOf('Брокер') >= 0 || String(v) === '#';
      })) {
        headerRow = h;
        break;
      }
    }

    var currencyCols = {};
    var pctCols = {};
    if (rows[headerRow]) {
      for (var ci = 0; ci < rows[headerRow].length; ci++) {
        var hdr = String(rows[headerRow][ci] || '').toLowerCase();
        for (var cm = 0; cm < currencyMarkers.length; cm++) {
          if (hdr.indexOf(currencyMarkers[cm]) >= 0) { currencyCols[ci] = true; break; }
        }
        for (var pm = 0; pm < percentMarkers.length; pm++) {
          if (hdr.indexOf(percentMarkers[pm]) >= 0) { pctCols[ci] = true; break; }
        }
      }
    }

    html += '<div class="card"><div class="card-header">' + esc(tbl.title) + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    if (rows[headerRow]) {
      html += '<tr>';
      for (var c = 0; c < rows[headerRow].length; c++) {
        html += '<th>' + esc(rows[headerRow][c] || '') + '</th>';
      }
      html += '</tr>';
    }

    for (var r = headerRow + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row) continue;
      var hasContent = row.some(function(v) { return v != null && v !== ''; });
      if (!hasContent) continue;

      html += '<tr>';
      for (var c2 = 0; c2 < row.length; c2++) {
        var val = row[c2] != null ? row[c2] : '';
        var style = '';

        if (pctCols[c2] && typeof val === 'number') val = Math.round(val * 100) + '%';
        else if (typeof val === 'number' && val > 0 && val < 1) val = Math.round(val * 100) + '%';
        if (currencyCols[c2] && typeof val === 'number') val = formatCurrency(val);

        var statusKey = String(val).trim();
        if (statusColors[statusKey]) {
          var sc = statusColors[statusKey];
          style = ' style="background-color:' + sc.bg + ';color:' + sc.color + ';font-weight:600"';
        }
        if (c2 === 0 && typeof row[c2] === 'number') {
          var rank = row[c2];
          if (rank === 1) style = ' style="background-color:#fef08a;font-weight:700"';
          else if (rank <= 3) style = ' style="background-color:#e0f2fe;font-weight:600"';
        }
        if (typeof row[c2] === 'number' && row[c2] < 0) {
          style = ' style="color:#dc2626;font-weight:600"';
        }

        html += '<td' + style + '>' + esc(val) + '</td>';
      }
      html += '</tr>';
    }

    html += '</table></div></div>';
    return html;
  }

  // ============ Helpers ============

  function applyRules(value, rules) {
    var num = parseFloat(value);
    if (isNaN(num) || num === 0) return null;
    for (var i = 0; i < rules.length; i++) {
      if (num >= rules[i].min) return { bg: rules[i].bg, color: rules[i].color };
    }
    return null;
  }

  function formatCurrency(num) {
    if (typeof num !== 'number') return num;
    var negative = num < 0;
    var abs = Math.abs(Math.round(num));
    var str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (negative ? '-' : '') + '$' + str;
  }

  function esc(val) {
    if (val == null) return '';
    var s = String(val);
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { render: render };
})();
