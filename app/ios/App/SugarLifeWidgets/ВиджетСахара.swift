import SwiftUI
import WidgetKit

/*
 ВИДЖЕТ НА РАБОЧЕМ СТОЛЕ И НА ЭКРАНЕ БЛОКИРОВКИ (SugarLife#542).

 Зачем он, когда есть живой баннер. Баннер живёт, пока его кто-то поддерживает: он гаснет через
 восемь часов, его смахивают, он исчезает после перезагрузки телефона. Виджет не исчезает никогда —
 он просто лежит на экране, и это единственная поверхность, которая переживает всё вышеперечисленное.

 ДАННЫЕ ПРИЕЗЖАЮТ ГОТОВЫМИ. Виджет — отдельный процесс без доступа к движку и к базе; он читает
 общую запись (`ОбщаяЗапись`) и рисует. Ни расчётов, ни порогов, ни единиц здесь нет: они живут
 там же, где живут для всех остальных поверхностей.

 РИСУЕТ ТЕМИ ЖЕ ЧАСТЯМИ, ЧТО БАННЕР — `Показание`, `ГрафикСахара`, `Вид`. Своя вёрстка означала бы
 два ответа об одном числе: на баннере «ниже коридора» краснеет, а на виджете нет, и разошлись бы
 они не сразу, а через месяц, когда кто-то поправит одно место из двух.

 СТАРЕЕТ САМ. Расписание строится вперёд: сейчас, а затем момент, когда показанию исполнится
 пятнадцать минут. К этому времени система перерисует виджет, и он покажет разрыв — даже если
 приложение к тому моменту не исполняется. Это то же правило, что у баннера (#530).
 */

/// Пятнадцать минут — общий порог: столько же живёт показание на баннере и в виджете Android.
private let РАЗРЫВ_СЕК: TimeInterval = 15 * 60
/// Пауза НМГ. Пока движок не отдаёт, когда ждать следующее показание, считаем по ней.
private let ШАГ_СЕК: TimeInterval = 5 * 60

@available(iOS 16.0, *)
struct ЗаписьВиджета: TimelineEntry {
    let date: Date
    let состояние: СахарАтрибуты.ContentState?
}

@available(iOS 16.0, *)
struct ПоставщикСахара: TimelineProvider {

    func placeholder(in context: Context) -> ЗаписьВиджета {
        ЗаписьВиджета(date: Date(), состояние: Пример.состояние)
    }

    func getSnapshot(in context: Context, completion: @escaping (ЗаписьВиджета) -> Void) {
        /* В галерее виджетов данных ещё нет и быть не может: человек только выбирает, что поставить.
           Показываем пример — пустая карточка в галерее читается как сломанный виджет. */
        let с = context.isPreview ? Пример.состояние : собрать(Date())
        completion(ЗаписьВиджета(date: Date(), состояние: с))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ЗаписьВиджета>) -> Void) {
        let сейчас = Date()
        var записи = [ЗаписьВиджета(date: сейчас, состояние: собрать(сейчас))]

        /* Вторая запись — момент, когда числу верить уже нельзя. Своей волей чаще система нас не
           перерисует, а показание с растущим возрастом и прежним цветом врёт тем сильнее, чем
           дольше висит. Приложение, пока живо, обновляет виджет само по приходу данных. */
        if let с = ОбщаяЗапись.прочитать() {
            let протухнет = Date(timeIntervalSince1970: с.когдаМс / 1000 + РАЗРЫВ_СЕК)
            if протухнет > сейчас {
                записи.append(ЗаписьВиджета(date: протухнет, состояние: собрать(протухнет)))
            }
        }
        completion(Timeline(entries: записи, policy: .after(сейчас.addingTimeInterval(РАЗРЫВ_СЕК))))
    }

    /// Общая запись → состояние баннера. Один тип на все поверхности: см. шапку.
    private func собрать(_ когда: Date) -> СахарАтрибуты.ContentState? {
        guard let с = ОбщаяЗапись.прочитать() else { return nil }
        let момент = Date(timeIntervalSince1970: с.когдаМс / 1000)
        let возраст = когда.timeIntervalSince(момент)
        let разрыв = возраст > РАЗРЫВ_СЕК
        return СахарАтрибуты.ContentState(
            значение: с.значение,
            стрелка: разрыв ? "" : с.стрелка,
            разница: с.разница,
            когда: момент,
            /* «Задержалось» начинается сразу после ожидаемого срока следующего показания: пять минут
               прошли, а нового нет — число ещё что-то значит, но уже не «сейчас». */
            старое: возраст > ШАГ_СЕК * 2,
            ряд: с.ряд.map { .init(т: Date(timeIntervalSince1970: $0.т), в: $0.в) },
            mmol: с.mmol,
            зона: с.зона,
            инсулин: с.инсулин,
            прогноз: nil,
            следующее: разрыв ? nil : момент.addingTimeInterval(ШАГ_СЕК),
            разрыв: разрыв,
            последнее: с.значение
        )
    }
}

/// Что показать, пока данных нет вовсе: первый запуск, только что поставили виджет.
@available(iOS 16.0, *)
private enum Пример {
    static var состояние: СахарАтрибуты.ContentState {
        let сейчас = Date()
        let ряд = (0..<36).map { i -> СахарАтрибуты.ContentState.Точка in
            let т = сейчас.addingTimeInterval(-Double(35 - i) * 5 * 60)
            return .init(т: т, в: 6.4 + sin(Double(i) / 5) * 1.6)
        }
        return СахарАтрибуты.ContentState(
            значение: "6,8", стрелка: "→", разница: "+0,1", когда: сейчас, старое: false,
            ряд: ряд, mmol: 6.8, зона: "коридор", инсулин: "0,9 ед", прогноз: nil,
            следующее: сейчас.addingTimeInterval(ШАГ_СЕК), разрыв: false, последнее: "6,8")
    }
}

/// Нет данных — говорим словами. Пустая карточка читается как поломка приложения.
@available(iOS 16.0, *)
private struct Пусто: View {
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "wifi.slash").font(.system(size: 18))
            Text("Нет данных").font(.system(size: 13, weight: .medium))
            Text("откройте приложение").font(.system(size: 11)).foregroundStyle(Цвета.тускло)
        }
        .foregroundStyle(Цвета.разрыв)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/* МАЛЫЙ КВАДРАТ: число, направление, возраст. Графику здесь места нет — он превратился бы в
   закорючку, а число потеряло бы кегль ради неё. */
@available(iOS 16.0, *)
private struct МалыйВиджет: View {
    let с: СахарАтрибуты.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Показание(состояние: с, кегль: 40)
            Spacer(minLength: 0)
            if !с.разрыв {
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 11))
                    Text(с.когда, style: .timer).monospacedDigit()
                }
                .font(.system(size: 12, design: .rounded))
                .foregroundStyle(с.старое ? Цвета.устарело : Цвета.тускло)
            }
            ИнсулинНаБорту(текст: с.инсулин, размер: 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/* СРЕДНИЙ ПРЯМОУГОЛЬНИК: то же плюс три часа графиком — «как именно шёл сахар». Ровно тот вид,
   который человек и ставит на рабочий стол вместо открытия приложения. */
@available(iOS 16.0, *)
private struct СреднийВиджет: View {
    let с: СахарАтрибуты.ContentState

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Показание(состояние: с, кегль: 38)
                if !с.разница.isEmpty && !с.разрыв {
                    Text(с.разница)
                        .font(.system(size: 12.5, design: .rounded))
                        .foregroundStyle(Цвета.тускло)
                }
                Spacer(minLength: 0)
                ПараВремён(состояние: с, размер: 11.5)
                ИнсулинНаБорту(текст: с.инсулин, размер: 11.5)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            ГрафикСахара(состояние: с)
                .frame(width: 168)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/* ЭКРАН БЛОКИРОВКИ. Место с ноготь, взгляд в полсекунды: только число и направление. Цвет там
   системный (система рисует эти виджеты одним тоном), поэтому зону показываем формой — у старого
   показания направления нет вовсе. */
@available(iOS 16.0, *)
private struct СтрочныйВиджет: View {
    let с: СахарАтрибуты.ContentState

    var body: some View {
        if с.разрыв {
            Text("нет связи")
        } else {
            HStack(spacing: 4) {
                Text(с.значение).monospacedDigit()
                if !с.стрелка.isEmpty && !с.старое { Text(с.стрелка) }
                Text(с.когда, style: .timer).monospacedDigit().opacity(0.7)
            }
        }
    }
}

@available(iOS 16.0, *)
struct ВиджетСахара: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ru.imiron.sugarlife.виджет", provider: ПоставщикСахара()) { запись in
            ТелоВиджета(состояние: запись.состояние)
        }
        .configurationDisplayName("Сахар")
        .description("Показание, возраст и три часа графиком — не открывая приложение.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@available(iOS 16.0, *)
private struct ТелоВиджета: View {
    @Environment(\.widgetFamily) private var семейство
    let состояние: СахарАтрибуты.ContentState?

    var body: some View {
        ЗаливкаВиджета(семейство: семейство) {
            if let с = состояние {
                switch семейство {
                case .systemSmall: МалыйВиджет(с: с)
                case .accessoryRectangular, .accessoryInline: СтрочныйВиджет(с: с)
                default: СреднийВиджет(с: с)
                }
            } else {
                Пусто()
            }
        }
    }
}

/* Фон рисуем только на рабочем столе: у виджетов экрана блокировки его нет вовсе, и заливка там
   выглядит грязным пятном поверх обоев. Модификатор `containerBackground` обязателен с iOS 17 —
   без него система показывает виджет пустым. */
@available(iOS 16.0, *)
private struct ЗаливкаВиджета<Содержимое: View>: View {
    let семейство: WidgetFamily
    @ViewBuilder let содержимое: Содержимое

    var body: some View {
        if #available(iOS 17.0, *) {
            содержимое
                .containerBackground(for: .widget) {
                    семейство == .systemSmall || семейство == .systemMedium
                        ? AnyView(Color(red: 0.086, green: 0.094, blue: 0.149))
                        : AnyView(Color.clear)
                }
        } else {
            содержимое.padding(12)
        }
    }
}
