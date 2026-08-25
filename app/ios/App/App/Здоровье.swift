import Foundation
#if canImport(HealthKit)
import HealthKit
#endif

/**
 ВЕС И ДАВЛЕНИЕ ИЗ «ЗДОРОВЬЯ» — ЧТОБЫ НЕ СПРАШИВАТЬ ТО, ЧТО ТЕЛЕФОН УЖЕ ЗНАЕТ (SugarLife#557).

 В разделе «Здоровье» вес и давление человек вводит руками. Это ровно тот случай, который правила
 проекта называют лишним: весы и тонометр давно кладут свои измерения в Health, часы туда же пишут
 давление, — а мы просим ввести их заново. Нулевой ручной ввод того, что система знает.

 ТОЛЬКО ЧТЕНИЕ, И ТОЛЬКО ДВЕ ВЕЛИЧИНЫ. Запись наружу (глюкоза, инсулин, углеводы) — отдельный
 разговор с ядром: у нас всё, что уходит за пределы приложения, идёт через его коннекторы, и заводить
 второй путь до ответа нельзя. Просить право на запись «про запас» тоже не станем: разрешение,
 которым не пользуются, однажды станет вопросом «зачем им это».

 HEALTHKIT ДОСТУПЕН БЕСПЛАТНОЙ КОМАНДЕ — проверено сборкой на устройство 25 августа 2026: профиль
 личной команды выдан с `com.apple.developer.healthkit`. Это не общее правило: право на срочные
 уведомления и общую группу приложений той же команде Apple не выдаёт (см. debug.xcconfig).

 РАЗРЕШЕНИЕ HEALTH УСТРОЕНО ИНАЧЕ, ЧЕМ ОСТАЛЬНЫЕ. Система не говорит приложению, дали ли ему право
 ЧИТАТЬ: `authorizationStatus` отвечает только про запись. Сделано это нарочно — по одному факту
 отказа можно было бы догадаться о диагнозе. Поэтому «разрешено ли» мы определяем единственно
 честным способом: пробуем прочитать. Пусто — значит либо не дали, либо данных нет, и различить это
 нельзя ни нам, ни кому-либо ещё.
 */
enum ЗдоровьеТелефона {

    #if canImport(HealthKit)
    private static let хранилище = HKHealthStore()

    private static var типы: Set<HKObjectType> {
        var набор: Set<HKObjectType> = []
        if let вес = HKObjectType.quantityType(forIdentifier: .bodyMass) { набор.insert(вес) }
        if let верх = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic) { набор.insert(верх) }
        if let низ = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic) { набор.insert(низ) }
        return набор
    }

    static var доступно: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Спросить право на чтение. Система сама решает, показывать ли лист: второй раз она не спросит.
    static func спросить(_ готово: @escaping (Bool) -> Void) {
        guard доступно else { готово(false); return }
        хранилище.requestAuthorization(toShare: [], read: типы) { ок, _ in
            DispatchQueue.main.async { готово(ок) }
        }
    }

    /// Последний вес (кг) и давление. nil у величины — её в «Здоровье» нет или читать не дали.
    static func прочитать(_ готово: @escaping ([String: Any]) -> Void) {
        guard доступно else { готово(["доступно": false]); return }
        var итог: [String: Any] = ["доступно": true]
        let группа = DispatchGroup()

        if let вес = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            группа.enter()
            последний(вес) { значение, когда in
                if let значение, let когда {
                    итог["вес"] = значение.doubleValue(for: .gramUnit(with: .kilo))
                    итог["весКогда"] = когда.timeIntervalSince1970 * 1000
                }
                группа.leave()
            }
        }
        /* Верхнее и нижнее лежат в Health отдельными записями, но человеку давление — одно число из
           двух. Берём последние обе и отдаём вместе; если пришла только половина, молчим: «120 на
           неизвестно» не давление. */
        if let верх = HKQuantityType.quantityType(forIdentifier: .bloodPressureSystolic),
           let низ = HKQuantityType.quantityType(forIdentifier: .bloodPressureDiastolic) {
            группа.enter()
            последний(верх) { значениеВ, когдаВ in
                последний(низ) { значениеН, _ in
                    if let значениеВ, let значениеН, let когдаВ {
                        итог["верх"] = значениеВ.doubleValue(for: .millimeterOfMercury())
                        итог["низ"] = значениеН.doubleValue(for: .millimeterOfMercury())
                        итог["давлениеКогда"] = когдаВ.timeIntervalSince1970 * 1000
                    }
                    группа.leave()
                }
            }
        }

        группа.notify(queue: .main) { готово(итог) }
    }

    private static func последний(_ тип: HKQuantityType,
                                  _ готово: @escaping (HKQuantity?, Date?) -> Void) {
        let порядок = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let запрос = HKSampleQuery(sampleType: тип, predicate: nil, limit: 1, sortDescriptors: [порядок]) { _, образцы, _ in
            let о = (образцы?.first as? HKQuantitySample)
            готово(о?.quantity, о?.endDate)
        }
        хранилище.execute(запрос)
    }
    #else
    static var доступно: Bool { false }
    static func спросить(_ готово: @escaping (Bool) -> Void) { готово(false) }
    static func прочитать(_ готово: @escaping ([String: Any]) -> Void) { готово(["доступно": false]) }
    #endif
}
