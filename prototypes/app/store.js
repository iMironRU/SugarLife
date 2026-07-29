/* SugarLife — стор живых данных из Nightscout.
   Поллинг + кэш в localStorage (офлайн). При отсутствии конфига — данных нет,
   приложение показывает демо-наборы (fallback внутри renderVals). */
(() => {
  'use strict';

  const CACHE_KEY = 'sl.ns.cache.v1';
  const POLL_MS = 60000;

  let data = null;      // { entries:[{t,mgdl,mmol,dir}], latest, updatedAt }
  let status = 'idle';  // idle | off | loading | ok | stale | error
  let error = null;
  let timer = null;
  let inflight = false;

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c && c.entries) { data = c; status = 'stale'; }
    } catch (e) {}
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function notify() {
    const app = window.__app;
    if (app && app._onChange) app._onChange();
  }

  async function refresh() {
    if (inflight) return;
    const cfg = window.Nightscout.getCfg();
    if (!cfg || !cfg.enabled || !cfg.url) {
      status = 'off'; error = null; notify(); return;
    }
    inflight = true;
    status = data ? status : 'loading';
    notify();
    try {
      const res = await window.Nightscout.loadAll(cfg);
      const entries = res.entries || [];
      const latest = entries.length ? entries[entries.length - 1] : null;
      data = { entries, latest, device: res.device || null, profile: res.profile || null, updatedAt: Date.now() };
      status = 'ok'; error = null;
      saveCache();
    } catch (e) {
      error = String(e && e.message || e);
      status = data ? 'stale' : 'error';
    } finally {
      inflight = false;
      notify();
    }
  }

  function start() {
    loadCache();
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, POLL_MS);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  window.Store = {
    start, refresh,
    get data() { return data; },
    get status() { return status; },
    get error() { return error; },
  };
})();
