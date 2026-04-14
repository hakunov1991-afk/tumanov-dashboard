/**
 * App — роутинг, навигация, инициализация
 */
(function() {

  var loading = document.getElementById('loading');
  var view = document.getElementById('view');
  var sidebar = document.getElementById('sidebar');
  var btnMenu = document.getElementById('btn-menu');
  var btnRefresh = document.getElementById('btn-refresh');
  var updatedAt = document.getElementById('updated-at');

  btnMenu.addEventListener('click', function() { sidebar.classList.toggle('open'); });
  sidebar.addEventListener('click', function(e) {
    if (e.target.classList.contains('nav-link')) sidebar.classList.remove('open');
  });

  var syncStatus = document.getElementById('sync-status');
  btnRefresh.addEventListener('click', function() { GitHubSync.dispatchAll(syncStatus); });

  function getRoute() { return (location.hash.replace('#/', '') || 'tasks'); }

  function updateActiveNav(route) {
    var links = document.querySelectorAll('.nav-link');
    for (var i = 0; i < links.length; i++) {
      var r = links[i].getAttribute('data-route');
      links[i].classList.toggle('active', r === route);
    }
  }

  function showView() {
    loading.classList.add('hidden');
    view.classList.remove('hidden');
  }

  function showError(msg) {
    showView();
    view.innerHTML = '<p style="padding:20px;color:#E53935">' + msg + '</p>';
  }

  function renderRoute(route, data) {
    try {
      var pageConfig = ConfigLoader.getPageConfig(route);
      if (!pageConfig) { view.innerHTML = '<p style="padding:20px">Страница не найдена: ' + route + '</p>'; return; }
      if (!data) { view.innerHTML = '<p style="padding:20px">Нет данных. Нажмите "Обновить все данные".</p>'; return; }

      if (data.tables) {
        ConfigRenderer.render(view, data, pageConfig);
      } else if (pageConfig.tables) {
        ConfigRenderer.render(view, data, pageConfig);
      } else {
        GenericRenderer.render(view, data, pageConfig.title);
      }

      // Обновляем timestamp
      if (data._meta && data._meta.updated) {
        updatedAt.textContent = 'Обновлено: ' + new Date(data._meta.updated).toLocaleString('ru-RU');
      }
    } catch (err) {
      console.error('Render error:', err);
      view.innerHTML = '<p style="padding:20px;color:#E53935">Ошибка рендеринга: ' + err.message + '</p>';
    }
  }

  function navigate() {
    var route = getRoute();
    console.log('APP: navigate to', route);
    updateActiveNav(route);
    loading.classList.remove('hidden');
    view.classList.add('hidden');

    try {
      // Рейтинг — выбор периода
      if (route === 'rating') {
        showView();
        RatingPeriod.renderSelector(view);
        return;
      }

      // Задачи + Задачи брокеров
      if (route === 'tasks') {
        var p1 = DataLoader.loadSheet('tasks').catch(function(e) { console.error('tasks:', e); return null; });
        var p2 = DataLoader.loadSheet('broker-tasks').catch(function(e) { console.error('bt:', e); return null; });
        Promise.all([p1, p2]).then(function(r) {
          showView();
          var td = r[0], bt = r[1];
          if (td && td.tables && bt && bt.tables) { td.tables = td.tables.concat(bt.tables); }
          renderRoute(route, td || bt);
        }).catch(function(e) { showError('Ошибка задач: ' + e.message); });
        return;
      }

      // Все остальные страницы
      DataLoader.loadSheet(route).then(function(data) {
        showView();
        renderRoute(route, data);
      }).catch(function(e) { showError('Ошибка загрузки ' + route + ': ' + e.message); });

    } catch (err) {
      showError('Ошибка навигации: ' + err.message);
    }
  }

  // Старт
  console.log('APP: init start');
  ConfigLoader.load().then(function() {
    console.log('APP: config loaded, navigating to', getRoute());
    DataLoader.loadMeta().then(function(meta) {
      if (meta && meta._meta && meta._meta.snapshotDate) {
        updatedAt.textContent = 'Обновлено: ' + new Date(meta._meta.snapshotDate).toLocaleString('ru-RU');
      }
    }).catch(function() {});

    window.addEventListener('hashchange', navigate);
    if (!location.hash) location.hash = '#/tasks';
    navigate();
  }).catch(function(err) {
    loading.classList.add('hidden');
    view.classList.remove('hidden');
    console.error('APP: init error', err);
    view.innerHTML = '<p style="padding:20px;color:#E53935">Ошибка инициализации: ' + err.message + '</p>';
  });

})();
