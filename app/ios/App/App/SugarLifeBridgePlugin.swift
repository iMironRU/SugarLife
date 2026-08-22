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
        if #available(iOS 16.2, *) {
            call.resolve([
                "supported": true,
                "on": UserDefaults.standard.bool(forKey: "sl.live-banner"),
                "running": ЖивойБаннер.живой,
            ])
        } else {
            /* До 16.2 живых уведомлений нет вовсе. Говорим это прямо, чтобы экран не
               обещал человеку то, чего его телефон не умеет. */
            call.resolve(["supported": false, "on": false, "running": false])
        }
    }

    @objc func setLiveBanner(_ call: CAPPluginCall) {
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

    @objc func setBackgroundKeepAlive(_ call: CAPPluginCall) {
        guard let raw = call.getString("mode"),
              let режим = ФоновоеБодрствование.Режим(rawValue: raw) else {
            call.reject("неизвестный режим: \(call.getString("mode") ?? "—")")
            return
        }
        ФоновоеБодрствование.shared.установить(режим)
        call.resolve(["mode": режим.rawValue])
    }

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
            self.unsubscribe = e.subscribe(onSnapshot: { [weak self] json in
                DispatchQueue.main.async {
                    self?.notifyListeners("snapshot", data: ["json": json])
                    /* Баннер обновляем ЗДЕСЬ, а не из веб-слоя (#428). Ночью и в кармане
                       webview усыплён, а этот код живёт, пока приложение просыпается от
                       эфира BLE (#379). Обновление из JS работало бы ровно тогда, когда
                       человек и так смотрит на экран, — то есть когда баннер не нужен. */
                    self?.последнийСнимок = json
                    if #available(iOS 16.2, *) { _ = self?.обновитьЖивойБаннер(json) }
                }
            })
            e.startAsync()
            // Boot-реконнект BLE: если доступ к Bluetooth уже выдан — цепляем провайдер сразу, движок
            // переподнимет сохранённые сенсор/помпу из БД (без ожидания скана). notDetermined — отложим
            // до первого скана (не показываем системный запрос на старте; restore сработает при первом attach).
            if CBManager.authorization == .allowedAlways { self.ensureProvider() }
        }
    }
    /// Последний снимок — чтобы включённый баннер показал число сразу, а не через пять минут.
    private var последнийСнимок: String?

    /* Из снимка — в состояние баннера.

       Разбираем ровно то, что показываем: значение, тренд, время. Единицы не трогаем —
       движок отдаёт готовую строку в тех единицах, которые выбрал человек, и второй
       формат здесь означал бы, что на экране блокировки и в приложении разные числа. */
    @available(iOS 16.2, *)
    @discardableResult
    private func обновитьЖивойБаннер(_ json: String?) -> String {
        guard UserDefaults.standard.bool(forKey: "sl.live-banner") else { return "выключено" }
        guard let json, let data = json.data(using: .utf8),
              let корень = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let monitor = корень["monitor"] as? [String: Any] else { return "нет снимка" }

        let значение = (monitor["glucose"] as? String) ?? "—"
        guard значение != "—", !значение.isEmpty else { return "нет числа" }

        let стрелка = стрелкаТренда(monitor["trend"] as? String)
        let когдаМс = (monitor["latestAtMs"] as? Double) ?? Date().timeIntervalSince1970 * 1000
        /* «Старое» решает движок своим статусом, а не мы порогом: два мнения о свежести
           разойдутся в первый же день (та же причина, что в domain/freshness.ts). */
        let старое = ((monitor["status"] as? String) ?? "") != "Live"
        /* Ряд для графика копим здесь же: снимок несёт одно число, а линии нужен час (#428).
           Число берём то, что уже посчитано движком, а не парсим строку значения обратно —
           две дороги к одному числу разойдутся на округлении. */
        let ряд: [СахарАтрибуты.ContentState.Точка]
        if let mmol = monitor["glucoseMmol"] as? Double, mmol > 0 {
            ряд = ИсторияСахара.добавить(значение: mmol, когдаМс: когдаМс)
        } else {
            ряд = ИсторияСахара.ряд()
        }
        return ЖивойБаннер.обновить(
            значение: значение, стрелка: стрелка, разница: "",
            когдаМс: когдаМс, старое: старое,
            источник: (monitor["source"] as? String) ?? "сенсор",
            ряд: ряд
        )
    }

    /// Тренд движка — стрелкой. Незнакомое значение отдаём пустым: выдуманная стрелка
    /// хуже отсутствующей, по ней принимают решение о дозе.
    private func стрелкаТренда(_ t: String?) -> String {
        switch t {
        case "DoubleUp", "SingleUp": return "↑"
        case "FortyFiveUp": return "↗"
        case "Flat": return "→"
        case "FortyFiveDown": return "↘"
        case "SingleDown", "DoubleDown": return "↓"
        default: return ""
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
            self?.engineQueue.async { self?.engine?.attachDriverProvider(provider: provider) }
        }
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
        if json.contains("\"exportLog\"") { exportAndShare(); return call.resolve(["json": "{\"accepted\":true}"]) }
        // Скан и провайдер — на своей очереди вместе с движком (core#82): `ensureProvider` тянет за собой
        // восстановление приборов из базы, а это уже разговор с движком.
        engineQueue.async { [weak self] in
            guard let self else { return }
            if json.contains("\"startScan\"") { self.ensureProvider(); self.scanner.start() }
            else if json.contains("\"stopScan\"") { self.scanner.stop() }
            else if json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") { self.ensureProvider() }
            call.resolve(["json": self.engine?.sendIntent(json: json) ?? "{\"accepted\":false,\"error\":\"engine not ready\"}"])
        }
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
