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
    private let peripheralUUID: UUID
    private let serviceUUID: CBUUID
    private let charUUIDs: [CBUUID]
    private var peripheral: CBPeripheral?
    private var chars: [CBUUID: CBCharacteristic] = [:]
    private var notifyHandlers: [CBUUID: (Data) -> Void] = [:]
    private var readHandlers: [CBUUID: (Data?) -> Void] = [:]
    var onState: ((String) -> Void)?

    init(bleId: String, service: CBUUID, characteristics: [CBUUID]) {
        self.peripheralUUID = UUID(uuidString: bleId) ?? UUID()
        self.serviceUUID = service
        self.charUUIDs = characteristics
        super.init()
        SharedCentral.shared.register(self, for: peripheralUUID)
    }

    // Перерегистрируемся при каждом connect: reconnect-петля драйвера делает disconnect()→connect() на том же
    // линке, а disconnect() снимает маршрут — без этого повторный коннект не встал бы.
    func connectNow() { SharedCentral.shared.register(self, for: peripheralUUID); SharedCentral.shared.connect(peripheralUUID) }
    func disconnect() {
        if let p = peripheral { SharedCentral.shared.cancel(p) }
        SharedCentral.shared.unregister(peripheralUUID, self)   // линк отпущен — снять маршрут (и дать ARC освободить)
    }
    func subscribe(_ char: CBUUID, handler: @escaping (Data) -> Void) { notifyHandlers[char] = handler }
    func write(_ data: Data, to char: CBUUID) {
        guard let p = peripheral, let c = chars[char] else { return }
        p.writeValue(data, for: c, type: c.properties.contains(.write) ? .withResponse : .withoutResponse)
    }
    func read(_ char: CBUUID, completion: @escaping (Data?) -> Void) {
        guard let p = peripheral, let c = chars[char] else { completion(nil); return }
        readHandlers[char] = completion; p.readValue(for: c)
    }

    // Колбэки соединения приходят из общего central, маршрутизированные по peripheral.
    func bind(_ p: CBPeripheral) { peripheral = p; p.delegate = self }
    func didConnect(_ p: CBPeripheral) { onState?("Connected"); p.discoverServices(nil) }  // все сервисы: MAC 0x2A25 в 0x180A, не в FF30
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
        onState?("Streaming")
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let v = ch.value else { return }
        if let h = notifyHandlers[ch.uuid] { h(v) }
        if let r = readHandlers.removeValue(forKey: ch.uuid) { r(v) }
    }
}

// MARK: - Мосты

private let sibService = CBUUID(string: "FF30")
private let sibNotify  = CBUUID(string: "FF31")
private let sibWrite   = CBUUID(string: "FF32")
private let macChar    = CBUUID(string: "2A25")
private let macCharAlt  = CBUUID(string: "2ABE")   // вендор-характеристика MAC (как в Juggluco) — фолбэк

final class SensorBridge: SensorTransportBridge {
    private let link: BleLink
    private var onDataCb: ((KotlinByteArray) -> Void)?
    init(bleId: String) { link = BleLink(bleId: bleId, service: sibService, characteristics: [sibNotify, sibWrite, macChar, macCharAlt]) }
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
    private let link: BleLink
    private var pending: ((KotlinByteArray) -> Void)?
    init(bleId: String) { link = BleLink(bleId: bleId, service: rlService, characteristics: [rlData, rlRespCount]) }
    func onLink(callback: @escaping (String) -> Void) { link.onState = callback }
    func connect() {
        link.subscribe(rlRespCount) { [weak self] _ in
            self?.link.read(rlData) { data in
                if let d = data, let cb = self?.pending { self?.pending = nil; cb(d.toKotlin()) }
            }
        }
        link.connectNow()
    }
    func command(bytes: KotlinByteArray, timeoutMs: Int64, callback: @escaping (KotlinByteArray) -> Void) {
        pending = callback
        link.write(bytes.toData(), to: rlData)
    }
    func disconnect() { link.disconnect() }
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
            self.engine = e
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
}
