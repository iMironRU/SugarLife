import ActivityKit
import SwiftUI
import WidgetKit

/*
 Живой баннер: сахар на экране блокировки, в «Динамическом острове» и в CarPlay (#428).

 ПОЧЕМУ ЭТО ВАЖНЕЕ ОБЫЧНОГО ВИДЖЕТА. Человек за рулём не достаёт телефон; человек ночью не
 разблокирует экран. Число, ради которого приложение существует, должно быть видно там,
 куда взгляд падает и так, — а падает он на экран блокировки и на приборную панель.

 ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Live Activity рисует то, что ей передали: значение, стрелку,
 разницу с прошлым, время последнего показания. Считать здесь нечего и незачем — это
 расширение, оно живёт в отдельном процессе и данных не имеет. Всё, что оно показывает,
 приезжает из приложения одним состоянием.

 СРОК ЖИЗНИ. Система сама гасит Live Activity через восемь часов после старта и через
 двенадцать снимает окончательно. Поэтому приложение обязано её продлевать, а не
 запускать однажды и забыть; когда данные перестают приходить, баннер должен об этом
 сказать, а не показывать вчерашнее число как сегодняшнее.
 */


/*
 График сахара за час — крупно и цветом (#428).

 ЗАЧЕМ ОН ЗДЕСЬ. Стрелка отвечает «растёт», но не отвечает «как»: разгоняется подъём или
 выдыхается, идёт он полчаса или начался пять минут назад. За рулём вопрос именно такой, и
 по одному мгновенному тренду решение принять нельзя. Форма линии отвечает на него без
 чтения — взгляд, а не разбор.

 ЦВЕТ ПО ЗНАЧЕНИЮ, а не по последней точке: линия зелёная там, где сахар в диапазоне, и
 красная выше и ниже, с переломом ровно на границах. Правило то же, что в круге на экране
 «Сегодня» (charts/CircleSparkline.tsx) — иначе одна и та же картина в приложении и на
 экране блокировки означала бы разное.

 РАЗРЫВ ВМЕСТО ПРЯМОЙ. Если между точками больше двенадцати минут, линия прерывается.
 Соединять концы молчания отрезком нельзя: ровная линия через полчаса тишины читается как
 ровный сахар, а это худшее враньё, какое здесь можно нарисовать.
 */
@available(iOS 16.1, *)
struct ГрафикСахара: View {
    let ряд: [СахарАтрибуты.ContentState.Точка]
    var старое: Bool = false

    private static let НИЗ = 3.9
    private static let ВЕРХ = 10.0
    /// Больше этого промежутка — не линия, а дыра. Две обычные паузы НМГ плюс запас.
    private static let РАЗРЫВ: TimeInterval = 12 * 60

    private static let зелёный = Color(red: 0.576, green: 0.780, blue: 0.608)
    private static let красный = Color(red: 0.788, green: 0.420, blue: 0.478)

    /* МАСШТАБ ПО ДАННЫМ, А НЕ ПО ДИАПАЗОНУ (#500). Раньше окно всегда включало 3,9 и 10 — и ровный
       вечер 7,7…7,9 превращался в прямую черту: линия есть, а сказать ей нечего. Соседи по экрану
       блокировки в тот же момент показывали ту же историю с формой.

       Окно считаем по самим показаниям, но не уже двух с половиной ммоль: иначе шум ±0,2 нарисовался
       бы горами, и спокойная ночь выглядела бы тревожной. */
    private static func окно(_ все: [СахарАтрибуты.ContentState.Точка]) -> (Double, Double) {
        let низ = (все.map(\.в).min() ?? НИЗ) - 0.5
        let верх = (все.map(\.в).max() ?? ВЕРХ) + 0.5
        let ОКНО = 2.5
        guard верх - низ < ОКНО else { return (низ, верх) }
        let центр = (верх + низ) / 2
        return (центр - ОКНО / 2, центр + ОКНО / 2)
    }

    private var сегменты: [[СахарАтрибуты.ContentState.Точка]] {
        var итог: [[СахарАтрибуты.ContentState.Точка]] = []
        var текущий: [СахарАтрибуты.ContentState.Точка] = []
        for т in ряд.sorted(by: { $0.т < $1.т }) {
            if let прошлая = текущий.last, т.т.timeIntervalSince(прошлая.т) > Self.РАЗРЫВ {
                итог.append(текущий); текущий = []
            }
            текущий.append(т)
        }
        if !текущий.isEmpty { итог.append(текущий) }
        return итог
    }

    var body: some View {
        GeometryReader { г in
            let все = ряд.sorted(by: { $0.т < $1.т })
            let t0 = все.first?.т.timeIntervalSince1970 ?? 0
            let t1 = все.last?.т.timeIntervalSince1970 ?? 1
            let диапазонT = max(t1 - t0, 60)
            let (vmin, vmax) = Self.окно(все)
            let x: (Date) -> CGFloat = { д in
                CGFloat((д.timeIntervalSince1970 - t0) / диапазонT) * г.size.width
            }
            let y: (Double) -> CGFloat = { в in
                г.size.height - CGFloat((в - vmin) / (vmax - vmin)) * г.size.height
            }

            ZStack(alignment: .topLeading) {
                /* Целевой диапазон полосой: видно не только «растёт», но и «уже вышел». Окно теперь
                   бывает уже диапазона — тогда полоса выходит за края, и это правильно: значит всё
                   показанное время сахар был внутри. */
                Rectangle()
                    .fill(Self.зелёный.opacity(0.13))
                    .frame(height: max(y(max(Self.НИЗ, vmin)) - y(min(Self.ВЕРХ, vmax)), 1))
                    .offset(y: y(min(Self.ВЕРХ, vmax)))

                /* Границы диапазона пунктиром — но только те, что попали в окно. Линия, нарисованная
                   по краю кадра, читалась бы как граница кадра, а не как порог. */
                ForEach([Self.НИЗ, Self.ВЕРХ].filter { $0 > vmin && $0 < vmax }, id: \.self) { порог in
                    Path { п in
                        п.move(to: CGPoint(x: 0, y: y(порог)))
                        п.addLine(to: CGPoint(x: г.size.width, y: y(порог)))
                    }
                    .stroke(Self.зелёный.opacity(0.35),
                            style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }

                ForEach(Array(сегменты.enumerated()), id: \.offset) { _, сегмент in
                    Path { п in
                        for (i, т) in сегмент.enumerated() {
                            let точка = CGPoint(x: x(т.т), y: y(т.в))
                            if i == 0 { п.move(to: точка) } else { п.addLine(to: точка) }
                        }
                    }
                    .stroke(градиент(vmin: vmin, vmax: vmax),
                            style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                }

                if let последняя = все.last {
                    Circle()
                        .fill(цвет(последняя.в))
                        .frame(width: 10, height: 10)
                        .position(x: x(последняя.т), y: y(последняя.в))
                }
            }
            .opacity(старое ? 0.5 : 1)
        }
    }

    private func цвет(_ в: Double) -> Color {
        (в >= Self.НИЗ && в <= Self.ВЕРХ) ? Self.зелёный : Self.красный
    }

    /// Вертикальный градиент с переломами ровно на границах диапазона — тот же приём, что в
    /// вебе: цвет линии тогда зависит от значения, а не от того, где линия началась.
    private func градиент(vmin: Double, vmax: Double) -> LinearGradient {
        let доля: (Double) -> Double = { в in min(max((vmax - в) / (vmax - vmin), 0), 1) }
        var стопы: [Gradient.Stop] = [.init(color: цвет(vmax), location: 0)]
        if Self.ВЕРХ < vmax && Self.ВЕРХ > vmin {
            let о = доля(Self.ВЕРХ)
            стопы.append(.init(color: цвет(Self.ВЕРХ + 0.01), location: о))
            стопы.append(.init(color: цвет(Self.ВЕРХ - 0.01), location: о))
        }
        if Self.НИЗ < vmax && Self.НИЗ > vmin {
            let о = доля(Self.НИЗ)
            стопы.append(.init(color: цвет(Self.НИЗ + 0.01), location: о))
            стопы.append(.init(color: цвет(Self.НИЗ - 0.01), location: о))
        }
        стопы.append(.init(color: цвет(vmin), location: 1))
        return LinearGradient(stops: стопы.sorted { $0.location < $1.location },
                              startPoint: .top, endPoint: .bottom)
    }
}

@available(iOS 16.1, *)
struct ЖивойБаннер: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: СахарАтрибуты.self) { контекст in
            /* Экран блокировки. Тёмный фон и крупное число: читают его в темноте, боковым
               зрением и не разблокируя телефон. */
            /* ЧИСЛО КРУПНО СЛЕВА, ГРАФИК НА ВСЮ ОСТАВШУЮСЯ ШИРИНУ (решение владельца).

               Эта же раскладка едет на приборную панель: в машине читать надо быстро и
               боковым зрением, поэтому число берёт всю высоту, а линии отдаётся всё, что
               осталось. Кольца здесь нет намеренно — размером говорит само число. */
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        /* Число НИКОГДА не переносится (#500). Раньше сюда приезжала строка вместе с
                           единицами, «7,9 ммоль/л» ломалось на две строки и занимало пол-карточки —
                           ради слова, которое человек и так знает. Единицы теперь не приезжают
                           вовсе, а на случай длинного числа стоит запрет переноса. */
                        Text(контекст.state.значение)
                            .font(.system(size: 46, weight: .semibold, design: .rounded))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .foregroundStyle(контекст.state.старое ? .secondary : .primary)
                        if !контекст.state.стрелка.isEmpty {
                            Text(контекст.state.стрелка).font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                    /* Возраст показания считает система: так он идёт вперёд сам и не врёт
                       между обновлениями. Наше дело — сказать, ОТ КАКОГО момента считать.
                       Рядом с графиком он обязателен: линия выглядит живой всегда.

                       Разница рядом с ним, а не под числом: «+0,1» и «2 мин» — это один ответ на
                       вопрос «что происходит», и читаются они вместе. */
                    HStack(spacing: 6) {
                        if !контекст.state.разница.isEmpty {
                            Text(контекст.state.разница)
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        Text(контекст.state.когда, style: .timer)
                            .font(.system(size: 14, design: .rounded))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: 58, alignment: .leading)
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                /* Ряда нет — сборка старше графика или показаний ещё не накопилось. Тогда
                   пусто, а не выдуманная линия по одной точке. */
                if контекст.state.ряд.count >= 2 {
                    ГрафикСахара(ряд: контекст.state.ряд, старое: контекст.state.старое)
                        .frame(maxWidth: .infinity)
                        .frame(height: 66)
                } else {
                    Spacer()
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .activityBackgroundTint(Color.black)
            .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { контекст in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(контекст.state.значение)
                        .font(.system(size: 26, weight: .semibold, design: .rounded))
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(контекст.state.когда, style: .timer)
                        .font(.system(size: 16, design: .rounded))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 70, alignment: .trailing)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        if контекст.state.ряд.count >= 2 {
                            ГрафикСахара(ряд: контекст.state.ряд, старое: контекст.state.старое)
                                .frame(height: 44)
                        }
                        HStack(spacing: 8) {
                            if !контекст.state.стрелка.isEmpty { Text(контекст.state.стрелка) }
                            if !контекст.state.разница.isEmpty {
                                Text(контекст.state.разница).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(контекст.attributes.источник).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 6)
                }
            } compactLeading: {
                /* Сжатый вид — то, что видно всегда, пока баннер жив. Здесь помещается
                   ровно число и стрелка, и это правильный выбор: время можно спросить,
                   сахар — нет. */
                Text(контекст.state.значение).font(.system(size: 15, weight: .semibold))
            } compactTrailing: {
                Text(контекст.state.стрелка).font(.system(size: 15, weight: .semibold))
            } minimal: {
                Text(контекст.state.значение).font(.system(size: 13, weight: .semibold))
            }
            .keylineTint(Color.white)
        }
    }
}

@main
struct SugarLifeWidgets: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.1, *) {
            ЖивойБаннер()
        }
    }
}
