/**
 * Config Loader — загружает dashboard-config.json
 */
var ConfigLoader = (function() {
  var config = null;

  function load() {
    console.log('CONFIG: loading...');
    return fetch('data/dashboard-config.json?t=' + Date.now())
      .then(function(r) {
        console.log('CONFIG: fetch status', r.status);
        return r.json();
      })
      .then(function(d) {
        config = d;
        console.log('CONFIG: OK, pages:', Object.keys(d.pages || {}));
        return d;
      })
      .catch(function(err) {
        console.error('CONFIG: FAILED', err);
        config = { version: 1, pages: {}, genericPages: {} };
        return config;
      });
  }

  function getPageConfig(routeKey) {
    if (!config) return null;
    return config.pages[routeKey] || config.genericPages[routeKey] || null;
  }

  function getSheetName(routeKey) {
    var p = getPageConfig(routeKey);
    return p ? p.sheet : null;
  }

  function getFileName(routeKey) {
    var p = getPageConfig(routeKey);
    return p ? p.file : null;
  }

  return {
    load: load,
    getPageConfig: getPageConfig,
    getSheetName: getSheetName,
    getFileName: getFileName
  };
})();
/**
 * Data Loader — загружает JSON из docs/data/ или напрямую из GAS web app
 */
var DataLoader = (function() {
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbxnMZ53JPp4HHvBxPICo9jTW4hWfsBtrsIjq3VsuTzXwu1Lz1-03863RY-bQ5hUWbNO/exec';

  var SHEET_MAP = {
    'tasks':          'Задачи',
    'broker-tasks':   'Задачи брокеров',
    'rating':         'Рейтинг',
    'rating-brokers': 'Валовая маржа брокеров',
    'rating-interim': 'Рейтинг промежуточный',
    'statistics':     'Статистика',
    'cohort':         'Когортный анализ',
    'conversion2':    'Конверсия по неделям 2',
    'conversion4':    'Конверсия 4 недели',
    'interns':        'Стажеры',
    'closure':        'Причины закрытия',
    'leads':          'Распределение лидов',
    'heatmap':        'Тепловая карта брокеров',
    'stakan':         'Стакан 2/3/4 круг'
  };

  var FILE_MAP = {
    'tasks':          'zadachi',
    'broker-tasks':   'zadachi-brokerov',
    'rating':         'rating',
    'rating-brokers': 'valovaya-marzha-brokerov',
    'rating-interim': 'rating-promezhutochny',
    'statistics':     'statistika',
    'cohort':         'kogortny-analiz',
    'conversion2':    'konversiya-2',
    'conversion4':    'konversiya-4',
    'interns':        'stazhery',
    'closure':        'prichiny-zakrytiya',
    'leads':          'raspredelenie-lidov',
    'heatmap':        'teplovaya-karta',
    'stakan':         'stakan'
  };

  var cache = {};
  var meta = null;

  function loadMeta() {
    if (meta) return Promise.resolve(meta);
    return fetch('data/meta.json?t=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(d) { meta = d; return d; })
      .catch(function() { return null; });
  }

  function _resolveSheet(routeKey) {
    // Try hardcoded maps first, then fall back to config
    var sheetName = SHEET_MAP[routeKey];
    var fileName = FILE_MAP[routeKey];
    if (!sheetName && typeof ConfigLoader !== 'undefined') {
      sheetName = ConfigLoader.getSheetName(routeKey);
      fileName = ConfigLoader.getFileName(routeKey);
    }
    return { sheetName: sheetName, fileName: fileName };
  }

  function loadSheet(routeKey) {
    if (cache[routeKey]) return Promise.resolve(cache[routeKey]);
    var resolved = _resolveSheet(routeKey);
    if (!resolved.fileName) return Promise.resolve(null);
    return fetch('data/sheets/' + resolved.fileName + '.json?t=' + Date.now())
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var sheetData = d.sheets ? d.sheets[resolved.sheetName] : d;
        cache[routeKey] = sheetData;
        return sheetData;
      })
      .catch(function(err) {
        console.error('Load error for ' + routeKey + ':', err);
        return null;
      });
  }

  function refreshFromGAS(routeKey) {
    var resolved = _resolveSheet(routeKey);
    if (!resolved.sheetName) return Promise.resolve(null);
    var url = GAS_URL + '?sheet=' + encodeURIComponent(resolved.sheetName);
    return fetch(url, { redirect: 'follow' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var sheetData = d.sheets ? d.sheets[resolved.sheetName] : d;
        cache[routeKey] = sheetData;
        return sheetData;
      });
  }

  function getSheetName(routeKey) {
    return SHEET_MAP[routeKey] || (typeof ConfigLoader !== 'undefined' ? ConfigLoader.getSheetName(routeKey) : null) || routeKey;
  }

  return {
    loadMeta: loadMeta,
    loadSheet: loadSheet,
    refreshFromGAS: refreshFromGAS,
    getSheetName: getSheetName,
    SHEET_MAP: SHEET_MAP,
    FILE_MAP: FILE_MAP
  };
})();
/**
 * Conditional Formatting — правила условного форматирования из GAS скриптов
 */
var Formatting = (function() {

  // T1: Просроченные задачи
  var T1_RULES = [
    { min: 10, bg: '#880e4f', color: '#fff' },
    { min: 5,  bg: '#fff3e0', color: '#000' },
    { min: 1,  bg: '#fce4ec', color: '#000' }
  ];

  // T2: Нагрузка брокеров (кол-во сделок в этапе)
  var T2_RULES = [
    { min: 40, bg: '#ef9a9a', color: '#000' },
    { min: 30, bg: '#ffcc80', color: '#000' },
    { min: 20, bg: '#ffe0b2', color: '#000' },
    { min: 10, bg: '#fff9c4', color: '#000' }
  ];

  // T3: Просрочки >30 дней
  var T3_RULES = [
    { min: 20, bg: '#ef9a9a', color: '#000' },
    { min: 15, bg: '#ffcc80', color: '#000' },
    { min: 10, bg: '#ffe0b2', color: '#000' },
    { min: 5,  bg: '#fff9c4', color: '#000' }
  ];

  // T8: Скорость взятия в секундах
  var T8_RULES = [
    { min: 86400, bg: '#ef9a9a', color: '#000' },  // > 1 день
    { min: 3600,  bg: '#ffcc80', color: '#000' },  // > 1 час
    { min: 600,   bg: '#fff9c4', color: '#000' }   // > 10 мин
  ];

  // T9: Снятые сделки
  var T9_RULES = [
    { min: 5, bg: '#ef9a9a', color: '#000' },
    { min: 3, bg: '#ffcc80', color: '#000' },
    { min: 1, bg: '#fff9c4', color: '#000' }
  ];

  // BT: Контроль задач бота
  var BT_RULES = [
    { min: 5, bg: '#ef9a9a', color: '#000' },
    { min: 3, bg: '#ffcc80', color: '#000' },
    { min: 1, bg: '#fff9c4', color: '#000' }
  ];

  function applyRules(value, rules) {
    var num = parseFloat(value);
    if (isNaN(num) || num === 0) return null;
    for (var i = 0; i < rules.length; i++) {
      if (num >= rules[i].min) return { bg: rules[i].bg, color: rules[i].color };
    }
    return null;
  }

  function deltaStyle(value) {
    var num = parseFloat(value);
    if (isNaN(num) || num === 0) return { color: '#999' };
    if (num > 0) return { color: '#cc0000' };
    return { color: '#006600' };
  }

  function formatDelta(value) {
    var num = parseFloat(value);
    if (isNaN(num) || num === 0) return '';
    return (num > 0 ? '+' : '') + num;
  }

  function styleCell(td, fmt) {
    if (!fmt) return;
    if (fmt.bg) td.style.backgroundColor = fmt.bg;
    if (fmt.color) td.style.color = fmt.color;
  }

  return {
    T1: function(v) { return applyRules(v, T1_RULES); },
    T2: function(v) { return applyRules(v, T2_RULES); },
    T3: function(v) { return applyRules(v, T3_RULES); },
    T8: function(v) { return applyRules(v, T8_RULES); },
    T9: function(v) { return applyRules(v, T9_RULES); },
    BT: function(v) { return applyRules(v, BT_RULES); },
    deltaStyle: deltaStyle,
    formatDelta: formatDelta,
    styleCell: styleCell
  };
})();
/**
 * AMO Mapping Parser — парсит лист "AMO Маппинг" для справочников
 */
var AmoMapping = (function() {
  var parsed = null;

  function parse(sheetData) {
    if (!sheetData || !sheetData.data) return null;
    var data = sheetData.data;

    var sections = { users: [], groups: [], pipelines: [], leadFields: [], contactFields: [] };
    var currentSection = null;
    var headerCols = null;

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      if (!row || !row[0]) continue;

      var first = String(row[0]).trim().toUpperCase();

      // Detect section headers
      if (first === 'ПОЛЬЗОВАТЕЛИ' || first.indexOf('ПОЛЬЗОВАТЕЛ') >= 0) {
        currentSection = 'users'; headerCols = null; continue;
      }
      if (first === 'ГРУППЫ' || first.indexOf('ГРУПП') >= 0) {
        currentSection = 'groups'; headerCols = null; continue;
      }
      if (first.indexOf('ВОРОНК') >= 0 || first.indexOf('ЭТАП') >= 0) {
        currentSection = 'pipelines'; headerCols = null; continue;
      }
      if (first.indexOf('ПОЛЯ СДЕЛОК') >= 0 || first.indexOf('ПОЛЯ ЛИДОВ') >= 0) {
        currentSection = 'leadFields'; headerCols = null; continue;
      }
      if (first.indexOf('ПОЛЯ КОНТАКТ') >= 0) {
        currentSection = 'contactFields'; headerCols = null; continue;
      }

      if (!currentSection) continue;

      // Detect sub-headers (column names)
      if (!headerCols) {
        headerCols = [];
        for (var c = 0; c < row.length; c++) {
          headerCols.push(row[c] ? String(row[c]).trim() : '');
        }
        continue;
      }

      // Data row — build object from header columns
      var obj = {};
      for (var c2 = 0; c2 < headerCols.length; c2++) {
        if (headerCols[c2]) {
          obj[headerCols[c2]] = row[c2] != null ? row[c2] : '';
        }
      }

      // Skip empty rows
      var hasVal = Object.values(obj).some(function(v) { return v !== '' && v != null; });
      if (!hasVal) continue;

      sections[currentSection].push(obj);
    }

    parsed = sections;
    return sections;
  }

  function load() {
    if (parsed) return Promise.resolve(parsed);
    return fetch('data/sheets/amo-mapping.json')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var sheetData = null;
        if (d.sheets) {
          var keys = Object.keys(d.sheets);
          if (keys.length > 0) sheetData = d.sheets[keys[0]];
        }
        return parse(sheetData);
      })
      .catch(function() { return null; });
  }

  function getGroups() {
    if (!parsed) return [];
    return parsed.groups;
  }

  function getUsers() {
    if (!parsed) return [];
    return parsed.users;
  }

  function getUsersByGroup(groupName) {
    if (!parsed) return [];
    return parsed.users.filter(function(u) {
      var group = u['Группа'] || u['группа'] || '';
      return String(group).indexOf(groupName) >= 0;
    });
  }

  function getPipelines() {
    if (!parsed) return [];
    var pipes = {};
    parsed.pipelines.forEach(function(row) {
      var pipeName = row['Воронка'] || row['воронка'] || '';
      var pipeId = row['ID воронки'] || row['id воронки'] || '';
      if (pipeName && !pipes[pipeName]) {
        pipes[pipeName] = { id: pipeId, name: pipeName, stages: [] };
      }
      var stageName = row['Этап'] || row['этап'] || '';
      var stageId = row['ID этапа'] || row['id этапа'] || '';
      if (pipeName && stageName && pipes[pipeName]) {
        pipes[pipeName].stages.push({ id: stageId, name: stageName });
      }
    });
    return Object.values(pipes);
  }

  function getData() {
    return parsed;
  }

  return {
    load: load,
    parse: parse,
    getGroups: getGroups,
    getUsers: getUsers,
    getUsersByGroup: getUsersByGroup,
    getPipelines: getPipelines,
    getData: getData
  };
})();
/**
 * Server Sync — запуск синхронизации через API сервера
 * POST /api/sync/{script} → запускает Node.js скрипт на сервере
 * GET /api/sync/status → статус запущенных скриптов
 */
var GitHubSync = (function() {

  var API_BASE = window.location.origin;

  var SYNC_MAP = {
    'tasks':          'tasks',
    'broker-tasks':   'tasks',
    'rating':         'rating',
    'rating-interim': 'rating',
    'rating-brokers': 'rating',
    'cohort':         'cohort',
    'conversion2':    'cohort',
    'statistics':     'stats',
    'interns':        'stats',
    'closure':        'rating',
    'stakan':         'tasks',
    '_all':           'all',
  };

  function dispatch(script, statusEl) {
    if (statusEl) {
      statusEl.textContent = 'Запуск...';
      statusEl.style.color = '#0088CC';
      statusEl.disabled = true;
      statusEl.style.opacity = '0.6';
      statusEl.style.pointerEvents = 'none';
    }

    fetch(API_BASE + '/api/sync/' + script, { method: 'POST' })
    .then(function(resp) { return resp.json(); })
    .then(function(data) {
      if (data.status === 'started') {
        pollStatus(script, statusEl, 0);
      } else if (data.status === 'already_running') {
        if (statusEl) {
          statusEl.textContent = '\u23F3 Уже обновляется...';
          statusEl.style.color = '#C9A96E';
        }
        pollStatus(script, statusEl, 0);
      }
    })
    .catch(function(err) {
      if (statusEl) {
        statusEl.textContent = '\u2717 Ошибка подключения';
        statusEl.style.color = '#E53935';
        statusEl.style.opacity = '1';
        statusEl.style.pointerEvents = '';
        statusEl.disabled = false;
      }
    });
  }

  function pollStatus(script, statusEl, elapsed) {
    fetch(API_BASE + '/api/sync/status')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var isRunning = data.running && data.running[script];
      elapsed += 5;
      var mins = Math.floor(elapsed / 60);
      var secs = elapsed % 60;

      if (isRunning) {
        if (statusEl) {
          statusEl.textContent = '\u23F3 Обновляется... ' + mins + ':' + String(secs).padStart(2, '0');
          statusEl.style.color = '#0088CC';
        }
        setTimeout(function() { pollStatus(script, statusEl, elapsed); }, 5000);
      } else {
        if (statusEl) {
          statusEl.textContent = '\u2713 Готово! Обновите страницу (F5)';
          statusEl.style.color = '#00B67A';
          statusEl.style.opacity = '1';
          statusEl.style.pointerEvents = '';
          statusEl.disabled = false;
        }
      }
    })
    .catch(function() {
      setTimeout(function() { pollStatus(script, statusEl, elapsed); }, 5000);
    });
  }

  function dispatchAll(statusEl) {
    dispatch('all', statusEl);
  }

  function dispatchForRoute(route, statusEl) {
    var script = SYNC_MAP[route];
    if (!script) {
      if (statusEl) {
        statusEl.textContent = 'Нельзя обновить';
        statusEl.style.color = '#64748b';
      }
      return;
    }
    dispatch(script, statusEl);
  }

  return {
    dispatchAll: dispatchAll,
    dispatchForRoute: dispatchForRoute,
  };
})();
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

    var titleHtml = esc(tbl.title || '').replace(/\n/g, '<br>');
    var syncBtnHtml = '<button class="card-sync-btn" data-table-id="' + (tbl.id || '') + '">Обновить таблицу</button>';
    var html = '<div class="card"><div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span>' + titleHtml + '</span>' + syncBtnHtml + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    // Заголовки
    if (tbl.headers) {
      for (var h = 0; h < tbl.headers.length; h++) {
        html += '<tr>';
        var hrow = tbl.headers[h];
        for (var hc = 0; hc < hrow.length; hc++) {
          var thStyle = '';
          var hval = String(hrow[hc] || '');
          // Дельта-столбцы — одинаковая узкая ширина
          if (hval.match(/^Δ\d?$/)) thStyle = ' style="width:35px;min-width:35px"';
          html += '<th' + thStyle + '>' + esc(hrow[hc]) + '</th>';
        }
        html += '</tr>';
      }
    }

    // Данные
    var fmtFn = getFormattingFn(tbl.id);
    if (tbl.rows) {
      for (var r = 0; r < tbl.rows.length; r++) {
        html += renderDataRow(tbl.rows[r], false, fmtFn, tbl.id, tbl.headers);
      }
    }

    // Итого
    if (tbl.totals) {
      html += renderDataRow(tbl.totals, true, null, tbl.id, tbl.headers);
    }

    html += '</table></div></div>';

    // Диаграмма для стакана
    if (tbl.id === 'stakan') {
      html += renderBarChart(tbl);
    }

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

  function renderDataRow(row, isTotal, fmtFn, tableId, headers) {
    if (!row) return '';
    var isRating = tableId === 'rating' || tableId === 'rating-interim';
    var html = '<tr' + (isTotal ? ' class="total-row"' : '') + '>';
    var isDeltaTable = (tableId === 't1');

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

      if (isTotal) {
        style = ' style="font-weight:700;background-color:#eef2ff"';
      }

      // Рейтинг — специальное форматирование
      if (isRating && !isTotal) {
        var ratingStyle = getRatingCellStyle(val, c, row, headers);
        if (ratingStyle) style = ' style="' + ratingStyle + '"';
      }
      // Дельта столбцы (T1)
      else if (isDeltaTable && !isTotal && c > 0 && typeof val === 'string' && val.match(/^[+-]\d/)) {
        var num = parseInt(val);
        var dColor = num > 0 ? '#dc2626' : num < 0 ? '#16a34a' : '#999';
        style = ' style="color:' + dColor + ';font-weight:600"';
      }
      // Условное форматирование по правилам
      else if (!isTotal && c > 0 && fmtFn && val !== '' && val !== 0) {
        var numVal = typeof val === 'number' ? val : parseFloat(val);
        if (!isNaN(numVal) && numVal > 0) {
          var fmt = fmtFn(numVal);
          if (fmt) style = ' style="background-color:' + fmt.bg + ';color:' + fmt.color + '"';
        }
      }

      if (c === 0) cls = ' class="cell-name"';

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

  // Условное форматирование для рейтинга (как в Google Sheets)
  function getRatingCellStyle(val, colIdx, row, headers) {
    var hdr = (headers && headers[0] && headers[0][colIdx]) ? String(headers[0][colIdx]).toLowerCase() : '';
    var numVal = typeof val === 'number' ? val : parseFloat(String(val).replace(/[$%,\s]/g, ''));

    // Место (#) — 1 жёлтый, 2-3 голубой
    if (colIdx === 0 && typeof val === 'number') {
      if (val === 1) return 'background-color:#fef08a;font-weight:700';
      if (val <= 3) return 'background-color:#e0f2fe;font-weight:600';
    }

    // Статус
    if (hdr.indexOf('статус') >= 0) {
      var s = String(val).trim().toLowerCase();
      if (s === 'лидер') return 'background-color:#dcfce7;color:#166534;font-weight:700';
      if (s.indexOf('топ') >= 0) return 'background-color:#dbeafe;color:#1e40af;font-weight:600';
      if (s === 'рентабельный') return 'background-color:#f0fdf4;color:#15803d';
      if (s === 'убыточный') return 'background-color:#fef2f2;color:#dc2626;font-weight:600';
    }

    // % сжигания — градиент красный/зелёный
    if (hdr.indexOf('сжиган') >= 0 || hdr.indexOf('burn') >= 0) {
      var pct = parseFloat(String(val).replace('%', ''));
      if (!isNaN(pct)) {
        if (pct <= 20) return 'background-color:#bbf7d0;color:#166534'; // зелёный
        if (pct <= 35) return 'background-color:#fef9c3;color:#854d0e'; // жёлтый
        if (pct <= 50) return 'background-color:#fed7aa;color:#9a3412'; // оранжевый
        return 'background-color:#fecaca;color:#991b1b'; // красный
      }
    }

    // Валовая маржа — жёлтый градиент (чем больше, тем ярче)
    if (hdr.indexOf('маржа') >= 0 || hdr.indexOf('margin') >= 0) {
      if (!isNaN(numVal) && numVal > 0) {
        var intensity = Math.min(numVal / 50000, 1);
        var r = Math.round(255 - intensity * 10);
        var g = Math.round(255 - intensity * 20);
        var b = Math.round(200 - intensity * 100);
        return 'background-color:rgb(' + r + ',' + g + ',' + b + ');color:#854d0e;font-weight:600';
      }
    }

    // Личный вклад — зелёный/красный
    if (hdr.indexOf('вклад') >= 0 || hdr.indexOf('contribution') >= 0) {
      if (!isNaN(numVal)) {
        if (numVal > 0) return 'background-color:#dcfce7;color:#166534;font-weight:600';
        if (numVal < 0) return 'background-color:#fecaca;color:#991b1b;font-weight:600';
      }
    }

    // Затраты на MQL — градиент
    if (hdr.indexOf('затрат') >= 0 || hdr.indexOf('cost') >= 0) {
      if (!isNaN(numVal) && numVal > 0) {
        var int2 = Math.min(numVal / 15000, 1);
        return 'background-color:rgb(255,' + Math.round(255 - int2 * 60) + ',' + Math.round(220 - int2 * 120) + ')';
      }
    }

    return null;
  }

  // ============ Диаграмма стакана ============

  function renderBarChart(tbl) {
    if (!tbl || !tbl.rows || tbl.id !== 'stakan') return '';
    var html = '<div class="card"><div class="card-header">Сделки по кругам</div><div style="padding:20px">';
    html += '<div style="display:flex;align-items:flex-end;gap:30px;height:200px;justify-content:center">';

    var maxVal = 0;
    for (var r = 0; r < tbl.rows.length; r++) {
      var row = tbl.rows[r];
      var total = row[3] && typeof row[3] === 'object' ? row[3].v : (row[3] || 0);
      var overdue = row[5] && typeof row[5] === 'object' ? row[5].v : (row[5] || 0);
      var inWork = row[4] && typeof row[4] === 'object' ? row[4].v : (row[4] || 0);
      var otstoy = row[1] && typeof row[1] === 'object' ? row[1].v : (row[1] || 0);
      if (total > maxVal) maxVal = total;
    }
    if (maxVal === 0) maxVal = 1;

    var colors = { overdue: '#ef4444', inWork: '#22c55e', otstoy: '#f59e0b' };

    for (var r2 = 0; r2 < tbl.rows.length; r2++) {
      var row2 = tbl.rows[r2];
      var name = row2[0];
      var otstoy2 = row2[1] && typeof row2[1] === 'object' ? row2[1].v : (row2[1] || 0);
      var stakan2 = row2[2] && typeof row2[2] === 'object' ? row2[2].v : (row2[2] || 0);
      var total2 = row2[3] && typeof row2[3] === 'object' ? row2[3].v : (row2[3] || 0);
      var inWork2 = row2[4] && typeof row2[4] === 'object' ? row2[4].v : (row2[4] || 0);
      var overdue2 = row2[5] && typeof row2[5] === 'object' ? row2[5].v : (row2[5] || 0);

      var barH = Math.max(total2 / maxVal * 180, 2);
      var overdueH = total2 > 0 ? overdue2 / total2 * barH : 0;
      var inWorkH = total2 > 0 ? inWork2 / total2 * barH : 0;
      var otstoyH = total2 > 0 ? otstoy2 / total2 * barH : 0;
      var restH = barH - overdueH - inWorkH - otstoyH;

      html += '<div style="display:flex;flex-direction:column;align-items:center;width:80px">';
      html += '<div style="font-size:12px;font-weight:700;margin-bottom:4px;color:#f59e0b">' + otstoy2 + '</div>';
      html += '<div style="display:flex;flex-direction:column-reverse;width:50px">';
      html += '<div style="height:' + overdueH + 'px;background:' + colors.overdue + ';border-radius:0 0 4px 4px"></div>';
      html += '<div style="height:' + inWorkH + 'px;background:' + colors.inWork + '"></div>';
      html += '<div style="height:' + otstoyH + 'px;background:' + colors.otstoy + '"></div>';
      html += '<div style="height:' + restH + 'px;background:#94a3b8;border-radius:4px 4px 0 0"></div>';
      html += '</div>';
      html += '<div style="font-size:11px;margin-top:6px;font-weight:600">' + esc(name) + '</div>';
      html += '<div style="font-size:10px;color:#64748b">' + total2 + ' всего</div>';
      html += '</div>';
    }

    html += '</div>';
    html += '<div style="display:flex;gap:16px;justify-content:center;margin-top:12px;font-size:11px">';
    html += '<span><span style="display:inline-block;width:10px;height:10px;background:#ef4444;border-radius:2px;margin-right:4px"></span>Просрочены</span>';
    html += '<span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px"></span>В работе</span>';
    html += '<span><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px;margin-right:4px"></span>Отстойник</span>';
    html += '</div></div></div>';
    return html;
  }

  // ============ Попап со сделками ============

  function bindCellClicks(container) {
    container.addEventListener('click', function(e) {
      // Кнопка обновления таблицы
      var syncBtn = e.target.closest('.card-sync-btn');
      if (syncBtn) {
        var route = location.hash.replace('#/', '') || 'tasks';
        syncBtn.textContent = '...';
        syncBtn.style.color = '#0088CC';
        GitHubSync.dispatchForRoute(route, syncBtn);
        setTimeout(function() { syncBtn.textContent = '\u21BB'; }, 8000);
        return;
      }

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
/**
 * Generic Renderer — для листов без специальной логики
 * Поддержка: тепловая карта (красный/зелёный), проценты, итого
 */
var GenericRenderer = (function() {

  function render(container, sheetData, title) {
    if (!sheetData || !sheetData.data) {
      container.innerHTML = '<p class="text-slate-500">Нет данных</p>';
      return;
    }
    var data = sheetData.data;
    var isHeatmap = (title && title.indexOf('карта') >= 0) || (title && title.indexOf('Heatmap') >= 0);

    var html = '<div class="card"><div class="card-header">' + esc(title || 'Данные') + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    var headerRow = 0;
    for (var h = 0; h < Math.min(data.length, 5); h++) {
      if (data[h] && data[h].some(function(v) { return v != null && v !== ''; })) {
        headerRow = h;
        break;
      }
    }

    for (var r = headerRow; r < data.length; r++) {
      var row = data[r];
      if (!row) continue;

      var hasContent = row.some(function(v) { return v != null && v !== ''; });
      if (!hasContent) continue;

      var isHeader = (r === headerRow);
      var isTotal = row[0] && String(row[0]).toUpperCase().indexOf('ИТОГО') >= 0;
      var tag = isHeader ? 'th' : 'td';

      html += '<tr>';
      for (var c = 0; c < row.length; c++) {
        var val = row[c] != null ? row[c] : '';
        var style = '';

        if (!isHeader && typeof val === 'number' && val > 0 && val < 1) {
          val = Math.round(val * 100) + '%';
        }

        if (isTotal) {
          style = ' style="font-weight:700;background-color:#eef2ff"';
        }

        // Тепловая карта: красный/зелёный градиент для числовых ячеек
        if (isHeatmap && !isHeader && !isTotal && c > 0 && typeof row[c] === 'number' && row[c] !== 0) {
          style = ' style="' + heatmapStyle(row[c]) + '"';
        }

        // Валюта ($ в значении)
        if (!isHeader && typeof val === 'number' && c > 0) {
          var hdr = data[headerRow] && data[headerRow][c] ? String(data[headerRow][c]) : '';
          if (hdr.indexOf('$') >= 0 || hdr.indexOf('маржа') >= 0 || hdr.indexOf('вклад') >= 0) {
            val = formatCurrency(val);
            if (row[c] < 0 && !isHeatmap) {
              style = ' style="color:#dc2626;font-weight:600"';
            }
          }
        }

        html += '<' + tag + style + '>' + esc(val) + '</' + tag + '>';
      }
      html += '</tr>';
    }

    html += '</table></div></div>';
    container.innerHTML = html;
  }

  function heatmapStyle(val) {
    if (val > 0) {
      // Зелёный градиент: чем больше, тем насыщеннее
      var intensity = Math.min(val / 50000, 1); // $50K = максимум
      var g = Math.round(200 - intensity * 80);
      var r = Math.round(220 - intensity * 100);
      return 'background-color:rgb(' + r + ',' + g + ',200);color:#065f46;font-weight:600';
    } else {
      // Красный градиент
      var intensity2 = Math.min(Math.abs(val) / 10000, 1);
      var rr = Math.round(255 - intensity2 * 30);
      var gg = Math.round(220 - intensity2 * 120);
      return 'background-color:rgb(' + rr + ',' + gg + ',' + gg + ');color:#991b1b;font-weight:600';
    }
  }

  function formatCurrency(num) {
    if (typeof num !== 'number') return num;
    var negative = num < 0;
    var abs = Math.abs(Math.round(num));
    var str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (negative ? '-$' : '$') + str;
  }

  function esc(val) {
    if (val == null) return '';
    return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { render: render };
})();
/**
 * Rating Period Selector — клиентский рендер рейтинга за выбранный период.
 * Загружает rating-db.json (содержит taken/mql/byCircle/mqlCost/margin на месяц/менеджера).
 * 9 колонок: #, Брокер, Взято, MQL, % сжигания, Маржа, Затраты MQL, Личный вклад, Статус.
 * Сортировка по Личному вкладу (маржа − затраты), DESC.
 */
var RatingPeriod = (function() {

  var CIRCLE_COSTS = { 1: 100, 2: 10, 3: 10, 4: 0 };
  var CIRCLE_COSTS_LEGACY = { 1: 100, 2: 30, 3: 10, 4: 0 };

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
      var circleIds = { 1: [], 2: [], 3: [], 4: [] };
      var k2LegacyIds = [];

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

        // Стоимость (mqlCost) посчитана на сервере с учётом cutoff 2026-04-24 по К2.
        if (typeof d.mqlCost === 'number') totalCost += d.mqlCost;
        if (d.byCircle) {
          for (var c = 1; c <= 4; c++) {
            var ids = d.byCircle[c] || [];
            circleIds[c] = circleIds[c].concat(ids);
            costLeadIds = costLeadIds.concat(ids);
          }
        }
        if (d.byCircle2Legacy) k2LegacyIds = k2LegacyIds.concat(d.byCircle2Legacy);
      }

      var burnPct = totalTaken > 0 ? Math.round((totalTaken - totalMql) / totalTaken * 100) : 0;
      var contribution = Math.round(totalMargin - totalCost);

      // Тултип: блок на каждый круг со списком лидов. К2 — два блока если есть оба тарифа.
      var costParts = [];
      var k2LegacySet = {};
      for (var kli = 0; kli < k2LegacyIds.length; kli++) k2LegacySet[k2LegacyIds[kli]] = true;

      for (var c2 = 1; c2 <= 4; c2++) {
        var ids2 = circleIds[c2];
        if (!ids2.length) continue;
        if (c2 === 2) {
          var legacy = [], current = [];
          for (var ii = 0; ii < ids2.length; ii++) {
            if (k2LegacySet[ids2[ii]]) legacy.push(ids2[ii]);
            else current.push(ids2[ii]);
          }
          if (legacy.length && current.length && CIRCLE_COSTS_LEGACY[2] !== CIRCLE_COSTS[2]) {
            costParts.push('К2 ($' + CIRCLE_COSTS_LEGACY[2] + ') [до 24.04.2026] × ' + legacy.length + ' = $' + (legacy.length * CIRCLE_COSTS_LEGACY[2]));
            costParts.push(legacy.join(', '));
            costParts.push('К2 ($' + CIRCLE_COSTS[2] + ') [с 24.04.2026] × ' + current.length + ' = $' + (current.length * CIRCLE_COSTS[2]));
            costParts.push(current.join(', '));
          } else {
            var price2 = (legacy.length && !current.length) ? CIRCLE_COSTS_LEGACY[2] : CIRCLE_COSTS[2];
            costParts.push('К2 ($' + price2 + ') × ' + ids2.length + ' = $' + (ids2.length * price2));
            costParts.push(ids2.join(', '));
          }
        } else {
          var priceN = CIRCLE_COSTS[c2] || 0;
          costParts.push('К' + c2 + ' ($' + priceN + ') × ' + ids2.length + ' = $' + (ids2.length * priceN));
          costParts.push(ids2.join(', '));
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
/**
 * App — роутинг, навигация, инициализация
 */
(function() {

  var loading = document.getElementById('loading');
  var view = document.getElementById('view');
  var sidebar = document.getElementById('sidebar');
  var btnMenu = document.getElementById('btn-menu');
  var btnRefresh = document.getElementById('btn-refresh');
  var updatedAt = document.getElementById('updated-at');

  btnMenu.addEventListener('click', function() { sidebar.classList.toggle('open'); });
  sidebar.addEventListener('click', function(e) {
    if (e.target.classList.contains('nav-link')) sidebar.classList.remove('open');
  });

  var syncStatus = document.getElementById('sync-status');
  btnRefresh.addEventListener('click', function() { GitHubSync.dispatchAll(syncStatus); });

  function getRoute() { return (location.hash.replace('#/', '') || 'tasks'); }

  function updateActiveNav(route) {
    var links = document.querySelectorAll('.nav-link');
    for (var i = 0; i < links.length; i++) {
      var r = links[i].getAttribute('data-route');
      links[i].classList.toggle('active', r === route);
    }
  }

  function showView() {
    loading.classList.add('hidden');
    view.classList.remove('hidden');
  }

  function showError(msg) {
    showView();
    view.innerHTML = '<p style="padding:20px;color:#E53935">' + msg + '</p>';
  }

  function renderRoute(route, data) {
    try {
      var pageConfig = ConfigLoader.getPageConfig(route);
      if (!pageConfig) { view.innerHTML = '<p style="padding:20px">Страница не найдена: ' + route + '</p>'; return; }
      if (!data) { view.innerHTML = '<p style="padding:20px">Нет данных. Нажмите "Обновить все данные".</p>'; return; }

      if (data.tables) {
        ConfigRenderer.render(view, data, pageConfig);
      } else if (pageConfig.tables) {
        ConfigRenderer.render(view, data, pageConfig);
      } else {
        GenericRenderer.render(view, data, pageConfig.title);
      }

      // Обновляем timestamp
      if (data._meta && data._meta.updated) {
        updatedAt.textContent = 'Обновлено: ' + new Date(data._meta.updated).toLocaleString('ru-RU');
      }
    } catch (err) {
      console.error('Render error:', err);
      view.innerHTML = '<p style="padding:20px;color:#E53935">Ошибка рендеринга: ' + err.message + '</p>';
    }
  }

  function navigate() {
    var route = getRoute();
    console.log('APP: navigate to', route);
    updateActiveNav(route);
    loading.classList.remove('hidden');
    view.classList.add('hidden');

    try {
      // Рейтинг — выбор периода
      if (route === 'rating') {
        showView();
        RatingPeriod.renderSelector(view);
        return;
      }

      // Задачи + Задачи брокеров
      if (route === 'tasks') {
        var p1 = DataLoader.loadSheet('tasks').catch(function(e) { console.error('tasks:', e); return null; });
        var p2 = DataLoader.loadSheet('broker-tasks').catch(function(e) { console.error('bt:', e); return null; });
        Promise.all([p1, p2]).then(function(r) {
          showView();
          var td = r[0], bt = r[1];
          if (td && td.tables && bt && bt.tables) { td.tables = td.tables.concat(bt.tables); }
          renderRoute(route, td || bt);
        }).catch(function(e) { showError('Ошибка задач: ' + e.message); });
        return;
      }

      // Все остальные страницы
      DataLoader.loadSheet(route).then(function(data) {
        showView();
        renderRoute(route, data);
      }).catch(function(e) { showError('Ошибка загрузки ' + route + ': ' + e.message); });

    } catch (err) {
      showError('Ошибка навигации: ' + err.message);
    }
  }

  // Старт
  console.log('APP: init start');
  ConfigLoader.load().then(function() {
    console.log('APP: config loaded, navigating to', getRoute());
    DataLoader.loadMeta().then(function(meta) {
      if (meta && meta._meta && meta._meta.snapshotDate) {
        updatedAt.textContent = 'Обновлено: ' + new Date(meta._meta.snapshotDate).toLocaleString('ru-RU');
      }
    }).catch(function() {});

    window.addEventListener('hashchange', function() {
      console.log('APP: hashchange to', getRoute());
      navigate();
    });
    if (!location.hash || location.hash === '#/') location.hash = '#/tasks';
    // Одна начальная навигация
    setTimeout(navigate, 50);
  }).catch(function(err) {
    loading.classList.add('hidden');
    view.classList.remove('hidden');
    console.error('APP: init error', err);
    view.innerHTML = '<p style="padding:20px;color:#E53935">Ошибка инициализации: ' + err.message + '</p>';
  });

})();
