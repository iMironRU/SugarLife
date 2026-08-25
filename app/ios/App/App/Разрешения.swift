import Foundation
import UserNotifications
import CoreBluetooth
import AVFoundation
import UIKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/**
 ЧТО РАЗРЕШЕНО НАШЕМУ ПРИЛОЖЕНИЮ — ОДНИМ СПИСКОМ (SugarLife#538).

 Разрешения раскиданы по системным настройкам так, что собрать картину невозможно: уведомления в
 одном месте, срочные — внутри них, Bluetooth в третьем, фоновое обновление в четвёртом. Человек
 узнаёт о запрете не тогда, когда его дал, а тогда, когда не сработала тревога.

 ПОЭТОМУ СПИСОК ЧИТАЕТСЯ, А НЕ НАСТРАИВАЕТСЯ. Половину этих переключателей приложение изменить не
 может — их держит система, и единственное честное действие для них «открыть настройки». Спросить мы
 вправе ровно один раз и только то, чего ещё не спрашивали: отказ окончателен, повторный запрос
 система молча проглотит. Здесь это видно прямо в списке — «спросить» появляется только там, где
 вопрос ещё имеет смысл.

 ЧЕГО ЗДЕСЬ НЕТ — тоже решение. Не спрашиваем ни геопозицию (на iOS для наших задач она не нужна),
 ни доступ к фото: разрешение, которое не используется, всё равно однажды станет вопросом «зачем им
 это», а ответа не будет.
 */
enum Разрешения {

    /// Состояние одного разрешения. Слова — на стороне веба, здесь только коды.
    struct Пункт {
        let id: String
        let статус: Статус
        /// Можно ли ещё спросить: система разрешает вопрос ровно однажды.
        let спросить: Bool
    }

    enum Статус: String {
        case разрешено, нет, неСпрашивали = "не спрашивали", частично, неизвестно
    }

    static func собрать(_ готово: @escaping ([[String: Any]]) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            var список: [Пункт] = []

            /* УВЕДОМЛЕНИЯ — ОСНОВАНИЕ ВСЕГО ОСТАЛЬНОГО. Без них не будет ни тревоги, ни сводки, ни
               перехода по нажатию: приложение теряет единственный способ заговорить первым. */
            let увед: Статус
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: увед = .разрешено
            case .denied: увед = .нет
            case .notDetermined: увед = .неСпрашивали
            @unknown default: увед = .неизвестно
            }
            список.append(Пункт(id: "уведомления", статус: увед, спросить: увед == .неСпрашивали))

            if #available(iOS 15.0, *) {
                /* Срочные — то, чем тревога пробивает «Не беспокоить». Спросить их отдельно нельзя:
                   право либо вшито в подпись сборки, либо человек выключил его в настройках. */
                let срочные: Статус
                switch s.timeSensitiveSetting {
                case .enabled: срочные = .разрешено
                case .disabled: срочные = .нет
                case .notSupported: срочные = .неизвестно
                @unknown default: срочные = .неизвестно
                }
                список.append(Пункт(id: "срочные", статус: срочные, спросить: false))
            }

            /* Экран блокировки: ночью тревогу видно только там. Выключенный — это не мелочь
               оформления, а «увидите, когда разблокируете». */
            let блок: Статус = s.lockScreenSetting == .enabled ? .разрешено
                : (s.lockScreenSetting == .disabled ? .нет : .неизвестно)
            список.append(Пункт(id: "экран-блокировки", статус: блок, спросить: false))

            if #available(iOS 16.2, *) {
                let живые = ActivityAuthorizationInfo().areActivitiesEnabled
                список.append(Пункт(id: "живые-уведомления", статус: живые ? .разрешено : .нет, спросить: false))
            }

            /* Bluetooth: на облаке он не нужен вовсе, а с сенсором без него нет ничего. Спрашивает
               система сама при первом обращении к радио — нашего вопроса тут нет. */
            let bt: Статус
            switch CBCentralManager.authorization {
            case .allowedAlways: bt = .разрешено
            case .denied, .restricted: bt = .нет
            case .notDetermined: bt = .неСпрашивали
            @unknown default: bt = .неизвестно
            }
            список.append(Пункт(id: "bluetooth", статус: bt, спросить: false))

            /* Камера — только ради кода с коробки сенсора. Спросить можно и нужно по месту, но и
               здесь: человек, однажды отказавший, иначе не поймёт, почему сканер не открывается. */
            let кам: Статус
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: кам = .разрешено
            case .denied, .restricted: кам = .нет
            case .notDetermined: кам = .неСпрашивали
            @unknown default: кам = .неизвестно
            }
            список.append(Пункт(id: "камера", статус: кам, спросить: кам == .неСпрашивали))

            DispatchQueue.main.async {
                /* Фоновое обновление — общий выключатель системы для всей фоновой жизни приложения.
                   Спрашивается только с главного потока: это свойство UIApplication. */
                let фон: Статус
                switch UIApplication.shared.backgroundRefreshStatus {
                case .available: фон = .разрешено
                case .denied: фон = .нет
                case .restricted: фон = .частично
                @unknown default: фон = .неизвестно
                }
                список.append(Пункт(id: "фоновое-обновление", статус: фон, спросить: false))

                готово(список.map { ["id": $0.id, "статус": $0.статус.rawValue, "спросить": $0.спросить] })
            }
        }
    }

    /// Спросить то, что ещё можно спросить. Всё остальное — только через настройки телефона.
    static func спросить(_ id: String, _ готово: @escaping (Bool) -> Void) {
        switch id {
        case "уведомления":
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { ок, _ in
                DispatchQueue.main.async { готово(ок) }
            }
        case "камера":
            AVCaptureDevice.requestAccess(for: .video) { ок in DispatchQueue.main.async { готово(ок) } }
        default:
            готово(false)
        }
    }
}
