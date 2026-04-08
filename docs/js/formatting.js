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
