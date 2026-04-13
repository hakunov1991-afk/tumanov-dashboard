/**
 * GitHub Sync — запуск workflow из дашборда
 * Использует GitHub PAT для dispatch workflow_dispatch
 */
var GitHubSync = (function() {

  var REPO = 'hakunov1991-afk/tumanov-dashboard';
  var TOKEN_KEY = 'gh_pat_token';

  // Маппинг: какой workflow запускать для какой страницы
  var WORKFLOW_MAP = {
    'tasks':          'sync-tasks.yml',
    'rating':         'sync-rating.yml',
    'rating-interim': 'sync-rating.yml',
    'rating-brokers': 'sync-rating.yml',
    'cohort':         'sync-cohort.yml',
    'conversion2':    'sync-cohort.yml',
    'statistics':     'sync-stats.yml',
    'interns':        'sync-stats.yml',
    'closure':        'sync-rating.yml',
    'stakan':         'sync-tasks.yml',
    'heatmap':        null, // GAS snapshot, нельзя обновить
    '_all':           'fetch-data.yml',
  };

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function promptToken() {
    var token = prompt(
      'Для обновления данных нужен GitHub Personal Access Token.\n' +
      'Создайте на github.com → Settings → Developer Settings → Personal Access Tokens → Fine-grained\n' +
      'Repo: ' + REPO + ', Permissions: Actions (read+write)\n\n' +
      'Вставьте токен:'
    );
    if (token && token.trim()) {
      setToken(token.trim());
      return token.trim();
    }
    return null;
  }

  var runningWorkflows = {};

  function dispatch(workflowFile, statusEl) {
    // Защита от повторного нажатия — пока workflow запущен, не запускать снова
    if (runningWorkflows[workflowFile]) {
      if (statusEl) {
        statusEl.textContent = 'Уже обновляется...';
        statusEl.style.color = '#C9A96E';
      }
      return;
    }

    var token = getToken();
    if (!token) {
      token = promptToken();
      if (!token) return;
    }

    runningWorkflows[workflowFile] = true;
    if (statusEl) {
      statusEl.textContent = 'Запуск...';
      statusEl.style.color = '#0088CC';
      statusEl.disabled = true;
      statusEl.style.opacity = '0.6';
      statusEl.style.pointerEvents = 'none';
    }

    fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + workflowFile + '/dispatches', {
      method: 'POST',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json',
      },
      body: JSON.stringify({ ref: 'master' }),
    })
    .then(function(resp) {
      if (resp.status === 204) {
        if (statusEl) {
          statusEl.textContent = '\u2713 Запущено! Обновится через 5-10 мин';
          statusEl.style.color = '#00B67A';
        }
        // Опрос статуса workflow каждые 30 сек
        pollWorkflowStatus(token, workflowFile, statusEl);
      } else if (resp.status === 401 || resp.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        delete runningWorkflows[workflowFile];
        if (statusEl) {
          statusEl.textContent = '\u2717 Токен недействителен';
          statusEl.style.color = '#E53935';
          statusEl.style.opacity = '1';
          statusEl.style.pointerEvents = '';
        }
      } else {
        delete runningWorkflows[workflowFile];
        if (statusEl) {
          statusEl.textContent = '\u2717 Ошибка: ' + resp.status;
          statusEl.style.color = '#E53935';
          statusEl.style.opacity = '1';
          statusEl.style.pointerEvents = '';
        }
      }
    })
    .catch(function(err) {
      delete runningWorkflows[workflowFile];
      if (statusEl) {
        statusEl.textContent = '\u2717 Сетевая ошибка';
        statusEl.style.color = '#E53935';
        statusEl.style.opacity = '1';
        statusEl.style.pointerEvents = '';
      }
    });
  }

  function pollWorkflowStatus(token, workflowFile, statusEl) {
    var attempts = 0;
    var maxAttempts = 40; // 40 × 30сек = 20 мин максимум

    function check() {
      attempts++;
      var elapsed = attempts * 30;
      var mins = Math.floor(elapsed / 60);
      var secs = elapsed % 60;

      if (statusEl) {
        statusEl.textContent = '\u23F3 Обновляется... ' + mins + ':' + String(secs).padStart(2, '0');
        statusEl.style.color = '#0088CC';
      }

      fetch('https://api.github.com/repos/' + REPO + '/actions/runs?per_page=5&status=in_progress', {
        headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.v3+json' }
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var running = (data.workflow_runs || []).some(function(run) {
          return run.path && run.path.indexOf(workflowFile) >= 0;
        });

        if (!running && attempts > 2) {
          // Workflow завершился
          delete runningWorkflows[workflowFile];
          if (statusEl) {
            statusEl.textContent = '\u2713 Готово! Обновите страницу (F5)';
            statusEl.style.color = '#00B67A';
            statusEl.style.opacity = '1';
            statusEl.style.pointerEvents = '';
            statusEl.disabled = false;
          }
          return;
        }

        if (attempts >= maxAttempts) {
          delete runningWorkflows[workflowFile];
          if (statusEl) {
            statusEl.textContent = '\u26A0 Таймаут. Проверьте Actions на GitHub';
            statusEl.style.color = '#C9A96E';
            statusEl.style.opacity = '1';
            statusEl.style.pointerEvents = '';
          }
          return;
        }

        setTimeout(check, 30000);
      })
      .catch(function() {
        if (attempts < maxAttempts) setTimeout(check, 30000);
      });
    }

    // Первая проверка через 30 сек (дать время workflow стартовать)
    setTimeout(check, 30000);
  }

  function dispatchAll(statusEl) {
    dispatch('fetch-data.yml', statusEl);
  }

  function dispatchForRoute(route, statusEl) {
    var wf = WORKFLOW_MAP[route];
    if (!wf) {
      if (statusEl) {
        statusEl.textContent = 'Эта страница обновляется автоматически';
        statusEl.style.color = '#64748b';
      }
      return;
    }
    dispatch(wf, statusEl);
  }

  return {
    dispatchAll: dispatchAll,
    dispatchForRoute: dispatchForRoute,
    getToken: getToken,
    setToken: setToken,
  };
})();
