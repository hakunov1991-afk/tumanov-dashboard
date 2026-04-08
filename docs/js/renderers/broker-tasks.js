/**
 * Renderer: Задачи брокеров — 3 подтаблицы (BT, T8, T9)
 */
var BrokerTasksRenderer = (function() {

  var SECTIONS = [
    { title: 'Контроль постановки задач ботом', from: 0, to: 14, format: 'BT' },
    { title: 'Скорость взятия в работу (секунды)', from: 17, to: 31, format: 'T8' },
    { title: 'Снятые сделки', from: 36, to: 50, format: 'T9' }
  ];

  function render(container, sheetData) {
    if (!sheetData || !sheetData.data) {
      container.innerHTML = '<p class="text-slate-500">Нет данных</p>';
      return;
    }
    var data = sheetData.data;
    var html = '';

    for (var s = 0; s < SECTIONS.length; s++) {
      var sec = SECTIONS[s];
      html += renderSection(data, sec);
    }

    container.innerHTML = html;
  }

  function renderSection(data, sec) {
    var rows = data.slice(sec.from, sec.to + 1);
    if (!rows.length) return '';

    // Find the header row (first non-empty row)
    var headerIdx = 0;
    for (var h = 0; h < rows.length; h++) {
      if (rows[h] && rows[h].some(function(v) { return v != null && v !== ''; })) {
        headerIdx = h;
        break;
      }
    }

    var html = '<div class="card"><div class="card-header">' + sec.title + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    for (var r = headerIdx; r < rows.length; r++) {
      var row = rows[r];
      if (!row) continue;

      // Skip completely empty rows
      var hasContent = row.some(function(v) { return v != null && v !== ''; });
      if (!hasContent) continue;

      var isHeader = (r === headerIdx) || (r === headerIdx + 1);
      var isTotal = row[0] && String(row[0]).toUpperCase().indexOf('ИТОГО') >= 0;
      var tag = isHeader ? 'th' : 'td';

      html += '<tr>';
      for (var c = 0; c < row.length; c++) {
        var val = row[c] != null ? row[c] : '';
        var style = '';

        if (!isHeader && !isTotal && sec.format && c > 0 && val !== '') {
          var fmt = Formatting[sec.format](val);
          if (fmt) {
            style = ' style="background-color:' + fmt.bg + ';color:' + fmt.color + '"';
          }
        }

        if (isTotal) {
          style = ' style="font-weight:700;background-color:#eef2ff"';
        }

        html += '<' + tag + style + '>' + val + '</' + tag + '>';
      }
      html += '</tr>';
    }

    html += '</table></div></div>';
    return html;
  }

  return { render: render };
})();
