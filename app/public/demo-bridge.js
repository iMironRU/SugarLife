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
      { id: 'sibionics', displayName: 'Sibionics', kind: 'sensor', roles: ['GlucoseSource'], settings: { parameters: [] }, available: true },
      { id: 'medtronic', displayName: 'Medtronic', kind: 'pump', roles: ['PumpStateSource'], settings: { parameters: [] }, available: true },
      { id: 'orange', displayName: 'OrangeLink', kind: 'bridge', roles: [], settings: { parameters: [] }, available: true, providesTransportFor: ['medtronic'] },
    ],
    logging: null,
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

  function разослать() { подписчики.forEach(function (cb) { cb(снимок); }); }

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
  };
})();
