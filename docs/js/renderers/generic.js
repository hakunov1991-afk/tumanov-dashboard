/**
 * Generic Renderer — для листов без специальной логики
 */
var GenericRenderer = (function() {

  function render(container, sheetData, title) {
    if (!sheetData || !sheetData.data) {
      container.innerHTML = '<p class="text-slate-500">Нет данных</p>';
      return;
    }
    var data = sheetData.data;

    var html = '<div class="card"><div class="card-header">' + (title || 'Данные') + '</div>';
    html += '<div class="table-scroll"><table class="dash-table">';

    // Find first non-empty row as header
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

        // Format percentages
        if (!isHeader && typeof val === 'number' && val > 0 && val < 1) {
          val = Math.round(val * 100) + '%';
        }

        if (isTotal) {
          style = ' style="font-weight:700;background-color:#eef2ff"';
        }

        html += '<' + tag + style + '>' + val + '</' + tag + '>';
      }
      html += '</tr>';
    }

    html += '</table></div></div>';
    container.innerHTML = html;
  }

  return { render: render };
})();
