import Foundation
#if canImport(HealthKit)
import HealthKit
#endif

/* СОН ИЗ APPLE HEALTH (SugarLife#597, ядро #177).

   Читать может только натив: HealthKit — API платформы, общий код движка до него не дотянется.
   Но решение «спит или нет» принимаем НЕ МЫ: мы отдаём наблюдения интентом `reportSleep`, окно
   выводит движок медианой за две недели. Владелец поймал нас ровно на этом вопросом «из Health
   разве мы читаем, а не ядро?» — читаем мы, отвечает он.

   ЧЕТЫРЕ СОСТОЯНИЯ ИСТОЧНИКА, А НЕ ТРИ. Ядро повторило это дважды, и оно право:

     yes      данные есть
     no       HealthKit недоступен на этом устройстве
     denied   человек не дал читать
     unknown  разрешение есть, а данных ещё не приходило — часы не синхронизировались,
              человек надел их вчера

   «Сна не было» и «мы ещё не знаем» — разные ответы. По второму движок решает, сказать ли человеку
   «окно у нас общее, а не ваше», и спутать их значит соврать ему про защиту.

   ОТКРЫТАЯ СЕССИЯ ОТДЕЛЬНЫМ ПОЛЕМ. Ядро верит ей тридцать минут после `observedAtMs`: сессия, не
   обновлявшаяся час, о «сейчас» не говорит ничего — человек мог встать, а прибор ещё не рассказал. */
enum СонИзЗдоровья {
    /// Две недели: столько ядру нужно, чтобы вывести окно медианой.
    private static let ОКНО_СУТОК = 14

    #if canImport(HealthKit)
    private static let хранилище = HKHealthStore()

    private static var типСна: HKCategoryType? {
        HKObjectType.categoryType(forIdentifier: .sleepAnalysis)
    }

    /// Прочитать сессии сна за две недели. Ответ уже в форме интента `reportSleep`.
    static func прочитать(_ готово: @escaping ([String: Any]) -> Void) {
        guard HKHealthStore.isHealthDataAvailable(), let тип = типСна else {
            готово(["available": "no", "sessions": []]); return
        }
        /* Право на чтение HealthKit НЕ ОТДАЁТ: `authorizationStatus` для чтения всегда говорит
           `notDetermined`, это сделано намеренно — иначе приложение узнавало бы о человеке то,
           чего он не рассказывал. Поэтому «отказано» мы отличаем не по статусу, а по ошибке
           запроса: пустой ответ без ошибки — это «данных нет», ошибка — «не дали». */
        let от = Calendar.current.date(byAdding: .day, value: -ОКНО_СУТОК, to: Date()) ?? Date()
        let период = HKQuery.predicateForSamples(withStart: от, end: Date(), options: [])
        let порядок = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let запрос = HKSampleQuery(sampleType: тип, predicate: период,
                                   limit: HKObjectQueryNoLimit, sortDescriptors: [порядок]) { _, образцы, ошибка in
            if ошибка != nil {
                готово(["available": "denied", "sessions": []]); return
            }
            let сессии = (образцы as? [HKCategorySample] ?? []).compactMap { собрать($0) }
            /* Разрешение есть, а сессий нет — это `unknown`, а не `yes` с пустым списком: часы
               могли не синхронизироваться ни разу. */
            готово([
                "available": сессии.isEmpty ? "unknown" : "yes",
                "sessions": сессии.map { $0.поле },
                "openSinceMs": открытая(сессии) as Any,
                "observedAtMs": Int(Date().timeIntervalSince1970 * 1000),
            ])
        }
        хранилище.execute(запрос)
    }

    private struct Сессия {
        let отМс: Int, доМс: Int, откуда: String
        var поле: [String: Any] { ["fromMs": отМс, "toMs": доМс, "source": откуда] }
    }

    private static func собрать(_ о: HKCategorySample) -> Сессия? {
        /* «В постели» — не сон: человек читал полтора часа. Берём только состояния сна; на iOS 16+
           их несколько (ядро, глубокий, быстрый), и для нас это одно и то же — он спал. */
        let сон: Set<Int> = {
            /* ЕДИНИЦА — ЭТО «СПИТ» В ОБЕИХ СХЕМАХ. До iOS 16 значение называлось `asleep`, с 16-й
               оно же зовётся `asleepUnspecified` — имя сменилось, число осталось.

               Пишем числом намеренно: `asleepUnspecified` доступен только с 16-й (сборка на 15-й
               падает), а старое `asleep` в 16-й объявлено устаревшим и даёт предупреждение. Числом
               мы обходим обе беды разом, а не выбираем между ошибкой и предупреждением. */
            var н: Set<Int> = [1]
            if #available(iOS 16.0, *) {
                н.formUnion([HKCategoryValueSleepAnalysis.asleepCore.rawValue,
                             HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                             HKCategoryValueSleepAnalysis.asleepREM.rawValue])
            }
            return н
        }()
        guard сон.contains(о.value) else { return nil }
        let от = Int(о.startDate.timeIntervalSince1970 * 1000)
        let до = Int(о.endDate.timeIntervalSince1970 * 1000)
        guard до > от else { return nil }
        /* Откуда пришла запись: часы это или сам телефон. Ядру это нужно не для красоты — доверие
           к ним разное, и оно решает, что показать человеку. */
        let источник = о.sourceRevision.source.name.lowercased()
        let откуда = источник.contains("watch") || источник.contains("часы") ? "watch"
            : источник.contains("iphone") || источник.contains("phone") ? "phone" : "unknown"
        return Сессия(отМс: от, доМс: до, откуда: откуда)
    }

    /* Открытая сессия — та, что кончилась только что и, возможно, ещё идёт. HealthKit закрытых
       сессий «в процессе» не отдаёт: часы пишут запись, когда сон уже определён. Поэтому открытой
       считаем последнюю, если она кончилась меньше получаса назад, — и честно отдаём момент её
       начала, а решает движок. */
    private static func открытая(_ сессии: [Сессия]) -> Int? {
        guard let последняя = сессии.last else { return nil }
        let сейчас = Int(Date().timeIntervalSince1970 * 1000)
        return сейчас - последняя.доМс < 30 * 60 * 1000 ? последняя.отМс : nil
    }
    #else
    static func прочитать(_ готово: @escaping ([String: Any]) -> Void) {
        готово(["available": "no", "sessions": []])
    }
    #endif
}
