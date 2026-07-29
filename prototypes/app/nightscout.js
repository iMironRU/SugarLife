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

  function num() {
    for (let i = 0; i < arguments.length; i++) {
      const x = arguments[i];
      if (typeof x === 'number' && !isNaN(x)) return x;
    }
    return null;
  }

  // текущее значение из расписания профиля (carbratio/sens/basal/target) по локальному времени
  function slotValue(schedule) {
    if (!Array.isArray(schedule) || !schedule.length) return null;
    const now = new Date();
    const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    let val = schedule[0].value;
    for (const s of schedule) {
      const t = s.timeAsSeconds != null ? s.timeAsSeconds : 0;
      if (t <= sec) val = s.value;
    }
    return val;
  }

  // devicestatus → IOB/COB/резервуар/статус/базал (последняя запись)
  async function loadDeviceStatus(base, token) {
    const raw = await getJSON(base, '/api/v1/devicestatus.json?count=1', token);
    const d = Array.isArray(raw) ? raw[0] : null;
    if (!d) return null;
    const oa = d.openaps || {};
    const loop = d.loop || {};
    const pump = d.pump || {};
    const ext = pump.extended || {};
    return {
      iob: num(oa.iob && oa.iob.iob, loop.iob && loop.iob.iob),
      cob: num(oa.suggested && oa.suggested.COB, oa.cob, loop.cob && loop.cob.cob),
      reservoir: num(pump.reservoir),
      pumpBattery: num(pump.battery && pump.battery.percent),
      status: (pump.status && pump.status.status) || null,
      baseBasal: num(ext.BaseBasalRate),
      tempRate: num(ext.TempBasalAbsoluteRate),
      lastBolus: num(ext.LastBolusAmount),
      at: d.date || (d.created_at && Date.parse(d.created_at)) || null,
    };
  }

  // profile → текущие СУИ (IC), ISF, базал, целевой диапазон
  async function loadProfile(base, token) {
    const raw = await getJSON(base, '/api/v1/profile.json', token);
    const doc = Array.isArray(raw) ? raw[0] : raw;
    if (!doc || !doc.store) return null;
    const key = (doc.defaultProfile && doc.store[doc.defaultProfile]) ? doc.defaultProfile : Object.keys(doc.store)[0];
    const p = doc.store[key] || {};
    return {
      name: key,
      ic: slotValue(p.carbratio),
      isf: slotValue(p.sens),
      basal: slotValue(p.basal),
      targetLow: slotValue(p.target_low),
      targetHigh: slotValue(p.target_high),
      dia: num(p.dia),
      units: p.units,
    };
  }

  // treatments → болюсы, углеводы, старт сенсора
  async function loadTreatments(base, token, count) {
    const raw = await getJSON(base, '/api/v1/treatments.json?count=' + (count || 120), token);
    return (Array.isArray(raw) ? raw : []).map(t => ({
      t: t.date || (t.created_at && Date.parse(t.created_at)) || null,
      type: t.eventType || '',
      carbs: num(t.carbs),
      insulin: num(t.insulin),
    })).filter(x => x.t);
  }

  // всё сразу; частичные ошибки не валят загрузку сахара
  async function loadAll(cfg) {
    const base = cfg.url, token = cfg.token;
    const [entries, device, profile, treatments] = await Promise.all([
      loadEntries(base, token, 288),
      loadDeviceStatus(base, token).catch(() => null),
      loadProfile(base, token).catch(() => null),
      loadTreatments(base, token, 120).catch(() => null),
    ]);
    return { entries, device, profile, treatments };
  }

  window.Nightscout = {
    getCfg, setCfg, ping, loadEntries, loadDeviceStatus, loadProfile, loadTreatments, loadAll,
    arrowFor, MGDL_PER_MMOL,
  };
})();
