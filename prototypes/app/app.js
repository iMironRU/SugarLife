/* SugarLife PWA — состояние и вычисляемые пропсы экрана.
   Класс Component воспроизведён из дизайн-хэндофа (design/Приложение диабетика.dc.html),
   это спецификация поведения. Рантайм — свой (engine.js), не проприетарный support.js. */
'use strict';
const DCLogic = window.DC.DCLogic;

class Component extends DCLogic {
  state = {
    tab: 'today', range: '3H', sheet: null,
    therapy: 'pump', rapid: 'Fiasp', basal: 'Tresiba',
    insulinSlot: 'rapid', insulinFilter: 'Все', query: '',
    monitor: 'cgm', exportFmt: 'PDF', metric: 'glucose', lActivity: false,
    sCloud: true, sHealth: true, sScale: false,
    sNight: false, sShare: true, sClinic: false, sHealthOut: true,
    exportPeriod: '90 дней',
    sensorId: 's1', newModel: 'Guardian 4', newSerial: '',
    manual: 5.8, manualTag: 'До еды', units: 'mmol', unitsSheet: false,
    pumpRunning: true, basalRate: 0.9, tempBasal: 'выкл',
    shotKind: 'bolus', shotSite: 'Живот', shotUnits: 4,
    bolusCarbs: 45, bolusBg: 5.8, bolusFinal: 3.3, bolusMode: 'Обычный',
    foodMode: 'dish', dishId: 'd1', dishQuery: '', portions: 1,
    mProt: 0, mFat: 0, mCarbs: 40, mealType: 'Обед',
    carbUnits: 'g', carbSheet: false,
    bolusRemOn: true, bolusRemCount: 3, remMissed: true,
    low: 3.9, high: 10.0,
    aLow: true, aHigh: true, aFall: true, aRise: false, aRes: true,
    aMiss: true, aStrips: true,
  };

  renderVals() {
    const tab = this.state.tab;
    const go = (t) => () => this.setState({ tab: t, sheet: null, scrolled: false, unitsSheet: false, carbSheet: false });

    const themeMode = this.state.theme || 'dark';
    const sysLight = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-color-scheme: light)').matches;
    const themeAttr = themeMode === 'system' ? (sysLight ? 'light' : 'dark') : themeMode;
    const themes = [
      { key: 'system', label: 'Системная', icon: 'ph-fill ph-circle-half' },
      { key: 'light', label: 'Светлая', icon: 'ph-fill ph-sun' },
      { key: 'dark', label: 'Тёмная', icon: 'ph-fill ph-moon' },
    ].map(t => {
      const on = themeMode === t.key;
      return { ...t,
        onClick: () => this.setState({ theme: t.key }),
        bg: on ? 'color-mix(in srgb, var(--color-accent) 26%, var(--color-neutral-900))' : 'transparent',
        bd: on ? 'color-mix(in srgb, var(--color-accent) 65%, transparent)' : 'var(--color-neutral-800)',
        col: on ? 'var(--color-text)' : 'var(--color-neutral-400)',
      };
    });

    const dsSurfaces = [
      { name: 'Фон', token: '--color-bg', value: 'var(--color-bg)' },
      { name: 'Поверхность', token: '--color-neutral-900', value: 'var(--color-neutral-900)' },
      { name: 'Граница', token: '--color-neutral-800', value: 'var(--color-neutral-800)' },
      { name: 'Акцент', token: '--color-accent', value: 'var(--color-accent)' },
      { name: 'Текст', token: '--color-text', value: 'var(--color-text)' },
      { name: 'Второстепенный', token: '--color-neutral-400', value: 'var(--color-neutral-400)' },
    ];
    const dsSemantic = [
      { name: 'Глюкоза', token: '--c-glu', value: 'var(--c-glu)', use: 'в диапазоне' },
      { name: 'Углеводы', token: '--c-carb', value: 'var(--c-carb)', use: 'еда, Х.Е.' },
      { name: 'Инсулин', token: '--c-ins', value: 'var(--c-ins)', use: 'болюс, базал' },
      { name: 'Активность', token: '--c-act', value: 'var(--c-act)', use: 'шаги, спорт' },
      { name: 'Тренд', token: '--c-trend', value: 'var(--c-trend)', use: 'кривая сахара' },
      { name: 'Опасность', token: '--c-danger', value: 'var(--c-danger)', use: 'гипо, выход' },
    ];
    const dsType = [
      { sample: 'Заголовок экрана', size: '28px', weight: 600, ls: '-.02em', spec: '28 / 600', color: 'var(--color-text)' },
      { sample: 'Заголовок шторки', size: '19px', weight: 600, ls: '-.01em', spec: '19 / 600', color: 'var(--color-text)' },
      { sample: 'Крупное значение', size: '34px', weight: 600, ls: '-.02em', spec: '34 / 600', color: 'var(--color-text)' },
      { sample: 'Строка списка', size: '14px', weight: 400, ls: '0', spec: '14 / 400', color: 'var(--color-text)' },
      { sample: 'Значение справа', size: '13px', weight: 400, ls: '0', spec: '13 / 400', color: 'var(--color-neutral-400)' },
      { sample: 'Подпись и пояснение', size: '11px', weight: 400, ls: '0', spec: '11 / 400', color: 'var(--color-neutral-500)' },
      { sample: 'РАЗДЕЛ', size: '12px', weight: 500, ls: '.08em', spec: '12 / 500', color: 'var(--color-neutral-500)' },
    ];
    const dsRadii = [
      { label: '14 чип', value: '14px' },
      { label: '16 кнопка', value: '16px' },
      { label: '18 список', value: '18px' },
      { label: '20 карточка', value: '20px' },
      { label: '50% круг', value: '50%' },
    ];
    const dsOn = this.state.dsToggleOn !== false;
    const dsChips = ['Активный', 'Обычный', 'Ещё'].map(label => ({
      label,
      onClick: () => this.setState({ dsChip: label }),
      bg: (this.state.dsChip || 'Активный') === label ? 'color-mix(in srgb, var(--color-accent) 26%, var(--color-neutral-900))' : 'transparent',
      bd: (this.state.dsChip || 'Активный') === label ? 'color-mix(in srgb, var(--color-accent) 65%, transparent)' : 'var(--color-neutral-800)',
      col: (this.state.dsChip || 'Активный') === label ? 'var(--color-text)' : 'var(--color-neutral-400)',
    }));

    const fmt = (v) => v.toFixed(1).replace('.', ',');
    const mgdl = this.state.units === 'mgdl';
    const unitLabel = mgdl ? 'мг/дл' : 'ммоль/л';
    const toUnits = (v) => mgdl ? String(Math.round(v * 18)) : fmt(v);

    const ranges = ['1H', '3H', '6H', '12H', '24H', '3D'].map(r => ({
      label: r,
      active: this.state.range === r,
      onClick: () => this.setState({ range: r }),
      bg: this.state.range === r ? 'color-mix(in srgb, var(--color-accent) 30%, var(--color-neutral-800))' : 'transparent',
      col: this.state.range === r ? 'var(--color-text)' : 'var(--color-neutral-400)',
    }));

    const readings = [
      ['12:23', 12.8, 'ph-bold ph-arrow-up-right', true],
      ['12:22', 12.8, 'ph ph-arrow-right', false],
      ['12:21', 12.7, 'ph ph-arrow-right', false],
      ['12:20', 12.7, 'ph ph-arrow-right', false],
      ['12:19', 12.5, 'ph ph-arrow-right', false],
    ].map(([time, value, arrow, first]) => ({
      time, arrow, value: toUnits(value),
      weight: first ? 600 : 400,
      col: first ? 'var(--color-text)' : 'var(--color-neutral-300)',
      arrowCol: first ? 'var(--color-text)' : 'var(--color-neutral-500)',
      bg: first ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
    }));

    // ===== Живые данные Nightscout (если настроены), иначе демо =====
    const NS = (window.Store && window.Store.data) || null;
    const nsLive = NS && NS.latest ? NS : null;
    const nsCfg = window.Nightscout ? window.Nightscout.getCfg() : null;
    const nsStat = window.Store ? window.Store.status : 'off';
    const agoText = (t) => {
      const m = Math.max(0, Math.round((Date.now() - t) / 60000));
      if (m < 1) return 'только что';
      if (m < 60) return m + ' мин назад';
      const h = Math.floor(m / 60);
      return h + ' ч назад';
    };
    const hhmm = (t) => {
      const d = new Date(t);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };
    // список последних измерений из живых данных
    const liveReadings = nsLive ? NS.entries.slice(-6).reverse().map((e, i) => {
      const first = i === 0;
      return {
        time: hhmm(e.t), arrow: window.Nightscout.arrowFor(e.dir), value: toUnits(e.mmol),
        weight: first ? 600 : 400,
        col: first ? 'var(--color-text)' : 'var(--color-neutral-300)',
        arrowCol: first ? 'var(--color-text)' : 'var(--color-neutral-500)',
        bg: first ? 'color-mix(in srgb, var(--color-accent) 10%, transparent)' : 'transparent',
      };
    }) : null;
    // кривая глюкозы в системе координат графика (viewBox 402x300; y: 44→12 ммоль, 252→4)
    const RANGE_MS = { '1H': 36e5, '3H': 3 * 36e5, '6H': 6 * 36e5, '12H': 12 * 36e5, '24H': 24 * 36e5, '3D': 3 * 24 * 36e5 };
    let liveGluPath = null;
    if (nsLive) {
      const span = RANGE_MS[this.state.range] || 3 * 36e5;
      const t0 = Date.now() - span;
      const pts = NS.entries.filter(e => e.t >= t0);
      if (pts.length >= 2) {
        const yFor = (v) => Math.max(2, Math.min(298, 44 + (12 - v) / 8 * 208));
        const xFor = (t) => ((t - t0) / span) * 402;
        liveGluPath = pts.map((e, i) => (i ? 'L' : 'M') + xFor(e.t).toFixed(1) + ',' + yFor(e.mmol).toFixed(1)).join(' ');
      }
    }
    const DEMO_GLU1 = "M0,88 C14,86 24,90 40,90 C56,91 66,92 78,92 C88,92 96,86 108,80 C120,74 130,64 142,52 C154,40 164,26 178,20 C190,15 202,12 214,14 C228,17 240,22 254,26 C268,30 280,28 292,26";
    const DEMO_GLU2 = "M320,30 C330,42 340,58 352,58 C364,58 372,44 384,38 C392,34 396,34 402,36";
    const glucoseMmol = nsLive ? nsLive.latest.mmol : 5.8;
    const glucoseBigMmol = nsLive ? nsLive.latest.mmol : 12.8;

    const sBack = "M0,16 C22,7 40,22 62,15 C82,9 92,17 100,13 L100,40 L0,40 Z";
    const sFront = "M0,24 C22,17 44,29 64,22 C82,17 94,25 100,21 L100,40 L0,40 Z";
    const flatBack = "M0,22 C25,19 75,25 100,21 L100,40 L0,40 Z";
    const flatFront = "M0,28 C25,26 75,30 100,27 L100,40 L0,40 Z";
    const jagBack = "M0,22 L12,16 L24,24 L36,17 L48,24 L60,17 L72,24 L84,17 L100,23 L100,40 L0,40 Z";
    const jagFront = "M0,27 L12,22 L24,29 L36,23 L48,29 L60,23 L72,29 L84,23 L100,28 L100,40 L0,40 Z";

    const G  = { a: '#8bb890', b: '#6f9e79', ic: '#93c79b' };
    const Go = { a: '#d8b463', b: '#c1953f', ic: '#e0b64f' };
    const T  = { a: '#5aa9b4', b: '#3f8b97', ic: '#63c0cc' };
    const Pu = { a: '#9184d9', b: '#6d5fb8', ic: '#a99ee6' };

    const tile = (label, value, unit, iconClass, c, pB, pF) => ({
      label, value, unit, iconClass, iconColor: c.ic, waveA: c.a, waveB: c.b, pathBack: pB, pathFront: pF,
    });

    const tiles = [
      tile('Средняя глюкоза', toUnits(12.3), unitLabel, 'ph-fill ph-drop', G, sBack, sFront),
      tile('Ст. отклонение', toUnits(2.2), unitLabel, 'ph-bold ph-plus-minus', G, sBack, sFront),
      tile('В диапазоне', '0', '%', 'ph-fill ph-target', G, flatBack, flatFront),
      tile('Углеводы', '0', 'г', 'ph-fill ph-hexagon', Go, jagBack, jagFront),
      tile('Болюс', '0', 'ед', 'ph-fill ph-syringe', T, sBack, sFront),
      tile('Базал', '0', 'ед', 'ph-fill ph-eyedropper', T, sBack, sFront),
      tile('Активность', '0', 'мин', 'ph-fill ph-person-simple-run', Pu, sBack, sFront),
      tile('Шаги', '1 511', '', 'ph-fill ph-footprints', Pu, sBack, sFront),
    ];

    const full = tab === 'today';
    const line = !full && this.state.scrolled;

    const isPen = this.state.therapy === 'pen';
    const chip = (on) => ({
      bg: on ? 'color-mix(in srgb, var(--color-accent) 26%, var(--color-neutral-900))' : 'transparent',
      bd: on ? 'color-mix(in srgb, var(--color-accent) 70%, transparent)' : 'var(--color-neutral-800)',
      col: on ? 'var(--color-text)' : 'var(--color-neutral-400)',
    });

    const methods = [
      { key: 'pump', label: 'Помпа', icon: 'ph-fill ph-drop-half' },
      { key: 'pen', label: 'Шприц-ручка', icon: 'ph-fill ph-syringe' },
    ].map(m => ({ ...m, ...chip(this.state.therapy === m.key), onClick: () => this.setState({ therapy: m.key }) }));

    // --- справочник инсулинов ---
    const CATALOG = [
      { name: 'Fiasp', sub: 'инсулин аспарт, ускоренный', type: 'Ультракороткий', timing: '0:05 · 3–5 ч' },
      { name: 'NovoRapid', sub: 'инсулин аспарт', type: 'Ультракороткий', timing: '0:10 · 3–5 ч' },
      { name: 'Humalog', sub: 'инсулин лизпро', type: 'Ультракороткий', timing: '0:15 · 3–5 ч' },
      { name: 'Lyumjev', sub: 'лизпро, ускоренный', type: 'Ультракороткий', timing: '0:05 · 3–4 ч' },
      { name: 'Apidra', sub: 'инсулин глулизин', type: 'Ультракороткий', timing: '0:15 · 3–4 ч' },
      { name: 'Actrapid', sub: 'человеческий растворимый', type: 'Короткий', timing: '0:30 · 6–8 ч' },
      { name: 'Humulin R', sub: 'человеческий растворимый', type: 'Короткий', timing: '0:30 · 6–8 ч' },
      { name: 'Tresiba', sub: 'инсулин деглудек', type: 'Длинный', timing: '1:00 · до 42 ч' },
      { name: 'Lantus', sub: 'инсулин гларгин', type: 'Длинный', timing: '1:00 · 24 ч' },
      { name: 'Toujeo', sub: 'гларгин 300 ед/мл', type: 'Длинный', timing: '1:30 · 24–36 ч' },
      { name: 'Levemir', sub: 'инсулин детемир', type: 'Длинный', timing: '1:00 · 12–24 ч' },
      { name: 'NovoMix 30', sub: 'аспарт двухфазный', type: 'Смесь', timing: '0:15 · 24 ч' },
      { name: 'Humalog Mix 25', sub: 'лизпро двухфазный', type: 'Смесь', timing: '0:15 · 22 ч' },
    ];
    const slot = this.state.insulinSlot;
    const filter = this.state.insulinFilter;
    const q = (this.state.query || '').trim().toLowerCase();
    const insulinFilters = ['Все', 'Ультракороткий', 'Короткий', 'Длинный', 'Смесь'].map(label => ({
      label, ...chip(filter === label), onClick: () => this.setState({ insulinFilter: label }),
    }));
    const insulinList = CATALOG
      .filter(i => (filter === 'Все' || i.type === filter))
      .filter(i => !q || (i.name + ' ' + i.sub).toLowerCase().includes(q))
      .map(i => {
        const on = this.state[slot] === i.name;
        return { ...i,
          rowBg: on ? 'color-mix(in srgb, var(--color-accent) 16%, transparent)' : 'transparent',
          check: on ? 'ph-fill ph-check-circle' : 'ph ph-circle',
          checkCol: on ? 'var(--color-accent)' : 'var(--color-neutral-700)',
          onClick: () => this.setState({ [slot]: i.name, sheet: null }),
        };
      });

    // --- уведомления ---
    const step = (key, d, lo, hi) => () => this.setState(s => ({
      [key]: Math.min(hi, Math.max(lo, Math.round((s[key] + d) * 10) / 10)),
    }));
    const thresholds = [
      { label: 'Гипо-порог', icon: 'ph-fill ph-arrow-down', iconCol: '#c96b7a', value: toUnits(this.state.low),
        dec: step('low', -0.1, 3.0, 5.5), inc: step('low', 0.1, 3.0, 5.5) },
      { label: 'Гипер-порог', icon: 'ph-fill ph-arrow-up', iconCol: '#e0b64f', value: toUnits(this.state.high),
        dec: step('high', -0.5, 7.0, 16.0), inc: step('high', 0.5, 7.0, 16.0) },
    ];
    const cgmAlerts = [
      { key: 'aLow', label: 'Гипогликемия', sub: 'звук + вибрация', icon: 'ph-fill ph-bell-ringing' },
      { key: 'aHigh', label: 'Гипергликемия', sub: 'уведомление на экране', icon: 'ph-fill ph-bell' },
      { key: 'aFall', label: 'Быстрое падение', sub: 'от 2 ммоль/л за 15 мин', icon: 'ph-fill ph-trend-down' },
      { key: 'aRise', label: 'Быстрый рост', sub: 'от 2 ммоль/л за 15 мин', icon: 'ph-fill ph-trend-up' },
      { key: 'aRes', label: 'Резервуар и сенсор', sub: 'за 12 часов до замены', icon: 'ph-fill ph-warning' },
    ];
    const bgmAlerts = [
      { key: 'aMiss', label: 'Пропущенное измерение', sub: 'через 30 мин после напоминания', icon: 'ph-fill ph-clock-countdown' },
      { key: 'aStrips', label: 'Тест-полоски', sub: 'когда осталось меньше 10', icon: 'ph-fill ph-warning' },
      { key: 'aRes', label: 'Резервуар инсулина', sub: 'за 12 часов до замены', icon: 'ph-fill ph-drop-half' },
    ];
    const alerts = (this.state.monitor === 'cgm' ? cgmAlerts : bgmAlerts).map(a => {
      const on = !!this.state[a.key];
      return { ...a,
        toggle: () => this.setState(s => ({ [a.key]: !s[a.key] })),
        trackBg: on ? 'var(--color-accent)' : 'var(--color-neutral-800)',
        knobBg: on ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
        knobX: on ? 'translateX(18px)' : 'translateX(0)',
      };
    });
    const notifyOn = alerts.filter(a => this.state[a.key]).length;

    const reminders = [
      { key: 'r1', time: '08:00', label: 'натощак' },
      { key: 'r2', time: '13:00', label: 'перед обедом' },
      { key: 'r3', time: '19:00', label: 'перед ужином' },
      { key: 'r4', time: '22:30', label: 'перед сном' },
    ].map(r => {
      const on = this.state[r.key] !== false;
      return { ...r,
        toggle: () => this.setState(s => ({ [r.key]: s[r.key] === false })),
        timeCol: on ? 'var(--color-text)' : 'var(--color-neutral-600)',
        trackBg: on ? 'var(--color-accent)' : 'var(--color-neutral-800)',
        knobBg: on ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
        knobX: on ? 'translateX(18px)' : 'translateX(0)',
      };
    });
    const remindersOn = reminders.filter(r => this.state[r.key] !== false).length;

    // --- мониторинг ---
    const isCgm = this.state.monitor === 'cgm';
    const monitors = [
      { key: 'cgm', label: 'НМГ', icon: 'ph-fill ph-wave-sine' },
      { key: 'bgm', label: 'Глюкометр', icon: 'ph-fill ph-drop-half-bottom' },
    ].map(m => ({ ...m, ...chip(this.state.monitor === m.key), onClick: () => this.setState({ monitor: m.key }) }));

    // --- датчики НМГ ---
    const SENSORS = [
      { id: 's1', model: 'Guardian 4', serial: '4NBF80812', placed: 'установлен 18 июля',
        active: true, day: 3, total: 10, signal: 'хороший', battery: '78%',
        site: 'Левая рука', calib: '2 часа назад', warm: 'завершён' },
      { id: 's2', model: 'Guardian 4', serial: '4NBF80644', placed: '8–18 июля',
        active: false, day: 10, total: 10, signal: '—', battery: '—',
        site: 'Правая рука', calib: '—', warm: 'завершён' },
    ];
    const sensors = SENSORS.map(s => ({
      ...s,
      onClick: () => this.setState({ sheet: 'sensor', sensorId: s.id }),
      status: s.active ? 'активен' : 'снят',
      chipCol: s.active ? '#93c79b' : 'var(--color-neutral-400)',
      chipBg: s.active ? 'color-mix(in srgb, #93c79b 18%, transparent)' : 'var(--color-neutral-800)',
      iconCol: s.active ? 'var(--color-accent)' : 'var(--color-neutral-600)',
      bg: s.active ? 'color-mix(in srgb, var(--color-accent) 12%, var(--color-neutral-900))' : 'var(--color-neutral-900)',
      bd: s.active ? 'color-mix(in srgb, var(--color-accent) 45%, transparent)' : 'var(--color-neutral-800)',
      progress: Math.round((s.day / s.total) * 100) + '%',
      dayText: 'день ' + s.day + ' из ' + s.total,
      leftText: (s.total - s.day) + ' дн осталось',
      leftShort: (s.total - s.day) + ' дн',
    }));
    const curSensor = sensors.find(s => s.id === this.state.sensorId) || sensors[0];
    const sensorDetails = [
      { icon: 'ph ph-barcode', label: 'Серийный номер', value: curSensor.serial },
      { icon: 'ph ph-map-pin', label: 'Место установки', value: curSensor.site },
      { icon: 'ph ph-calendar-blank', label: 'Период', value: curSensor.placed },
      { icon: 'ph ph-crosshair', label: 'Калибровка', value: curSensor.calib },
      { icon: 'ph ph-hourglass', label: 'Прогрев', value: curSensor.warm },
    ];
    const sensorModels = ['Guardian 4', 'Dexcom G7', 'FreeStyle Libre 3', 'Medtrum A8'].map(label => ({
      label, ...chip(this.state.newModel === label), onClick: () => this.setState({ newModel: label }),
    }));

    // --- помпа и инъекции ---
    const running = this.state.pumpRunning !== false;
    const tempBasal = ['выкл', '80%', '120%', '150%'].map(label => ({
      label, ...chip(this.state.tempBasal === label), onClick: () => this.setState({ tempBasal: label }),
    }));
    const shotKinds = [
      { key: 'bolus', label: 'Болюс', icon: 'ph-fill ph-lightning' },
      { key: 'basal', label: 'Базал', icon: 'ph-fill ph-moon-stars' },
    ].map(k => ({ ...k, ...chip(this.state.shotKind === k.key), onClick: () => this.setState({ shotKind: k.key }) }));
    const shotSites = ['Живот', 'Бедро', 'Плечо', 'Ягодица'].map(label => ({
      label, ...chip(this.state.shotSite === label), onClick: () => this.setState({ shotSite: label }),
    }));
    const uStep = (key, d, lo, hi) => () => this.setState(s => ({
      [key]: Math.min(hi, Math.max(lo, Math.round((s[key] + d) * 10) / 10)),
    }));

    // --- еда ---
    const DISHES = [
      { id: 'd1', name: 'Овсяная каша на молоке', portion: '250 г', carbs: 42, prot: 9, fat: 7, kcal: 280 },
      { id: 'd2', name: 'Гречка отварная', portion: '180 г', carbs: 38, prot: 7, fat: 2, kcal: 200 },
      { id: 'd3', name: 'Куриная грудка гриль', portion: '150 г', carbs: 0, prot: 34, fat: 4, kcal: 175 },
      { id: 'd4', name: 'Яблоко', portion: '1 шт · 180 г', carbs: 19, prot: 0, fat: 0, kcal: 82 },
      { id: 'd5', name: 'Бутерброд с сыром', portion: '90 г', carbs: 26, prot: 11, fat: 12, kcal: 255 },
      { id: 'd6', name: 'Творог 5%', portion: '150 г', carbs: 5, prot: 25, fat: 8, kcal: 180 },
    ];
    const fq = (this.state.dishQuery || '').trim().toLowerCase();
    const dishes = DISHES.filter(d => !fq || d.name.toLowerCase().includes(fq)).map(d => {
      const on = this.state.dishId === d.id;
      return { ...d,
        onClick: () => this.setState({ dishId: d.id }),
        rowBg: on ? 'color-mix(in srgb, #e0b64f 16%, transparent)' : 'transparent',
        check: on ? 'ph-fill ph-check-circle' : 'ph ph-circle',
        checkCol: on ? '#e0b64f' : 'var(--color-neutral-700)',
      };
    });
    const dish = DISHES.find(d => d.id === this.state.dishId) || DISHES[0];
    const byDish = this.state.foodMode === 'dish';
    const p = this.state.portions;
    const meal = byDish
      ? { carbs: Math.round(dish.carbs * p), prot: Math.round(dish.prot * p), fat: Math.round(dish.fat * p), kcal: Math.round(dish.kcal * p) }
      : { carbs: this.state.mCarbs, prot: this.state.mProt, fat: this.state.mFat,
          kcal: Math.round(this.state.mCarbs * 4 + this.state.mProt * 4 + this.state.mFat * 9) };
    const foodModes = [
      { key: 'dish', label: 'Блюдо', icon: 'ph-fill ph-bowl-food' },
      { key: 'macros', label: 'БЖУ вручную', icon: 'ph-fill ph-sliders-horizontal' },
    ].map(m => ({ ...m, ...chip(this.state.foodMode === m.key), onClick: () => this.setState({ foodMode: m.key }) }));
    const iStep = (key, d) => () => this.setState(s => ({ [key]: Math.min(500, Math.max(0, s[key] + d)) }));
    const macroInputs = [
      { key: 'mProt', short: 'Б', label: 'Белки', color: '#63c0cc' },
      { key: 'mFat', short: 'Ж', label: 'Жиры', color: '#a99ee6' },
    ].map(m => ({ ...m,
      value: String(this.state[m.key]),
      inc: iStep(m.key, 5), dec: iStep(m.key, -5),
      onInput: (e) => {
        const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) this.setState({ [m.key]: Math.min(500, n) });
      },
    }));
    const xe = this.state.carbUnits === 'xe';
    const carbUnitLabel = xe ? 'Х.Е.' : 'г';
    const toCarb = (g) => xe ? fmt(Math.round((g / 12) * 10) / 10) : String(Math.round(g));
    const carbUnitOptions = [
      { key: 'g', title: 'Граммы', sub: 'точный вес углеводов', unit: 'г',
        ex1: '42', ex2: '19', ex3: '186',
        scale: 'Десятки и сотни: считаете граммы прямо с упаковки или из справочника.' },
      { key: 'xe', title: 'Хлебные единицы', sub: 'традиционный счёт, 1 Х.Е. = 12 г', unit: 'Х.Е.',
        ex1: '3,5', ex2: '1,6', ex3: '15,5',
        scale: 'Единицы: те же порции выглядят как «3,5» — удобно, если врач считает в Х.Е.' },
    ].map(u => {
      const on = this.state.carbUnits === u.key;
      return { ...u,
        onClick: () => this.setState({ carbUnits: u.key }),
        bg: on ? 'color-mix(in srgb, #e0b64f 14%, var(--color-neutral-900))' : 'var(--color-neutral-900)',
        bd: on ? 'color-mix(in srgb, #e0b64f 55%, transparent)' : 'var(--color-neutral-800)',
        check: on ? 'ph-fill ph-check-circle' : 'ph ph-circle',
        checkCol: on ? '#e0b64f' : 'var(--color-neutral-700)',
      };
    });

    const mealTypes = ['Завтрак', 'Обед', 'Ужин', 'Перекус'].map(label => ({
      label, ...chip(this.state.mealType === label), onClick: () => this.setState({ mealType: label }),
    }));

    // --- напоминания о болюсе (шприц-ручка) ---
    const plural = (n) => (n % 10 === 1 && n % 100 !== 11) ? 'раз' : ((n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'раза' : 'раз');
    const remOn = this.state.bolusRemOn !== false;
    const missedOn = this.state.remMissed !== false;
    const REM_TIMES = [
      { time: '08:00', label: 'завтрак' },
      { time: '13:00', label: 'обед' },
      { time: '16:30', label: 'перекус' },
      { time: '19:00', label: 'ужин' },
      { time: '22:00', label: 'поздний перекус' },
    ];
    const bolusRemCounts = [1, 2, 3, 4, 5].map(n => {
      const on = this.state.bolusRemCount === n;
      return { label: String(n),
        onClick: () => this.setState({ bolusRemCount: n }),
        bg: on ? 'color-mix(in srgb, var(--color-accent) 30%, var(--color-neutral-800))' : 'transparent',
        col: on ? 'var(--color-text)' : 'var(--color-neutral-400)',
      };
    });
    const bolusRemTimes = REM_TIMES.slice(0, this.state.bolusRemCount).map(t => ({
      ...t, col: remOn ? 'var(--color-text)' : 'var(--color-neutral-600)',
    }));

    // --- калькулятор болюса ---
    const IC = 8, ISF = 2.2, IOB = 2.4, TARGET = 6.0;
    const food = this.state.bolusCarbs / IC;
    const corr = Math.max(0, (this.state.bolusBg - TARGET) / ISF);
    const suggested = Math.max(0, Math.round((food + corr - IOB) * 10) / 10);
    const bolusModes = ['Обычный', 'Растянутый', 'Двойной'].map(label => ({
      label, ...chip(this.state.bolusMode === label), onClick: () => this.setState({ bolusMode: label }),
    }));

    // --- единицы измерения ---
    const unitOptions = [
      { key: 'mmol', title: 'ммоль/л', sub: 'Россия, Европа, Австралия', unit: 'ммоль/л',
        normal: '5,8', low: '3,4', high: '12,8',
        scale: 'Единицы и десятые: значения от 2 до 25 — привычная шкала «5,8».' },
      { key: 'mgdl', title: 'мг/дл', sub: 'США, Германия, Израиль', unit: 'мг/дл',
        normal: '104', low: '61', high: '230',
        scale: 'Сотни: те же значения выглядят как «104» — умножены примерно на 18.' },
    ].map(u => {
      const on = this.state.units === u.key;
      return { ...u,
        onClick: () => this.setState({ units: u.key }),
        bg: on ? 'color-mix(in srgb, var(--color-accent) 14%, var(--color-neutral-900))' : 'var(--color-neutral-900)',
        bd: on ? 'color-mix(in srgb, var(--color-accent) 55%, transparent)' : 'var(--color-neutral-800)',
        check: on ? 'ph-fill ph-check-circle' : 'ph ph-circle',
        checkCol: on ? 'var(--color-accent)' : 'var(--color-neutral-700)',
      };
    });

    // --- глюкометр: синхронизация и ручной ввод ---
    const pendingReadings = [
      { time: '08:05', value: '6,4', tag: 'натощак' },
      { time: '13:10', value: '9,1', tag: 'до обеда' },
      { time: '15:40', value: '7,8', tag: 'после еды' },
      { time: '19:02', value: '5,9', tag: 'до ужина' },
    ];
    const manualTags = ['Натощак', 'До еды', 'После еды', 'Перед сном', 'Гипо'].map(label => ({
      label, ...chip(this.state.manualTag === label), onClick: () => this.setState({ manualTag: label }),
    }));
    const mStep = (d) => () => this.setState(s => ({
      manual: Math.min(30, Math.max(1.5, Math.round((s.manual + d) * 10) / 10)),
    }));

    // --- интеграции ---
    const mkSwitch = (list) => list.map(s => {
      const on = !!this.state[s.key];
      return { ...s,
        toggle: () => this.setState(st => ({ [s.key]: !st[s.key] })),
        trackBg: on ? 'var(--color-accent)' : 'var(--color-neutral-800)',
        knobBg: on ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
        knobX: on ? 'translateX(18px)' : 'translateX(0)',
      };
    });
    const SOURCES = [
      { key: 'sCloud', label: 'Dexcom / Libre облако', sub: 'сахар каждые 5 минут', icon: 'ph-fill ph-cloud-arrow-down' },
      { key: 'sHealth', label: 'Apple Health', sub: 'шаги, пульс, вес', icon: 'ph-fill ph-heart' },
      { key: 'sScale', label: 'Умные весы', sub: 'вес и состав тела', icon: 'ph-fill ph-scales' },
    ];
    const TARGETS = [
      { key: 'sNight', label: 'Nightscout', sub: 'свой сервер, каждые 5 мин', icon: 'ph-fill ph-cloud-arrow-up' },
      { key: 'sShare', label: 'Dexcom Share', sub: 'подписчики видят сахар', icon: 'ph-fill ph-users-three' },
      { key: 'sClinic', label: 'Клиника', sub: 'отчёты лечащему врачу', icon: 'ph-fill ph-first-aid-kit' },
      { key: 'sHealthOut', label: 'Apple Health', sub: 'пишем глюкозу и болюсы', icon: 'ph-fill ph-export' },
    ];
    const sources = mkSwitch(SOURCES);
    const targets = mkSwitch(TARGETS);
    const sourcesOn = SOURCES.filter(s => this.state[s.key]).length;
    const targetsOn = TARGETS.filter(s => this.state[s.key]).length;
    const exportFormats = ['PDF', 'CSV', 'XML'].map(label => ({
      label, ...chip(this.state.exportFmt === label), onClick: () => this.setState({ exportFmt: label }),
    }));
    const exportPeriods = ['7 дней', '30 дней', '90 дней', 'Всё'].map(label => {
      const on = this.state.exportPeriod === label;
      return { label,
        onClick: () => this.setState({ exportPeriod: label }),
        bg: on ? 'color-mix(in srgb, var(--color-accent) 30%, var(--color-neutral-800))' : 'transparent',
        col: on ? 'var(--color-text)' : 'var(--color-neutral-400)',
      };
    });
    const exportParts = [
      { key: 'pGlucose', label: 'Глюкоза', icon: 'ph ph-drop' },
      { key: 'pInsulin', label: 'Инсулин и болюсы', icon: 'ph ph-syringe' },
      { key: 'pCarbs', label: 'Углеводы', icon: 'ph ph-hexagon' },
      { key: 'pStats', label: 'Сводная статистика', icon: 'ph ph-chart-bar' },
    ].map(p => {
      const on = this.state[p.key] !== false;
      return { ...p,
        toggle: () => this.setState(s => ({ [p.key]: s[p.key] === false })),
        check: on ? 'ph-fill ph-check-circle' : 'ph ph-circle',
        checkCol: on ? 'var(--color-accent)' : 'var(--color-neutral-700)',
      };
    });

    // --- слои общего графика ---
    const layerDefs = [
      { key: 'lGlucose', label: 'Глюкоза', dot: '#b0713d' },
      { key: 'lCarbs', label: 'Углеводы', dot: '#d8b463' },
      { key: 'lInsulin', label: 'Инсулин', dot: '#63c0cc' },
      { key: 'lActivity', label: 'Активность', dot: '#9184d9' },
    ];
    const layers = layerDefs.map(l => {
      const on = this.state[l.key] !== false;
      return { ...l,
        toggle: () => this.setState(s => ({ [l.key]: s[l.key] === false })),
        bg: on ? 'color-mix(in srgb, ' + l.dot + ' 22%, var(--color-neutral-900))' : 'transparent',
        bd: on ? 'color-mix(in srgb, ' + l.dot + ' 65%, transparent)' : 'var(--color-neutral-800)',
        col: on ? 'var(--color-text)' : 'var(--color-neutral-500)',
      };
    });
    const layerOn = {};
    layerDefs.forEach(l => { layerOn[l.key] = this.state[l.key] !== false; });

    // --- метрики: переключение ---
    const METRICS = {
      glucose: { title: 'Глюкоза', icon: 'ph-fill ph-drop', color: '#93c79b',
        hero: ['В диапазоне', '57', '%'],
        cards: [['Выше диапазона', '43', '%'], ['Ниже диапазона', '0', '%']],
        stats: [['Средняя глюкоза', toUnits(8.8), unitLabel], ['Ст. отклонение', toUnits(2.4), unitLabel]] },
      carbs: { title: 'Углеводы', icon: 'ph-fill ph-hexagon', color: '#e0b64f',
        hero: ['Всего за день', '186', 'г'],
        cards: [['Завтрак', '54', 'г'], ['Ужин', '62', 'г']],
        stats: [['Ср. за приём', '46', 'г'], ['Приёмов пищи', '4', '']] },
      insulin: { title: 'Инсулин', icon: 'ph-fill ph-syringe', color: '#63c0cc',
        hero: ['Всего за день', '38,4', 'ед'],
        cards: [['Болюс', '22,1', 'ед'], ['Базал', '16,3', 'ед']],
        stats: [['Ср. болюс', '3,7', 'ед'], ['Коррекций', '6', '']] },
      activity: { title: 'Активность', icon: 'ph-fill ph-person-simple-run', color: '#a99ee6',
        hero: ['Активные минуты', '48', 'мин'],
        cards: [['Шаги', '8 412', ''], ['Калории', '2 140', 'ккал']],
        stats: [['Тренировок', '3', ''], ['Ср. пульс', '96', 'уд/мин']] },
    };
    const mKey = this.state.metric;
    const M = METRICS[mKey];
    const metricTabs = [
      { key: 'glucose', label: 'Глюкоза', icon: 'ph-fill ph-drop' },
      { key: 'carbs', label: 'Углеводы', icon: 'ph-fill ph-hexagon' },
      { key: 'insulin', label: 'Инсулин', icon: 'ph-fill ph-syringe' },
      { key: 'activity', label: 'Активность', icon: 'ph-fill ph-person-simple-run' },
    ].map(t => {
      const on = mKey === t.key;
      const c = METRICS[t.key].color;
      return { ...t,
        onClick: () => this.setState({ metric: t.key }),
        dot: on ? c : 'var(--color-neutral-500)',
        bg: on ? 'color-mix(in srgb, ' + c + ' 20%, var(--color-neutral-900))' : 'transparent',
        bd: on ? 'color-mix(in srgb, ' + c + ' 60%, transparent)' : 'var(--color-neutral-800)',
        col: on ? 'var(--color-text)' : 'var(--color-neutral-400)',
      };
    });
    const AREA_A = 'M8,66 C70,62 110,54 155,50 C210,45 255,26 292,16 L292,90 L8,90 Z';
    const LINE_A = 'M8,66 C70,62 110,54 155,50 C210,45 255,26 292,16';
    const SM_AREA = 'M6,40 C40,28 60,24 80,26 C110,29 135,52 154,60 L154,70 L6,70 Z';
    const SM_LINE = 'M6,40 C40,28 60,24 80,26 C110,29 135,52 154,60';
    const SM_AREA2 = 'M6,52 C36,46 62,30 86,34 C112,38 132,26 154,22 L154,70 L6,70 Z';
    const SM_LINE2 = 'M6,52 C36,46 62,30 86,34 C112,38 132,26 154,22';

    const monLabelShort = isCgm ? 'НМГ' : 'МГ';

    const nav = [
      { key: 'metrics', label: 'Метрики', icon: 'ph-chart-bar' },
      { key: 'mon', label: monLabelShort, icon: isCgm ? 'ph-wave-sine' : 'ph-drop-half-bottom' },
      { key: 'today', label: 'Сегодня', icon: 'ph-house', big: true },
      { key: 'ins', label: 'Инсулин', icon: isPen ? 'ph-pen-nib' : 'ph-drop-half' },
      { key: 'profile', label: 'Профиль', icon: 'ph-user-circle' },
    ].map(n => {
      const active = n.key === tab;
      return {
        label: n.label,
        onClick: go(n.key),
        iconClass: (active ? 'ph-fill ' : 'ph ') + n.icon,
        col: active ? 'var(--color-text)' : 'var(--color-neutral-500)',
        iconSize: n.big ? '32px' : '23px',
        labelSize: n.big ? '11px' : '10px',
        labelWeight: n.big ? 600 : 400,
      };
    });

    return {
      isToday: tab === 'today',
      isMetrics: tab === 'metrics',
      isSheet: this.state.sheet === 'glucose',
      isProfile: tab === 'profile',
      isOther: !['today', 'metrics', 'profile', 'mon', 'ins', 'ds'].includes(tab),
      goProfile: go('profile'),
      full,
      headPad: tab === 'today' ? '72px' : (line ? '52px' : '58px'),
      rowH: full ? '150px' : (line ? '54px' : '92px'),
      rectTop: full ? '10px' : (line ? '4px' : '7px'),
      rectH: full ? '130px' : (line ? '46px' : '78px'),
      gapW: full ? '146px' : (line ? '58px' : '96px'),
      icoS: full ? '24px' : (line ? '15px' : '17px'),
      nameS: full ? '14px' : (line ? '11px' : '12px'),
      valS: full ? '15px' : (line ? '12px' : '14px'),
      valueS: full ? '44px' : (line ? '17px' : '27px'),
      arrowS: full ? '22px' : (line ? '11px' : '15px'),
      unitS: full ? '12px' : '9px',
      unitShow: line ? 'none' : 'block',
      wingDir: line ? 'row' : 'column',
      wingGap: line ? '7px' : '3px',
      wingAlignL: line ? 'center' : 'flex-start',
      wingAlignR: line ? 'center' : 'flex-end',
      onScroll: (e) => {
        const s = e.target.scrollTop > 10;
        if (s !== this.state.scrolled) this.setState({ scrolled: s });
      },
      methods, isPen, monitors, sources, targets, exportFormats, exportPeriods, exportParts,
      sensors, curSensor, sensorDetails, sensorModels,
      sensorsActiveText: SENSORS.filter(s => s.active).length + ' установлен · всего ' + SENSORS.length,
      isSensorSheet: this.state.sheet === 'sensor',
      isAddSensorSheet: this.state.sheet === 'addSensor',
      openAddSensor: () => this.setState({ sheet: 'addSensor' }),
      newSerial: this.state.newSerial || '',
      onSerial: (e) => this.setState({ newSerial: e.target.value }),
      monDeviceRowShow: isCgm ? 'none' : 'flex',
      pendingReadings, manualTags,
      isSyncSheet: this.state.sheet === 'sync',
      isManualSheet: this.state.sheet === 'manual',
      isPump: !isPen,
      isPumpSheet: this.state.sheet === 'pump',
      isShotSheet: this.state.sheet === 'shot',
      openPump: () => this.setState({ sheet: 'pump' }),
      isFoodSheet: this.state.sheet === 'food',
      openFood: () => this.setState({ sheet: 'food' }),
      foodModes, dishes, macroInputs, mealTypes,
      foodByDish: byDish, foodByMacros: !byDish,
      dishQuery: this.state.dishQuery || '',
      onDishQuery: (e) => this.setState({ dishQuery: e.target.value }),
      portions: String(p),
      portionInc: () => this.setState(s => ({ portions: Math.min(6, Math.round((s.portions + 0.5) * 10) / 10) })),
      portionDec: () => this.setState(s => ({ portions: Math.max(0.5, Math.round((s.portions - 0.5) * 10) / 10) })),
      mealCarbs: String(meal.carbs), mealProt: String(meal.prot), mealFat: String(meal.fat), mealKcal: String(meal.kcal),
      mealCarbsDisp: toCarb(meal.carbs),
      carbUnitLabel, carbUnitOptions,
      unitsShort: unitLabel + ' · ' + carbUnitLabel,
      activeCarbs: toCarb(42),
      dayCarbs: toCarb(186),
      openCarbUnits: () => this.setState({ unitsSheet: true }),
      carbInValue: toCarb(this.state.mCarbs),
      carbInInc: () => this.setState(s => ({ mCarbs: Math.min(500, s.mCarbs + (xe ? 6 : 5)) })),
      carbInDec: () => this.setState(s => ({ mCarbs: Math.max(0, s.mCarbs - (xe ? 6 : 5)) })),
      carbInInput: (e) => {
        const n = parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
        if (isNaN(n)) return;
        this.setState({ mCarbs: Math.min(500, Math.round(xe ? n * 12 : n)) });
      },
      mealBolus: fmt(Math.round((meal.carbs / 8) * 10) / 10),
      isBolusSheet: this.state.sheet === 'bolus',
      openBolus: () => this.setState({ sheet: 'bolus', bolusFinal: suggested }),
      bolusModes,
      bolusCarbs: String(this.state.bolusCarbs),
      bolusBg: toUnits(this.state.bolusBg),
      bolusSuggested: fmt(suggested),
      bolusFood: fmt(Math.round(food * 10) / 10),
      bolusCorr: fmt(Math.round(corr * 10) / 10),
      bolusFinal: fmt(this.state.bolusFinal),
      carbsInc: () => this.setState(s => ({ bolusCarbs: Math.min(300, s.bolusCarbs + 5) })),
      carbsDec: () => this.setState(s => ({ bolusCarbs: Math.max(0, s.bolusCarbs - 5) })),
      onCarbsInput: (e) => {
        const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
        if (!isNaN(n)) this.setState({ bolusCarbs: Math.min(300, n) });
      },
      bgInc: uStep('bolusBg', 0.1, 1.5, 30),
      bgDec: uStep('bolusBg', -0.1, 1.5, 30),
      onBgInput: (e) => {
        const n = parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
        if (isNaN(n)) return;
        const v = mgdl ? n / 18 : n;
        this.setState({ bolusBg: Math.min(30, Math.max(1.5, Math.round(v * 10) / 10)) });
      },
      bolusInc: uStep('bolusFinal', 0.1, 0, 30),
      bolusDec: uStep('bolusFinal', -0.1, 0, 30),
      onBolusInput: (e) => {
        const n = parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
        if (!isNaN(n)) this.setState({ bolusFinal: Math.min(30, Math.max(0, Math.round(n * 10) / 10)) });
      },
      openShot: () => this.setState({ sheet: 'shot' }),
      primaryAction: isPen ? () => this.setState({ sheet: 'shot' }) : () => this.setState({ sheet: 'bolus', bolusFinal: suggested }),
      primaryIcon: isPen ? 'ph-fill ph-syringe' : 'ph-fill ph-lightning',
      primaryLabel: isPen ? 'Зарегистрировать инъекцию' : 'Ввести болюс',
      primarySub: isPen ? 'последняя: 4 ед в 12:40' : 'калькулятор по углеводам и сахару',
      isBolusRemSheet: this.state.sheet === 'bolusRem',
      openBolusRem: () => this.setState({ sheet: 'bolusRem' }),
      toggleBolusRem: () => this.setState(s => ({ bolusRemOn: s.bolusRemOn === false })),
      bolusRemTrack: remOn ? 'var(--color-accent)' : 'var(--color-neutral-800)',
      bolusRemKnob: remOn ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
      bolusRemX: remOn ? 'translateX(18px)' : 'translateX(0)',
      toggleRemMissed: () => this.setState(s => ({ remMissed: s.remMissed === false })),
      remMissedTrack: missedOn ? 'var(--color-accent)' : 'var(--color-neutral-800)',
      remMissedKnob: missedOn ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
      remMissedX: missedOn ? 'translateX(18px)' : 'translateX(0)',
      bolusRemCounts, bolusRemTimes,
      bolusRemSummary: remOn ? this.state.bolusRemCount + ' ' + plural(this.state.bolusRemCount) + ' в день · ' + bolusRemTimes.map(t => t.time).join(', ') : 'выключены',
      tempBasal, shotKinds, shotSites,
      basalRate: fmt(this.state.basalRate),
      basalInc: uStep('basalRate', 0.05, 0.05, 5),
      basalDec: uStep('basalRate', -0.05, 0.05, 5),
      shotUnits: fmt(this.state.shotUnits),
      shotInc: uStep('shotUnits', 0.5, 0.5, 60),
      shotDec: uStep('shotUnits', -0.5, 0.5, 60),
      onShotInput: (e) => {
        const n = parseFloat(e.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
        if (!isNaN(n)) this.setState({ shotUnits: Math.min(60, Math.max(0.5, Math.round(n * 10) / 10)) });
      },
      shotInsulin: this.state.shotKind === 'basal' ? this.state.basal : this.state.rapid,
      pumpSummary: (running ? 'работает' : 'приостановлена') + ' · базал ' + fmt(this.state.basalRate) + ' ед/ч · 112 ед',
      pumpStateLabel: running ? 'работает' : 'приостановлена',
      togglePump: () => this.setState(s => ({ pumpRunning: s.pumpRunning === false })),
      pumpBtnLabel: running ? 'Приостановить подачу' : 'Возобновить подачу',
      pumpBtnIcon: running ? 'ph-bold ph-pause-circle' : 'ph-bold ph-play-circle',
      pumpBtnBd: running ? 'color-mix(in srgb, #c96b7a 55%, transparent)' : 'var(--color-accent)',
      pumpBtnCol: running ? '#d98a96' : 'var(--color-text)',
      openSync: () => this.setState({ sheet: 'sync' }),
      openManual: () => this.setState({ sheet: 'manual' }),
      manualValue: toUnits(this.state.manual),
      onManualInput: (e) => {
        const raw = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
        const n = parseFloat(raw);
        if (isNaN(n)) return;
        const v = mgdl ? n / 18 : n;
        this.setState({ manual: Math.min(30, Math.max(1.5, Math.round(v * 10) / 10)) });
      },
      unitLabel, unitOptions,
      isUnitsSheet: this.state.unitsSheet === true,
      openUnits: () => this.setState({ unitsSheet: true }),
      closeUnits: () => this.setState({ unitsSheet: false }),
      manualInc: mStep(0.1),
      manualDec: mStep(-0.1),
      isFilesSheet: this.state.sheet === 'files',
      openFiles: () => this.setState({ sheet: 'files' }),
      exportFmt: this.state.exportFmt,
      isMon: tab === 'mon',
      isIns: tab === 'ins',
      openMon: go('mon'),
      openIns: go('ins'),
      isCgm,
      isIntegrSheet: this.state.sheet === 'integr',
      openIntegr: () => this.setState({ sheet: 'integr' }),
      monIcon: isCgm ? 'ph-bold ph-wave-sine' : 'ph-bold ph-drop-half-bottom',
      monLabel: isCgm ? 'НМГ' : 'МГ',
      monBadge: isCgm ? '×' + SENSORS.filter(s => s.active).length : '',
      monBadgeShow: isCgm ? 'flex' : 'none',
      monSub: isCgm ? 'датчик' : 'глюкометр',
      monValue: isCgm ? '7 дн' : '24 шт',
      monSub2: isCgm ? 'осталось' : 'тест-полоски',
      monDeviceLabel: isCgm ? 'Сенсор НМГ' : 'Глюкометр',
      monDeviceValue: isCgm ? 'Guardian 4' : 'Contour Plus One',
      monExtraIcon: isCgm ? 'ph ph-crosshair' : 'ph ph-clock-counter-clockwise',
      monExtraLabel: isCgm ? 'Калибровка' : 'Напоминания об измерении',
      monExtraValue: isCgm ? 'по запросу' : remindersOn + ' в день',
      monSummary: isCgm ? 'НМГ · Guardian 4' : 'Глюкометр · Contour Plus One',
      insSummary: isPen ? 'Шприц-ручка · NovoPen 6' : 'Помпа · MiniMed 780G',
      targetRange: toUnits(this.state.low) + '–' + toUnits(this.state.high),
      glucoseNow: toUnits(glucoseMmol),
      glucoseArrow: nsLive ? window.Nightscout.arrowFor(nsLive.latest.dir) : 'ph-bold ph-arrow-up-right',
      glucoseAgo: nsLive ? agoText(nsLive.latest.t) : '3 мин назад',
      syncedText: nsLive ? 'Обновлено ' + agoText(NS.updatedAt) : 'Демо-данные',
      gluPath: nsLive && liveGluPath ? liveGluPath : DEMO_GLU1,
      gluPath2: nsLive ? '' : DEMO_GLU2,
      ax1: toUnits(12), ax2: toUnits(10), ax3: toUnits(8), ax4: toUnits(6), ax5: toUnits(4),
      glucoseBig: toUnits(glucoseBigMmol),
      notifyShort: notifyOn + '/' + alerts.length,
      integrShort: '↓' + sourcesOn + ' · ↑' + targetsOn,
      isInsulinSheet: this.state.sheet === 'insulin',
      isNotifySheet: this.state.sheet === 'notify',
      openRapid: () => this.setState({ sheet: 'insulin', insulinSlot: 'rapid', query: '', insulinFilter: isPen ? 'Ультракороткий' : 'Все' }),
      openBasal: () => this.setState({ sheet: 'insulin', insulinSlot: 'basal', query: '', insulinFilter: 'Длинный' }),
      openNotify: () => this.setState({ sheet: 'notify' }),
      insulinSlotTitle: slot === 'basal' ? 'Базальный инсулин' : (isPen ? 'Болюсный инсулин' : 'Инсулин в резервуаре'),
      insulinFilters, insulinList, thresholds, alerts,
      insulinEmpty: insulinList.length === 0,
      query: this.state.query || '',
      onQuery: (e) => this.setState({ query: e.target.value }),
      basal: this.state.basal,
      notifySummary: this.state.monitor === 'cgm'
        ? notifyOn + ' из ' + alerts.length + ' включено · гипо ' + toUnits(this.state.low) + ' · гипер ' + toUnits(this.state.high)
        : remindersOn + ' напоминаний · ' + notifyOn + ' из ' + alerts.length + ' оповещений',
      reminders,
      isBgm: this.state.monitor !== 'cgm',
      deviceIcon: isPen ? 'ph ph-pen-nib' : 'ph ph-drop-half',
      deviceLabel: isPen ? 'Шприц-ручка' : 'Помпа',
      deviceValue: isPen ? 'NovoPen 6' : 'MiniMed 780G',
      rapidTitle: isPen ? 'Болюсный инсулин' : 'Инсулин в резервуаре',
      rapid: this.state.rapid,
      pumpIcon: isPen ? 'ph-bold ph-pen-nib' : 'ph-bold ph-syringe',
      insulinLeft: isPen ? '28 ед' : '112 ед',
      deviceSub: isPen ? 'картридж' : 'резервуар · 2 дн',
      openGlucose: () => this.setState({ sheet: 'glucose' }),
      closeSheet: () => this.setState({ sheet: null }),
      ranges, readings: liveReadings || readings, layers, metricTabs,

      // ===== Конфиг-шторка Nightscout =====
      isNsSheet: this.state.sheet === 'ns',
      openNs: () => this.setState({ sheet: 'ns', nsUrlDraft: (nsCfg && nsCfg.url) || '', nsTokenDraft: (nsCfg && nsCfg.token) || '', nsMsg: '' }),
      nsUrl: this.state.nsUrlDraft !== undefined ? this.state.nsUrlDraft : ((nsCfg && nsCfg.url) || ''),
      onNsUrl: (e) => this.setState({ nsUrlDraft: e.target.value }),
      nsToken: this.state.nsTokenDraft !== undefined ? this.state.nsTokenDraft : ((nsCfg && nsCfg.token) || ''),
      onNsToken: (e) => this.setState({ nsTokenDraft: e.target.value }),
      nsEnabled: !!(nsCfg && nsCfg.enabled),
      nsTrack: (nsCfg && nsCfg.enabled) ? 'var(--color-accent)' : 'var(--color-neutral-800)',
      nsKnob: (nsCfg && nsCfg.enabled) ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
      nsKnobX: (nsCfg && nsCfg.enabled) ? 'translateX(18px)' : 'translateX(0)',
      nsToggle: () => {
        const c = window.Nightscout.getCfg() || {};
        window.Nightscout.setCfg(Object.assign({}, c, { enabled: !c.enabled, url: c.url || this.state.nsUrlDraft || '', token: c.token || this.state.nsTokenDraft || '' }));
        window.Store.refresh();
        this.setState({});
      },
      nsSave: () => {
        const url = (this.state.nsUrlDraft || '').trim();
        const token = (this.state.nsTokenDraft || '').trim();
        window.Nightscout.setCfg({ url, token, enabled: true });
        this.setState({ nsMsg: 'Проверяю подключение…' });
        window.Nightscout.ping(url, token).then((res) => {
          this.setState({ nsMsg: res.ok ? ('Подключено · Nightscout ' + (res.version || '') + ' · сахар ' + toUnits(res.latestMmol)) : 'Ответ есть, но нет данных сахара' });
          window.Store.refresh();
        }).catch((e) => this.setState({ nsMsg: 'Ошибка: ' + (e && e.message || e) }));
      },
      nsStatusText: !nsCfg || !nsCfg.enabled ? 'Выключено'
        : nsStat === 'ok' ? ('Подключено · обновлено ' + (NS ? agoText(NS.updatedAt) : '—'))
        : nsStat === 'loading' ? 'Подключение…'
        : nsStat === 'stale' ? 'Нет связи · показаны кэш/демо'
        : nsStat === 'error' ? ('Ошибка связи' + (window.Store && window.Store.error ? ' · ' + window.Store.error : ''))
        : '—',
      nsMsg: this.state.nsMsg || '',
      nsRowValue: !nsCfg || !nsCfg.enabled ? 'выкл'
        : nsStat === 'ok' ? 'подключено'
        : nsStat === 'loading' ? 'подключение…'
        : (nsStat === 'error' || nsStat === 'stale') ? 'нет связи' : '—',
      themeAttr, themes,
      isDarkTheme: themeAttr !== 'light',
      isDs: tab === 'ds',
      openDs: go('ds'),
      dsSurfaces, dsSemantic, dsType, dsRadii, dsChips,
      dsToggle: () => this.setState(s => ({ dsToggleOn: s.dsToggleOn === false })),
      dsTrack: dsOn ? 'var(--color-accent)' : 'var(--color-neutral-800)',
      dsKnob: dsOn ? 'var(--color-neutral-100)' : 'var(--color-neutral-600)',
      dsKnobX: dsOn ? 'translateX(18px)' : 'translateX(0)',
      dsValue: String(this.state.dsNumber === undefined ? 3 : this.state.dsNumber),
      dsInc: () => this.setState(s => ({ dsNumber: Math.min(99, (s.dsNumber === undefined ? 3 : s.dsNumber) + 1) })),
      dsDec: () => this.setState(s => ({ dsNumber: Math.max(0, (s.dsNumber === undefined ? 3 : s.dsNumber) - 1) })),
      themeLabel: themeMode === 'system' ? 'Системная' : (themeMode === 'light' ? 'Светлая' : 'Тёмная'),
      themeIcon: themeAttr === 'light' ? 'ph-fill ph-sun' : 'ph-fill ph-moon',
      toggleTheme: () => this.setState({ theme: themeAttr === 'light' ? 'dark' : 'light' }),
      lGlucose: layerOn.lGlucose, lCarbs: layerOn.lCarbs, lInsulin: layerOn.lInsulin, lActivity: layerOn.lActivity,
      mTitle: M.title, mIcon: M.icon, mColor: M.color,
      mHeroLabel: M.hero[0], mHeroValue: M.hero[1], mHeroUnit: M.hero[2],
      mHeroArea: AREA_A, mHeroLine: LINE_A,
      mCards: M.cards.map((c, i) => ({ label: c[0], value: c[1], unit: c[2],
        area: i ? SM_AREA2 : SM_AREA, line: i ? SM_LINE2 : SM_LINE })),
      mStats: M.stats.map(s => ({ label: s[0], value: s[1], unit: s[2] })),
      tiles, nav,
    };
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new Component();
  window.__app = app;
  window.DC.mount(app, document.getElementById('tpl'), document.getElementById('root'));

  if (window.Store) window.Store.start();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
  }
});
