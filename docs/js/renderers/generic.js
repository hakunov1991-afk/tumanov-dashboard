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
