/* SugarLife — адаптер Nightscout (read-only).
   Ходит напрямую из браузера (у Nightscout по умолчанию CORS + роль readable).
   Нормализует ответы в модель приложения. Конфиг — только в localStorage, локально. */
(() => {
  'use strict';

  const CFG_KEY = 'sl.ns.cfg';
  const MGDL_PER_MMOL = 18.0;

  function getCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || null; } catch (e) { return null; }
  }
  function setCfg(cfg) {
    if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CFG_KEY);
  }

  // Nightscout direction -> phosphor-иконка стрелки (веса bold, как в дизайне)
  const ARROWS = {
    DoubleUp: 'ph-bold ph-arrow-up',
    SingleUp: 'ph-bold ph-arrow-up',
    FortyFiveUp: 'ph-bold ph-arrow-up-right',
    Flat: 'ph-bold ph-arrow-right',
    FortyFiveDown: 'ph-bold ph-arrow-down-right',
    SingleDown: 'ph-bold ph-arrow-down',
    DoubleDown: 'ph-bold ph-arrow-down',
  };
  function arrowFor(dir) { return ARROWS[dir] || 'ph-bold ph-arrow-right'; }

  function joinUrl(base, path, token) {
    let u = String(base || '').trim().replace(/\/+$/, '') + path;
    if (token) u += (path.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
    return u;
  }

  async function getJSON(base, path, token, timeoutMs) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    try {
      const r = await fetch(joinUrl(base, path, token), {
        headers: { Accept: 'application/json' }, signal: ctrl.signal,
      });
      if (!r.ok) throw new Error('Nightscout ' + path + ' → HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  // Проверка подключения: латест SGV + версия сервера
  async function ping(base, token) {
    const [entries, status] = await Promise.all([
      getJSON(base, '/api/v1/entries.json?count=1', token),
      getJSON(base, '/api/v1/status.json', token).catch(() => null),
    ]);
    const e = Array.isArray(entries) ? entries.find(x => x && x.sgv != null) : null;
    return {
      ok: !!e,
      version: status && status.version,
      name: status && status.name,
      latestMgdl: e ? e.sgv : null,
      latestMmol: e ? +(e.sgv / MGDL_PER_MMOL).toFixed(1) : null,
      at: e ? (e.date || Date.parse(e.dateString)) : null,
    };
  }

  // Загрузка entries (SGV) за период; count с запасом (5 мин * 288 = 24 ч)
  async function loadEntries(base, token, count) {
    const raw = await getJSON(base, '/api/v1/entries.json?count=' + (count || 288), token);
    const list = (Array.isArray(raw) ? raw : [])
      .filter(e => e && e.sgv != null)
      .map(e => ({
        t: e.date || Date.parse(e.dateString),
        mgdl: e.sgv,
        mmol: e.sgv / MGDL_PER_MMOL,
        dir: e.direction || 'Flat',
      }))
      .filter(e => e.t)
      .sort((a, b) => a.t - b.t); // по возрастанию времени
    return list;
  }

  window.Nightscout = { getCfg, setCfg, ping, loadEntries, arrowFor, MGDL_PER_MMOL };
})();
