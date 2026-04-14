/**
 * App — роутинг, навигация, инициализация (config-driven)
 */
(function() {

  var loading = document.getElementById('loading');
  var view = document.getElementById('view');
  var sidebar = document.getElementById('sidebar');
  var btnMenu = document.getElementById('btn-menu');
  var btnRefresh = document.getElementById('btn-refresh');
  var updatedAt = document.getElementById('updated-at');

  // Mobile menu toggle
  btnMenu.addEventListener('click', function() {
    sidebar.classList.toggle('open');
  });

  // Close sidebar on nav click (mobile)
  sidebar.addEventListener('click', function(e) {
    if (e.target.classList.contains('nav-link')) {
      sidebar.classList.remove('open');
    }
  });

  // Refresh button
  // Обновить все данные — запускает GitHub Actions workflow
  var syncStatus = document.getElementById('sync-status');
  btnRefresh.addEventListener('click', function() {
    GitHubSync.dispatchAll(syncStatus);
  });

  function getRoute() {
    var hash = location.hash.replace('#/', '');
    return hash || 'tasks';
  }

  function updateActiveNav(route) {
    var links = document.querySelectorAll('.nav-link');
    for (var i = 0; i < links.length; i++) {
      var linkRoute = links[i].getAttribute('data-route');
      if (linkRoute === route) {
        links[i].classList.add('active');
      } else {
        links[i].classList.remove('active');
      }
    }
  }

  function renderRoute(route, data) {
    var pageConfig = ConfigLoader.getPageConfig(route);

    if (!pageConfig) {
      view.innerHTML = '<p class="text-slate-500">Страница не найдена</p>';
      return;
    }

    if (!data) {
      view.innerHTML = '<div class="card"><div class="card-header">' +
        (pageConfig.title || DataLoader.getSheetName(route)) +
        '</div><div class="p-8 text-center text-slate-400">Нет данных. Нажмите "Обновить данные" для загрузки из Google Sheets.</div></div>';
      return;
    }

    // Новый формат (Node.js скрипты) — данные содержат tables[]
    if (data && data.tables) {
      ConfigRenderer.render(view, data, pageConfig);
    }
    // Старый формат (GAS snapshot) — конфиг содержит tables[]
    else if (pageConfig.tables) {
      ConfigRenderer.render(view, data, pageConfig);
    } else {
      // Generic pages (no tables defined) → GenericRenderer
      GenericRenderer.render(view, data, pageConfig.title);
    }
  }

  function navigate() {
    var route = getRoute();
    updateActiveNav(route);

    loading.classList.remove('hidden');
    view.classList.add('hidden');

    // Рейтинг — с выбором периода из базы
    if (route === 'rating') {
      loading.classList.add('hidden');
      view.classList.remove('hidden');
      RatingPeriod.renderSelector(view);
      return;
    }

    // Задачи = Задачи + Задачи брокеров (объединённая страница)
    if (route === 'tasks') {
      Promise.all([
        DataLoader.loadSheet('tasks'),
        DataLoader.loadSheet('broker-tasks')
      ]).then(function(results) {
        var tasksData = results[0];
        var btData = results[1];
        if (tasksData && tasksData.tables && btData && btData.tables) {
          tasksData.tables = tasksData.tables.concat(btData.tables);
        }
        loading.classList.add('hidden');
        view.classList.remove('hidden');
        renderRoute(route, tasksData || btData);
      }).catch(function(err) {
        console.error('Tasks load error:', err);
        loading.classList.add('hidden');
        view.classList.remove('hidden');
        view.innerHTML = '<p style="padding:20px;color:#E53935">Ошибка загрузки данных: ' + err.message + '</p>';
      });
      return;
    }

    DataLoader.loadSheet(route).then(function(data) {
      loading.classList.add('hidden');
      view.classList.remove('hidden');
      renderRoute(route, data);
    }).catch(function(err) {
      console.error('Load error:', err);
      loading.classList.add('hidden');
      view.classList.remove('hidden');
      view.innerHTML = '<p style="padding:20px;color:#E53935">Ошибка загрузки: ' + err.message + '</p>';
    });
  }

  // Initialize: load config first, then start the app
  ConfigLoader.load().then(function() {
    // Load meta for updated timestamp
    DataLoader.loadMeta().then(function(meta) {
      if (meta && meta._meta && meta._meta.snapshotDate) {
        var d = new Date(meta._meta.snapshotDate);
        updatedAt.textContent = 'Обновлено: ' + d.toLocaleString('ru-RU');
      }
    }).catch(function() {});

    // Также проверяем timestamp из нового формата данных
    DataLoader.loadSheet('tasks').then(function(data) {
      if (data && data._meta && data._meta.updated) {
        var d = new Date(data._meta.updated);
        updatedAt.textContent = 'Обновлено: ' + d.toLocaleString('ru-RU');
      }
    }).catch(function() {});

    // Route handling
    window.addEventListener('hashchange', navigate);

    // Initial load
    if (!location.hash) location.hash = '#/tasks';
    navigate();
  });

})();
