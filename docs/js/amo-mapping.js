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
