import Foundation
import Capacitor
import CoreBluetooth
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

// MARK: - Обобщённый линк к одному peripheral (peripheral по UUID через retrievePeripherals)

final class BleLink: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private let peripheralUUID: UUID
    private let serviceUUID: CBUUID
    private let charUUIDs: [CBUUID]
    private var central: CBCentralManager!
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
        central = CBCentralManager(delegate: self, queue: nil)
    }

    func connectNow() {
        if let p = central.retrievePeripherals(withIdentifiers: [peripheralUUID]).first {
            peripheral = p; p.delegate = self; central.connect(p, options: nil)
        }
    }
    func disconnect() { if let p = peripheral { central.cancelPeripheralConnection(p) } }
    func subscribe(_ char: CBUUID, handler: @escaping (Data) -> Void) { notifyHandlers[char] = handler }
    func write(_ data: Data, to char: CBUUID) {
        guard let p = peripheral, let c = chars[char] else { return }
        p.writeValue(data, for: c, type: c.properties.contains(.write) ? .withResponse : .withoutResponse)
    }
    func read(_ char: CBUUID, completion: @escaping (Data?) -> Void) {
        guard let p = peripheral, let c = chars[char] else { completion(nil); return }
        readHandlers[char] = completion; p.readValue(for: c)
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) { if c.state == .poweredOn { connectNow() } }
    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) { onState?("Connected"); p.discoverServices([serviceUUID]) }
    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) { onState?("Disconnected") }
    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { onState?("Error") }
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        for s in p.services ?? [] where s.uuid == serviceUUID { p.discoverCharacteristics(charUUIDs, for: s) }
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

final class SensorBridge: SensorTransportBridge {
    private let link: BleLink
    private var onDataCb: ((KotlinByteArray) -> Void)?
    init(bleId: String) { link = BleLink(bleId: bleId, service: sibService, characteristics: [sibNotify, sibWrite, macChar]) }
    func onLink(callback: @escaping (String) -> Void) { link.onState = callback }
    func onData(callback: @escaping (KotlinByteArray) -> Void) {
        onDataCb = callback
        link.subscribe(sibNotify) { [weak self] d in self?.onDataCb?(d.toKotlin()) }
    }
    func connect() { link.connectNow() }
    func readMac(callback: @escaping (KotlinByteArray?) -> Void) {
        link.read(macChar) { data in
            guard let d = data, d.count == 6 else { callback(nil); return }
            callback(Data(d.reversed()).toKotlin())
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

final class SugarLifeScanner: NSObject, CBCentralManagerDelegate {
    private var central: CBCentralManager!
    private let onAdvertisement: (String) -> Void
    private var wantScan = false
    private let filterServices = [sibService, rlService]
    init(onAdvertisement: @escaping (String) -> Void) { self.onAdvertisement = onAdvertisement; super.init(); central = CBCentralManager(delegate: self, queue: nil) }
    func start() { wantScan = true; if central.state == .poweredOn { central.scanForPeripherals(withServices: filterServices) } }
    func stop() { wantScan = false; central.stopScan() }
    func centralManagerDidUpdateState(_ c: CBCentralManager) { if c.state == .poweredOn && wantScan { start() } }
    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
        let dto: [String: Any] = ["bleId": p.identifier.uuidString, "name": p.name as Any, "serviceUuids": services, "rssi": RSSI.intValue]
        if let data = try? JSONSerialization.data(withJSONObject: dto), let json = String(data: data, encoding: .utf8) {
            onAdvertisement(json)
        }
    }
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

    // Движок стартует с nil-провайдером — это НАДЁЖНЫЙ рендер (как исходный плагин). Реальный провайдер
    // драйверов (тяжёлая инициализация K/N-модулей) цепляем ВНЕ boot-пути — по первому «Подключить»/скану,
    // когда main-луп уже устоялся. Так KMP-графа драйверов на старте нет → нет гонки/зависания.
    private let engine = SugarLifeEngine(driverProvider: nil)
    private lazy var scanner = SugarLifeScanner { [weak self] json in _ = self?.engine.submitAdvertisement(json: json) }
    private var unsubscribe: (() -> Void)?
    private var providerAttached = false

    override public func load() {
        unsubscribe = engine.subscribe(onSnapshot: { [weak self] json in
            DispatchQueue.main.async { self?.notifyListeners("snapshot", data: ["json": json]) }
        })
        engine.startAsync()
    }
    deinit { unsubscribe?(); engine.stop() }

    /// Подцепить провайдер реальных драйверов — вне boot-пути (создаём на фоне, цепляем на main).
    private func ensureProvider() {
        guard !providerAttached else { return }
        providerAttached = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let provider = DefaultDriverProvider(
                nowMs: { kmpNow() },
                sensorBridge: { bleId, _ in SensorBridge(bleId: bleId) },
                pumpBridge: { bleId, _ in PumpBridge(bleId: bleId) }
            )
            DispatchQueue.main.async { self?.engine.attachDriverProvider(provider: provider) }
        }
    }

    @objc func requestSnapshot(_ call: CAPPluginCall) { call.resolve(["json": engine.requestSnapshot()]) }

    @objc func sendIntent(_ call: CAPPluginCall) {
        let json = call.getString("json") ?? ""
        if json.contains("\"startScan\"") { ensureProvider(); scanner.start() }
        else if json.contains("\"stopScan\"") { scanner.stop() }
        else if json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") { ensureProvider() }
        call.resolve(["json": engine.sendIntent(json: json)])
    }

    @objc func query(_ call: CAPPluginCall) { call.resolve(["json": engine.query(json: call.getString("json") ?? "")]) }
}
