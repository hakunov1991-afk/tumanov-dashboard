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
