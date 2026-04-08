/**
 * Renderer: Рейтинг — таблица с рангами и KPI
 */
var RatingRenderer = (function() {

  var STATUS_COLORS = {
    'Лидер': { bg: '#dcfce7', color: '#166534' },
    'ТОП 2': { bg: '#dbeafe', color: '#1e40af' },
    'ТОП 3': { bg: '#e0e7ff', color: '#3730a3' },
    'рентабельный': { bg: '#fef9c3', color: '#854d0e' },
    'убыточный': { bg: '#fecaca', color: '#991b1b' }
  };

  function render(container, sheetData) {
    if (!sheetData || !sheetData.data) {
      container.innerHTML = '<p class="text-slate-500">Нет данных</p>';
      return;
    }
    var data = sheetData.data;
    var html = '';

    // Title rows (rows 0-2 usually contain period info)
    for (var t = 0; t < 3; t++) {
      if (data[t]) {
        var titleText = data[t].filter(function(v) { return v != null && v !== ''; }).join(' ');
        if (titleText) {
          html += '<p class="text-sm text-slate-500 mb-1">' + titleText + '</p>';
        }
      }
    }

    // Find header row (row with "Брокер" or "#")
    var headerRow = 3;
    for (var h = 0; h < Math.min(data.length, 8); h++) {
      if (data[h] && data[h].some(function(v) { return String(v).indexOf('Брокер') >= 0 || String(v) === '#'; })) {
        headerRow = h;
        break;
      }
    }

    html += '<div class="card"><div class="card-header">Рейтинг брокеров</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    // Header
    if (data[headerRow]) {
      html += '<tr>';
      for (var c = 0; c < data[headerRow].length; c++) {
        html += '<th>' + (data[headerRow][c] || '') + '</th>';
      }
      html += '</tr>';
    }

    // Detect currency columns by header text
    var currencyCols = {};
    var pctCols = {};
    if (data[headerRow]) {
      for (var ci = 0; ci < data[headerRow].length; ci++) {
        var hdr = String(data[headerRow][ci] || '').toLowerCase();
        if (hdr.indexOf('$') >= 0 || hdr.indexOf('маржа') >= 0 || hdr.indexOf('вклад') >= 0 || hdr.indexOf('затрат') >= 0) {
          currencyCols[ci] = true;
        }
        if (hdr.indexOf('%') >= 0 || hdr.indexOf('сжиган') >= 0) {
          pctCols[ci] = true;
        }
      }
    }

    // Data rows
    for (var r = headerRow + 1; r < data.length; r++) {
      var row = data[r];
      if (!row) continue;
      var hasContent = row.some(function(v) { return v != null && v !== ''; });
      if (!hasContent) continue;

      html += '<tr>';
      for (var c2 = 0; c2 < row.length; c2++) {
        var val = row[c2] != null ? row[c2] : '';
        var style = '';

        // Format percentages (by column header or by value 0-1)
        if (pctCols[c2] && typeof val === 'number') {
          val = Math.round(val * 100) + '%';
        } else if (typeof val === 'number' && val > 0 && val < 1) {
          val = Math.round(val * 100) + '%';
        }

        // Format currency (only columns with $ or margin/costs in header)
        if (currencyCols[c2] && typeof val === 'number') {
          val = formatNumber(val);
        }

        // Status column coloring
        var statusKey = String(val).trim();
        if (STATUS_COLORS[statusKey]) {
          var sc = STATUS_COLORS[statusKey];
          style = ' style="background-color:' + sc.bg + ';color:' + sc.color + ';font-weight:600"';
        }

        // Rank column (first column, number)
        if (c2 === 0 && typeof row[c2] === 'number') {
          var rank = row[c2];
          if (rank === 1) style = ' style="background-color:#fef08a;font-weight:700"';
          else if (rank <= 3) style = ' style="background-color:#e0f2fe;font-weight:600"';
        }

        // Negative values in red
        if (typeof row[c2] === 'number' && row[c2] < 0) {
          style = ' style="color:#dc2626;font-weight:600"';
        }

        html += '<td' + style + '>' + val + '</td>';
      }
      html += '</tr>';
    }

    html += '</table></div></div>';
    container.innerHTML = html;
  }

  function formatNumber(num) {
    if (typeof num !== 'number') return num;
    var negative = num < 0;
    var abs = Math.abs(Math.round(num));
    var str = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (negative ? '-' : '') + '$' + str;
  }

  return { render: render };
})();
