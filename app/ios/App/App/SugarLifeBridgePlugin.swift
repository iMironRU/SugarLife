import Foundation
import Capacitor
import CoreBluetooth
import UIKit
import WidgetKit
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
/**
 ОЧЕРЕДЬ BLE — ОДНА НА ВСЁ СОСТОЯНИЕ СВЯЗИ (#379).

 До этого CoreBluetooth создавался с `queue: nil`, то есть колбэки приходили на ГЛАВНУЮ нить, а звали нас
 при этом из движка — из его собственного потока. Получалось, что `links`, `chars`, обработчики и очередь
 отложенных операций пишутся из двух потоков сразу. Словари Swift к этому не готовы: гонка здесь — это не
 «иногда медленнее», а падение приложения в случайном месте.

 Отдельная нить сама по себе гонку не убирает, а лишь переносит. Убирает — единственный владелец: всё
 состояние живёт на этой очереди, а публичные методы на неё переходят. Так устроены обе рабочие реализации:
 у Loop `centralQueue` с проверками `dispatchPrecondition`, у xDrip4iOS менеджер создаётся с пометкой
 «so all delegate callbacks arrive off the main thread».
 */
let bleQueue = DispatchQueue(label: "ru.imiron.sugarlife.ble")

/**
 ОЧЕРЕДЬ ОТВЕТОВ НАРУЖУ — ВТОРАЯ, И ЭТО НЕ ИЗЛИШЕСТВО.

 Из BLE мы зовём движок: показание пришло, связь изменилась, команда ответила. Вызовы движка синхронны — он
 ждёт своей внутренней очереди. Если бы мы ждали его прямо на [bleQueue], то в момент, когда движок с своего
 потока спрашивает у нас состояние Bluetooth (а он спрашивает, синхронно), обе стороны встали бы намертво.

 Поэтому наружу отвечаем с отдельной последовательной очереди: порядок событий сохраняется — для потока
 показаний это обязательно, — а очередь связи не ждёт никого.
 */
let bleOutQueue = DispatchQueue(label: "ru.imiron.sugarlife.ble.out")

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
        // Спрашивают из движка, с чужого потока: состояние менеджера читаем на его очереди. Ждать здесь
        // безопасно — [bleQueue] сама никого не ждёт, ответы наружу уходят с [bleOutQueue].
        bleQueue.sync {
            switch central.state {
            case .poweredOn: return true
            case .unknown, .resetting: return nil
            default: return false
            }
        }
    }
    /// Дал ли человек доступ к Bluetooth. На iOS отказ выглядит как «ничего не находится» — молча.
    var authorized: Bool {
        if #available(iOS 13.1, *) { return CBCentralManager.authorization == .allowedAlways }
        return true
    }

    /// Приборы, соединение с которыми мы хотим ДЕРЖАТЬ. Заявка на подключение в CoreBluetooth бессрочна и
    /// переживает приостановку приложения: система соединит сама, когда прибор появится в эфире, и разбудит
    /// нас под это событие. Ровно так живёт Loop (`autoConnectDevices` при каждом разрыве) — и это
    /// единственный способ вернуться на связь, пока приложение спит и своей петли переподключения крутить не
    /// может (#379).
    ///
    /// В набор попадает то, что просил драйвер, и выбывает то, что он же сам отсоединил. Разница
    /// принципиальная: свой разрыв — это решение (core#83), чужой — потеря связи, и только её мы чиним молча.
    private var держим: Set<UUID> = []
    /// Периферали, вернувшиеся от системы при восстановлении (см. `willRestoreState`).
    private var восстановленные: [UUID: CBPeripheral] = [:]

    override init() {
        super.init()
        /* ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ (#379).

           Без идентификатора восстановления выгруженное приложение не поднимется больше никогда — ни на
           одно BLE-событие, пока человек не откроет его руками. А выгружает iOS обычно: по памяти, по сбою,
           просто так. Идентификатор говорит системе «этот центральный менеджер мой, подними меня, когда по
           нему что-то произойдёт».

           Идентификатор обязан быть ПОСТОЯННЫМ между запусками — на том и держится вся затея. У нас общий
           центральный на всё приложение (core#20), поэтому строка одна и записана здесь; у xDrip4iOS
           менеджеров много, и они складывают адрес прибора в идентификатор, чтобы получить ту же
           постоянство. Издания разведены: Pro и Lite не должны делить восстановление.

           ShowPowerAlert — системная подсказка «включите Bluetooth». Отказ доступа на iOS выглядит как
           «ничего не находится», молча (core#61), и одну из причин этой тишины система объяснит сама. */
        let restoreId = (Bundle.main.bundleIdentifier ?? "ru.imiron.sugarlife") + ".central"
        central = CBCentralManager(
            delegate: self, queue: bleQueue,
            options: [
                CBCentralManagerOptionRestoreIdentifierKey: restoreId,
                CBCentralManagerOptionShowPowerAlertKey: true,
            ]
        )
    }

    func register(_ link: BleLink, for uuid: UUID) { bleQueue.async { self.links[uuid] = link } }
    // Снимаем маршрут только если он всё ещё НАШ: иначе disconnect старого линка стёр бы маршрут нового.
    func unregister(_ uuid: UUID, _ link: BleLink) {
        bleQueue.async { if self.links[uuid] === link { self.links.removeValue(forKey: uuid) } }
    }

    func connect(_ uuid: UUID) { bleQueue.async { self.подключить(uuid) } }

    private func подключить(_ uuid: UUID) {
        dispatchPrecondition(condition: .onQueue(bleQueue))
        держим.insert(uuid)
        guard central.state == .poweredOn else { if !pending.contains(uuid) { pending.append(uuid) }; return }
        // Восстановленная периферь — та же самая: система вернула нам живой объект, заново искать нечего.
        if let p = восстановленные[uuid] ?? central.retrievePeripherals(withIdentifiers: [uuid]).first {
            links[uuid]?.bind(p); central.connect(p, options: nil)
        }
    }
    func cancel(_ p: CBPeripheral) {
        bleQueue.async {
            self.держим.remove(p.identifier)   // отсоединил драйвер — держать больше не надо (#379)
            self.central.cancelPeripheralConnection(p)
        }
    }

    func startScan() {
        bleQueue.async {
            self.wantScan = true
            if self.central.state == .poweredOn { self.central.scanForPeripherals(withServices: nil) }
        }
    }
    func stopScan() { bleQueue.async { self.wantScan = false; self.central.stopScan() } }

    /// Система подняла приложение и вернула ему свои периферали (#379). Пустой обработчик уже достаточен —
    /// важен сам факт объявления, — но раз периферали дают, забираем: по ним `connect` соединится без поиска.
    func centralManager(_ c: CBCentralManager, willRestoreState dict: [String: Any]) {
        let список = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        NSLog("SugarLifeBLE: восстановление состояния — периферали: \(список.count)")
        for p in список { восстановленные[p.identifier] = p }
    }

    func centralManagerDidUpdateState(_ c: CBCentralManager) {
        // Наружу — со своей очереди: обработчик идёт в движок, а он синхронный (см. [bleOutQueue]).
        if let h = readinessHandler { bleOutQueue.async { h() } }
        guard c.state == .poweredOn else { return }
        let p = pending; pending = []; p.forEach { подключить($0) }
        // Приборы, которые мы держим, переподаём заявкой: Bluetooth могли выключить и включить, а заявка
        // при этом теряется (#379).
        держим.forEach { подключить($0) }
        if wantScan { c.scanForPeripherals(withServices: nil) }
    }
    func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) { links[p.identifier]?.didConnect(p) }
    func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        сообщитьОБеде("связь с прибором потеряна", p, error)
        links[p.identifier]?.didDisconnect()
        /* ЧУЖОЙ РАЗРЫВ — ПЕРЕПОДАЁМ ЗАЯВКУ (#379).

           Прибор ушёл из радиуса, мигнул питанием, iOS решила освободить эфир — своего решения тут нет
           (наше сняло бы `cancel`, см. выше). Пока приложение на экране, переподключением займётся драйвер;
           в фоне он не запустится вовсе — процесс приостановлен. Бессрочная заявка тем и хороша, что её
           исполняет система: прибор появился — соединение поднято, приложение разбужено под это событие.

           Так же поступает Loop: `autoConnectDevices()` вызывается прямо из обработчика разрыва. */
        if держим.contains(p.identifier) { c.connect(p, options: nil) }
    }
    func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        сообщитьОБеде("подключиться к прибору не удалось", p, error)
        links[p.identifier]?.didFail()
    }

    /**
     Причина и совет — ИЗ ЯДРА (core#94).

     Словарь причин жил в Android-мосте и кодами Android; здесь не было ничего, и человек с айфоном видел
     либо тишину, либо системную английскую строку. Теперь обе платформы берут ответ в одном месте: одна и
     та же беда читается одинаково, и у каждой есть продолжение — что делать дальше.

     Молчим только когда система молчит сама: разрыв без ошибки — это штатное завершение (мы сами позвали
     cancel), и объявлять бедой его нельзя. Лог, который врёт, хуже отсутствующего.
     */
    private func сообщитьОБеде(_ событие: String, _ p: CBPeripheral, _ error: Error?) {
        guard let error = error else { return }
        let id = p.identifier.uuidString
        guard let code = cbCode(error) else {
            NSLog("SugarLifeBLE: \(событие) — \(error.localizedDescription)")
            bleLog("Warn", событие, id, ["смысл": error.localizedDescription])
            return
        }
        let беда = LinkFailures.shared.of(platform: .apple, code: code)
        NSLog("SugarLifeBLE: \(событие) [код \(code)] — \(беда.reason); \(беда.whatToDo)")
        bleLog("Warn", событие, id, [
            "код": String(code),
            "смысл": беда.reason,
            "что делать": беда.whatToDo,
            "поможет повтор": String(беда.retryHelps),
        ])
    }
    func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        /* НАРУЖУ — С ВЫХОДНОЙ ОЧЕРЕДИ, и это не формальность (#379).

           Обработчик скана зовёт движок НАПРЯМУЮ и синхронно (`submitAdvertisement`). Оставь мы его здесь —
           получили бы взаимную блокировку в первую же секунду: движок со своего потока спрашивает у нас
           состояние Bluetooth и ждёт очередь связи, а очередь связи в это время ждёт движок. Обе стороны
           стоят, приложение живо и не делает ничего — худший вид поломки. */
        guard let h = scanHandler else { return }
        bleOutQueue.async { h(p, advertisementData, RSSI) }
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
    func connectNow() { bleQueue.async { self.подключиться() } }

    private func подключиться() {
        dispatchPrecondition(condition: .onQueue(bleQueue))
        SharedCentral.shared.register(self, for: peripheralUUID); SharedCentral.shared.connect(peripheralUUID)
        сторожDiscovery?.cancel()
        let r = DispatchWorkItem { [weak self] in
            NSLog("SugarLifeBLE: discovery не завершился за 15с — отложенные команды пойдут своим отказом")
            self?.отпуститьОтложенные(всё: true, причина: "сдались ждать discovery")
        }
        сторожDiscovery = r
        // Сторож трогает состояние линка — значит живёт на очереди связи, а не на главной (#379).
        bleQueue.asyncAfter(deadline: .now() + 15, execute: r)
    }
    func disconnect() { bleQueue.async { self.отсоединиться() } }

    private func отсоединиться() {
        dispatchPrecondition(condition: .onQueue(bleQueue))
        сторожDiscovery?.cancel(); сторожDiscovery = nil
        // Отложенное отпускаем: иначе чтение, начатое до разрыва, не ответит никогда.
        отпуститьОтложенные(всё: true, причина: "разрыв связи")
        if let p = peripheral { SharedCentral.shared.cancel(p) }
        SharedCentral.shared.unregister(peripheralUUID, self)   // линк отпущен — снять маршрут (и дать ARC освободить)
        /* О СВОЁМ РАЗРЫВЕ СООБЩАЕМ САМИ (core#83).

           Маршрут только что снят, значит `didDisconnect` от CoreBluetooth сюда уже не придёт — рассказывать
           о разрыве больше некому. На Android ровно это подвешивало сеанс: драйвер сам звал disconnect и ждал
           события «связь упала», которого никто не пришлёт; его опрос при этом продолжал слать запросы в
           закрытую сессию минутами, а прибор числился «на связи».

           Разрыв — факт, а не чужое мнение: кто его совершил, тот и объявляет. */
        наружу("Disconnected")
    }
    func subscribe(_ char: CBUUID, handler: @escaping (Data) -> Void) {
        bleQueue.async { self.notifyHandlers[char] = handler }
    }

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
        bleQueue.async { self.приГотовности(char) { [weak self] in
            guard let self else { return }
            guard let p = self.peripheral else {
                NSLog("SugarLifeBLE: запись \(char) отброшена: нет соединения"); return
            }
            guard let c = self.chars[char] else {
                NSLog("SugarLifeBLE: запись \(char) отброшена: у прибора нет такой характеристики; есть: \(self.chars.keys.map { $0.uuidString }.joined(separator: ", "))")
                return
            }
            p.writeValue(data, for: c, type: c.properties.contains(.write) ? .withResponse : .withoutResponse)
        } }
    }
    func read(_ char: CBUUID, completion: @escaping (Data?) -> Void) {
        bleQueue.async { self.приГотовности(char) { [weak self] in
            guard let self, let p = self.peripheral, let c = self.chars[char] else {
                NSLog("SugarLifeBLE: чтение \(char) отброшено: нет соединения или характеристики")
                bleOutQueue.async { completion(nil) }; return
            }
            self.readHandlers[char] = completion; p.readValue(for: c)
        } }
    }

    // Колбэки соединения приходят из общего central, маршрутизированные по peripheral.
    func bind(_ p: CBPeripheral) { peripheral = p; p.delegate = self }
    func didConnect(_ p: CBPeripheral) { наружу("Connected"); p.readRSSI(); p.discoverServices(nil) }  // rssi (issue #38) + все сервисы: MAC 0x2A25 в 0x180A, не в FF30
    func didDisconnect() { наружу("Disconnected") }
    func didFail() { наружу("Error") }

    /// Состояние связи — в движок, и всегда с выходной очереди: он синхронный, ждать его на очереди связи
    /// нельзя (см. [bleOutQueue]).
    private func наружу(_ state: String) {
        guard let cb = onState else { return }
        bleOutQueue.async { cb(state) }
    }

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
        наружу("Streaming")
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        guard let v = ch.value else { return }
        // Телеметрия (issue #38): заряд 0x2A19 (uint8 %), прошивка 0x2A26 (строка).
        if ch.uuid == batteryChar, let b = v.first { emitTelemetry(battery: Int(b)); return }
        if ch.uuid == firmwareChar, let s = String(data: v, encoding: .utf8) { emitTelemetry(firmware: s); return }
        // Данные прибора — наружу по порядку и не задерживая очередь связи (#379).
        if let h = notifyHandlers[ch.uuid] { bleOutQueue.async { h(v) } }
        if let r = readHandlers.removeValue(forKey: ch.uuid) { bleOutQueue.async { r(v) } }
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

/**
 Канал BLE-слоя в ОБЩИЙ журнал — вторая половина core#72.

 На Android это сделано давно: строки BLE-слоя уходят в журнал движка и попадают в выгрузку диагностики.
 На iOS их не было вовсе — только NSLog, то есть видимые нам и невидимые ни человеку с телефоном, ни
 тестировщику. Ровно эти строки решили разбор помпы.
 */
var logSink: ((_ level: String, _ event: String, _ deviceId: String?, _ fields: [String: String], _ frame: Bool) -> Void)?

/// Событие BLE в журнал прибора. `frame = true` — кадр обмена: он несёт идентификаторы прибора.
func bleLog(_ level: String, _ event: String, _ deviceId: String?, _ fields: [String: String] = [:], frame: Bool = false) {
    logSink?(level, event, deviceId, fields, frame)
}

/// Строка в JSON — с экранированием: имя прибора и текст причины приходят снаружи и могут содержать что угодно.
func jsonStr(_ s: String) -> String {
    let data = try? JSONSerialization.data(withJSONObject: [s], options: [])
    let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
    return String(arr.dropFirst().dropLast())
}

/// Код CoreBluetooth из ошибки: он и решает, что человеку делать дальше (core#94).
func cbCode(_ error: Error?) -> Int32? {
    guard let e = error as NSError? else { return nil }
    guard e.domain == CBErrorDomain else { return nil }
    return Int32(e.code)
}

final class SensorBridge: SensorTransportBridge {
    private let link: BleLink
    private var onDataCb: ((KotlinByteArray) -> Void)?
    init(bleId: String) { link = BleLink(bleId: bleId, service: sibService, characteristics: [sibNotify, sibWrite, macChar, macCharAlt, batteryChar, firmwareChar]) }
    func onLink(callback: @escaping (String) -> Void) { link.onState = callback }
    func onData(callback: @escaping (KotlinByteArray) -> Void) {
        // Обработчик ставит движок со своего потока, а зовём мы его с выходной очереди — значит и запись
        // должна идти оттуда же (#379).
        bleOutQueue.async { self.onDataCb = callback }
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
                    bleOutQueue.asyncAfter(deadline: .now() + 0.5) { self.attemptMac(tries: tries - 1, callback: callback) }
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
    /* Запас на транспорт живёт ниже, вычисляемым свойством (SugarLifeCore#80).

       Здесь стояла его копия — я оставил её, рассудив, что «в Swift лишнее свойство
       протокол не ломает». Рассуждение верное ровно до публикации требования: как только
       ядро его объявило, компилятор увидел двух кандидатов на одно требование и отказался
       собирать iOS вовсе.

       Урок тот же, что и с Android: писать против неопубликованного интерфейса нельзя ни
       в какой форме — ни реализуя его, ни «на будущее». */

    private let link: BleLink
    private var pending: ((KotlinByteArray) -> Void)?
    private var срок: DispatchWorkItem?

    /* ЗАПАС ВРЕМЕНИ НА ТРАНСПОРТ поверх радио-времени команды (core#80).

       Срок ответа складывается из двух частей: сколько мост держит приёмник — знает протокол в ядре;
       сколько сверху добавит BLE-стек — знает только платформа. У CoreBluetooth это порядка двух секунд
       (rileylink_ios, `expectedMaxBLELatency`), у Android — 7.5 с. Потому число и объявляет натив: одна
       общая константа была бы либо мала для Android, либо избыточна здесь.

       Раньше ядро отводило на команду 3–8 с «на глаз», и обычная задержка стека выглядела как «мост
       молчит». */
    var bleLatencyMs: Int64 { 2_000 }
    init(bleId: String) { link = BleLink(bleId: bleId, service: rlService, characteristics: [rlData, rlRespCount, batteryChar, firmwareChar]) }
    func onLink(callback: @escaping (String) -> Void) { link.onState = callback }

    /* Ровно один ответ на команду — и он есть всегда (SugarLife#344). Зеркало Android;
       поймали на Android, но код здесь был тот же, и повисло бы так же.

       Пустой массив, а не 0xAA: у колбэка нет канала ошибки, пустой разбирается ядром как
       «ответа нет», а 0xAA значит «мост ответил, что помпа промолчала» — другая поломка. */
    /// Ровно один ответ на команду. Живёт на [bleOutQueue]: туда приходят ответы прибора, оттуда же зовут
    /// команду и срок — иначе `pending` пишется из двух потоков сразу (#379).
    private func завершить(_ данные: Data) {
        dispatchPrecondition(condition: .onQueue(bleOutQueue))
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
        bleOutQueue.async {
            self.завершить(Data())          // предыдущая команда не теряется молча
            self.pending = callback
            if timeoutMs > 0 {
                let r = DispatchWorkItem { [weak self] in
                    NSLog("SugarLifeBLE: мост молчит \(timeoutMs)мс — отвечаем «нет ответа»")
                    self?.завершить(Data())
                }
                self.срок = r
                bleOutQueue.asyncAfter(deadline: .now() + .milliseconds(Int(timeoutMs)), execute: r)
            }
            self.link.write(bytes.toData(), to: rlData)
        }
    }
    func disconnect() { bleOutQueue.async { self.завершить(Data()) }; link.disconnect() }
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
        CAPPluginMethod(name: "backgroundKeepAlive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBackgroundKeepAlive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "liveBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLiveBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "raiseLiveBanner", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "builtinBundle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loopFeed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLoopFeed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alarmReadiness", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAlarmSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ожидающаяЦель", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "statusNote", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "glucoseBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGlucoseBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportActiveInsulin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setStatusNote", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openPermissionSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alarmVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAlarmVolume", returnType: CAPPluginReturnPromise),
    ]

    /**
     Фоновое бодрствование для облачного режима (#388).

     Читать и менять — из интерфейса: это выбор человека, а не наша настройка. Возвращаем и список
     возможных значений, чтобы экран не хранил их у себя копией.
     */
    @objc func backgroundKeepAlive(_ call: CAPPluginCall) {
        call.resolve([
            "mode": ФоновоеБодрствование.shared.режим.rawValue,
            "modes": ФоновоеБодрствование.Режим.allCases.map { $0.rawValue },
        ])
    }

    /* ЖИВОЙ БАННЕР (#428).

       Включает и выключает его человек: Live Activity — вещь, которая занимает экран
       блокировки и «Динамический остров», и заводить её без спроса нельзя.

       Само содержимое сюда не приходит: строку значения, стрелку и разницу собирает
       приложение из снимка и присылает готовыми. Здесь только «включено ли» и передача
       дальше — считать в двух местах одно и то же мы не станем. */
    @objc func liveBanner(_ call: CAPPluginCall) {
        /* iOS 18, а не 16.2 (#500). Само по себе живое уведомление работает с 16.2, но наш баннер
           объявляет маленькое семейство ради CarPlay, а оно с 18-й. Обещать баннер на 16–17 значило
           бы включить переключатель, за которым ничего не появится. */
        if #available(iOS 18.0, *) {
            /* Отключена владельцем — говорим это отдельным полем, а не притворяемся, что телефон
               не умеет: «не умеет» и «мы решили не показывать» человек чинит по-разному. */
            if РешениеОКарточке.отключена {
                call.resolve([
                    "supported": true, "on": false, "running": false,
                    "выключенаПочему": РешениеОКарточке.почему,
                ]); return
            }
            call.resolve([
                "supported": true,
                "on": UserDefaults.standard.bool(forKey: "sl.live-banner"),
                "running": ЖивойБаннер.живой,
            ])
        } else {
            /* Говорим это прямо, чтобы экран не обещал человеку то, чего его телефон не умеет. */
            call.resolve(["supported": false, "on": false, "running": false])
        }
    }

    @objc func setLiveBanner(_ call: CAPPluginCall) {
        /* Пока карточка отключена решением владельца, включить её нельзя даже нажатием: экран об
           этом честно пишет, а тихо согласиться и ничего не сделать — худший из вариантов. */
        if РешениеОКарточке.отключена {
            UserDefaults.standard.set(false, forKey: "sl.live-banner")
            if #available(iOS 16.2, *) { ЖивойБаннер.погасить() }
            call.resolve(); return
        }
        let включено = call.getBool("on") ?? false
        UserDefaults.standard.set(включено, forKey: "sl.live-banner")
        if #available(iOS 16.2, *) {
            if включено {
                /* Показываем сразу, не дожидаясь следующего показания: человек нажал и
                   должен увидеть результат, а следующее показание придёт через пять минут. */
                _ = обновитьЖивойБаннер(последнийСнимок)
            } else {
                ЖивойБаннер.погасить()
            }
        }
        call.resolve()
    }

    /**
     ПАСПОРТ ВСТРОЕННОГО ВЕБ-СЛОЯ (#569).

     Зачем это натив, а не веб. Когда поверх приложения лёг бандл, приехавший по воздуху, работающий
     код видит СВОЙ `APP_BUILD` — то есть отвечает за OTA-бандл, а не за то, что лежит внутри
     установленного приложения. Спросить «а что там внутри» изнутри бандла невозможно: и `fetch`, и
     ассеты разрешаются относительно активного бандла, а не встроенного.

     Отсюда и симптом, который поймал владелец: приложение ставится по проводу, натив меняется, а
     экраны прежние — потому что показывается OTA-снимок недельной давности, и никакой провод его не
     трогает. Каждая кабельная установка выглядела как «ничего не приехало».

     `build.json` кладёт сборщик рядом с ассетами; мы читаем его из СВОЕГО бандла (`Bundle.main`), а
     дальше веб сравнит дату с той, на которой работает сам, и решит, откатываться ли на встроенный.
     Решение оставляем вебу намеренно: там же лежит вся остальная политика обновлений, и разводить её
     по двум языкам значило бы держать две правды о том, какая сборка новее.
     */
    /* СКОЛЬКО РАЗ ПОДНИМАЛСЯ ВЕБ-СЛОЙ ЗА ЖИЗНЬ ПРОЦЕССА.

       Ночной разбор показал явление, которого мы не видели: трижды веб-слой перезагружался БЕЗ
       перезапуска приложения, и за каждым разом в пределах минут следовала смерть. Вывели мы это
       косвенно — по тому, что настройки облаков передавались движку, а старта движка рядом не было.

       Косвенный вывод — не факт. Система выгружает содержимое webview под нехваткой памяти, и это
       отдельное событие со своими последствиями: наш JS теряет всё, что помнил, и начинает заново.
       Пусть оно называет себя само.

       Второй и последующие разы — это перезагрузка. Первый — обычный запуск. */
    private var подъёмовВеба = 0

    @objc func вебПоднялся(_ call: CAPPluginCall) {
        подъёмовВеба += 1
        if подъёмовВеба > 1 {
            вЖурнал("Warn", "life", "веб-слой перезагружен системой (\(подъёмовВеба)-й подъём за жизнь процесса)")
        }
        call.resolve(["подъём": подъёмовВеба])
    }

    @objc func builtinBundle(_ call: CAPPluginCall) {
        guard let url = Bundle.main.url(forResource: "build", withExtension: "json", subdirectory: "public"),
              let data = try? Data(contentsOf: url),
              let о = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            /* Файла нет — это сборка старше паспорта. Не ошибка: веб просто не станет ничего решать. */
            call.resolve(["есть": false]); return
        }
        call.resolve([
            "есть": true,
            "build": (о["build"] as? String) ?? "",
            "builtAt": (о["builtAt"] as? String) ?? "",
        ])
    }

    /**
     ПОДНЯТЬ БАННЕР ПО ПРОСЬБЕ ЧЕЛОВЕКА (#568, замечание владельца «баннера не вижу»).

     Почему кнопка вообще понадобилась. Live Activity создаётся ТОЛЬКО из активного приложения: из
     фона система отвечает «Target is not foreground» и не делает ничего. Значит любой баннер,
     умерший в кармане — смахнули, система погасила, приложение переустановили, — обратно сам не
     встанет. Мы пробуем поднять его при выходе на передний план, но делаем это молча, и когда не
     срабатывает, человек остаётся с включённым выключателем и пустым экраном блокировки. Именно
     этот тупик владелец и описал.

     Кнопка снимает две беды разом: делает попытку в тот единственный момент, когда она разрешена
     (человек смотрит в приложение — значит оно активно), и ОТВЕЧАЕТ, чем кончилось. Молчаливый
     отказ здесь хуже отсутствия кнопки: он читается как «нажал, и ничего», то есть как поломка.

     Отметку показанного сбрасываем: иначе обновление решит, что показание то же самое, и вернёт
     «без изменений», — а нам нужно именно создать активность заново.
     */
    @objc func raiseLiveBanner(_ call: CAPPluginCall) {
        guard #available(iOS 18.0, *) else {
            call.resolve(["итог": "не умеет", "идёт": false]); return
        }
        guard UserDefaults.standard.bool(forKey: "sl.live-banner") else {
            call.resolve(["итог": "выключено", "идёт": false]); return
        }
        DispatchQueue.main.async {
            self.показанноеПоказаниеМс = 0
            let итог = self.обновитьЖивойБаннер(self.последнийСнимок, поПросьбе: true)
            /* Имени развилки здесь нет намеренно (мост 1.50): движок схлопывает одинаковые исходы,
               а нажатий человек делает считанные штуки, и второе с тем же итогом он должен увидеть.
               Схлопывать надо повторяющийся расчёт, а не повторяющееся действие человека. */
            self.вЖурнал(итог == "обновлено" || итог == "запущено" ? "Info" : "Warn",
                         "banner", "по кнопке: " + итог)
            call.resolve(["итог": итог, "идёт": ЖивойБаннер.живой])
        }
    }

    /**
     Отдача показаний в петлю (SugarLife#413, ядро core#100): узнать состояние и переключить.

     Отдельным выключателем, а не «включено, раз петля стоит рядом»: по этим числам она считает дозу
     инсулина, и решение должно быть человеческим. Отвечаем и о доступности контейнера — человек должен
     узнать «отдавать некуда» от нас, а не по молчанию петли.
     */
    @objc func loopFeed(_ call: CAPPluginCall) {
        call.resolve([
            "enabled": LoopFeed.включено,
            "container": LoopFeed.контейнер as Any,
            "problem": LoopFeed.доступность() as Any,
        ])
    }

    @objc func setLoopFeed(_ call: CAPPluginCall) {
        guard let on = call.getBool("enabled") else {
            call.reject("не сказано, включать или выключать"); return
        }
        LoopFeed.включить(on)
        call.resolve(["enabled": on, "problem": LoopFeed.доступность() as Any])
    }

    @objc func setBackgroundKeepAlive(_ call: CAPPluginCall) {
        guard let raw = call.getString("mode"),
              let режим = ФоновоеБодрствование.Режим(rawValue: raw) else {
            call.reject("неизвестный режим: \(call.getString("mode") ?? "—")")
            return
        }
        ФоновоеБодрствование.shared.установить(режим)
        /* Возможность разбудить изменилась — говорим движку сразу (#482). Иначе он до перезапуска
           считает, что мы можем то, чего уже не можем (или наоборот). */
        Тревоги.общие.доложитьОДоставке()
        call.resolve(["mode": режим.rawValue])
    }

    // Движок создаём ОТЛОЖЕННО — на следующем тике main-цикла (в load() через async), а не в property-init
    // и не синхронно в load(). Инициализация KMP-графа на главном потоке ВО ВРЕМЯ синхронной фазы Capacitor
    // load() дедлочит (K/N-рантайм ↔ WKWebView) → webview/JS не стартует. На реальном устройстве это стабильно.
    // Отложив за пределы фазы load(), получаем максимум кратковременную заминку, а не вечный сплэш.
    // Провайдер реальных драйверов цепляем ещё позже — по первому «Подключить»/скану (attachDriverProvider).
    /* ССЫЛКА ДЛЯ ЖИЗНЕННОГО ЦИКЛА ПРИЛОЖЕНИЯ (#559).

       AppDelegate знает моменты, которых не знает плагин: приложение стало активным, уходит в фон.
       Для живого баннера это ключевые моменты — поднять его можно ТОЛЬКО пока мы на переднем плане
       (система отвечает «Target is not foreground» и не запускает). Слабая, чтобы не держать плагин
       живым дольше, чем он есть. */
    static weak var общий: SugarLifeBridgePlugin?

    private var engine: SugarLifeEngine?
    private lazy var scanner = SugarLifeScanner { [weak self] json in _ = self?.engine?.submitAdvertisement(json: json) }
    private var unsubscribe: (() -> Void)?
    private var providerAttached = false

    private static let emptySnapshot =
        "{\"bridgeRevision\":\"1.6\",\"monitor\":{\"glucose\":\"—\",\"glucoseMmol\":null,\"trend\":\"—\"," +
        "\"link\":\"Disconnected\",\"reservoir\":\"—\",\"battery\":\"—\",\"confirmedIOB\":0,\"assumedIOB\":0," +
        "\"conservativeIOB\":0},\"devices\":[],\"availableDrivers\":[]}"

    /**
     ОЧЕРЕДЬ ДЛЯ РАЗГОВОРА С ДВИЖКОМ (core#82).

     Публичные методы движка синхронны и ждут своей очереди: внутри у него один поток, которым защищено
     состояние. Ждать в этой очереди можно откуда угодно, кроме главной: на iOS зависший главный поток
     убивает системный watchdog, на Android — показывает «приложение не отвечает». Второе мы уже получили
     на железе: три перезапуска за восемь минут, приборы не подключились ни разу.

     Очередь ПОСЛЕДОВАТЕЛЬНАЯ и своя — не про параллельность, а про то, чтобы не занимать чужую. Ровно так
     же устроен `sessionQueue` у rileylink_ios: у железа своя очередь, и UI в ней не ждёт.
     */
    private let engineQueue = DispatchQueue(label: "ru.imiron.sugarlife.engine")

    override public func load() {
        SugarLifeBridgePlugin.общий = self
        // Уход в фон и возвращение — на них подписываемся сразу: без этого настройка была бы мёртвой (#388).
        ФоновоеБодрствование.shared.начать()
        engineQueue.async { [weak self] in
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
            // Куда отдавать показания за пределы приложения (core#100): на iOS это общий контейнер, из
            // которого читает петля. Ставим всегда — сама отдача включается человеком (SugarLife#413).
            e.setGlucoseBroadcaster(b: LoopFeed.shared)
            // Телеметрия приходит из колбэков CoreBluetooth; вызов движка синхронный, поэтому уводим его
            // на свою очередь — иначе поток событий от железа ждёт очереди движка (core#82).
            telemetrySink = { [weak self] json in
                self?.engineQueue.async { _ = self?.engine?.submitTelemetry(json: json) }
            }
            // BLE-слой → ОБЩИЙ журнал (core#72, вторая половина): на Android так давно, здесь не было
            // ничего. Строку собираем здесь — она про ЭТОТ момент, — а движку отдаём с его очереди:
            // запись в журнал не должна останавливать того, кто разговаривает с прибором (core#82).
            logSink = { [weak self] level, event, deviceId, fields, frame in
                let f = fields.map { "\(jsonStr($0.key)):\(jsonStr($0.value))" }.joined(separator: ",")
                var json = "{\"type\":\"submitLog\",\"level\":\(jsonStr(level)),\"tag\":\"ble\"," +
                    "\"event\":\(jsonStr(event)),"
                if let d = deviceId { json += "\"deviceId\":\(jsonStr(d))," }
                json += "\"fields\":{\(f)},\"hasIdentifiers\":\(frame)}"
                self?.engineQueue.async { _ = self?.engine?.sendIntent(json: json) }
            }
            /* РУКА К «ЗДОРОВЬЮ» — СРАЗУ, А ПРАВА — ПОТОМ (#583).

               Привязка не значит запись: приёмник встаёт в строй только по настройке `health.write`,
               выключенной по умолчанию, а право система спросит в момент первой отправки. Поэтому
               цеплять можно здесь же, вместе со всем остальным, — системного окна человек не увидит.

               На платформе без HealthKit рука честно отвечает «хранилища нет», и движок приёмник не
               ставит: отдельной ветки для Android тут не нужно. */
            self.engineQueue.async { [weak self] in
                self?.engine?.attachHealthStore(store: ЗдоровьеЗапись())
            }
            self.unsubscribe = e.subscribe(onSnapshot: { [weak self] json in
                /* История — с движковой очереди: это запрос в базу, и на главном потоке ему не
                   место (тот же урок, что с сериализацией снимка, #517). */
                self?.engineQueue.async { self?.обновитьИсториюИзДвижка() }
                DispatchQueue.main.async {
                    self?.notifyListeners("snapshot", data: ["json": json])
                    /* Баннер обновляем ЗДЕСЬ, а не из веб-слоя (#428). Ночью и в кармане
                       webview усыплён, а этот код живёт, пока приложение просыпается от
                       эфира BLE (#379). Обновление из JS работало бы ровно тогда, когда
                       человек и так смотрит на экран, — то есть когда баннер не нужен. */
                    self?.последнийСнимок = json
                    /* Звуковая обстановка из снимка → опоре (мост 1.51, ядро #149). Маршрут сообщаем
                       мы, решение приезжает обратно: держать опору или отпустить. Разбираем здесь, а
                       не в опоре, — она про звук, а не про разбор JSON. */
                    self?.применитьЗвуковуюОбстановку(json)
                    if #available(iOS 16.2, *) { _ = self?.обновитьЖивойБаннер(json) }
                    /* Виджет на рабочем столе — ОТДЕЛЬНОЙ дорогой, а не внутри баннера (#542).
                       Баннер человек может выключить, виджет при этом остаётся на экране: одна
                       общая ветка означала бы, что выключенный баннер молча гасит и виджет. */
                    if #available(iOS 16.0, *) { ПоверхностьВиджета.общая.обновить(json, историяДвижка: self?.историяДвижка ?? []) }
                    /* Значок и тихая сводка — ТОЖЕ отдельной дорогой (#655).

                       Они жили внутри решения о живой карточке, в одной из его веток. 28 августа я
                       карточку выключил, поставил выход в начале той функции — и унёс с ней обе
                       поверхности. Владелец увидел это на заблокированном телефоне: «банера нет, но
                       нет числа на значке и всплывающих уведомлений».

                       Тот же капкан ждал любого, кто просто выключил бы баннер выключателем: старый
                       выход по `sl.live-banner` стоял ровно там же. Беда лежала до меня.

                       Правило уже было записано строкой выше — про виджет: «одна общая ветка
                       означала бы, что выключенный баннер молча гасит и виджет». Значок со сводкой
                       его просто не получили. Теперь получили: четыре поверхности — четыре строки
                       здесь, и ни одна не спрятана внутри другой. Сторожит `поверхности.test.ts`. */
                    ЗначокИСводка.общая.обновить(json, историяДвижка: self?.историяДвижка ?? [])
                    /* Тревоги показываем ОТСЮДА же и по той же причине, что баннер (#482): ночью и в
                       кармане webview усыплён, а этот код живёт, пока живёт приложение. */
                    Тревоги.общие.приСнимке(json)
                }
            })
            /* Доставка тревог: категория с кнопкой «Понял», делегат и разгрузка очереди ответов.
               Отправителя ставим сюда же — сам движок в Тревоги не виден и не должен быть. */
            Тревоги.общие.отправить = { [weak self] json in
                self?.engine?.sendIntent(json: json) ?? ""
            }
            /* Молчаливо умирающий механизм неотличим от работающего (#593). И тревога, не
               прозвучавшая звуком, и опора, у которой отобрали сессию, обязаны оставить след там,
               откуда его можно прочитать наутро, — в журнале движка, а не в NSLog. */
            Тревоги.общие.вЖурналДвижка = { [weak self] уровень, событие in
                self?.вЖурнал(уровень, "alarm", событие)
            }
            ФоновоеБодрствование.shared.вЖурнал = { [weak self] уровень, событие in
                self?.вЖурнал(уровень, "keepalive", событие)
            }
            /* Исход обновления карточки — тем же путём. Развилку не называем: это не повторяющийся
               выбор, а результат чужого решения, и схлопывать его нельзя. */
            if #available(iOS 16.2, *) {
                ЖивойБаннер.вЖурнал = { [weak self] уровень, событие in
                    self?.вЖурнал(уровень, "banner", событие)
                }
            }
            /* Сеть вернулась — будим облако движка немедленно, не досиживая его паузу (#544). */
            Сеть.общая.сообщить = { [weak self] json in
                self?.engineQueue.async { _ = self?.engine?.sendIntent(json: json) }
            }
            Сеть.общая.слушать()

            /* Куда вести из уведомления — решают тревоги (они знают, о чём событие), а доставляем
               цель мы: событие уходит в веб, а если слушать ещё некому — ждёт своей очереди. */
            Тревоги.общие.повестиВ = { [weak self] цель in
                DispatchQueue.main.async {
                    guard let self else { return }
                    SugarLifeBridgePlugin.ожидающаяЦельПерехода = цель
                    self.notifyListeners("цель", data: ["цель": цель])
                }
            }
            Тревоги.общие.настроить()
            Тревоги.общие.доложитьОДоставке()
            e.startAsync()
            /* Гасим оставшуюся карточку при первом же запуске: без этого на экране блокировки
               висел бы замерший труп с числом получасовой давности — то самое, из-за чего
               владелец и попросил её убрать (см. РешениеОКарточке). */
            if РешениеОКарточке.отключена, #available(iOS 16.2, *) {
                UserDefaults.standard.set(false, forKey: "sl.live-banner")
                ЖивойБаннер.погасить()
            }
            // Boot-реконнект BLE: если доступ к Bluetooth уже выдан — цепляем провайдер сразу, движок
            // переподнимет сохранённые сенсор/помпу из БД (без ожидания скана). notDetermined — отложим
            // до первого скана (не показываем системный запрос на старте; restore сработает при первом attach).
            if CBManager.authorization == .allowedAlways { self.ensureProvider() }
        }
    }
    /// Последний снимок — чтобы включённый баннер показал число сразу, а не через пять минут.
    private var последнийСнимок: String?
    /* ИСТОРИЯ ДЛЯ ГРАФИКА — У ДВИЖКА, А НЕ ИЗ СВОЕЙ КОПИЛКИ (#547, SugarLife#528).

       Ряд для баннера мы копили сами: по точке на снимок, начиная с момента, когда приложение
       работает. Отсюда рваная линия — дыры в ней это не пропажи данных, а часы, когда телефон нас
       усыплял. Владелец увидел график из четырёх обрывков и спросил, не догружаем ли мы историю.

       Не догружали. При этом у движка она есть целиком: он тянет её из облака и держит в своей
       базе — тысячи точек. Спрашиваем ЕГО (`query` с окном), и график перестаёт зависеть от того,
       как часто нас будили.

       СВОЯ КОПИЛКА ОСТАЁТСЯ ЗАПАСНЫМ ПУТЁМ: браузерный шим истории не отдаёт, а до первого ответа
       движка рисовать что-то надо. Пустой график вместо линии выглядит поломкой.

       Спрашиваем не чаще раза в четыре минуты: запрос идёт в базу, а снимки приходят пачками. */
    private var историяДвижка: [СахарАтрибуты.ContentState.Точка] = []
    private var историяВзятаМс: Double = 0

    private func обновитьИсториюИзДвижка() {
        let сейчас = Date().timeIntervalSince1970 * 1000
        guard сейчас - историяВзятаМс > 4 * 60 * 1000 else { return }
        историяВзятаМс = сейчас
        let от = сейчас - ИсторияСахара.ОКНО * 1000
        /* MAXPOINTS НЕ ПРОСИМ — И ЭТО ВЫСТРАДАННОЕ (#550).

           Сначала просили 48 точек, рассчитывая на прореживание. У движка два хранилища, и ведут они
           себя по-разному: в памяти `maxPoints` РАЗРЕЖИВАЕТ окно, а в постоянном (то, что работает на
           телефоне) — берёт ПОСЛЕДНИЕ N. При минутном такте это 48 минут вместо трёх часов, и на
           баннере получился короткий обрубок линии справа — владелец увидел его первым.

           Поэтому берём окно целиком и прореживаем сами (`ИсторияСахара.дляПоказа`): полторы сотни
           точек через мост раз в четыре минуты дешевле, чем график, который врёт про длину истории.
           Ядру о расхождении сказано отдельно. */
        let запрос = "{\"kind\":\"Glucose\",\"fromMs\":\(Int(от)),\"toMs\":\(Int(сейчас))}"
        guard let ответ = engine?.query(json: запрос) else { NSLog("SugarLife: история — движка нет"); return }
        guard let data = ответ.data(using: .utf8),
              let корень = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let список = корень["glucose"] as? [[String: Any]] else {
            NSLog("SugarLife: история — не разобрали ответ: \(ответ.prefix(200))")
            return
        }
        /* В лог — сколько пришло. Когда линия на баннере снова окажется короче ожидаемого, по этой
           строке сразу видно, кто виноват: движок отдал мало или мы неправильно спросили. */
        NSLog("SugarLife: история движка — \(список.count) точек за \(Int(ИсторияСахара.ОКНО / 60)) мин")
        let точки: [СахарАтрибуты.ContentState.Точка] = список.compactMap { т in
            guard let атМс = т["atMs"] as? Double, let ммоль = т["mmol"] as? Double, ммоль > 0 else { return nil }
            return .init(т: Date(timeIntervalSince1970: атМс / 1000), в: ммоль)
        }.sorted { $0.т < $1.т }
        guard !точки.isEmpty else { return }
        DispatchQueue.main.async { self.историяДвижка = точки }
    }

    /* ПОДНЯТЬ БАННЕР, ПОКА МЫ НА ПЕРЕДНЕМ ПЛАНЕ (#559).

       Live Activity запускается только из активного приложения: из фона система отвечает «Target is
       not foreground» и не делает ничего. Это и был вчерашний случай — баннер закрылся, пока телефон
       лежал в кармане, а поднять его оттуда мы не могли; человек увидел мёртвую карточку, которая
       ждала, пока он сам откроет приложение.

       Поэтому проверяем в двух местах, и оба — когда мы точно активны: когда приложение открыли и
       когда его сворачивают. Второе важнее: это последняя секунда, когда мы ещё вправе запустить
       баннер на ближайшие часы фона.

       Своих данных не сочиняем: берём последний снимок движка. Нет снимка — значит показывать нечего
       и запускать нечего. */
    @available(iOS 16.2, *)
    func оживитьБаннер(_ повод: String) {
        guard UserDefaults.standard.bool(forKey: "sl.live-banner") else { return }
        guard !ЖивойБаннер.живой, let json = последнийСнимок else { return }
        NSLog("SugarLife: баннера нет (\(повод)) — поднимаем, пока можно")
        /* Отметку сбрасываем: иначе `обновитьЖивойБаннер` решит, что это то же показание, и не станет
           ничего делать — а нам нужно именно создать активность заново. */
        показанноеПоказаниеМс = 0
        _ = обновитьЖивойБаннер(json)
    }


    /* ЧТО УЖЕ ПОКАЗАНО НА БАННЕРЕ (#500). Снимки движка приходят пачкой — по несколько раз в минуту,
       на любое изменение чего угодно, — а показание сахара меняется раз в пять минут. Обновлять
       Live Activity на каждый снимок бессмысленно и вредно: система защищает батарею и начинает
       ПОДАВЛЯТЬ частые обновления, из-за чего баннер застревает на старом числе, пока соседний
       xDrip показывает свежее. Помним, что отдали, и отдаём заново, только когда правда изменилось. */
    private var показанноеПоказаниеМс: Double = 0
    private var показанноеСтарое = false
    /* КОГДА МЫ В ПОСЛЕДНИЙ РАЗ ПРОСИЛИ СИСТЕМУ ПЕРЕРИСОВАТЬ БАННЕР (#560).

       Система считает обновления живых уведомлений и, превысив её меру, начинает молча их
       отбрасывать: `update` проходит без ошибки, а карточка остаётся прежней. Со стороны это
       выглядит как «баннер не обновляется» — владелец видел на нём возраст 6:45 при свежей сводке
       рядом, и числа в них расходились.

       У него показания приезжают РАЗ В МИНУТУ, то есть мы просили перерисовку шестьдесят раз в час.
       Это заведомо больше, чем нам отпущено, и лишние просьбы не просто пропадают — они тратят
       бюджет, из-за чего пропадают и нужные.

       Поэтому просим раз в четыре минуты — как сводка. Между просьбами карточка не мертва: возраст
       и обратный счётчик в ней идут сами, системными таймерами, без нашего участия. */
    private var баннерПросиливМс: Double = 0

    /* РЕШАЕМ ПО ИТОГУ ПАЧКИ, А НЕ ПО КАЖДОМУ СНИМКУ (#582).

       Правило 6 («устаревшее показание не создаёт поверхность») в одном углу давало обратную беду.
       На старте движок отдаёт снимки пачкой, догружая историю: каждая прошлая точка приезжает как
       «последнее показание» и помечена устаревшей. Правило честно отказывается поднимать баннер —
       и это верно. Но карточки в этот момент нет вовсе, а подняться теперь можно только на
       СЛЕДУЮЩЕМ свежем показании. Уснёт приложение раньше — карточки не будет до касания человека.

       Так правило, чинившее «карточка показывает старое число», давало «карточки нет вовсе».
       Второе тише первого и потому хуже: человек не видит ошибки, он видит пустоту.

       Чиним не правило, а момент решения. Пачка узнаётся тем, что снимки идут подряд: сбрасываем
       отложенную проверку на каждом новом и делаем её, когда поток утих. К этому моменту
       `последнийСнимок` — уже итоговый, и если в нём свежее число, баннер встанет.

       Своей свежести по-прежнему не считаем: решает движок, мы лишь выбираем, КОГДА его спросить.

       Проверку заводим, только если баннера нет: у живого она бы просто повторяла обычный путь и
       тратила бюджет обновлений на то, что и так сделано. */
    private var отложеннаяПроверка: DispatchWorkItem?
    private let пачкаУлеглась: TimeInterval = 4

    @available(iOS 16.2, *)
    private func переспроситьКогдаПачкаУляжется() {
        guard UserDefaults.standard.bool(forKey: "sl.live-banner"), !ЖивойБаннер.живой else { return }
        отложеннаяПроверка?.cancel()
        let дело = DispatchWorkItem { [weak self] in
            guard let self, !ЖивойБаннер.живой else { return }
            _ = self.обновитьЖивойБаннер(self.последнийСнимок, переспрашивать: false)
        }
        отложеннаяПроверка = дело
        DispatchQueue.main.asyncAfter(deadline: .now() + пачкаУлеглась, execute: дело)
    }
    private var показаннаяЗона = ""
    private var показанноеЧисло = ""

    /* Не чаще этого шлём ИЗМЕНИВШЕЕСЯ ЧИСЛО той же зоны (SugarLife#649).

       Пять минут — просьба владельца и разумная середина: карточка объявляет себя протухшей через
       пятнадцать минут после показания, так что срок не истечёт, а в падении отставание числа не
       превысит пяти минут — примерно одну единицу. Смена зоны и разрыв идут мимо этого порога. */
    /* Одно число на двоих со сроком годности карточки: см. СрокиКарточки.порогЧислаСек.
       Разъехавшись, они дают карточку, которая протухает раньше, чем мы её кормим (#651). */
    private var баннерЧислоНеЧащеМс: Double { СрокиКарточки.порогЧислаСек * 1000 }

    /* Не чаще этого просим перерисовку — кроме случаев, когда смысл карточки изменился.

       ЭТОТ ПОРОГ БОЛЬШЕ НЕ ПРО ЧИСЛО. Он остался только для случая «на карточке ничего не
       изменилось»: изменившееся число и смена зоны проходят мимо него сразу (`смыслСменился`).

       ИСТОРИЯ ПОРОГА — ЗАПИСЬ ОБ ОШИБКЕ, И МОЕЙ. Стояло пять минут с объяснением «система считает
       наши просьбы и лишние отбрасывает молча». Я счёл объяснение неизмеренным, поставил минуту и
       пошёл смотреть. Через двенадцать минут минутных обновлений система начала отвечать
       «СИСТЕМА СЧИТАЕТ ПРОТУХШЕЙ» на каждое — и перестала их применять вовсе. Карточка встала на
       двадцать минут, и владелец увидел это раньше меня.

       То есть объяснение было неизмеренным И ВЕРНЫМ. Мерить его стоило, но вывод из измерения не
       «порог не нужен», а «порог не там». Бюджет тратится на КАЖДОЕ обновление, в том числе на то,
       которое ничего не меняет; беречь надо именно эти.

       Десять минут — не осторожность, а расчёт: карточка объявляет себя протухшей через пятнадцать
       минут после показания, и обновление раз в десять успевает продлить срок с запасом. Реже
       нельзя — протухнет; чаще незачем — на экране то же самое. */
    private let баннерНеЧащеМс: Double = 10 * 60 * 1000


    /**
     Строка в журнал движка: его выгрузка — единственный способ прочитать это с телефона потом.

     `решение` — ИМЯ РАЗВИЛКИ, если эта строка есть исход выбора (мост 1.50, ядро #138). Событие при
     этом остаётся событием («не чаще», «обновлено»), а `решение` называет, ЧТО решалось («banner»).

     Схлопывание держит движок, а не мы: сто одинаковых исходов в час — это не сто решений, а одна
     развилка, посчитанная сто раз. В структурный лог он положит каждую строку (лог пишет СОБЫТИЯ),
     в журнал решений — только смену исхода (решения пишут ИЗМЕНЕНИЯ). Своё схлопывание здесь было бы
     вторым таким правилом в другом месте, и расходились бы они молча.

     Имя развилки даём только повторяющимся выборам. Разовому действию человека его давать нельзя:
     схлопывание съело бы второе нажатие с тем же исходом, а человеку нужно видеть оба.
     */
    private func вЖурнал(_ уровень: String, _ тег: String, _ событие: String, решение: String? = nil) {
        let развилка = решение.map { "\"decision\":\(jsonStr($0))," } ?? ""
        let json = "{\"type\":\"submitLog\",\"level\":\(jsonStr(уровень)),\"tag\":\(jsonStr(тег))," +
            развилка +
            "\"event\":\(jsonStr(событие)),\"fields\":{},\"hasIdentifiers\":false}"
        engineQueue.async { [weak self] in _ = self?.engine?.sendIntent(json: json) }
    }

    /* Что движок разрешил нам со звуком. Пока поля нет (старое ядро) — не трогаем ответ вовсе:
       `nil` означает «не знаем», и опора в этом случае держится, как велит сам движок для
       незнакомого маршрута. Записать сюда `true` по умолчанию значило бы выдать догадку за ответ. */
    private func применитьЗвуковуюОбстановку(_ json: String?) {
        guard let json, let data = json.data(using: .utf8),
              let корень = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let звук = корень["audio"] as? [String: Any],
              let держать = звук["holdAudioAnchor"] as? Bool else { return }
        let было = ФоновоеБодрствование.shared.держатьПоДвижку
        ФоновоеБодрствование.shared.держатьПоДвижку = держать
        /* Решение сменилось — пересматриваем опору немедленно, не дожидаясь следующего ухода в фон:
           в машину садятся с уже усыплённым приложением. */
        if было != держать { ФоновоеБодрствование.shared.пересмотреть() }
    }

    /**
     Снимок движка — на рабочий стол (#542).

     Виджет читает общую запись сам, когда система решит его перерисовать; наше дело — положить
     свежее и сказать системе, что оно появилось. Просить перерисовку на каждый снимок нельзя:
     их несколько в минуту, а бюджет обновлений виджета система считает и урезает.
     */
    @available(iOS 16.0, *)
    
    /* Из снимка — в состояние баннера.

       Разбираем ровно то, что показываем: значение, тренд, время. Единицы не трогаем —
       движок отдаёт готовую строку в тех единицах, которые выбрал человек, и второй
       формат здесь означал бы, что на экране блокировки и в приложении разные числа. */
    /* ЖУРНАЛ ОБЯЗАН ОТВЕЧАТЬ И НА «ПОЧЕМУ НЕ ОБНОВИЛИ» (#580).

       Записывались только те исходы, что доходили до конца, — «запущено», «обновлено», «не удалось».
       Все ранние выходы («не чаще», «без изменений», «нет числа», «выключено», «старое — не
       поднимаем») уходили молча.

       Из-за этого молчание в журнале нельзя было прочесть. Владелец показал застывшую на двадцать
       минут карточку; я увидел пустой журнал и заключил, что приложение не выполнялось. Оказалось,
       что вывод сделан из тишины, которую мы сами и устроили: тех же двадцати минут молчания хватает
       и для «нас не было», и для «мы решили, что менять нечего».

       Инструмент, который не различает эти два случая, хуже отсутствующего: он даёт уверенность.
       Поэтому пишем КАЖДЫЙ исход, а решение принимаем внутри. */

    @available(iOS 16.2, *)
    @discardableResult
    private func обновитьЖивойБаннер(
        _ json: String?, поПросьбе: Bool = false, переспрашивать: Bool = true,
    ) -> String {
        let итог = решитьПоБаннеру(json, поПросьбе: поПросьбе)
        /* «Обновлено» и «запущено» пишутся ниже, в самом решении, вместе с числом и инсулином — там
           есть что сказать. Здесь остальные: коротко, но обязательно. */
        if итог != "обновлено" && итог != "запущено" && !итог.hasPrefix("не удалось") {
            вЖурнал("Debug", "banner", итог, решение: "banner")
            /* Не встали — переспросим, когда пачка догрузки утихнет (#582). Сама отложенная
               проверка следующую НЕ заводит: иначе при полном отсутствии данных это крутилось бы
               каждые четыре секунды всю ночь — ради карточки, которую всё равно нечем наполнить.
               Не вышло — ждём следующего настоящего снимка, он и заведёт проверку заново. */
            if переспрашивать { переспроситьКогдаПачкаУляжется() }
        }
        return итог
    }

    @available(iOS 16.2, *)
    private func решитьПоБаннеру(_ json: String?, поПросьбе: Bool) -> String {
        guard let json, let data = json.data(using: .utf8),
              let корень = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let monitor = корень["monitor"] as? [String: Any] else { return "нет снимка" }

        let значение = (monitor["glucose"] as? String) ?? "—"
        guard значение != "—", !значение.isEmpty else { return "нет числа" }

        let стрелка = Снимок.стрелкаТренда(monitor["trend"] as? String)
        let когдаМс = (monitor["latestAtMs"] as? Double) ?? Date().timeIntervalSince1970 * 1000
        /* «Старое» решает движок своим статусом, а не мы порогом: два мнения о свежести
           разойдутся в первый же день (та же причина, что в domain/freshness.ts). */
        let старое = ((monitor["status"] as? String) ?? "") != "Live"
        /* Ряд для графика копим здесь же: снимок несёт одно число, а линии нужен час (#428).
           Число берём то, что уже посчитано движком, а не парсим строку значения обратно —
           две дороги к одному числу разойдутся на округлении. */
        /* Новое показание — либо другое время, либо сменившаяся свежесть. Всё остальное в снимке
           (батареи, помпа, тревоги) баннера не касается и трогать его не должно. */
        if когдаМс == показанноеПоказаниеМс && старое == показанноеСтарое { return "без изменений" }
        показанноеПоказаниеМс = когдаМс
        показанноеСтарое = старое

        let ряд = Снимок.рядДляПоказа(monitor, когдаМс: когдаМс, историяДвижка: историяДвижка)
        /* ЧИСЛО ОТДЕЛЬНО ОТ ЕДИНИЦ (#500). Движок отдаёт готовую строку «7,9 ммоль/л», и на
           экране блокировки она переносилась на вторую строку, съедая пол-карточки под слово,
           которое человек и так знает. Режем по первому пробелу: число остаётся ТЕМ ЖЕ, что
           посчитал движок, — второй дороги к нему мы не заводим. */
        /* Разделитель — запятая, как везде в приложении (#500). Движок отдаёт «10.4 ммоль/л» с
           точкой; на баннере рядом с русскими словами точка читается как чужая, а в приложении в
           этот же момент стоит «10,4». Одно число в двух видах — повод усомниться в обоих. */
        let число = String(значение.split(separator: " ").first ?? "")
            .replacingOccurrences(of: ".", with: ",")
        /* РАЗРЫВ — ПОСЛЕ ПЯТНАДЦАТИ МИНУТ МОЛЧАНИЯ (макет v2). До этого показание «задержалось»:
           число ещё что-то значит, просто тускнеет. После — не значит ничего, и показывать его
           крупно нельзя: на экране блокировки старое число выглядит текущим всегда. */
        let возрастМин = (Date().timeIntervalSince1970 - когдаМс / 1000) / 60
        let разрыв = возрастМин > 15
        let mmol = monitor["glucoseMmol"] as? Double
        /* СМЫСЛ КАРТОЧКИ ВАЖНЕЕ РАСПИСАНИЯ. Зона (цвет числа) и разрыв — то, ради чего на баннер
           смотрят: переход «в коридоре → ниже» человек должен увидеть сразу, а не через четыре
           минуты. Всё остальное — очередная цифра того же цвета, и она подождёт. */
        /* СМЫСЛ КАРТОЧКИ — ЭТО И ЧИСЛО ТОЖЕ, А НЕ ОДНА ЗОНА.

           Здесь стояла только зона, и число внутри неё ждало общего тормоза. То есть «7,4 → 8,1»
           доезжало до экрана блокировки через тормоз, хотя это ровно то, на что человек смотрит.
           Владелец сказал об этом трижды за день, и был прав каждый раз. */
        /* ЧИСЛО ОТДЕЛИЛИ ОТ СМЫСЛА ОБРАТНО — НО НЕ ТУДА, ОТКУДА БРАЛИ (SugarLife#649).

           Владелец: «нет необходимости обновлять баннер раз в минуту, достаточно раз в 5 минут».
           Он прав: Nightscout наливает раз в минуту, и в падении мы слали карточку каждую минуту —
           шестьдесят обновлений в час ради цифры, которая меняется на одну десятую.

           Но вернуть число под общий десятиминутный тормоз нельзя: за десять минут в падении сахар
           уезжает на пару единиц, и человек на экране блокировки видит не то, что есть. Поэтому
           порога теперь два, и делит их не важность, а цена ошибки:

             зона, разрыв, «старое»  → мимо тормоза, сразу. Переход «в коридоре → ниже» ждать нельзя.
             другое число той же зоны → пять минут. Это уточнение, а не новость.
             ничего не изменилось     → десять минут, только чтобы срок карточки не истёк. */
        let зонаСейчас = Снимок.зонаСахара(mmol) + (разрыв ? "+разрыв" : "") + (старое ? "+старое" : "")
        let сейчасМс = Date().timeIntervalSince1970 * 1000
        let смыслСменился = зонаСейчас != показаннаяЗона
        let числоСменилось = число != показанноеЧисло
        /* ПЯТИМИНУТНЫЙ ТОРМОЗ НЕ КАСАЕТСЯ НАЖАТИЯ (#568).

           Он бережёт бюджет обновлений от потока показаний — от расписания, а не от человека.
           Нажатие «Показать сейчас» происходит раз в жизни и ровно тогда, когда баннера НЕТ: если
           тормозить и его, кнопка отвечает «не чаще» и не делает ничего — то есть ведёт себя как
           сломанная, ради экономии бюджета на активности, которой не существует. Ровно это я и
           увидел первым же нажатием на симуляторе. */
        /* ТОРМОЗ БЕРЕЖЁТ БЮДЖЕТ ЖИВОЙ КАРТОЧКИ — А ЕСЛИ КАРТОЧКИ НЕТ, БЕРЕЧЬ НЕЧЕГО (#582).

           Здесь была вторая половина той же беды. `баннерПросиливМс` взводится ДО решения, поднимать
           ли баннер, — значит пачка догрузки на старте взводила тормоз своими устаревшими точками, и
           следующие пять минут любое свежее показание получало «не чаще», не доходя до создания.
           Отложенная проверка по итогу пачки упиралась в него же и молчала.

           Ограничение обновлений живой активности — это ограничение ОБНОВЛЕНИЙ. Создание карточки,
           которой нет, никакого бюджета не тратит. */
        /* Решение владельца, а не сбой: карточка выключена целиком, см. РешениеОКарточке. */
        if РешениеОКарточке.отключена { return "выключено владельцем" }
        guard UserDefaults.standard.bool(forKey: "sl.live-banner") else { return "выключено" }

        let порог = числоСменилось ? баннерЧислоНеЧащеМс : баннерНеЧащеМс
        if !поПросьбе, ЖивойБаннер.живой, !смыслСменился, сейчасМс - баннерПросиливМс < порог {
            return "не чаще"
        }
        баннерПросиливМс = сейчасМс
        показаннаяЗона = зонаСейчас
        показанноеЧисло = число

        let итог = ЖивойБаннер.обновить(
            значение: число.isEmpty ? значение : число, стрелка: стрелка, разница: Снимок.дельта(ряд),
            когдаМс: когдаМс, старое: старое || разрыв,
            источник: (monitor["source"] as? String) ?? "сенсор",
            /* Прореженный: минутные показания за три часа в лимит ActivityKit не влезают (#545). */
            ряд: ИсторияСахара.дляПоказа(ряд),
            mmol: mmol,
            зона: Снимок.зонаСахара(mmol),
            инсулин: Снимок.инсулинСтрокой(monitor),
            прогноз: nil,
            разрыв: разрыв,
            /* ПОСЛЕДНЕЕ ИЗВЕСТНОЕ ОТДАЁМ ВСЕГДА (#530), а не только в разрыве: в разрыв баннер
               теперь умеет уйти сам, по сроку годности, — и если строки в состоянии нет, показать
               ему будет нечего. Сочинить её на месте расширение не может: там нет ни форматов, ни
               единиц. */
            последнее: последнееПоказание(число: число, когдаМс: когдаМс),
            /* КОГДА ЖДАТЬ СЛЕДУЮЩЕЕ — ОТ ДВИЖКА, А НЕ НАШИ ПЯТЬ МИНУТ (мост 1.41, SugarLifeCore#126).

               Пять минут были допущением: у минутного сенсора и пятиминутного облака такт разный, и
               счётчик на баннере врал у половины источников. Теперь момент приходит измеренным —
               движок берёт медиану фактических промежутков, а не заявление драйвера. Старое ядро
               поля не шлёт: тогда считаем по-прежнему, чтобы счётчик не исчез вовсе. */
            следующее: (monitor["nextExpectedAtMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) },
            опоздание: (monitor["beatsLate"] as? Int) ?? 0
        )
        /* Значок и сводка уже накормлены выше, до решения о карточке (#655): одно число, один раз,
           три поверхности. Здесь стоял их второй вызов — при включённой карточке он давал два
           обновления подряд на одно показание, а при выключенной не давал ни одного. */

        /* В лог — каждое ФАКТИЧЕСКОЕ обновление. Когда баннер снова застрянет, по логу будет видно,
           мы ли перестали отдавать или система перестала принимать. */
        NSLog("SugarLife: баннер — \(итог), показание \(число), инс. \(monitor["confirmedIOB"] as? Double ?? -1)")
        /* И В ЖУРНАЛ ДВИЖКА — ЧТОБЫ ЭТО МОЖНО БЫЛО ПРОЧИТАТЬ С ТЕЛЕФОНА (#559).

           NSLog виден только тому, кто держит телефон подключённым к Xcode в эту минуту. А застревает
           баннер не в эту минуту, а ночью, и разбирать потом нечего: строки уже нет.

           Журнал движка выгружается с устройства целиком, и по нему видно ровно то, что нужно: «мы
           отдали и система приняла», «мы решили, что менять нечего», «активность была закрыта».

           СХЛОПЫВАНИЕ ДЕРЖИТ ДВИЖОК (мост 1.50, ядро #138). Раньше мы сами писали только смену
           исхода, чтобы одинаковые «обновлено» не засоряли журнал. Но резали мы при этом и лог —
           а лог обязан отвечать на «выполнялось ли приложение в 3:40», и вырезанная строка отвечать
           на это перестаёт. Теперь отдаём каждый исход с именем развилки: в лог движок кладёт
           событие, в журнал решений — только переход. Одно правило, одно место. */
        вЖурнал(итог == "обновлено" || итог == "запущено" ? "Info" : "Warn", "banner", итог,
                решение: "banner")
        return итог
    }



    
    /* ЧТО БЫЛО ИЗВЕСТНО ДО РАЗРЫВА — ТОЛЬКО ЧИСЛО (замечание владельца).

       Здесь стояло «8,3 в 17:26», и рядом на той же карточке крупно шёл счётчик разрыва — «54:54».
       Одно и то же время сказано дважды, причём в двух разных видах: считай сам, сходится ли.

       Оставляем число. Сколько прошло, уже показывает счётчик, и он для этого точнее: идёт сам,
       без нашего участия, и не устареет, пока баннер стоит. */
    private func последнееПоказание(число: String, когдаМс: Double) -> String {
        число
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
            self?.engineQueue.async { self?.engine?.attachDriverProvider(provider: provider) }
        }
    }

    /**
     Проверочная тревога — тем же путём, что настоящая (#418, #482).

     Иначе узнать, работают ли тревоги, можно только когда ночью случится гипогликемия. Проходит весь
     путь целиком: разрешение, уведомление, свой звук поверх беззвучного режима.
     */
    @objc func testAlarm(_ call: CAPPluginCall) {
        Тревоги.общие.спроситьРазрешение { _ in
            Тревоги.общие.проверочная()
            call.resolve()
        }
    }

    /**
     Готовность тревог на айфоне (#468, #482).

     Ответ короче андроидного и держится на двух фактах: разрешены ли уведомления и живём ли мы в фоне.
     Третьего у iOS нет: ни канала, ни обхода «не беспокоить», ни полноэкранных уведомлений.
     */
    @objc func alarmReadiness(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            var поломки: [[String: String]] = []
            let разрешено = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
            if !разрешено {
                поломки.append(["code": "notifications-off",
                                "text": "уведомления выключены — показать тревогу нечем"])
            }
            if ФоновоеБодрствование.shared.режим == .выключено {
                поломки.append(["code": "ios-keep-alive",
                                "text": "фоновое бодрствование выключено — в фоне приложение уснёт, и тревога не прозвучит"])
            }
            /* СРОЧНЫЕ УВЕДОМЛЕНИЯ — БЕЗ НИХ «НЕ БЕСПОКОИТЬ» ПРЯЧЕТ ТРЕВОГУ (#500).

               Владелец увидел это вживую: сирена прозвучала (наш звук — не уведомление), а карточки
               на экране не было. Причины две, и они разные:
                 — notSupported: сборка подписана без права на срочные — уровень timeSensitive система
                   молча понижает до обычного. Чинится только переустановкой, кнопка настроек не поможет;
                 — disabled: право есть, но человек выключил срочные для приложения — чинится в его
                   настройках уведомлений. */
            if #available(iOS 15.0, *) {
                switch s.timeSensitiveSetting {
                case .notSupported:
                    поломки.append(["code": "time-sensitive-unsupported",
                                    "text": "эта сборка без права на срочные уведомления — при «Не беспокоить» тревогу спрячут; обновите приложение целиком"])
                case .disabled:
                    поломки.append(["code": "time-sensitive-off",
                                    "text": "срочные уведомления выключены — при «Не беспокоить» тревогу спрячут"])
                default: break
                }
                /* Сводка по расписанию копит уведомления и отдаёт пачкой в назначенный час. Тревога,
                   пришедшая «в сводке», — это тревога, пришедшая после гипогликемии. */
                if s.scheduledDeliverySetting == .enabled {
                    поломки.append(["code": "scheduled-summary",
                                    "text": "уведомления приходят по расписанию сводки — тревога может задержаться до часа сводки"])
                }
            }
            if s.lockScreenSetting == .disabled {
                поломки.append(["code": "lock-screen-off",
                                "text": "на экране блокировки уведомления выключены — ночью тревогу не увидеть, не разблокировав телефон"])
            }
            /* Убавленная громкость — поломка ровно до тех пор, пока мы не поднимаем её сами. Порог
               низкий: на трети громкости из-под подушки тревогу уже можно проспать. */
            if !Громкость.общая.поднимаем && Громкость.общая.сейчас < 0.35 {
                поломки.append(["code": "ios-volume",
                                "text": "громкость телефона убавлена, а поднимать её на тревоге запрещено"])
            }
            call.resolve([
                "problem": !поломки.isEmpty,
                "missing": поломки.map { $0["text"] ?? "" },
                "problems": поломки,
            ])
        }
    }

    /**
     Настройки уведомлений приложения (#468).

     Андроидному «доступу к не беспокоить» на айфоне соответствия нет: разрешение здесь одно, и
     ведёт к нему один экран — карточка приложения в системных настройках.
     */
    /**
     Громкость тревоги: поднимаем ли и какая она сейчас (#482).

     Экран показывает и то и другое: «поднимаем» — это обещание, а текущий уровень — то, что человек
     услышит, если обещание выключено.
     */
    /**
     Активный инсулин от веб-слоя (#500).

     В облачном режиме его считает не движок, а Nightscout, и приходит он в приложение, а не в
     нативную часть. Для сводки в шторке этого числа иначе не достать: в фоне webview спит.
     Пустое значение — «мы не знаем», и тогда сводка про инсулин молчит.
     */
    @objc func reportActiveInsulin(_ call: CAPPluginCall) {
        Сводка.общая.принятьИнсулин(call.getDouble("iob"))
        call.resolve()
    }

    /**
     Сахар цифрами на значке приложения (Значок.swift).

     Отдаём и список возможных видов: экран не должен держать их копией — иначе новый вид появится в
     нативе, а выбрать его будет негде.
     */
    /* КУДА ВЕЛИ ЧЕЛОВЕКА, ПОКА ЭКРАНА ЕЩЁ НЕ БЫЛО (#524).

       Приложение могли выгрузить: нажатие на уведомление поднимет его с нуля, и цель придёт раньше,
       чем веб успеет подписаться. Держим последнюю здесь и отдаём, когда спросят, — иначе теряли бы
       её ровно в самом важном случае. */
    private static var ожидающаяЦельПерехода: String?

    @objc func ожидающаяЦель(_ call: CAPPluginCall) {
        let цель = SugarLifeBridgePlugin.ожидающаяЦельПерехода ?? ""
        SugarLifeBridgePlugin.ожидающаяЦельПерехода = nil
        call.resolve(["цель": цель])
    }

    @objc func glucoseBadge(_ call: CAPPluginCall) {
        call.resolve([
            "mode": Значок.общий.вид.rawValue,
            "modes": Значок.Вид.allCases.map { $0.rawValue },
        ])
    }

    @objc func setGlucoseBadge(_ call: CAPPluginCall) {
        if let вид = Значок.Вид(rawValue: call.getString("mode") ?? "") { Значок.общий.вид = вид }
        call.resolve(["mode": Значок.общий.вид.rawValue])
    }

    /// Сводка в шторке: показывать ли (Сводка.swift).
    @objc func statusNote(_ call: CAPPluginCall) {
        call.resolve(["on": Сводка.общая.включена, "pop": Сводка.общая.всплывает])
    }

    @objc func setStatusNote(_ call: CAPPluginCall) {
        if let on = call.getBool("on") { Сводка.общая.включена = on }
        /* Повадку меняем отдельно от самого переключателя: экран шлёт то, что человек тронул, а не
           оба значения разом — иначе включение сводки заодно молча сбрасывало бы всплытие. */
        if let pop = call.getBool("pop") { Сводка.общая.всплывает = pop }
        call.resolve(["on": Сводка.общая.включена, "pop": Сводка.общая.всплывает])
    }

    /* ЧТО НАМ РАЗРЕШЕНО — СПИСКОМ (#538). Слова живут в вебе, здесь только коды и состояния:
       иначе одно и то же разрешение называлось бы по-разному на двух платформах. */
    @objc func permissions(_ call: CAPPluginCall) {
        Разрешения.собрать { список in call.resolve(["список": список]) }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        Разрешения.спросить(id) { _ in
            /* Отвечаем не «да/нет», а свежим списком: система могла изменить и соседние строки —
               разрешив уведомления, человек включает заодно экран блокировки и срочные. */
            Разрешения.собрать { список in call.resolve(["список": список]) }
        }
    }

    @objc func openPermissionSettings(_ call: CAPPluginCall) {
        открытьНастройкиПриложения()
        call.resolve()
    }

    @objc func alarmVolume(_ call: CAPPluginCall) {
        call.resolve(["boost": Громкость.общая.поднимаем, "level": Double(Громкость.общая.сейчас)])
    }

    @objc func setAlarmVolume(_ call: CAPPluginCall) {
        Громкость.общая.поднимаем = call.getBool("boost") ?? true
        call.resolve(["boost": Громкость.общая.поднимаем])
    }

    @objc func openAlarmSettings(_ call: CAPPluginCall) {
        открытьНастройкиПриложения()
        call.resolve()
    }

    @objc func requestSnapshot(_ call: CAPPluginCall) {
        /*
         СНАЧАЛА ПОСЛЕДНИЙ ИЗВЕСТНЫЙ, И ТОЛЬКО ПОТОМ ОЧЕРЕДЬ (core#110).

         Снято на Android, но причина общая: пока драйвер добирает историю, очередь движка занята тысячами
         событий, и запрос снимка ждёт вместе с ней. Последний разосланный снимок отстаёт на сотую долю
         секунды и отдаётся сразу.
         */
        if let последний = engine?.lastSnapshot() {
            call.resolve(["json": последний]); return
        }
        engineQueue.async { [weak self] in
            call.resolve(["json": self?.engine?.requestSnapshot() ?? Self.emptySnapshot])
        }
    }

    @objc func sendIntent(_ call: CAPPluginCall) {
        let json = call.getString("json") ?? ""
        // Экспорт лога перехватываем ДО движка (как Android): редактированный NDJSON → share sheet ОС.
        if json.contains("\"exportLog\"") {
            ВыгрузкаЖурнала.отдать(ndjson: engine?.exportLog(), контроллер: bridge?.viewController,
                                   вЖурнал: { self.вЖурнал($0, "log", $1) })
            return call.resolve(["json": "{\"accepted\":true}"])
        }
        /* «Открыть настройки» — наше дело, а не движка (SugarLife#333, контракт: «куда вести, знает
           движок, КАК открыть — натив»). Раньше интент уходил в движок, тот честно писал в журнал
           `intent-not-handled` и всё равно отвечал `accepted: true`: кнопка выглядела рабочей и не
           делала ничего.

           На iOS системный экран ровно один — настройки нашего приложения. Отдельных страниц Bluetooth
           или геолокации приложениям не открывают, и притворяться, что мы ведём именно туда, нельзя:
           человек всё равно окажется на общей странице, и обещание разойдётся с тем, что он увидит. */
        if json.contains("\"openSystemScreen\"") {
            открытьНастройкиПриложения()
            return call.resolve(["json": "{\"accepted\":true}"])
        }
        // Скан и провайдер — на своей очереди вместе с движком (core#82): `ensureProvider` тянет за собой
        // восстановление приборов из базы, а это уже разговор с движком.
        engineQueue.async { [weak self] in
            /* НЕ ОТВЕТИТЬ НА ВЫЗОВ — ХУЖЕ, ЧЕМ ОТВЕТИТЬ ОТКАЗОМ.

               Здесь стояло `guard let self else { return }`. Плагина не стало — блок выходил молча,
               и обещание на стороне веба не выполнялось и не отвергалось НИКОГДА. Тот, кто его ждал,
               ждал вечно; «потяни, чтобы обновить» на этом и замерзало насмерть.

               Отказ веб переживёт: он его прочитает и покажет. Тишину прочитать нельзя. */
            guard let self else {
                return call.resolve(["json": "{\"accepted\":false,\"error\":\"bridge gone\"}"])
            }
            if json.contains("\"startScan\"") { self.ensureProvider(); self.scanner.start() }
            else if json.contains("\"stopScan\"") { self.scanner.stop() }
            else if json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") { self.ensureProvider() }
            call.resolve(["json": self.engine?.sendIntent(json: json) ?? "{\"accepted\":false,\"error\":\"engine not ready\"}"])
        }
    }

    /// Настройки приложения — единственный системный экран, который iOS даёт открыть из приложения.
    private func открытьНастройкиПриложения() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
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
