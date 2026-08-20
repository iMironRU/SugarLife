import Foundation
import SugarLifeKit

/**
 ОТДАЁМ ПОКАЗАНИЯ ПЕТЛЕ (SugarLife#413, ядро core#100).

 На Android для этого есть системное вещание — приложения там умеют кричать в эфир, и AAPS слушает. На iOS
 такого нет вовсе, зато есть ОБЩИЙ КОНТЕЙНЕР: две программы одной команды разработчика могут писать и читать
 одно хранилище настроек.

 Именно так с iAPS разговаривают xDrip4iOS и Glucose Direct. Формат снят с исходников iAPS
 (`FreeAPS/Sources/APS/CGM/AppGroupCGM/AppGroupSource.swift`), а не придуман:

   ключ `latestReadings` — массив словарей, СВЕЖЕЕ ПЕРВЫМ;
   {"DT": "/Date(<мс>)/", "ST": "/Date(<мс>)/", "Value": <мг/дл, целое>, "direction": "Flat", "from": "…"}

 iAPS читает контейнер раз в десять секунд, берёт до шестидесяти записей и принимает только те, у которых
 `from` совпадает с первой. Незнакомое имя источника он не отвергает — показывает как есть. Значит
 притворяться чужим приложением не нужно: пишем своё имя.

 СЕРДЦЕБИЕНИЕ ПО BLE МЫ НЕ ПУБЛИКУЕМ, и это осознанно. xDrip4iOS кладёт в тот же контейнер адрес и UUID
 своего трансмиттера, чтобы iAPS подключался к нему и просыпался от эфира. У BLE-периферии один центральный:
 сделай мы так же — и петля начнёт отбирать у нас сенсор. Ровно эту беду мы лечим правилом «один центральный
 на прибор». У петли есть свой источник пробуждения — связь с помпой.

 ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ. По этим числам петля считает дозу инсулина; включение — шаг человека, а не наше
 поведение из коробки. Тем более пока наша калибровка расходится с эталоном (core#104).
 */
final class LoopFeed: NSObject, GlucoseBroadcaster {

    static let shared = LoopFeed()

    /// Своя очередь: запись в общий контейнер идёт из потока движка, а он не должен ждать диска.
    private let очередь = DispatchQueue(label: "ru.imiron.sugarlife.loopfeed")

    /// Ключ, под которым петля ищет показания. Имя не наше — оно из iAPS, менять нельзя.
    private static let КЛЮЧ_ПОКАЗАНИЙ = "latestReadings"

    /// Наш выключатель — в СВОИХ настройках, не в общих: чужому приложению до него дела нет.
    private static let КЛЮЧ_ВКЛЮЧЕНО = "sugarlife.loop-feed.enabled"

    /// Сколько последних показаний держим. Петля читает до шестидесяти — больше писать незачем.
    private static let ГЛУБИНА = 60

    /// Как мы подписываемся в петле. Своё имя, без маскарада: iAPS покажет его как есть.
    private static let ИМЯ_ИСТОЧНИКА = "SugarLife"

    // MARK: - Настройка

    /// Имя общего контейнера. Берём из своего Info.plist тем же способом, что и iAPS из своего.
    static var контейнер: String? {
        (Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String)?
            .trimmingCharacters(in: .whitespaces)
            .nilЕслиПусто
    }

    static var включено: Bool { UserDefaults.standard.bool(forKey: КЛЮЧ_ВКЛЮЧЕНО) }

    static func включить(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: КЛЮЧ_ВКЛЮЧЕНО)
        NSLog("SugarLife: отдача в петлю \(on ? "включена" : "выключена")")
        if on, доступность() != nil { NSLog("SugarLife: но отдавать некуда — \(доступность()!)") }
    }

    /**
     Чего не хватает, чтобы отдавать. `nil` — всё на месте.

     Отвечаем словами, а не «не работает»: общий контейнер требует одинаковой подписи у обеих программ, и
     человек должен узнать об этом от нас, а не гадать, почему петля не видит показаний.
     */
    static func доступность() -> String? {
        guard let имя = контейнер else {
            return "в сборке не объявлен общий контейнер (AppGroupID в Info.plist)"
        }
        guard UserDefaults(suiteName: имя) != nil else {
            return "нет доступа к контейнеру \(имя) — он не объявлен в подписи приложения"
        }
        return nil
    }

    // MARK: - Отдача

    func publish(reading: GlucoseBroadcast) {
        guard Self.включено else { return }
        guard let имя = Self.контейнер, let общие = UserDefaults(suiteName: имя) else {
            Self.пожаловатьсяРазВМинуту()
            return
        }
        // Значение уже калиброванное и уже в мг/дл — перевод делает ядро, в одном месте (core#100).
        let запись: [String: Any] = [
            "DT": Self.датаКакУНих(reading.atMs),
            "ST": Self.датаКакУНих(reading.atMs),
            "Value": Int(reading.mgdl.rounded()),
            "direction": Self.оноЖеУНих(reading.trend),
            "Trend": Self.номерТренда(reading.trend),
            "from": Self.ИМЯ_ИСТОЧНИКА,
        ]
        очередь.async {
            var список: [[String: Any]] = []
            if let было = общие.data(forKey: Self.КЛЮЧ_ПОКАЗАНИЙ),
               let разобрано = (try? JSONSerialization.jsonObject(with: было)) as? [[String: Any]] {
                // Своё же и продолжаем: если в контейнере пишет кто-то ещё, мешать наши записи с чужими
                // нельзя — петля берёт только те, у которых источник совпадает с первой, и половина
                // показаний потерялась бы молча.
                список = разобрано.filter { ($0["from"] as? String) == Self.ИМЯ_ИСТОЧНИКА }
            }
            // Повтор той же минуты не задваиваем: показание опознаётся по времени.
            let это = запись["DT"] as? String
            список.removeAll { ($0["DT"] as? String) == это }
            список.insert(запись, at: 0)
            if список.count > Self.ГЛУБИНА { список = Array(список.prefix(Self.ГЛУБИНА)) }
            guard let данные = try? JSONSerialization.data(withJSONObject: список) else { return }
            общие.set(данные, forKey: Self.КЛЮЧ_ПОКАЗАНИЙ)
        }
    }

    // MARK: - Мелочи формата

    /// Время в том виде, в каком его ждёт петля: `/Date(1757767879000)/`.
    private static func датаКакУНих(_ мс: Int64) -> String { "/Date(\(мс))/" }

    /**
     Наши названия тренда — в те, что понимает получатель.

     У него это строки xDrip: `Flat`, `FortyFiveUp`, `SingleUp` и так далее. Незнакомое имя он превратит в
     «неизвестно», поэтому переводим сами, а не надеемся на совпадение. Таблица та же, что на Android, —
     и это правило: одно и то же показание должно приходить в петлю одинаково с обоих телефонов.
     */
    private static func оноЖеУНих(_ наш: String?) -> String {
        switch наш {
        case "Rising", "Up": return "SingleUp"
        case "RisingSlowly", "SlowlyUp": return "FortyFiveUp"
        case "Stable", "Flat": return "Flat"
        case "FallingSlowly", "SlowlyDown": return "FortyFiveDown"
        case "Falling", "Down": return "SingleDown"
        default: return "NOT COMPUTABLE"
        }
    }

    /// Тот же тренд числом — как его нумерует xDrip. Петля сейчас это поле не читает, но пишем: оно её.
    private static func номерТренда(_ наш: String?) -> Int {
        switch оноЖеУНих(наш) {
        case "DoubleUp": return 1
        case "SingleUp": return 2
        case "FortyFiveUp": return 3
        case "Flat": return 4
        case "FortyFiveDown": return 5
        case "SingleDown": return 6
        case "DoubleDown": return 7
        default: return 0
        }
    }

    /// Жалуемся редко: показание приходит раз в минуту, а причина одна и та же.
    private static var последняяЖалоба: Date?
    private static func пожаловатьсяРазВМинуту() {
        let сейчас = Date()
        if let было = последняяЖалоба, сейчас.timeIntervalSince(было) < 60 { return }
        последняяЖалоба = сейчас
        NSLog("SugarLife: отдать показание в петлю не смогли — \(доступность() ?? "причина неизвестна")")
    }
}

private extension String {
    var nilЕслиПусто: String? { isEmpty ? nil : self }
}
