/**
 * Config Loader — загружает dashboard-config.json
 */
var ConfigLoader = (function() {
  var config = null;

  function load() {
    console.log('CONFIG: loading...');
    return fetch('data/dashboard-config.json?t=' + Date.now())
      .then(function(r) {
        console.log('CONFIG: fetch status', r.status);
        return r.json();
      })
      .then(function(d) {
        config = d;
        console.log('CONFIG: OK, pages:', Object.keys(d.pages || {}));
        return d;
      })
      .catch(function(err) {
        console.error('CONFIG: FAILED', err);
        config = { version: 1, pages: {}, genericPages: {} };
        return config;
      });
  }

  function getPageConfig(routeKey) {
    if (!config) return null;
    return config.pages[routeKey] || config.genericPages[routeKey] || null;
  }

  function getSheetName(routeKey) {
    var p = getPageConfig(routeKey);
    return p ? p.sheet : null;
  }

  function getFileName(routeKey) {
    var p = getPageConfig(routeKey);
    return p ? p.file : null;
  }

  return {
    load: load,
    getPageConfig: getPageConfig,
    getSheetName: getSheetName,
    getFileName: getFileName
  };
})();
