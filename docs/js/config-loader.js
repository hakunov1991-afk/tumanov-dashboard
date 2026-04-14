/**
 * Config Loader — загружает dashboard-config.json, поддерживает localStorage override
 */
var ConfigLoader = (function() {
  var config = null;
  var LOCAL_KEY = 'dashboard-config-override';

  function load() {
    if (config) return Promise.resolve(config);

    // localStorage override отключён (редактор убран)
    try { localStorage.removeItem(LOCAL_KEY); } catch(e) {}

    return fetch('data/dashboard-config.json')
      .then(function(r) { return r.json(); })
      .then(function(d) { config = d; return d; })
      .catch(function(err) {
        console.error('Failed to load config:', err);
        config = { version: 1, pages: {}, genericPages: {} };
        return config;
      });
  }

  function getPageConfig(routeKey) {
    if (!config) return null;
    if (config.pages[routeKey]) return config.pages[routeKey];
    if (config.genericPages[routeKey]) return config.genericPages[routeKey];
    return null;
  }

  function getSheetName(routeKey) {
    var page = getPageConfig(routeKey);
    return page ? page.sheet : null;
  }

  function getFileName(routeKey) {
    var page = getPageConfig(routeKey);
    return page ? page.file : null;
  }

  function getAllRoutes() {
    if (!config) return [];
    return Object.keys(config.pages || {}).concat(Object.keys(config.genericPages || {}));
  }

  function getConfig() {
    return config;
  }

  function saveLocal(newConfig) {
    config = newConfig;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(newConfig));
  }

  function clearLocal() {
    localStorage.removeItem(LOCAL_KEY);
    config = null;
  }

  function hasLocalOverride() {
    return !!localStorage.getItem(LOCAL_KEY);
  }

  return {
    load: load,
    getPageConfig: getPageConfig,
    getSheetName: getSheetName,
    getFileName: getFileName,
    getAllRoutes: getAllRoutes,
    getConfig: getConfig,
    saveLocal: saveLocal,
    clearLocal: clearLocal,
    hasLocalOverride: hasLocalOverride
  };
})();
