/**
 * Data Loader — загружает JSON из docs/data/ или напрямую из GAS web app
 */
var DataLoader = (function() {
  var GAS_URL = 'https://script.google.com/macros/s/AKfycbxnMZ53JPp4HHvBxPICo9jTW4hWfsBtrsIjq3VsuTzXwu1Lz1-03863RY-bQ5hUWbNO/exec';

  var SHEET_MAP = {
    'tasks':          'Задачи',
    'broker-tasks':   'Задачи брокеров',
    'rating':         'Рейтинг',
    'rating-brokers': 'Рейтинг брокеров',
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
    'rating-brokers': 'rating-brokerov',
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
    return fetch('data/meta.json')
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
    return fetch('data/sheets/' + resolved.fileName + '.json')
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
