/**
 * Config Editor — визуальный редактор конфигурации дашборда
 * Страница #/config
 */
var ConfigEditor = (function() {

  var currentPage = null; // selected page route key
  var currentTableIdx = -1;
  var previewData = null; // sheet data for preview

  function render(container) {
    var config = ConfigLoader.getConfig();
    if (!config) {
      container.innerHTML = '<p class="text-slate-500">Конфиг не загружен</p>';
      return;
    }

    container.innerHTML = buildLayout();
    bindEvents();
    renderPageList();

    // Load AMO mapping in background
    AmoMapping.load().then(function() {
      console.log('AMO Mapping loaded for editor');
    });
  }

  // ==================== Layout ====================

  function buildLayout() {
    return '' +
      '<div class="cfg-editor">' +
        // Top bar
        '<div class="cfg-topbar">' +
          '<h2 class="cfg-title">Редактор конфигурации</h2>' +
          '<div class="cfg-actions">' +
            (ConfigLoader.hasLocalOverride()
              ? '<button id="cfg-reset" class="cfg-btn cfg-btn-warn">Сбросить изменения</button>'
              : '') +
            '<button id="cfg-export" class="cfg-btn cfg-btn-primary">Экспорт JSON</button>' +
          '</div>' +
        '</div>' +
        // Main area
        '<div class="cfg-main">' +
          // Left: page list
          '<div class="cfg-sidebar" id="cfg-pages"></div>' +
          // Center: table editor
          '<div class="cfg-center" id="cfg-center">' +
            '<p class="text-slate-400 p-4">Выберите страницу слева</p>' +
          '</div>' +
          // Right: preview
          '<div class="cfg-preview" id="cfg-preview">' +
            '<p class="text-slate-400 p-4">Превью данных</p>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ==================== Events ====================

  function bindEvents() {
    var exportBtn = document.getElementById('cfg-export');
    if (exportBtn) {
      exportBtn.addEventListener('click', function() {
        var json = JSON.stringify(ConfigLoader.getConfig(), null, 2);
        var blob = new Blob([json], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'dashboard-config.json';
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    var resetBtn = document.getElementById('cfg-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        if (confirm('Сбросить все локальные изменения?')) {
          ConfigLoader.clearLocal();
          location.reload();
        }
      });
    }
  }

  // ==================== Page List ====================

  function renderPageList() {
    var config = ConfigLoader.getConfig();
    var el = document.getElementById('cfg-pages');
    if (!el) return;

    var html = '<h3 class="cfg-section-title">Страницы</h3>';

    // Configured pages
    var pageKeys = Object.keys(config.pages || {});
    for (var i = 0; i < pageKeys.length; i++) {
      var key = pageKeys[i];
      var page = config.pages[key];
      var active = currentPage === key ? ' cfg-page-active' : '';
      html += '<div class="cfg-page-item' + active + '" data-page="' + key + '" data-type="page">' +
        '<span class="cfg-page-name">' + esc(page.title) + '</span>' +
        '<span class="cfg-page-badge">' + (page.tables ? page.tables.length : 0) + ' табл.</span>' +
      '</div>';
    }

    // Generic pages
    html += '<h3 class="cfg-section-title" style="margin-top:12px">Простые страницы</h3>';
    var genKeys = Object.keys(config.genericPages || {});
    for (var g = 0; g < genKeys.length; g++) {
      var gkey = genKeys[g];
      var gpage = config.genericPages[gkey];
      var gactive = currentPage === gkey ? ' cfg-page-active' : '';
      html += '<div class="cfg-page-item' + gactive + '" data-page="' + gkey + '" data-type="generic">' +
        '<span class="cfg-page-name">' + esc(gpage.title) + '</span>' +
      '</div>';
    }

    html += '<button id="cfg-add-page" class="cfg-btn cfg-btn-sm" style="margin-top:12px;width:100%">+ Добавить страницу</button>';

    el.innerHTML = html;

    // Bind click events
    var items = el.querySelectorAll('.cfg-page-item');
    for (var j = 0; j < items.length; j++) {
      items[j].addEventListener('click', function() {
        currentPage = this.getAttribute('data-page');
        currentTableIdx = -1;
        renderPageList();
        renderPageEditor();
        loadPreview();
      });
    }

    var addBtn = document.getElementById('cfg-add-page');
    if (addBtn) {
      addBtn.addEventListener('click', addNewPage);
    }
  }

  // ==================== Page Editor ====================

  function renderPageEditor() {
    var el = document.getElementById('cfg-center');
    if (!el || !currentPage) return;

    var config = ConfigLoader.getConfig();
    var page = config.pages[currentPage];
    var isGeneric = !page;
    if (isGeneric) page = config.genericPages[currentPage];
    if (!page) return;

    var html = '' +
      '<div class="cfg-page-editor">' +
        '<div class="cfg-field">' +
          '<label>Название страницы</label>' +
          '<input id="cfg-page-title" class="cfg-input" value="' + escAttr(page.title) + '">' +
        '</div>' +
        '<div class="cfg-field">' +
          '<label>Лист Google Sheets</label>' +
          '<input id="cfg-page-sheet" class="cfg-input" value="' + escAttr(page.sheet) + '">' +
        '</div>' +
        '<div class="cfg-field">' +
          '<label>Файл данных</label>' +
          '<input id="cfg-page-file" class="cfg-input" value="' + escAttr(page.file || '') + '">' +
        '</div>';

    if (!isGeneric && page.tables) {
      html += '<h3 class="cfg-section-title" style="margin-top:16px">Таблицы</h3>';
      html += '<div id="cfg-tables-list">';
      for (var t = 0; t < page.tables.length; t++) {
        var tbl = page.tables[t];
        var tactive = currentTableIdx === t ? ' cfg-table-active' : '';
        html += '<div class="cfg-table-item' + tactive + '" data-idx="' + t + '">' +
          '<span class="cfg-table-name">' + esc(tbl.title || tbl.id) + '</span>' +
          '<span class="cfg-table-range">строки ' + tbl.from + '-' + tbl.to + '</span>' +
          '<button class="cfg-btn-icon cfg-del-table" data-idx="' + t + '" title="Удалить">&#10005;</button>' +
        '</div>';
      }
      html += '</div>';
      html += '<button id="cfg-add-table" class="cfg-btn cfg-btn-sm" style="margin-top:8px">+ Добавить таблицу</button>';
    }

    // Table detail editor
    if (!isGeneric && currentTableIdx >= 0 && page.tables && page.tables[currentTableIdx]) {
      html += renderTableDetail(page.tables[currentTableIdx]);
    }

    html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0">' +
      '<button id="cfg-save-page" class="cfg-btn cfg-btn-primary">Сохранить изменения</button>' +
      '<button id="cfg-del-page" class="cfg-btn cfg-btn-warn" style="margin-left:8px">Удалить страницу</button>' +
    '</div>';

    html += '</div>';
    el.innerHTML = html;

    // Bind events
    var tableItems = el.querySelectorAll('.cfg-table-item');
    for (var i = 0; i < tableItems.length; i++) {
      tableItems[i].addEventListener('click', function(e) {
        if (e.target.classList.contains('cfg-del-table')) return;
        currentTableIdx = parseInt(this.getAttribute('data-idx'));
        renderPageEditor();
        highlightPreviewRows();
      });
    }

    var delBtns = el.querySelectorAll('.cfg-del-table');
    for (var d = 0; d < delBtns.length; d++) {
      delBtns[d].addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(this.getAttribute('data-idx'));
        if (confirm('Удалить таблицу?')) {
          page.tables.splice(idx, 1);
          currentTableIdx = -1;
          saveConfig();
          renderPageEditor();
        }
      });
    }

    var addTableBtn = document.getElementById('cfg-add-table');
    if (addTableBtn) {
      addTableBtn.addEventListener('click', function() {
        page.tables.push({
          id: 'new-' + Date.now(),
          title: 'Новая таблица',
          from: 0,
          to: 10,
          headerRows: 1
        });
        currentTableIdx = page.tables.length - 1;
        saveConfig();
        renderPageEditor();
      });
    }

    var amoPickBtn = document.getElementById('tbl-pick-amo');
    if (amoPickBtn) amoPickBtn.addEventListener('click', showAmoPicker);

    var addRuleBtn = document.getElementById('tbl-add-rule');
    if (addRuleBtn) {
      addRuleBtn.addEventListener('click', function() {
        var tbl = page.tables[currentTableIdx];
        if (!tbl.formatting) tbl.formatting = { type: 'threshold', rules: [] };
        if (!tbl.formatting.rules) tbl.formatting.rules = [];
        tbl.formatting.rules.push({ min: 1, bg: '#fff9c4', color: '#000' });
        saveConfig();
        renderPageEditor();
      });
    }

    var delRuleBtns = document.querySelectorAll('.cfg-del-rule');
    for (var dr = 0; dr < delRuleBtns.length; dr++) {
      delRuleBtns[dr].addEventListener('click', function() {
        var ridx = parseInt(this.getAttribute('data-ridx'));
        var tbl = page.tables[currentTableIdx];
        if (tbl.formatting && tbl.formatting.rules) {
          tbl.formatting.rules.splice(ridx, 1);
          saveConfig();
          renderPageEditor();
        }
      });
    }

    var saveBtn = document.getElementById('cfg-save-page');
    if (saveBtn) saveBtn.addEventListener('click', savePageFromForm);

    var delPageBtn = document.getElementById('cfg-del-page');
    if (delPageBtn) {
      delPageBtn.addEventListener('click', function() {
        if (confirm('Удалить страницу "' + page.title + '"?')) {
          var config = ConfigLoader.getConfig();
          delete config.pages[currentPage];
          delete config.genericPages[currentPage];
          currentPage = null;
          currentTableIdx = -1;
          saveConfig();
          renderPageList();
          document.getElementById('cfg-center').innerHTML = '<p class="text-slate-400 p-4">Выберите страницу</p>';
        }
      });
    }
  }

  // ==================== Table Detail ====================

  function renderTableDetail(tbl) {
    var fmt = tbl.formatting || {};
    var rules = fmt.rules || [];

    var html = '' +
      '<div class="cfg-table-detail" style="margin-top:16px;padding:12px;background:#f8fafc;border-radius:8px">' +
        '<h4 style="font-weight:600;margin-bottom:8px">Настройки таблицы</h4>' +
        '<div class="cfg-field-row">' +
          '<div class="cfg-field"><label>ID</label><input id="tbl-id" class="cfg-input cfg-input-sm" value="' + escAttr(tbl.id) + '"></div>' +
          '<div class="cfg-field"><label>Название</label><input id="tbl-title" class="cfg-input cfg-input-sm" value="' + escAttr(tbl.title) + '"></div>' +
        '</div>' +
        '<div class="cfg-field-row">' +
          '<div class="cfg-field"><label>Строка от (0-based)</label><input id="tbl-from" type="number" class="cfg-input cfg-input-sm" value="' + tbl.from + '"></div>' +
          '<div class="cfg-field"><label>Строка до</label><input id="tbl-to" type="number" class="cfg-input cfg-input-sm" value="' + tbl.to + '"></div>' +
          '<div class="cfg-field"><label>Header rows</label><input id="tbl-header" type="number" class="cfg-input cfg-input-sm" value="' + (tbl.headerRows || 1) + '"></div>' +
        '</div>' +
        '<div class="cfg-field-row">' +
          '<div class="cfg-field">' +
            '<label><input type="checkbox" id="tbl-delta" ' + (tbl.hasDelta ? 'checked' : '') + '> Дельта-столбцы (Δ)</label>' +
          '</div>' +
          '<div class="cfg-field">' +
            '<label><input type="checkbox" id="tbl-total" ' + (tbl.totalRow ? 'checked' : '') + '> Строка ИТОГО</label>' +
          '</div>' +
        '</div>' +
        // AMO picker button
        '<div style="margin-top:8px">' +
          '<button id="tbl-pick-amo" class="cfg-btn cfg-btn-sm">Выбрать строки из AMO</button>' +
        '</div>' +
        // Formatting
        '<h4 style="font-weight:600;margin-top:12px;margin-bottom:8px">Форматирование</h4>' +
        '<div class="cfg-field">' +
          '<label>Тип</label>' +
          '<select id="tbl-fmt-type" class="cfg-input cfg-input-sm">' +
            '<option value=""' + (fmt.type ? '' : ' selected') + '>Нет</option>' +
            '<option value="threshold"' + (fmt.type === 'threshold' ? ' selected' : '') + '>Пороговое (цвет по значению)</option>' +
            '<option value="rating"' + (fmt.type === 'rating' ? ' selected' : '') + '>Рейтинг</option>' +
          '</select>' +
        '</div>';

    if (fmt.type === 'threshold' && rules.length > 0) {
      html += '<div id="tbl-rules">';
      for (var i = 0; i < rules.length; i++) {
        html += '<div class="cfg-rule-row" data-ridx="' + i + '">' +
          '<input type="number" class="cfg-input cfg-input-xs rule-min" value="' + rules[i].min + '" placeholder="min">' +
          '<input type="color" class="cfg-color-input rule-bg" value="' + rules[i].bg + '">' +
          '<input type="color" class="cfg-color-input rule-color" value="' + rules[i].color + '">' +
          '<button class="cfg-btn-icon cfg-del-rule" data-ridx="' + i + '">&#10005;</button>' +
        '</div>';
      }
      html += '</div>';
      html += '<button id="tbl-add-rule" class="cfg-btn cfg-btn-sm" style="margin-top:4px">+ Правило</button>';
    }

    html += '</div>';
    return html;
  }

  // ==================== AMO Picker Modal ====================

  function showAmoPicker() {
    var data = AmoMapping.getData();
    if (!data) {
      alert('AMO Маппинг не загружен. Попробуйте обновить данные.');
      return;
    }

    var overlay = document.createElement('div');
    overlay.className = 'cfg-modal-overlay';

    var groups = data.groups || [];
    var users = data.users || [];

    var html = '<div class="cfg-modal">' +
      '<div class="cfg-modal-header">' +
        '<h3>Выбрать из AMO</h3>' +
        '<button class="cfg-modal-close">&times;</button>' +
      '</div>' +
      '<div class="cfg-modal-body">';

    // Groups section
    html += '<h4 style="font-weight:600;margin-bottom:8px">Группы пользователей</h4>';
    if (groups.length > 0) {
      for (var g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var grpName = grp['Название'] || grp['название'] || grp['Группа'] || Object.values(grp).join(' ');
        var grpId = grp['ID'] || grp['id'] || '';
        var members = AmoMapping.getUsersByGroup(grpName);
        html += '<div class="cfg-amo-item" data-group="' + escAttr(grpName) + '">' +
          '<strong>' + esc(grpName) + '</strong>' +
          (grpId ? ' <span class="text-slate-400">(ID: ' + grpId + ')</span>' : '') +
          ' — <span class="text-blue-600">' + members.length + ' чел.</span>' +
        '</div>';
      }
    } else {
      html += '<p class="text-slate-400">Группы не найдены</p>';
    }

    // Users list
    html += '<h4 style="font-weight:600;margin-top:16px;margin-bottom:8px">Все пользователи (' + users.length + ')</h4>';
    html += '<div style="max-height:300px;overflow-y:auto">';
    for (var u = 0; u < users.length; u++) {
      var usr = users[u];
      var name = usr['Имя'] || usr['имя'] || usr['Название'] || Object.values(usr).slice(0, 2).join(' ');
      var uid = usr['ID'] || usr['id'] || '';
      var ugroup = usr['Группа'] || usr['группа'] || '';
      html += '<div class="cfg-amo-user">' +
        esc(name) + (uid ? ' <span class="text-slate-400">(ID: ' + uid + ')</span>' : '') +
        (ugroup ? ' <span class="text-xs text-slate-500">[' + esc(ugroup) + ']</span>' : '') +
      '</div>';
    }
    html += '</div>';

    html += '</div></div>';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Close modal
    overlay.querySelector('.cfg-modal-close').addEventListener('click', function() {
      document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    // Group click → show members count info
    var groupItems = overlay.querySelectorAll('.cfg-amo-item');
    for (var gi = 0; gi < groupItems.length; gi++) {
      groupItems[gi].addEventListener('click', function() {
        var groupName = this.getAttribute('data-group');
        var members = AmoMapping.getUsersByGroup(groupName);
        var info = 'Группа: ' + groupName + '\nУчастников: ' + members.length + '\n\nСписок:\n';
        for (var m = 0; m < members.length; m++) {
          var mn = members[m]['Имя'] || members[m]['имя'] || members[m]['Название'] || '';
          var mid = members[m]['ID'] || members[m]['id'] || '';
          info += '  ' + mn + (mid ? ' (ID: ' + mid + ')' : '') + '\n';
        }
        info += '\nКоличество строк для таблицы: ' + members.length;
        info += '\n(+ 1-2 строки заголовка + 1 строка ИТОГО)';
        alert(info);
      });
    }
  }

  // ==================== Preview ====================

  function loadPreview() {
    if (!currentPage) return;
    DataLoader.loadSheet(currentPage).then(function(data) {
      previewData = data;
      renderPreview();
    });
  }

  function renderPreview() {
    var el = document.getElementById('cfg-preview');
    if (!el || !previewData || !previewData.data) {
      if (el) el.innerHTML = '<p class="text-slate-400 p-4">Нет данных для превью</p>';
      return;
    }

    var data = previewData.data;
    var html = '<h3 class="cfg-section-title">Данные листа (' + data.length + ' строк)</h3>';
    html += '<div class="cfg-preview-table"><table>';

    var maxCols = 6; // Show only first N cols to save space
    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      if (!row) continue;
      var rowClass = getPreviewRowClass(r);
      html += '<tr class="' + rowClass + '">';
      html += '<td class="cfg-row-num">' + r + '</td>';
      for (var c = 0; c < Math.min(row.length, maxCols); c++) {
        var val = row[c] != null ? row[c] : '';
        html += '<td>' + esc(String(val).substring(0, 30)) + '</td>';
      }
      if (row.length > maxCols) html += '<td class="text-slate-400">...</td>';
      html += '</tr>';
    }

    html += '</table></div>';
    el.innerHTML = html;
  }

  function getPreviewRowClass(rowIdx) {
    if (currentTableIdx < 0 || !currentPage) return '';
    var config = ConfigLoader.getConfig();
    var page = config.pages[currentPage];
    if (!page || !page.tables || !page.tables[currentTableIdx]) return '';
    var tbl = page.tables[currentTableIdx];
    var to = tbl.to === -1 ? 9999 : tbl.to;
    if (rowIdx >= tbl.from && rowIdx <= to) return 'cfg-row-highlight';
    return '';
  }

  function highlightPreviewRows() {
    renderPreview(); // re-render with highlight
  }

  // ==================== Save / Config ops ====================

  function savePageFromForm() {
    var config = ConfigLoader.getConfig();
    var page = config.pages[currentPage] || config.genericPages[currentPage];
    if (!page) return;

    var titleInput = document.getElementById('cfg-page-title');
    var sheetInput = document.getElementById('cfg-page-sheet');
    var fileInput = document.getElementById('cfg-page-file');

    if (titleInput) page.title = titleInput.value;
    if (sheetInput) page.sheet = sheetInput.value;
    if (fileInput) page.file = fileInput.value;

    // Save table detail if open
    if (currentTableIdx >= 0 && page.tables && page.tables[currentTableIdx]) {
      var tbl = page.tables[currentTableIdx];
      var idInput = document.getElementById('tbl-id');
      var tblTitleInput = document.getElementById('tbl-title');
      var fromInput = document.getElementById('tbl-from');
      var toInput = document.getElementById('tbl-to');
      var headerInput = document.getElementById('tbl-header');
      var deltaInput = document.getElementById('tbl-delta');
      var totalInput = document.getElementById('tbl-total');
      var fmtTypeInput = document.getElementById('tbl-fmt-type');

      if (idInput) tbl.id = idInput.value;
      if (tblTitleInput) tbl.title = tblTitleInput.value;
      if (fromInput) tbl.from = parseInt(fromInput.value) || 0;
      if (toInput) tbl.to = parseInt(toInput.value) || 0;
      if (headerInput) tbl.headerRows = parseInt(headerInput.value) || 1;
      if (deltaInput) tbl.hasDelta = deltaInput.checked;
      if (totalInput) tbl.totalRow = totalInput.checked;

      // Formatting
      if (fmtTypeInput) {
        var ftype = fmtTypeInput.value;
        if (ftype) {
          if (!tbl.formatting) tbl.formatting = {};
          tbl.formatting.type = ftype;

          // Save rules
          if (ftype === 'threshold') {
            var ruleRows = document.querySelectorAll('.cfg-rule-row');
            var newRules = [];
            for (var i = 0; i < ruleRows.length; i++) {
              var minInput = ruleRows[i].querySelector('.rule-min');
              var bgInput = ruleRows[i].querySelector('.rule-bg');
              var colorInput = ruleRows[i].querySelector('.rule-color');
              if (minInput && bgInput && colorInput) {
                newRules.push({
                  min: parseFloat(minInput.value) || 0,
                  bg: bgInput.value,
                  color: colorInput.value
                });
              }
            }
            tbl.formatting.rules = newRules;
          }
        } else {
          delete tbl.formatting;
        }
      }
    }

    saveConfig();
    renderPageList();
    renderPageEditor();
  }

  function saveConfig() {
    ConfigLoader.saveLocal(ConfigLoader.getConfig());
  }

  function addNewPage() {
    var name = prompt('Ключ страницы (латиница, через дефис, напр. "new-report"):');
    if (!name) return;
    name = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    var config = ConfigLoader.getConfig();
    config.pages[name] = {
      title: 'Новая страница',
      sheet: '',
      file: '',
      tables: []
    };
    currentPage = name;
    currentTableIdx = -1;
    saveConfig();
    renderPageList();
    renderPageEditor();
  }

  // ==================== Helpers ====================

  function esc(val) {
    if (val == null) return '';
    return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escAttr(val) {
    if (val == null) return '';
    return String(val).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  return { render: render, showAmoPicker: showAmoPicker };
})();
