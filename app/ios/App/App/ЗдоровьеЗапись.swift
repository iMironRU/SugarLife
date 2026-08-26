import Foundation
#if canImport(HealthKit)
import HealthKit
#endif
import SugarLifeKit

/**
 РУКА К «ЗДОРОВЬЮ»: КЛАДЁМ ТО, ЧТО ДАЛ ДВИЖОК (SugarLife#583, ядро #134).

 ПОЧЕМУ ЗАПИСЬ — КОННЕКТОР ДВИЖКА, А НЕ НАШ ЭКРАН. Спрашивали ядро прямо, и довод оказался наш же:
 второй путь наружу отменяет весь учёт доставки. На вопрос «а точно ли доехало» должен быть один
 ответ, а не «в Nightscout — да, а в Health — не знаю, посмотрите сами».

 Второй довод сильнее первого, и его мы не назвали сами: отправка — это ещё и ПОРЯДОК И ПОЛНОТА.
 Прореживание, дозаполнение после разрыва, отказ отдавать сырое во время прогрева — всё это живёт в
 движке. Поверхность, пишущая из снимка, положила бы в «Здоровье» то, что видит экран.

 А «Здоровье» хранит образцы НЕИЗМЕНЯЕМО: там, где в Nightscout запись можно поправить, здесь её
 можно только удалить руками, по одной. Цена ошибки не «некрасиво», а «человек разбирает завалы».

 ДЕДУПЛИКАЦИЯ НЕ ЗДЕСЬ. Её ведёт движок: у него есть `externalKey` и якорь времени, и ту же задачу он
 уже решает для Nightscout. Держать правило в двух местах значит однажды разойтись — а расхождение
 человек увидит своими глазами, двойными записями в «Здоровье».

 ЕДИНИЦЫ СТАВИМ МЫ, И ТОЛЬКО ЗДЕСЬ. Глюкоза — ммоль/л, инсулин — единицы, углеводы — граммы. Health
 хранит величину вместе с единицей; перевести дважды значит однажды перевести неверно.
 */
final class ЗдоровьеЗапись: NSObject, HealthStore {

    #if canImport(HealthKit)
    private let хранилище = HKHealthStore()

    /* Просим права ровно под то, что пишем, — список короткий намеренно. Разрешение, которым не
       пользуются, однажды становится вопросом «а зачем им это», и человек отзывает всё скопом. */
    /* Вид приезжает из Kotlin как ОБЪЕКТ-перечисление, а не как Swift enum: сравниваем тождеством,
       `switch` по нему не работает. Отсюда же `default` в конце — компилятор не знает, что случаев
       ровно три. */
    private func тип(_ вид: HealthSampleKind) -> HKQuantityType? {
        if вид == HealthSampleKind.glucose { return HKObjectType.quantityType(forIdentifier: .bloodGlucose) }
        if вид == HealthSampleKind.insulin { return HKObjectType.quantityType(forIdentifier: .insulinDelivery) }
        if вид == HealthSampleKind.carbs { return HKObjectType.quantityType(forIdentifier: .dietaryCarbohydrates) }
        return nil
    }

    private func единица(_ вид: HealthSampleKind) -> HKUnit? {
        /* Ммоль/л в HealthKit выражается как «моль на литр с приставкой милли», делённое на объём:
           готовой константы нет, и собрать её надо ровно так. */
        if вид == HealthSampleKind.glucose {
            return HKUnit.moleUnit(with: .milli, molarMass: HKUnitMolarMassBloodGlucose).unitDivided(by: .liter())
        }
        if вид == HealthSampleKind.insulin { return .internationalUnit() }
        if вид == HealthSampleKind.carbs { return .gram() }
        return nil
    }

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /* Спрашиваем СИСТЕМУ, а не помним свой прошлый ответ: человек мог отозвать разрешение в
       настройках, и узнаем мы об этом только спросив.

       `NotAsked` и `Denied` разведены намеренно: склеив их, мы либо спрашивали бы повторно после
       отказа, либо не спросили бы ни разу. */
    func writePermission(kind: HealthSampleKind) async throws -> HealthWritePermission {
        guard isAvailable, let т = тип(kind) else { return .denied }
        switch хранилище.authorizationStatus(for: т) {
        case .sharingAuthorized: return .granted
        case .sharingDenied: return .denied
        default: return .notasked
        }
    }

    /* Право просим только когда есть что писать — движок зовёт это в момент первой отправки. Заранее
       «чтобы потом не мешало» не показываем: см. довод про отзыв всего скопом. */
    /* Kotlin-suspend возвращает `Boolean`, и в Swift он приезжает коробкой `KotlinBoolean`, а не
       голым `Bool`. Возвращаем коробку — иначе тип не сойдётся с протоколом. */
    func requestWritePermission(kinds: Set<HealthSampleKind>) async throws -> KotlinBoolean {
        guard isAvailable else { return false }
        let типы = Set(kinds.compactMap { тип($0) })
        guard !типы.isEmpty else { return false }
        let ок: Bool = await withCheckedContinuation { продолжить in
            хранилище.requestAuthorization(toShare: типы, read: []) { ок, _ in продолжить.resume(returning: ок) }
        }
        return KotlinBoolean(bool: ок)
    }

    func put(samples: [HealthSample]) async throws -> KotlinBoolean {
        guard isAvailable, !samples.isEmpty else { return false }
        var образцы: [HKQuantitySample] = []
        for s in samples {
            guard let т = тип(s.kind), let е = единица(s.kind) else { continue }
            let когда = Date(timeIntervalSince1970: Double(s.atMs) / 1000)
            /* `externalKey` кладём в метаданные как синхро-идентификатор: по нему система сама
               отсеет повтор той же записи, если движок пришлёт её дважды. Наша дедупликация от
               этого не отменяется — это второй пояс, а не первый. */
            образцы.append(HKQuantitySample(
                type: т,
                quantity: HKQuantity(unit: е, doubleValue: s.value),
                start: когда, end: когда,
                metadata: [HKMetadataKeySyncIdentifier: s.externalKey, HKMetadataKeySyncVersion: 1],
            ))
        }
        guard !образцы.isEmpty else { return false }
        let ок: Bool = await withCheckedContinuation { продолжить in
            хранилище.save(образцы) { ок, ошибка in
                if let ошибка { NSLog("SugarLife: «Здоровье» не приняло образцы — \(ошибка.localizedDescription)") }
                продолжить.resume(returning: ок)
            }
        }
        return KotlinBoolean(bool: ок)
    }
    #else
    /* Сборки без HealthKit (симулятор без фреймворка, будущие цели). Отвечаем честно: хранилища нет,
       и движок просто не поставит приёмник. */
    var isAvailable: Bool { false }
    func writePermission(kind: HealthSampleKind) async throws -> HealthWritePermission { .denied }
    func requestWritePermission(kinds: Set<HealthSampleKind>) async throws -> KotlinBoolean { false }
    func put(samples: [HealthSample]) async throws -> KotlinBoolean { false }
    #endif
}
