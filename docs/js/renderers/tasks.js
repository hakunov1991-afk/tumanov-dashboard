/**
 * Renderer: Задачи — 8 подтаблиц в виде карточек
 */
var TasksRenderer = (function() {

  // Границы подтаблиц (0-based row indices в массиве data)
  var SECTIONS = [
    { title: 'Круги (Взято в работу)', from: 0, to: 4, format: null },
    { title: 'T1: Просроченные задачи', from: 6, to: 19, format: 'T1', hasDelta: true },
    { title: 'T2: Активные карточки сделок', from: 22, to: 35, format: 'T2' },
    { title: 'T3: Просрочки более 30 дней на этапе', from: 38, to: 51, format: 'T3' },
    { title: 'T4: Взято в работу вчера', from: 55, to: 68, format: null },
    { title: 'T5: Взято в работу за месяц', from: 72, to: 85, format: null },
    { title: 'T7: Средняя скорость переходов (часы)', from: 92, to: 105, format: null },
    { title: 'Постановка задач', from: 110, to: 123, format: null }
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

    var html = '<div class="card"><div class="card-header">' + sec.title + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row) continue;
      var isHeader = (r === 0);
      var isTotal = (r === rows.length - 1);
      var tag = isHeader ? 'th' : 'td';

      html += '<tr>';
      for (var c = 0; c < row.length; c++) {
        var val = row[c] != null ? row[c] : '';
        var style = '';

        if (!isHeader && !isTotal && sec.format && c > 0 && val !== '') {
          // Check if this is a delta column (last 3 columns for T1)
          var isDelta = sec.hasDelta && c >= row.length - 3;
          if (isDelta) {
            var ds = Formatting.deltaStyle(val);
            style = ' style="color:' + ds.color + ';font-weight:600"';
            val = Formatting.formatDelta(val);
          } else {
            var fmt = Formatting[sec.format](val);
            if (fmt) {
              style = ' style="background-color:' + fmt.bg + ';color:' + fmt.color + '"';
            }
          }
        }

        if (isTotal && !isHeader) {
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
