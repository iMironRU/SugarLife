import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/*
 Управление живым баннером со стороны приложения (#428).

 РАСШИРЕНИЕ НИЧЕГО НЕ СЧИТАЕТ. Оно живёт отдельным процессом и данных не имеет — всё, что
 оно рисует, приезжает отсюда готовым: строка значения, стрелка, разница, время. Слова и
 форматы живут там, где живут остальные слова приложения, а не в двух местах сразу.

 ПРОДЛЕВАТЬ, А НЕ ЗАПУСКАТЬ ОДНАЖДЫ. Система гасит Live Activity через восемь часов и
 снимает через двенадцать. Баннер, запущенный вечером и забытый, к утру исчезнет — и
 человек решит, что приложение сломалось. Поэтому запуск идемпотентный: если баннер жив,
 мы его обновляем, если нет — поднимаем заново.

 СТАРОЕ ПОКАЗАНИЕ ПОМЕЧАЕМ. Число без возраста на экране блокировки — самый опасный вид
 вранья: оно выглядит текущим всегда. Возраст считает система по метке времени, а признак
 «старое» приходит от приложения, потому что порог свежести знает движок, а не виджет.
 */
@available(iOS 16.2, *)
enum ЖивойБаннер {
    #if canImport(ActivityKit)
    private static var текущий: Activity<СахарАтрибуты>?

    static func обновить(
        значение: String, стрелка: String, разница: String, когдаМс: Double, старое: Bool, источник: String
    ) -> String {
        let состояние = СахарАтрибуты.ContentState(
            значение: значение,
            стрелка: стрелка,
            разница: разница,
            когда: Date(timeIntervalSince1970: когдаМс / 1000),
            старое: старое
        )

        /* Человек мог выключить живые уведомления в настройках телефона — это его право, и
           обходить его нечем. Говорим правду наверх, чтобы экран мог объяснить, почему
           баннера нет, вместо того чтобы молча ничего не делать. */
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "выключено в настройках" }

        if let активный = текущий ?? Activity<СахарАтрибуты>.activities.first {
            текущий = активный
            Task { await активный.update(ActivityContent(state: состояние, staleDate: nil)) }
            return "обновлено"
        }

        do {
            текущий = try Activity.request(
                attributes: СахарАтрибуты(источник: источник),
                content: ActivityContent(state: состояние, staleDate: nil),
                pushType: nil
            )
            return "запущено"
        } catch {
            return "не удалось: \(error.localizedDescription)"
        }
    }

    static func погасить() {
        let все = Activity<СахарАтрибуты>.activities
        текущий = nil
        for а in все {
            Task { await а.end(nil, dismissalPolicy: .immediate) }
        }
    }

    static var живой: Bool { !Activity<СахарАтрибуты>.activities.isEmpty }
    #else
    static func обновить(значение: String, стрелка: String, разница: String, когдаМс: Double, старое: Bool, источник: String) -> String { "нет ActivityKit" }
    static func погасить() {}
    static var живой: Bool { false }
    #endif
}
