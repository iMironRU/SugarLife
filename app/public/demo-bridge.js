/* Демо-мост: приборы и облака напоказ, без железа и без сети (SugarLife#279).

   Нужен для одного — пройти путь целиком: увидеть слоты с несколькими источниками,
   переключить предпочтение, посмотреть цепочку через мост, зайти в облачные учётки.
   На настоящем телефоне это требует живого движка, а обсуждать интерфейс приходится
   сейчас.

   ВКЛЮЧАЕТСЯ ТОЛЬКО ЯВНО: ?демо=1 в адресе. Дальше держится в sessionStorage, чтобы
   переходы внутри приложения не сбрасывали его, и умирает вместе со вкладкой. Без
   параметра скрипт не делает ничего вовсе — ни в вебе, ни в нативе.

   Живёт вне бандла и на чистом JS по той же причине, что и сторож запуска: он должен
   встать ДО того, как приложение спросит мост. */
(function () {
  var КЛЮЧ = 'sl-демо';
  var хочет = /[?&](демо|demo)=1/.test(location.search);
  if (хочет) { try { sessionStorage.setItem(КЛЮЧ, '1'); } catch (e) { /* приватный режим */ } }
  var включено = хочет;
  try { включено = включено || sessionStorage.getItem(КЛЮЧ) === '1'; } catch (e) { /* ignore */ }
  if (!включено) return;

  var сейчас = Date.now();
  var подписчики = [];

  /* Два источника сахара — прибор и облако: ровно тот случай, ради которого слот и
     нужен. Помпа стоит за мостом, и её вторая связь молчит: так видно цепочку. */
  var сенсор = {
    id: 'ble-E2:38:B4:63:51:59', name: 'Sibionics GS1', kind: 'sensor', driverId: 'sibionics',
    requiresAccountId: 'acc-1',
    roles: ['GlucoseSource'], connection: 'Streaming', status: 'Live', live: true,
    capabilities: {}, settings: { parameters: [] },
    admittedInput: true, admittedOutput: false, testable: false,
    batteryPct: 74, nearbyAtMs: сейчас - 5000,
    channels: [{ id: 'c1', kind: 'direct', priority: 0, connection: 'Streaming', status: 'Live', live: true, latestAtMs: сейчас - 60000 }],
    activeChannel: 'c1',
  };
  var помпа = {
    id: 'medtronic-722:923109', name: 'Medtronic 722', kind: 'pump', driverId: 'medtronic',
    roles: ['PumpStateSource', 'DeliveryHistorySource'], connection: 'Disconnected', status: 'Disconnected',
    capabilities: {}, settings: { parameters: [{ key: 'serial', title: 'Серийный номер', type: 'Text', required: true, default: null, options: [], keyboard: 'numeric' }] },
    params: { serial: '923109' },
    admittedInput: true, admittedOutput: false, testable: false,
    behindBridgeId: 'bridge:E8:E6:C9:69:AB:6D', bridgeConnection: 'Disconnected',
    channels: [{ id: 'c2', kind: 'bridged', priority: 0, connection: 'Disconnected', status: 'Disconnected', live: false, latestAtMs: null }],
    activeChannel: 'c2',
  };
  var облакоПомпы = {
    id: 'ns-pump', name: 'Nightscout', kind: 'service', driverId: null,
    roles: ['PumpStateSource'], connection: 'Streaming', status: 'Delayed', live: false,
    capabilities: {}, settings: { parameters: [] },
    admittedInput: true, admittedOutput: false, testable: false,
    channels: [{ id: 'c3', kind: 'cloud', priority: 10, connection: 'Streaming', status: 'Delayed', live: false, latestAtMs: сейчас - 900000 }],
    activeChannel: 'c3',
  };
  var мост = {
    id: 'bridge:E8:E6:C9:69:AB:6D', name: 'OrangeLink (мост к помпе)', kind: 'bridge',
    connection: 'Disconnected', status: 'Disconnected', batteryPct: 60, firmware: '2.4',
  };

  /* Копии для восстановления: демо-ручки чистят списки, а вернуть их надо тем же
     содержимым, иначе «сПриборами» показывало бы не то, с чего начинали. */
  var железоДемо = null; var эфирДемо = null;

  var снимок = {
    bridgeRevision: '1.10',
    monitor: { glucose: '7,8', unit: 'ммоль/л', trend: '→', status: 'Live', link: 'Streaming', live: true,
      iob: '1,2', cob: '0', reservoir: '37 ед', battery: '62%', updatedAtMs: сейчас - 60000 },
    devices: [сенсор, помпа, облакоПомпы],
    hardware: [
      { id: сенсор.id, name: 'GS1-2E4F', model: 'Sibionics GS1', kind: 'sensor', connection: 'Streaming', status: 'Live', inSlot: 'cgm', batteryPct: 74, nearbyAtMs: сейчас - 5000 },
      { id: помпа.id, name: 'MMT-722', model: 'Medtronic 722', kind: 'pump', connection: 'Disconnected', status: 'Disconnected', inSlot: null, behindBridgeId: мост.id, bridgeConnection: 'Disconnected' },
      { id: мост.id, name: 'OrangeLink (мост к помпе)', kind: 'bridge', connection: 'Disconnected', status: 'Disconnected', batteryPct: 60, firmware: '2.4' },
    ],
    roles: [
      { role: 'cgm', activeSourceId: сенсор.id, via: 'direct', sourceIds: [сенсор.id] },
      { role: 'insulin', activeSourceId: облакоПомпы.id, via: 'cloud', serial: '923109', sourceIds: [помпа.id, облакоПомпы.id] },
    ],
    insights: null, pendingWrites: [], alerts: [],
    scanning: false,
    discovered: [
      { bleId: 'C1:22:33:44:55:66', name: 'Dexcom G7', displayName: 'Dexcom G7', driverId: 'dexcom',
        rssi: -68, needsMoreParams: false, isTransport: false, transportFor: [], knownDeviceId: null },
    ],
    availableDrivers: [
      /* Код сенсора — обязательный и без значения по умолчанию, как у драйвера ядра
         (SugarLife#349). Пока его в демо не было, мастер заводил сенсор одним тапом, и
         поломка «завели без кода — молчит навсегда» не воспроизводилась вовсе. */
      { id: 'sibionics', displayName: 'Sibionics', kind: 'sensor', roles: ['GlucoseSource'], available: true,
        settings: { parameters: [
          { key: 'sensorCode', title: 'Код сенсора', type: 'Text', required: true, default: null, options: [],
            scan: 'qr', hint: 'На упаковке сенсора, рядом с QR-кодом.' },
        ] } },
      /* Параметры — СЛОВО В СЛОВО как объявляет драйвер ядра (MedtronicDriver.parameterSpec).
         Списывать точно важнее, чем красиво: подсказки (hint) у этих двух полей нет, и
         демо не должно её выдумывать — иначе форма у нас выглядит понятнее, чем на
         телефоне, и разговор с ядром о недостающей подсказке не состоится (#344). */
      { id: 'medtronic', displayName: 'Medtronic', kind: 'pump', roles: ['PumpStateSource'], available: true,
        settings: { parameters: [
          { key: 'serial', title: 'Серийный номер помпы', type: 'Text', required: true, default: null, options: [], keyboard: 'numeric' },
          { key: 'region', title: 'Регион/частота', type: 'Enum', required: true, default: 'auto',
            options: ['auto', '868', '916'],
            optionTitles: { auto: 'авто · найдём сами (дольше)', '868': '868 МГц · Европа и мир', '916': '916 МГц · США и Канада' },
            hint: '«Авто» перебирает частоты и может занять пару минут при первом подключении.' },
        ] } },
      { id: 'orange', displayName: 'OrangeLink', kind: 'bridge', roles: [], settings: { parameters: [] }, available: true, providesTransportFor: ['medtronic'] },
    ],
    logging: null,
    /* Готовность к поиску и настроенность (мост 1.20, SugarLife#337). В демо ими можно
       управлять из консоли: window.демо.мешает('noPermission') и window.демо.готов().
       Ради этого демо и существует — пройти путь целиком, не имея под рукой чистого
       телефона с выключенной геолокацией. */
    scanReadiness: { canScan: true, blockers: [] },
    setup: { configured: true, sources: 2, receiving: true },
    availableCloudProviders: [
      { id: 'libre', displayName: 'LibreLinkUp', available: true, readOnly: true, hasSubjects: true,
        settings: { parameters: [
          { key: 'login', title: 'Почта', type: 'Text', required: true, default: null, options: [] },
          { key: 'password', title: 'Пароль', type: 'Secret', required: true, default: null, options: [] },
          { key: 'region', title: 'Регион', type: 'Enum', required: true, default: 'EU', options: ['EU', 'EU2', 'US', 'RU'] },
        ] } },
      { id: 'dexcom', displayName: 'Dexcom Share', available: false, settings: { parameters: [] } },
    ],
    accounts: [
      { id: 'acc-1', providerId: 'libre', displayName: 'demo@example.com', state: 'Error',
        problem: { code: 'cloud.auth.wrong-region', title: 'Не тот регион',
          remediation: 'Учётная запись в регионе EU2 — выберите его в списке.',
          severity: 'Error', category: 'Network', retryable: true },
        subjects: [
          { id: 's1', displayName: 'Я', kind: 'patient' },
          { id: 's2', displayName: 'Сын', kind: 'patient' },
        ], activeSubjectId: 's1' },
    ],
  };

  /* ЧИСТЫЙ ПЕРВЫЙ ЗАПУСК — телефон, на котором ещё ничего нет.

     Состояние, в которое своё приложение почти невозможно вернуть: чтобы увидеть мастер
     глазами, надо снести настройки, а на живом телефоне это стоит дорого. Оттого первый
     запуск и правят реже всего — а видит его каждый человек ровно один раз, и другого
     впечатления у него не будет.

     Приборов нет, показаний нет, в эфире вещают двое незнакомых. Разрешения не выданы:
     на Android так и есть при первом входе, и это то самое место, где решается, увидим
     ли мы эфир вообще. Включается window.демо.первыйЗапуск() — с перезагрузкой, потому
     что флаг «мастер пройден» приложение читает при старте. */
  var чистый = false;
  try { чистый = sessionStorage.getItem('sl-демо-первый') === '1'; } catch (e) { /* ignore */ }
  if (чистый) {
    снимок.monitor = { glucose: '—', unit: 'ммоль/л', trend: '', status: 'Disconnected', link: 'Disconnected',
      live: false, iob: '—', cob: '—', reservoir: '—', battery: '—', updatedAtMs: null };
    снимок.hardware = [];
    снимок.devices = [];
    снимок.roles = [];
    снимок.accounts = [];
    снимок.setup = { configured: false, sources: 0, receiving: false };
    снимок.scanReadiness = { canScan: false, blockers: ['noPermission'],
      reason: 'Приложению не разрешён поиск по блютусу',
      remediation: 'Разрешите поиск устройств поблизости — без этого система не покажет ни одного прибора',
      canAskAgain: true, settingsTarget: 'appSettings' };
    /* Всё в эфире — незнакомое. Своё железо мы только что стёрли, а на чистом телефоне
       знакомых и нет: сенсор соседа вещает ровно так же, как свой.

       Троих, а не одного, и намеренно разных: сенсор заводится одним тапом, мост ведёт
       к нескольким помпам и потому спрашивает — какую, а третий просто чужой. Мастер на
       одном приборе выглядит ровно и ничего не проверяет; ломается он там, где приборов
       несколько и они разные. */
    снимок.discovered = [
      { bleId: 'E2:38:B4:63:51:59', name: 'GS1-2E4F', displayName: 'Sibionics GS1', driverId: 'sibionics',
        rssi: -55, needsMoreParams: false, isTransport: false, transportFor: [], knownDeviceId: null },
      { bleId: 'E8:E6:C9:69:AB:6D', name: 'OrangeLink', displayName: 'OrangeLink (мост к помпе)', driverId: 'orange',
        rssi: -72, needsMoreParams: true, isTransport: true, transportFor: ['medtronic'], knownDeviceId: null },
    ].concat(снимок.discovered.map(function (d) {
      return Object.assign({}, d, { knownDeviceId: null });
    }));
  }

  /* Рассылаем КОПИЮ, а не тот же объект.

     React сравнивает снимки по ссылке: получив ту же самую, он справедливо решает, что
     ничего не изменилось, и не перерисовывает. Демо-ручки при этом «работали» —
     состояние в объекте менялось, — а экран оставался прежним, и выглядело это как
     сломанный интерфейс, хотя сломан был демо-мост. */
  железоДемо = снимок.hardware.slice();
  эфирДемо = снимок.discovered.slice();

  /* Журнал демо-моста. Отдельным массивом, а не в снимке: у настоящего движка записей
     тысячи, и снимок обязан оставаться маленьким. */
  var журнал = [];
  function записать(deviceId, level, event, fields, идент) {
    журнал.push({ atMs: Date.now(), level: level, deviceId: deviceId, tag: 'демо',
      event: event, fields: fields || null, hasIdentifiers: !!идент });
    if (журнал.length > 500) журнал = журнал.slice(-500);
  }
  (function затравка() {
    var сенсорId = снимок.hardware.filter(function (h) { return h.kind === 'sensor'; })[0];
    var id = сенсорId ? сенсорId.id : null;
    записать(id, 'Info', 'подключаюсь к прибору');
    записать(id, 'Debug', 'кадр отправлен', { длина: 12, канал: 'FF32' }, true);
    записать(id, 'Info', 'связь установлена');
    записать(id, 'Warn', 'ответа нет 5 с — повторяю запрос');
    записать(id, 'Info', 'показание получено', { 'ммоль/л': 7.8 });
  })();
  /* Тик: раз в несколько секунд что-нибудь происходит — иначе «живой обмен» на экране
     неотличим от замершего. */
  setInterval(function () {
    var с = снимок.hardware.filter(function (h) { return h.kind === 'sensor'; })[0];
    if (!с) return;
    записать(с.id, 'Info', 'показание получено', { 'ммоль/л': (6 + Math.round(Math.random() * 30) / 10).toFixed(1) });
  }, 5000);

  function разослать() {
    снимок = Object.assign({}, снимок);
    подписчики.forEach(function (cb) { cb(снимок); });
  }

  /* Ручки для проверки путей, которых иначе не достать.

     Состояния вроде «отказал насовсем» или «выключена служба геолокации» на своём
     телефоне не воспроизводятся без сброса настроек, а проверять их надо каждый раз,
     когда трогаем этот путь. Здесь они переключаются одной строкой в консоли. */
  var ПРИЧИНЫ = {
    noPermission: { reason: 'Нет разрешения на поиск устройств рядом',
      remediation: 'Разрешите приложению искать устройства поблизости', canAskAgain: true, settingsTarget: 'appSettings' },
    noPermissionForever: { blocker: 'noPermission', reason: 'Нет разрешения на поиск устройств рядом',
      remediation: 'Разрешение выключено насовсем — включите его в настройках приложения', canAskAgain: false, settingsTarget: 'appSettings' },
    bluetoothOff: { reason: 'Bluetooth выключен',
      remediation: 'Включите Bluetooth — без него приборы не слышно', canAskAgain: null, settingsTarget: 'bluetooth' },
    locationOff: { reason: 'Выключена служба геолокации',
      remediation: 'На этой версии Android без неё система не покажет ни одного устройства', canAskAgain: null, settingsTarget: 'location' },
  };
  window.демо = {
    мешает: function (код) {
      var п = ПРИЧИНЫ[код] || ПРИЧИНЫ.noPermission;
      снимок.scanReadiness = { canScan: false, blockers: [п.blocker || код],
        reason: п.reason, remediation: п.remediation, canAskAgain: п.canAskAgain, settingsTarget: п.settingsTarget };
      разослать(); return снимок.scanReadiness;
    },
    готов: function () { снимок.scanReadiness = { canScan: true, blockers: [] }; разослать(); return 'ок'; },
    неНастроено: function () { снимок.setup = { configured: false, sources: 0, receiving: false }; разослать(); return 'ок'; },
    настроено: function () { снимок.setup = { configured: true, sources: 2, receiving: true }; разослать(); return 'ок'; },
    /* Пустая лента — состояние первого запуска и состояние «всё забыли». Проверять его
       надо чаще, чем кажется: именно на пустом экране видно, объясняет ли приложение
       себя или молчит. */
    безПриборов: function () { снимок.hardware = []; снимок.discovered = []; разослать(); return 'ок'; },
    первыйЗапуск: function () {
      try { sessionStorage.setItem('sl-демо-первый', '1'); localStorage.removeItem('sl.onboarded.v1'); } catch (e) { /* ignore */ }
      location.reload(); return 'перезагружаюсь в чистый запуск';
    },
    какОбычно: function () {
      try { sessionStorage.removeItem('sl-демо-первый'); } catch (e) { /* ignore */ }
      location.reload(); return 'перезагружаюсь в обычное состояние';
    },
    /* Два состояния, ради которых заводили progress и NotConfigured (мост 1.22/1.24).
       Оба выглядели раньше одинаково — «устройство не отвечает», — и оба этим враньём и
       были: помпа в это время работает, а сенсор просто не спрошен. */
    подбирает: function () {
      снимок.hardware = снимок.hardware.map(function (h) {
        return h.kind === 'pump'
          ? Object.assign({}, h, { progress: 'Подбираю частоту помпы — это может занять пару минут' })
          : h;
      });
      разослать(); return 'помпа подбирает частоту';
    },
    неНастроен: function () {
      снимок.hardware = снимок.hardware.map(function (h) {
        return h.kind === 'sensor'
          ? Object.assign({}, h, { registryState: 'NotConfigured', note: 'Не хватает настроек: Код сенсора',
              connection: 'Disconnected', status: 'Disconnected' })
          : h;
      });
      /* И запись прибора — со спекой драйвера: форму рисуем по ней, а не по догадкам.
         Без этого «негде ввести код» не воспроизводится (SugarLife#362). */
      снимок.devices = снимок.devices.map(function (d) {
        return d.kind === 'sensor'
          ? Object.assign({}, d, { params: {}, settings: { parameters: [
              { key: 'sensorCode', title: 'Код сенсора', type: 'Text', required: true, default: null,
                options: [], scan: 'qr',
                hint: 'Код из QR на упаковке сенсора — отсканируйте камерой или введите вручную.' },
            ] } })
          : d;
      });
      разослать(); return 'сенсор без кода';
    },
    /* Источник «догоняет», а показание свежее — случай с телефона (#358): круг показывал
       часики при живом списке измерений. */
    догоняет: function () {
      снимок.monitor = Object.assign({}, снимок.monitor, {
        status: 'Acquiring', live: false,
        /* Число и его отметка времени — именно то, чего раньше не хватало: круг решал
           по статусу и не смотрел, есть ли вообще что показывать. */
        glucose: '6,2', glucoseMmol: 6.2,
        latestAtMs: Date.now() - 60000, updatedAtMs: Date.now() - 60000,
      });
      разослать(); return 'источник догоняет, показание минутной давности';
    },
    /* Тот же статус, но показание старое — часики обязаны остаться (SugarLifeCore#27:
       при подключении в круг лезет догрузка истории). */
    догоняетСтарое: function () {
      снимок.monitor = Object.assign({}, снимок.monitor, {
        status: 'Acquiring', live: false, glucose: '9,1', glucoseMmol: 9.1,
        latestAtMs: Date.now() - 40 * 60000, updatedAtMs: Date.now() - 40 * 60000,
      });
      разослать(); return 'источник догоняет, показание сорокаминутной давности';
    },
    сПриборами: function () { снимок.hardware = железоДемо.slice(); снимок.discovered = эфирДемо.slice(); разослать(); return 'ок'; },
  };

  window.SugarLifeBridge = {
    bridgeRevision: '1.10',
    subscribe: function (cb) {
      подписчики.push(cb); cb(снимок);
      return function () { подписчики = подписчики.filter(function (f) { return f !== cb; }); };
    },
    requestSnapshot: function () { return Promise.resolve(снимок); },
    /* Интенты не просто принимаются, а МЕНЯЮТ снимок: иначе «предпочесть» и
       «подключить» выглядели бы работающими, ничего не делая, — а именно это мы и
       пришли проверять. */
    sendIntent: function (i) {
      /* Скан в демо честный: startScan включает признак, stopScan гасит. Без этого
         подпись «Слушаю эфир» никогда не появлялась бы, и проверить её было бы нечем. */
      /* Добавление заводит прибор по-настоящему: он уходит из эфира и появляется своим.
         Без этого «Добавить» выглядело бы нажатием в пустоту — а именно этот переход и
         надо смотреть глазами. */
      if (i.type === 'addDiscovered') {
        var нашли = снимок.discovered.filter(function (d) { return d.bleId === i.bleId; })[0];
        if (нашли) {
          снимок.discovered = снимок.discovered.filter(function (d) { return d.bleId !== i.bleId; });
          var новыйId = 'ble-' + нашли.bleId;
          снимок.hardware = снимок.hardware.concat([{
            id: новыйId, name: нашли.displayName || нашли.name, model: нашли.displayName,
            kind: 'sensor', connection: 'Connecting', status: 'Connecting',
            inSlot: null, nearbyAtMs: Date.now(),
          }]);
          разослать();
          /* Заведённый прибор САМ идёт на связь, и через несколько секунд приходит первое
             показание. Так делает движок, и без этого демо врало в самом важном месте:
             только что заведённый сенсор навечно стоял «нет связи» с кнопкой
             «Подключить» — то есть первый запуск выглядел неудачным ровно тогда, когда
             всё прошло удачно. */
          setTimeout(function () {
            снимок.hardware = снимок.hardware.map(function (h) {
              return h.id === новыйId
                ? Object.assign({}, h, { connection: 'Streaming', status: 'Live', inSlot: 'cgm' })
                : h;
            });
            снимок.monitor = Object.assign({}, снимок.monitor, {
              glucose: '6,4', trend: '→', status: 'Live', link: 'Streaming', live: true,
              updatedAtMs: Date.now(),
            });
            /* Сводка настроенности идёт вместе с данными: движок считает её сам, и
               «не настроено» поверх первого же показания было бы его ошибкой, не
               нашей. Демо повторяет движок, а не удобное нам поведение. */
            снимок.setup = { configured: true, sources: 1, receiving: true };
            разослать();
          }, 4000);
        }
        return Promise.resolve({ accepted: true });
      }
      /* Разрешение в демо выдаётся: иначе железный путь обрывается на первой же кнопке
         и посмотреть, что будет дальше, нечем. Отказ проверяется ручкой демо.мешает(). */
      if (i.type === 'requestScanPermissions') {
        снимок.scanReadiness = { canScan: true, blockers: [] };
        снимок.scanning = true; разослать();
        return Promise.resolve({ accepted: true });
      }
      /* setParams в демо действительно записывает: у ядра он до сегодняшнего дня молча
         игнорировался (core#75), и повторять эту поломку у себя незачем. */
      if (i.type === 'setDeviceLogDetail') {
        снимок.hardware = снимок.hardware.map(function (h) {
          return h.id === i.deviceId
            ? Object.assign({}, h, { logDetailUntilMs: i.detailed ? Date.now() + 15 * 60000 : null })
            : h;
        });
        записать(i.deviceId, 'Info', i.detailed ? 'включён подробный обмен на 15 минут' : 'подробный обмен выключен');
        разослать();
        return Promise.resolve({ accepted: true });
      }
      if (i.type === 'setParams') {
        снимок.devices = снимок.devices.map(function (d) {
          return d.id === i.deviceId
            ? Object.assign({}, d, { params: Object.assign({}, d.params, i.params) })
            : d;
        });
        var хватает = Object.keys(i.params || {}).some(function (k) { return (i.params[k] || '').trim(); });
        if (хватает) {
          снимок.hardware = снимок.hardware.map(function (h) {
            return h.id === i.deviceId
              ? Object.assign({}, h, { registryState: 'Configured', note: null })
              : h;
          });
        }
        разослать();
        return Promise.resolve({ accepted: true });
      }
      if (i.type === 'startScan') { снимок.scanning = true; разослать(); }
      if (i.type === 'stopScan') { снимок.scanning = false; разослать(); }
      if (i.type === 'setPrimarySource') {
        снимок.roles = снимок.roles.map(function (r) {
          var свои = r.sourceIds || [];
          if (свои.indexOf(i.sourceId) < 0) return r;
          var новый = снимок.devices.filter(function (d) { return d.id === i.sourceId; })[0];
          return Object.assign({}, r, {
            activeSourceId: i.sourceId,
            via: новый && новый.channels && новый.channels[0] ? новый.channels[0].kind : r.via,
          });
        });
      }
      if (i.type === 'connect' || i.type === 'disconnect') {
        var живой = i.type === 'connect';
        снимок.hardware = снимок.hardware.map(function (h) {
          return h.id === i.deviceId
            ? Object.assign({}, h, { connection: живой ? 'Connected' : 'Disconnected', status: живой ? 'Live' : 'Disconnected' })
            : h;
        });
        снимок.devices = снимок.devices.map(function (d) {
          return d.id === i.deviceId
            ? Object.assign({}, d, { connection: живой ? 'Streaming' : 'Disconnected', status: живой ? 'Live' : 'Disconnected' })
            : d;
        });
      }
      if (i.type === 'selectAccountSubject') {
        снимок.accounts = снимок.accounts.map(function (a) {
          return a.id === i.accountId ? Object.assign({}, a, { activeSubjectId: i.subjectId }) : a;
        });
      }
      снимок = Object.assign({}, снимок);
      разослать();
      return Promise.resolve({ accepted: true });
    },
    query: function () { return Promise.resolve({ entries: [], treatments: [] }); },

    /* Журнал обмена (мост 1.25, SugarLife#354). Пишем сюда по-настоящему: без живой ленты
       экран нечем проверить, а именно лента и есть весь его смысл — что приложение
       говорит прибору и что слышит в ответ.

       Записи копятся от каждого интента и сами тикают, чтобы было видно движение. */
    logQuery: function (q) {
      var из = журнал.filter(function (з) {
        if (q && q.deviceId && з.deviceId !== q.deviceId) return false;
        if (q && q.sinceMs && з.atMs < q.sinceMs) return false;
        return true;
      });
      var лимит = (q && q.limit) || 200;
      return Promise.resolve({ records: из.slice(-лимит), truncated: из.length > лимит });
    },
  };
})();
