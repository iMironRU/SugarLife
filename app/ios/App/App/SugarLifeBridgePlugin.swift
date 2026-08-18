import Foundation
import Capacitor
import CoreBluetooth
import UIKit
import SugarLifeKit

/// Нативная сторона моста: держит KMP-движок (SugarLifeEngine) + реальные драйверы через колбэк-мосты
/// BLE (поверх CoreBluetooth, логика из проверенного спайка) + нативный скан эфира. Домен/протоколы — в KMP.

// MARK: - Interop (Data ↔ KotlinByteArray)

extension Data {
    func toKotlin() -> KotlinByteArray {
        let arr = KotlinByteArray(size: Int32(count))
        for (i, b) in enumerated() { arr.set(index: Int32(i), value: Int8(bitPattern: b)) }
        return arr
    }
}
extension KotlinByteArray {
    func toData() -> Data {
        var d = Data(count: Int(size))
        for i in 0..<Int(size) { d[i] = UInt8(bitPattern: get(index: Int32(i))) }
        return d
    }
}
private func kmpNow() -> KotlinLong { KotlinLong(longLong: Int64(Date().timeIntervalSince1970 * 1000)) }

// MARK: - Один общий CBCentralManager на приложение (iOS-идиома «один central на процесс»)

/// core#20: раньше КАЖДЫЙ BleLink поднимал свой CBCentralManager. Если для одного устройства когда-либо
/// сосуществовали два линка (пере-добавление, гонка resume, ре-паринг), у каждого central своя ссылка на
/// соединение, а CoreBluetooth держит peripheral подключённым, ПОКА ЖИВ ХОТЬ ОДИН central → cancel на одном
/// не рвал, освобождало только закрытие приложения (сносит все центральные). Один общий central = одна ссылка
/// на соединение → disconnect всегда реально освобождает. Он же скан (didDiscover) — один владелец эфира.
final class SharedCentral: NSObject, CBCentralManagerDelegate {
    static let shared = SharedCentral()
    private var central: CBCentralManager!
    private var links: [UUID: BleLink] = [:]     // peripheral UUID → линк (маршрут коннект-колбэков)
    private var pending: [UUID] = []             // connect до poweredOn — отложить
    private var wantScan = false
    var scanHandler: ((CBPeripheral, [String: Any], NSNumber) -> Void)?
    /// Кому сказать, что состояние Bluetooth изменилось (core#61, SugarLife#331): выключили адаптер,
    /// отказали в доступе. Без этого «Пока никого» означает одновременно «прибора нет» и «нам не дали искать».
    var readinessHandler: (() -> Void)?

    /// Можем ли слушать эфир прямо сейчас. `nil` — CoreBluetooth ещё не определился (состояние .unknown):
    /// врать «нельзя» в этот момент нельзя, это нормальная фаза запуска.
    var bluetoothOn: Bool? {
        switch central.state {
        case .poweredOn: return true
        case .unknown, .resetting: return nil
        default: return false
        }
    }
    /// Дал ли человек доступ к Bluetooth. На iOS отказ выглядит как «ничего не находится» — молча.
    var authorized: Bool {
        if #available(iOS 13.1, *) { return CBCentralManager.authorization == .allowedAlways }
        return true
    }

    override init() { super.init(); central = CBCentralManager(delegate: self, queue: nil) }

    func register(_ link: BleLink, for uuid: UUID) { links[uuid] = link }
    // Снимаем маршрут только если он всё ещё НАШ: иначе disconnect старого линка стёр бы маршрут нового.
    func unregister(_ uuid: UUID, _ link: BleLink) { if links[uuid] === link { links.removeValue(forKey: uuid) } }

    func connect(_ uuid: UUID) {
        guard central.state == .poweredOn else { if !pending.contains(uuid) { pending.append(uuid) }; return }
        if let p = central.retrievePeripherals(withIdentifiers: [uuid]).first {
            links[uuid]?.bind(p); central.connect(p, options: nil)
        }
    }
    func cancel(_ p: CBPeripheral) { central.cancelPeripheralConnection(p) }

    func startScan() { wantScan = true; if central.state == .poweredOn { central.scanForPeripherals(withServices: nil) } }
    func stopScan() { wantScan = false; central.stopScan() }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        readinessHandler?()   // выключили/включили Bluetooth или ответили на запрос доступа — сказать движку
        guard c.state == .poweredOn else { return }
        let p = pending; pending = []; p.forEach { connect($0) }
        if wantScan { c.scanForPeripherals(withServices: nil) }
    }
    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) { links[p.identifier]?.didConnect(p) }
    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) { links[p.identifier]?.didDisconnect() }
    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { links[p.identifier]?.didFail() }
    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        scanHandler?(p, advertisementData, RSSI)
    }
}

// MARK: - Линк к одному peripheral (соединение — через общий central; peripheral-делегат — здесь)

final class BleLink: NSObject, CBPeripheralDelegate {
    private let bleIdStr: String        // исходный bleId (issue #38): по нему движок проецирует телеметрию
    private let peripheralUUID: UUID
    private let serviceUUID: CBUUID
    private let charUUIDs: [CBUUID]
    private var peripheral: CBPeripheral?
    private var chars: [CBUUID: CBCharacteristic] = [:]
    private var notifyHandlers: [CBUUID: (Data) -> Void] = [:]
    private var readHandlers: [CBUUID: (Data?) -> Void] = [:]
    var onState: ((String) -> Void)?

    init(bleId: String, service: CBUUID, characteristics: [CBUUID]) {
        self.bleIdStr = bleId
        self.peripheralUUID = UUID(uuidString: bleId) ?? UUID()
        self.serviceUUID = service
        self.charUUIDs = characteristics
        super.init()
        SharedCentral.shared.register(self, for: peripheralUUID)
    }

    // Телеметрия периферала (issue #38): частичная эмиссия — null-поле движок не затирает.
    private func emitTelemetry(battery: Int? = nil, firmware: String? = nil, rssi: Int? = nil) {
        var parts = ["\"bleId\":\"\(bleIdStr)\""]
        if let b = battery { parts.append("\"batteryPct\":\(b)") }
        if let f = firmware { parts.append("\"firmware\":\"\(f.replacingOccurrences(of: "\"", with: ""))\"") }
        if let r = rssi { parts.append("\"rssi\":\(r)") }
        telemetrySink?("{\(parts.joined(separator: ","))}")
    }
    private func readTelemetry(_ p: CBPeripheral) {   // заряд/прошивка, если периферал их отдаёт
        if let c = chars[batteryChar] { p.readValue(for: c) }
        if let c = chars[firmwareChar] { p.readValue(for: c) }
    }

    // Перерегистрируемся при каждом connect: reconnect-петля драйвера делает disconnect()→connect() на том же
    // линке, а disconnect() снимает маршрут — без этого повторный коннект не встал бы.
    func connectNow() {
        SharedCentral.shared.register(self, for: peripheralUUID); SharedCentral.shared.connect(peripheralUUID)
        сторожDiscovery?.cancel()
        let r = DispatchWorkItem { [weak self] in
            NSLog("SugarLifeBLE: discovery не завершился за 15с — отложенные команды пойдут своим отказом")
            self?.отпуститьОтложенные(всё: true, причина: "сдались ждать discovery")
        }
        сторожDiscovery = r
        DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: r)
    }
    func disconnect() {
        сторожDiscovery?.cancel(); сторожDiscovery = nil
        // Отложенное отпускаем: иначе чтение, начатое до разрыва, не ответит никогда.
        отпуститьОтложенные(всё: true, причина: "разрыв связи")
        if let p = peripheral { SharedCentral.shared.cancel(p) }
        SharedCentral.shared.unregister(peripheralUUID, self)   // линк отпущен — снять маршрут (и дать ARC освободить)
    }
    func subscribe(_ char: CBUUID, handler: @escaping (Data) -> Void) { notifyHandlers[char] = handler }

    /* Операции ждут discovery, а отказ не пропадает молча (SugarLife#347, #348).

       Зеркало Android, где это поймали на живом железе: между «подключились» и «нашли
       характеристики» проходят миллисекунды, и первая команда ядра успевает уйти в
       пустой `chars`. Она молча выбрасывалась, драйвер уходил на бэкофф и попадал в ту же
       щель снова — бесконечно, при исправном приборе.

       Ждём ПОКАЖДОЙ характеристике отдельно: на iOS discovery приходит по одному сервису
       за раз, и «готово» вообще не единый момент. Не дождались за срок — операция уходит
       своим обычным отказом, а не висит: бесконечное ожидание мы уже чинили в #344. */
    private var отложенные: [(CBUUID, () -> Void)] = []
    private var сторожDiscovery: DispatchWorkItem?

    private func приГотовности(_ char: CBUUID, _ op: @escaping () -> Void) {
        if chars[char] != nil { op(); return }
        отложенные.append((char, op))
    }
    private func отпуститьОтложенные(всё: Bool, причина: String) {
        let были = отложенные
        отложенные = всё ? [] : были.filter { chars[$0.0] == nil }
        let идут = были.filter { всё || chars[$0.0] != nil }
        if !идут.isEmpty { NSLog("SugarLifeBLE: отпускаю \(идут.count) отложенных операций (\(причина))") }
        идут.forEach { $0.1() }
    }

    func write(_ data: Data, to char: CBUUID) {
        приГотовности(char) { [weak self] in
            guard let self else { return }
            guard let p = self.peripheral else {
                NSLog("SugarLifeBLE: запись \(char) отброшена: нет соединения"); return
            }
            guard let c = self.chars[char] else {
                NSLog("SugarLifeBLE: запись \(char) отброшена: у прибора нет такой характеристики; есть: \(self.chars.keys.map { $0.uuidString }.joined(separator: ", "))")
                return
            }
            p.writeValue(data, for: c, type: c.properties.contains(.write) ? .withResponse : .withoutResponse)
        }
    }
    func read(_ char: CBUUID, completion: @escaping (Data?) -> Void) {
        приГотовности(char) { [weak self] in
            guard let self, let p = self.peripheral, let c = self.chars[char] else {
                NSLog("SugarLifeBLE: чтение \(char) отброшено: нет соединения или характеристики")
                completion(nil); return
            }
            self.readHandlers[char] = completion; p.readValue(for: c)
        }
    }

    // Колбэки соединения приходят из общего central, маршрутизированные по peripheral.
    func bind(_ p: CBPeripheral) { peripheral = p; p.delegate = self }
    func didConnect(_ p: CBPeripheral) { onState?("Connected"); p.readRSSI(); p.discoverServices(nil) }  // rssi (issue #38) + все сервисы: MAC 0x2A25 в 0x180A, не в FF30
    func didDisconnect() { onState?("Disconnected") }
    func didFail() { onState?("Error") }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        // discover наши характеристики в КАЖДОМ сервисе (FF31/FF32 в FF30, MAC 0x2A25 в 0x180A)
        for s in p.services ?? [] { p.discoverCharacteristics(charUUIDs, for: s) }
    }
    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for ch in s.characteristics ?? [] {
            chars[ch.uuid] = ch
            if notifyHandlers[ch.uuid] != nil { p.setNotifyValue(true, for: ch) }
        }
        // ЧТО у прибора есть — одной строкой на сервис (#347): для незнакомого моста это
        // главный вопрос первых пяти минут, и догадку такой список превращает в факт.
        NSLog("SugarLifeBLE: сервис \(s.uuid.uuidString): \((s.characteristics ?? []).map { $0.uuid.uuidString }.joined(separator: ", "))")
        отпуститьОтложенные(всё: false, причина: "нашлись характеристики")
        readTelemetry(p)   // заряд/прошивка, если сервис их принёс (issue #38)
        onState?("Streaming")
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let v = ch.value else { return }
        // Телеметрия (issue #38): заряд 0x2A19 (uint8 %), прошивка 0x2A26 (строка).
        if ch.uuid == batteryChar, let b = v.first { emitTelemetry(battery: Int(b)); return }
        if ch.uuid == firmwareChar, let s = String(data: v, encoding: .utf8) { emitTelemetry(firmware: s); return }
        if let h = notifyHandlers[ch.uuid] { h(v) }
        if let r = readHandlers.removeValue(forKey: ch.uuid) { r(v) }
    }
    func peripheral(_ p: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        if error == nil { emitTelemetry(rssi: RSSI.intValue) }   // близость периферала (issue #38)
    }
}

// MARK: - Мосты

private let sibService = CBUUID(string: "FF30")
private let sibNotify  = CBUUID(string: "FF31")
private let sibWrite   = CBUUID(string: "FF32")
private let macChar    = CBUUID(string: "2A25")
private let macCharAlt  = CBUUID(string: "2ABE")   // вендор-характеристика MAC (как в Juggluco) — фолбэк
// Телеметрия периферала (issue #38): заряд Battery Service 0x180F, прошивка DIS 0x180A, rssi.
private let batteryChar  = CBUUID(string: "2A19")
private let firmwareChar = CBUUID(string: "2A26")
// Сток телеметрии натив→движок: плагин ставит engine.submitTelemetry; BleLink зовёт с json {bleId,batteryPct?,firmware?,rssi?}.
var telemetrySink: ((String) -> Void)?

final class SensorBridge: SensorTransportBridge {
    private let link: BleLink
    private var onDataCb: ((KotlinByteArray) -> Void)?
    init(bleId: String) { link = BleLink(bleId: bleId, service: sibService, characteristics: [sibNotify, sibWrite, macChar, macCharAlt, batteryChar, firmwareChar]) }
    func onLink(callback: @escaping (String) -> Void) { link.onState = callback }
    func onData(callback: @escaping (KotlinByteArray) -> Void) {
        onDataCb = callback
        link.subscribe(sibNotify) { [weak self] d in self?.onDataCb?(d.toKotlin()) }
    }
    func connect() { link.connectNow() }
    func readMac(callback: @escaping (KotlinByteArray?) -> Void) {
        // 0x2A25 (сервис 0x180A) открывается чуть позже FF30 → retry ~6с; фолбэк на вендор 2ABE (как Juggluco).
        attemptMac(tries: 12, callback: callback)
    }
    private func attemptMac(tries: Int, callback: @escaping (KotlinByteArray?) -> Void) {
        link.read(macChar) { d1 in
            if let d = d1, d.count == 6 { NSLog("SIB-swift: MAC 2A25 ok"); callback(Data(d.reversed()).toKotlin()); return }
            self.link.read(macCharAlt) { d2 in
                if let d = d2, d.count == 6 { NSLog("SIB-swift: MAC 2ABE ok"); callback(Data(d.reversed()).toKotlin()); return }
                if tries > 1 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.attemptMac(tries: tries - 1, callback: callback) }
                } else {
                    NSLog("SIB-swift: MAC не прочитался (2A25/2ABE нет)"); callback(nil)
                }
            }
        }
    }
    func write(bytes: KotlinByteArray) { link.write(bytes.toData(), to: sibWrite) }
    func disconnect() { link.disconnect() }
}

private let rlService   = CBUUID(string: "0235733B-99C5-4197-B856-69219C2A3845")
private let rlData      = CBUUID(string: "C842E849-5028-42E2-867C-016ADADA9155")
private let rlRespCount = CBUUID(string: "6E6C7910-B89E-43A5-A0FE-50C5E2B81F4A")

final class PumpBridge: PumpTransportBridge {
    /* Запас на транспорт (SugarLifeCore#80). У CoreBluetooth задержки предсказуемее, чем у
       Android: ориентир rileylink_ios — две секунды, его и берём. Не «как на Android, но
       поменьше»: число должно быть тем, что измерили на этой платформе. */
    let bleLatencyMs: Int64 = 2000

    private let link: BleLink
    private var pending: ((KotlinByteArray) -> Void)?
    private var срок: DispatchWorkItem?
    init(bleId: String) { link = BleLink(bleId: bleId, service: rlService, characteristics: [rlData, rlRespCount, batteryChar, firmwareChar]) }
    func onLink(callback: @escaping (String) -> Void) { link.onState = callback }

    /* Ровно один ответ на команду — и он есть всегда (SugarLife#344). Зеркало Android;
       поймали на Android, но код здесь был тот же, и повисло бы так же.

       Пустой массив, а не 0xAA: у колбэка нет канала ошибки, пустой разбирается ядром как
       «ответа нет», а 0xAA значит «мост ответил, что помпа промолчала» — другая поломка. */
    private func завершить(_ данные: Data) {
        срок?.cancel(); срок = nil
        guard let cb = pending else { return }
        pending = nil
        cb(данные.toKotlin())
    }

    func connect() {
        link.subscribe(rlRespCount) { [weak self] _ in
            self?.link.read(rlData) { data in self?.завершить(data ?? Data()) }
        }
        link.connectNow()
    }
    func command(bytes: KotlinByteArray, timeoutMs: Int64, callback: @escaping (KotlinByteArray) -> Void) {
        завершить(Data())          // предыдущая команда не теряется молча
        pending = callback
        if timeoutMs > 0 {
            let r = DispatchWorkItem { [weak self] in
                NSLog("SugarLifeBLE: мост молчит \(timeoutMs)мс — отвечаем «нет ответа»")
                self?.завершить(Data())
            }
            срок = r
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(Int(timeoutMs)), execute: r)
        }
        link.write(bytes.toData(), to: rlData)
    }
    func disconnect() { завершить(Data()); link.disconnect() }
}

// MARK: - Скан эфира → engine.submitAdvertisement

final class SugarLifeScanner {
    private let onAdvertisement: (String) -> Void
    // Скан БЕЗ фильтра сервисов (как Android): iOS scanForPeripherals(withServices:[FF30]) отсекает сенсоры,
    // которые не кладут FF30 в основной advertisement (Sibionics не виден). Распознавание — в ядре по каталогу.
    // Central — общий (SharedCentral): скан и коннекты не конкурируют за отдельные центральные (core#20).
    init(onAdvertisement: @escaping (String) -> Void) {
        self.onAdvertisement = onAdvertisement
        SharedCentral.shared.scanHandler = { [onAdvertisement] p, adv, RSSI in
            let services = (adv[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
            let dto: [String: Any] = ["bleId": p.identifier.uuidString, "name": p.name as Any, "serviceUuids": services, "rssi": RSSI.intValue]
            if let data = try? JSONSerialization.data(withJSONObject: dto), let json = String(data: data, encoding: .utf8) {
                onAdvertisement(json)
            }
        }
    }
    func start() { SharedCentral.shared.startScan() }
    func stop() { SharedCentral.shared.stopScan() }
}

// MARK: - Capacitor-плагин

@objc(SugarLifeBridgePlugin)
public class SugarLifeBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SugarLifeBridgePlugin"
    public let jsName = "SugarLifeBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendIntent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
        /* Без строки здесь метода для JS не существует, даже если он написан: Capacitor
           отдаёт вебвью ровно то, что перечислено. Забыть её — получить «not implemented»
           у работающего кода. */
        CAPPluginMethod(name: "logQuery", returnType: CAPPluginReturnPromise),
    ]

    // Движок создаём ОТЛОЖЕННО — на следующем тике main-цикла (в load() через async), а не в property-init
    // и не синхронно в load(). Инициализация KMP-графа на главном потоке ВО ВРЕМЯ синхронной фазы Capacitor
    // load() дедлочит (K/N-рантайм ↔ WKWebView) → webview/JS не стартует. На реальном устройстве это стабильно.
    // Отложив за пределы фазы load(), получаем максимум кратковременную заминку, а не вечный сплэш.
    // Провайдер реальных драйверов цепляем ещё позже — по первому «Подключить»/скану (attachDriverProvider).
    private var engine: SugarLifeEngine?
    private lazy var scanner = SugarLifeScanner { [weak self] json in _ = self?.engine?.submitAdvertisement(json: json) }
    private var unsubscribe: (() -> Void)?
    private var providerAttached = false

    private static let emptySnapshot =
        "{\"bridgeRevision\":\"1.6\",\"monitor\":{\"glucose\":\"—\",\"glucoseMmol\":null,\"trend\":\"—\"," +
        "\"link\":\"Disconnected\",\"reservoir\":\"—\",\"battery\":\"—\",\"confirmedIOB\":0,\"assumedIOB\":0," +
        "\"conservativeIOB\":0},\"devices\":[],\"availableDrivers\":[]}"

    override public func load() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            // Персист-БД (нативный SQLite) → история переживает перезапуск. Фабрику собирает Swift (экспорт :persistence).
            /* Конструктор движка — три аргумента, и это теперь правило, а не совпадение
               (SugarLife#292). Kotlin/Native не переносит в Swift значения по умолчанию,
               поэтому ЛЮБОЙ новый параметр конструктора молча ломает сборку оболочки, и
               сборка ядра этого не ловит — плагин живёт у нас. Настройки движка ядро
               теперь добавляет свойствами; таймаут квитанции (writeTimeoutMs) стал одним
               из них и здесь не называется вовсе — значение живёт в ядре в единственном
               экземпляре. */
            let e = SugarLifeEngine(driverProvider: nil, withSimulators: false,
                                    dbDriverFactory: DatabaseDriverFactory())
            // Предпосылки скана (core#61, SugarLife#331): знает только платформа, показать обязан интерфейс —
            // значит факт идёт через движок. На iOS геолокация к скану отношения не имеет, поле не шлём вовсе.
            let reportReadiness = { [weak e] in
                guard let e = e else { return }
                let bt = SharedCentral.shared.bluetoothOn
                var json = "{\"permissionsGranted\":\(SharedCentral.shared.authorized)"
                if let bt = bt { json += ",\"bluetoothOn\":\(bt)" }
                json += "}"
                NSLog("SugarLife: scan readiness \(json)")
                _ = e.submitScanReadiness(json: json)
            }
            SharedCentral.shared.readinessHandler = reportReadiness
            reportReadiness()
            self.engine = e
            telemetrySink = { [weak self] json in _ = self?.engine?.submitTelemetry(json: json) }   // натив→движок телеметрия (issue #38)
            self.unsubscribe = e.subscribe(onSnapshot: { [weak self] json in
                DispatchQueue.main.async { self?.notifyListeners("snapshot", data: ["json": json]) }
            })
            e.startAsync()
            // Boot-реконнект BLE: если доступ к Bluetooth уже выдан — цепляем провайдер сразу, движок
            // переподнимет сохранённые сенсор/помпу из БД (без ожидания скана). notDetermined — отложим
            // до первого скана (не показываем системный запрос на старте; restore сработает при первом attach).
            if CBManager.authorization == .allowedAlways { self.ensureProvider() }
        }
    }
    deinit { unsubscribe?(); engine?.stop() }

    /// Подцепить провайдер реальных драйверов — по первому скану/добавлению (создаём на фоне, цепляем на main).
    private func ensureProvider() {
        guard !providerAttached, engine != nil else { return }
        providerAttached = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let provider = DefaultDriverProvider(
                nowMs: { kmpNow() },
                sensorBridge: { bleId, _ in SensorBridge(bleId: bleId) },
                pumpBridge: { bleId, _ in PumpBridge(bleId: bleId) }
            )
            DispatchQueue.main.async { self?.engine?.attachDriverProvider(provider: provider) }
        }
    }

    @objc func requestSnapshot(_ call: CAPPluginCall) { call.resolve(["json": engine?.requestSnapshot() ?? Self.emptySnapshot]) }

    @objc func sendIntent(_ call: CAPPluginCall) {
        let json = call.getString("json") ?? ""
        // Экспорт лога перехватываем ДО движка (как Android): редактированный NDJSON → share sheet ОС.
        if json.contains("\"exportLog\"") { exportAndShare(); return call.resolve(["json": "{\"accepted\":true}"]) }
        if json.contains("\"startScan\"") { ensureProvider(); scanner.start() }
        else if json.contains("\"stopScan\"") { scanner.stop() }
        else if json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") { ensureProvider() }
        call.resolve(["json": engine?.sendIntent(json: json) ?? "{\"accepted\":false,\"error\":\"engine not ready\"}"])
    }

    /// Экспорт диагностического лога (редактированный NDJSON из движка) → UIActivityViewController
    /// (Telegram/почта/Файлы). Зеркало Android exportAndShare — механизм сбора телеметрии от волонтёров.
    private func exportAndShare() {
        guard let ndjson = engine?.exportLog() else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("sugarlife-log.ndjson")
        do { try ndjson.write(to: url, atomically: true, encoding: .utf8) } catch { return }
        DispatchQueue.main.async { [weak self] in
            guard let vc = self?.bridge?.viewController else { return }
            let av = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // iPad: share sheet — popover, нужен якорь (иначе краш).
            av.popoverPresentationController?.sourceView = vc.view
            av.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            av.popoverPresentationController?.permittedArrowDirections = []
            vc.present(av, animated: true)
        }
    }

    @objc func query(_ call: CAPPluginCall) { call.resolve(["json": engine?.query(json: call.getString("json") ?? "") ?? "{\"glucose\":[],\"treatments\":[]}"]) }

    /* Журнал обмена по приборам (мост 1.25, SugarLife#354) — зеркало Android.

       Отдельным методом, а не полем снимка: записей тысячи, а снимок уходит в вебвью
       целиком и каждые несколько секунд. Движка нет — отвечаем ПУСТЫМ списком, а не
       отказом: отказ у нас означает «эта сборка журнала не ведёт», и путать «движок ещё
       не поднялся» с «метода не существует» нельзя. */
    @objc func logQuery(_ call: CAPPluginCall) {
        call.resolve(["json": engine?.logQuery(json: call.getString("json") ?? "{}") ?? "{\"records\":[]}"])
    }
}
