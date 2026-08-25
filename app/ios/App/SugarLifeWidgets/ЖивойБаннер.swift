import ActivityKit
import SwiftUI
import WidgetKit

/*
 Живой баннер: сахар на экране блокировки, в «Динамическом острове», в CarPlay и на часах (#428, #500).

 ПОЧЕМУ ЭТО ВАЖНЕЕ ОБЫЧНОГО ВИДЖЕТА. Человек за рулём не достаёт телефон; человек ночью не
 разблокирует экран. Число, ради которого приложение существует, должно быть видно там, куда взгляд
 падает и так, — а падает он на экран блокировки и на приборную панель.

 ВИД v2 — ПО МАКЕТУ ВЛАДЕЛЬЦА. На поверхности пять величин, и каждая отвечает на свой вопрос:

   показание и направление  — «сколько сейчас и куда идёт»;
   возраст                  — «верить ли этому числу»;
   сколько до следующего    — «ждать или уже беспокоиться»;
   три часа на фиксированной оси — «как именно шёл сахар»;
   активный инсулин         — «продолжится ли падение».

 Ось ФИКСИРОВАННАЯ (2…16 ммоль) намеренно. Автомасштаб рисует спокойный вечер и качели от 3,8 до 13,1
 одинаково — линия всегда во весь кадр; фиксированная ось платит масштабом (мелкое колебание выглядит
 плоским), но не врёт про амплитуду, а на баннере важнее второе.

 ЧТО ЗДЕСЬ ЕСТЬ И ЧЕГО НЕТ. Расширение живёт отдельным процессом и данных не имеет: всё, что оно
 рисует, приезжает из приложения одним состоянием. Никаких порогов, целей и расчётов здесь нет.
 */

/// Палитра баннера — из макета v2. Значения зон отдельно от акцента: цвет здесь означает зону и
/// ничего больше (правило проекта), поэтому «выше» и «ниже» не берут акцентный фиолетовый.
enum Цвета {
    static let текст = Color(red: 0.914, green: 0.914, blue: 0.929)     // #e9e9ed
    static let тускло = Color(red: 0.545, green: 0.565, blue: 0.639)    // #8b90a3
    static let акцент = Color(red: 0.569, green: 0.518, blue: 0.851)    // #9184d9
    static let выше = Color(red: 0.910, green: 0.725, blue: 0.502)      // #e8b980
    static let ниже = Color(red: 0.898, green: 0.541, blue: 0.584)      // #e58a95
    static let разрыв = Color(red: 0.788, green: 0.663, blue: 0.478)    // #c9a97a
    static let устарело = Color(red: 0.639, green: 0.655, blue: 0.722)  // #a3a7b8
    static let инсулин = Color(red: 0.659, green: 0.714, blue: 0.851)   // #a8b6d9
    static let линияТускло = Color(red: 0.435, green: 0.455, blue: 0.518) // #6f7484
    static let коридор = Color(red: 0.576, green: 0.780, blue: 0.608)   // #93c79b
}

/// Цвета конкретного состояния — один расчёт на все поверхности, чтобы остров и блокировка не
/// разошлись в том, что означает «ниже коридора».
struct Вид {
    let число: Color
    let линия: Color

    init(_ с: СахарАтрибуты.ContentState) {
        if с.разрыв { число = Цвета.разрыв; линия = Цвета.линияТускло }
        else if с.старое { число = Цвета.устарело; линия = Цвета.линияТускло }
        else if с.зона == "выше" { число = Цвета.выше; линия = Цвета.выше }
        else if с.зона == "ниже" { число = Цвета.ниже; линия = Цвета.ниже }
        else { число = Цвета.текст; линия = Цвета.акцент }
    }
}

/*
 ТРИ ЧАСА НА ФИКСИРОВАННОЙ ОСИ.

 Коридор 3,9–10 показан полосой и двумя линиями с подписями — по ним читается «где я относительно
 нормы» без чтения цифр. Деления по часам вертикальными штрихами: они превращают «линия ползёт вверх»
 в «ползёт третий час».

 Линия темнеет к началу: слева прошлое, справа сейчас. Это заменяет подписи времени, на которые здесь
 нет места, и работает боковым зрением.

 ПРОГНОЗ ТАЮЩИМ ХВОСТОМ за правый край — и только если он есть. Выдуманное продолжение хуже
 отсутствующего: по нему принимают решение о дозе.
 */
@available(iOS 16.1, *)
struct ГрафикСахара: View {
    let состояние: СахарАтрибуты.ContentState
    /// Показывать подписи «10» и «3,9». В компактных видах для них нет места.
    var подписи: Bool = true

    private static let НИЗ = 3.9
    private static let ВЕРХ = 10.0
    /// Границы оси. Не по данным: см. объяснение в шапке файла.
    private static let ОСЬ_НИЗ = 2.0
    private static let ОСЬ_ВЕРХ = 16.0
    /// Больше этого промежутка — не линия, а дыра: ровная линия через полчаса тишины читается как
    /// ровный сахар, и это худшее враньё, какое здесь можно нарисовать.
    private static let РАЗРЫВ: TimeInterval = 12 * 60
    /// Сколько времени показываем. Точки старше просто не приезжают, но подстрахуемся и здесь.
    private static let ОКНО: TimeInterval = 3 * 60 * 60

    private var точки: [СахарАтрибуты.ContentState.Точка] {
        let край = Date().addingTimeInterval(-Self.ОКНО)
        return состояние.ряд.filter { $0.т >= край }.sorted { $0.т < $1.т }
    }

    private func сегменты(_ все: [СахарАтрибуты.ContentState.Точка]) -> [[СахарАтрибуты.ContentState.Точка]] {
        var итог: [[СахарАтрибуты.ContentState.Точка]] = []
        var текущий: [СахарАтрибуты.ContentState.Точка] = []
        for т in все {
            if let прошлая = текущий.last, т.т.timeIntervalSince(прошлая.т) > Self.РАЗРЫВ {
                итог.append(текущий); текущий = []
            }
            текущий.append(т)
        }
        if !текущий.isEmpty { итог.append(текущий) }
        return итог
    }

    var body: some View {
        let вид = Вид(состояние)
        GeometryReader { г in
            let все = точки
            let ш = г.size.width, в = г.size.height
            /* Ось времени привязана к ЧАСАМ, а не к первой точке: иначе после перерыва в данных
               кривая растянулась бы на весь кадр и полчаса выглядели бы как три. */
            let конец = все.last?.т ?? Date()
            let начало = конец.addingTimeInterval(-Self.ОКНО)
            let x: (Date) -> CGFloat = { д in
                CGFloat(д.timeIntervalSince(начало) / Self.ОКНО) * ш * 0.86
            }
            let y: (Double) -> CGFloat = { v in
                let доля = (Self.ОСЬ_ВЕРХ - min(max(v, Self.ОСЬ_НИЗ), Self.ОСЬ_ВЕРХ))
                    / (Self.ОСЬ_ВЕРХ - Self.ОСЬ_НИЗ)
                return CGFloat(доля) * в
            }

            ZStack(alignment: .topLeading) {
                // Коридор полосой: «где я относительно нормы» — без чтения чисел.
                Rectangle()
                    .fill(LinearGradient(
                        stops: [.init(color: Цвета.коридор.opacity(0), location: 0),
                                .init(color: Цвета.коридор.opacity(0.08), location: 0.18),
                                .init(color: Цвета.коридор.opacity(0.08), location: 0.88),
                                .init(color: Цвета.коридор.opacity(0), location: 1)],
                        startPoint: .leading, endPoint: .trailing))
                    .frame(height: max(y(Self.НИЗ) - y(Self.ВЕРХ), 1))
                    .offset(y: y(Self.ВЕРХ))

                ForEach([Self.ВЕРХ, Self.НИЗ], id: \.self) { порог in
                    Rectangle()
                        .fill(LinearGradient(
                            stops: [.init(color: Цвета.текст.opacity(0), location: 0),
                                    .init(color: Цвета.текст.opacity(0.14), location: 0.16),
                                    .init(color: Цвета.текст.opacity(0.14), location: 0.88),
                                    .init(color: Цвета.текст.opacity(0), location: 1)],
                            startPoint: .leading, endPoint: .trailing))
                        .frame(height: 1)
                        .offset(y: y(порог))
                }

                // Деления по часам — превращают «ползёт вверх» в «ползёт третий час».
                ForEach(часы(начало: начало, конец: конец), id: \.self) { момент in
                    Rectangle()
                        .fill(LinearGradient(
                            stops: [.init(color: Цвета.текст.opacity(0), location: 0),
                                    .init(color: Цвета.текст.opacity(0.11), location: 0.5),
                                    .init(color: Цвета.текст.opacity(0), location: 1)],
                            startPoint: .top, endPoint: .bottom))
                        .frame(width: 1, height: в * 0.85)
                        .offset(x: x(момент), y: в * 0.075)
                }

                if let прогноз = состояние.прогноз, let последняя = все.last {
                    Path { п in
                        п.move(to: CGPoint(x: x(последняя.т), y: y(последняя.в)))
                        п.addLine(to: CGPoint(x: ш, y: y(прогноз)))
                    }
                    .stroke(LinearGradient(
                        colors: [вид.линия.opacity(0.3), вид.линия.opacity(0)],
                        startPoint: .leading, endPoint: .trailing),
                        style: StrokeStyle(lineWidth: 6, lineCap: .round))
                }

                ForEach(Array(сегменты(все).enumerated()), id: \.offset) { _, сегмент in
                    Path { п in
                        for (i, т) in сегмент.enumerated() {
                            let точка = CGPoint(x: x(т.т), y: y(т.в))
                            if i == 0 { п.move(to: точка) } else { п.addLine(to: точка) }
                        }
                    }
                    /* Прошлое тусклее настоящего: слева старое, справа свежее. Заменяет подписи
                       времени, на которые здесь нет места. */
                    .stroke(LinearGradient(
                        stops: [.init(color: вид.линия.opacity(0.16), location: 0),
                                .init(color: вид.линия.opacity(0.7), location: 0.45),
                                .init(color: вид.линия.opacity(1), location: 1)],
                        startPoint: .leading, endPoint: .trailing),
                        style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                }

                if let последняя = все.last {
                    Circle().fill(вид.линия.opacity(0.18)).frame(width: 14, height: 14)
                        .offset(x: x(последняя.т) - 7, y: y(последняя.в) - 7)
                    Circle().fill(вид.линия).frame(width: 6, height: 6)
                        .offset(x: x(последняя.т) - 3, y: y(последняя.в) - 3)
                }

                if подписи {
                    // Подписи коридора — у правого края, где кончается линия.
                    Text("10").font(.system(size: 11, design: .rounded))
                        .foregroundStyle(Цвета.тускло)
                        .offset(x: ш - 20, y: y(Self.ВЕРХ) - 7)
                    Text("3,9").font(.system(size: 11, design: .rounded))
                        .foregroundStyle(Цвета.тускло)
                        .offset(x: ш - 22, y: min(в - 14, y(Self.НИЗ) - 7))
                }
            }
        }
    }

    /// Границы часов внутри окна — по ним и рисуются деления.
    private func часы(начало: Date, конец: Date) -> [Date] {
        var итог: [Date] = []
        let календарь = Calendar.current
        var т = календарь.date(bySetting: .minute, value: 0, of: начало) ?? начало
        т = календарь.date(bySetting: .second, value: 0, of: т) ?? т
        while т < конец {
            if т > начало { итог.append(т) }
            т = т.addingTimeInterval(3600)
        }
        return итог
    }
}

/*
 ПАРА ВРЕМЁН: сколько прошло и сколько осталось.

 Возраст отвечает «верить ли числу», секундомер — «ждать или уже беспокоиться». Обе величины считает
 система по датам, поэтому идут сами и не застывают между обновлениями баннера — это важнее точности
 формата: застывший счётчик хуже некрасивого.

 ПЯТЬ МИНУТ — ПОКА НАШЕ ДОПУЩЕНИЕ. Движок не отдаёт, когда ждать следующее показание; шаг НМГ обычно
 пятиминутный, и до появления поля в контракте мы считаем по нему. Как только поле появится, счёт
 переедет на него — здесь менять будет нечего, дата приходит готовой.
 */
@available(iOS 16.1, *)
struct ПараВремён: View {
    let состояние: СахарАтрибуты.ContentState
    var размер: CGFloat = 11.5

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 5) {
                Image(systemName: "clock").font(.system(size: размер))
                if состояние.разрыв {
                    /* В разрыве место возраста занимает последнее известное значение. Времени при нём
                       нет намеренно: сколько прошло, крупно показывает счётчик разрыва слева, и
                       повторять то же самое другим способом — заставлять человека сверять два числа. */
                    Text(состояние.последнее)
                } else {
                    Text(состояние.когда, style: .timer).frame(maxWidth: размер * 4.2, alignment: .leading)
                }
            }
            .foregroundStyle(состояние.разрыв ? Цвета.разрыв : Цвета.тускло)

            if let следующее = состояние.следующее, !состояние.разрыв {
                HStack(spacing: 5) {
                    Image(systemName: "timer").font(.system(size: размер))
                    if состояние.опоздание > 0 {
                        /* СЧЁТЧИК ПЕРЕВОРАЧИВАЕТСЯ, А НЕ ЗАМИРАЕТ (SugarLifeCore#126). Время вышло,
                           показания нет — это и есть новость. Замерший ноль или отсчёт заново
                           выглядели бы как «всё идёт по плану». */
                        Text("опаздывает")
                    } else if состояние.старое {
                        /* Обещать время, когда прошлое уже просрочено, нельзя: показание задержалось,
                           и следующее может не прийти вовсе. */
                        Text("ждём")
                    } else {
                        Text(следующее, style: .timer).frame(maxWidth: размер * 4.2, alignment: .leading)
                    }
                }
                .foregroundStyle(состояние.опоздание > 0 ? Цвета.разрыв : Цвета.тускло)
            }
        }
        .font(.system(size: размер, design: .rounded))
        .monospacedDigit()
    }
}

/// Инсулин на борту — ответ на «продолжится ли падение». Пусто: движок не считал, и врать нечем.
@available(iOS 16.1, *)
struct ИнсулинНаБорту: View {
    let текст: String
    var размер: CGFloat = 11.5

    var body: some View {
        if !текст.isEmpty {
            HStack(spacing: 5) {
                Image(systemName: "drop.fill").font(.system(size: размер - 2.5))
                Text(текст)
            }
            .font(.system(size: размер, design: .rounded))
            .foregroundStyle(Цвета.инсулин)
        }
    }
}

/// Показание и направление — левая колонка всех крупных видов.
@available(iOS 16.1, *)
struct Показание: View {
    let состояние: СахарАтрибуты.ContentState
    var кегль: CGFloat = 42

    var body: some View {
        let вид = Вид(состояние)
        if состояние.разрыв {
            /* РАЗРЫВ — НЕ ТУСКЛОЕ ЧИСЛО, А ДРУГОЙ ОТВЕТ. Показывать последнее известное крупно
               значит выдавать позавчерашнее за сейчас; вместо него причина и сколько это длится. */
            VStack(alignment: .leading, spacing: 4) {
                Text("Нет связи")
                    .font(.system(size: кегль * 0.36, weight: .semibold))
                Text(состояние.когда, style: .timer)
                    .font(.system(size: кегль * 0.57, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .frame(maxWidth: кегль * 2.2, alignment: .leading)
            }
            .foregroundStyle(Цвета.разрыв)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(состояние.значение)
                    .font(.system(size: кегль, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(вид.число)
                if !состояние.стрелка.isEmpty {
                    Text(состояние.стрелка)
                        .font(.system(size: кегль * 0.42, weight: .medium))
                        .foregroundStyle(вид.число)
                }
            }
        }
    }
}

/*
 Экран блокировки: 361 × 110 pt. Слева показание, справа три часа, внизу пара времён и инсулин.
 */
@available(iOS 16.1, *)
struct БольшойБаннер: View {
    let состояние: СахарАтрибуты.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                Показание(состояние: состояние)
                    .frame(width: 116, alignment: .leading)
                ГрафикСахара(состояние: состояние)
                    .frame(height: 52)
            }
            Spacer(minLength: 6)
            HStack(spacing: 10) {
                ПараВремён(состояние: состояние)
                Spacer(minLength: 8)
                ИнсулинНаБорту(текст: состояние.инсулин)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

/*
 ВИД ДЛЯ МАШИНЫ И ЧАСОВ (#500).

 CarPlay и Apple Watch рисуют ОТДЕЛЬНОЕ, «маленькое» семейство баннера, и приложение обязано
 объявить, что умеет его рисовать (`supplementalActivityFamilies`, iOS 18). Пока оно не объявлено,
 CarPlay показывает служебную заглушку, и правкой большого вида это не чинится.

 В машине те же пять величин, но раскладка другая: сверху число, времена и инсулин, снизу график во
 всю ширину — три часа читаются одним взглядом, не поворачивая головы.
 */
@available(iOS 16.1, *)
struct КомпактныйБаннер: View {
    let состояние: СахарАтрибуты.ContentState

    /* ЭТО ВИД ДЛЯ МАШИНЫ, А НЕ УМЕНЬШЕННЫЙ БАННЕР (замечание владельца: «в машине баннер так себе,
       всё самое важное уехало за экран»).

       Мы складывали сюда всё то же, что на экран блокировки, только теснее: число, времена, график и
       инсулин в три яруса. На приборной панели места по высоте почти нет, и нижний ярус вместе с
       левым краем числа уезжал за границу — оставалась «,4 →» и обрезанный инсулин.

       За рулём смотрят полсекунды и на одно: сколько сейчас и куда идёт. Поэтому одна строка, и в
       ней по убыванию важности — число, направление, возраст. График убран намеренно: на полоске
       высотой в палец он превращается в кривую без масштаба, а место отнимает у числа.

       ВОЗРАСТ ОСТАЁТСЯ ВСЕГДА. Число без возраста в машине опаснее всего: человек видит его боковым
       зрением и не проверяет, а решение по нему может принять на ближайшем светофоре. */
    var body: some View {
        let вид = Вид(состояние)
        HStack(alignment: .center, spacing: 10) {
            if состояние.разрыв {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 20))
                    .foregroundStyle(Цвета.разрыв)
                Text("нет связи")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Цвета.разрыв)
                    .lineLimit(1)
            } else {
                Text(состояние.значение)
                    .font(.system(size: 34, weight: .light, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(вид.число)
                if !состояние.стрелка.isEmpty && !состояние.старое {
                    Text(состояние.стрелка)
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(вид.число)
                }
            }

            Spacer(minLength: 4)

            HStack(spacing: 5) {
                Image(systemName: "clock").font(.system(size: 12))
                Text(состояние.когда, style: .timer)
                    .monospacedDigit()
                    .frame(maxWidth: 54, alignment: .trailing)
            }
            .font(.system(size: 13, design: .rounded))
            .foregroundStyle(состояние.старое || состояние.разрыв ? Цвета.устарело : Цвета.тускло)
            .lineLimit(1)
        }
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/*
 Кто из двух видов сейчас нужен, знает только система: на экране блокировки — большой, в CarPlay и
 на часах — маленький. Она сообщает это через окружение, и появилось оно в iOS 18 — поэтому вся
 развилка живёт в отдельной структуре с этой доступностью.
 */
@available(iOS 18.0, *)
struct ВыборБаннера: View {
    let состояние: СахарАтрибуты.ContentState
    @Environment(\.activityFamily) private var семейство

    var body: some View {
        switch семейство {
        case .small: КомпактныйБаннер(состояние: состояние)
        default: БольшойБаннер(состояние: состояние)
        }
    }
}

/*
 «Динамический остров» — общий для обеих обёрток виджета.

 Компактное состояние — то, что видно всегда: число, направление и секундомер. Инсулин и история сюда
 не влезают и не нужны: это состояние «мимо», а не «разбираюсь».
 */
@available(iOS 16.1, *)
enum ОстровБаннера {
    static func остров(_ контекст: ActivityViewContext<СахарАтрибуты>) -> DynamicIsland {
        let с = контекст.state.состаренное(контекст.isStale)
        let вид = Вид(с)
        return DynamicIsland {
            DynamicIslandExpandedRegion(.leading) {
                Показание(состояние: с, кегль: 40).padding(.leading, 6)
            }
            DynamicIslandExpandedRegion(.trailing) {
                ПараВремён(состояние: с, размер: 12.5).padding(.trailing, 6)
            }
            DynamicIslandExpandedRegion(.bottom) {
                VStack(spacing: 8) {
                    ГрафикСахара(состояние: с).frame(height: 62)
                    HStack(spacing: 8) {
                        if !с.разница.isEmpty {
                            Text(с.разница)
                                .font(.system(size: 12.5, design: .rounded))
                                .foregroundStyle(Цвета.тускло)
                        }
                        Spacer()
                        ИнсулинНаБорту(текст: с.инсулин, размер: 12.5)
                    }
                }
                .padding(.horizontal, 6)
            }
        } compactLeading: {
            /* ЧИСЛО БЕЗ ВОЗРАСТА — ВРАНЬЁ, И НА «ОСТРОВЕ» ОНО ДОРОЖЕ ВСЕГО (SugarLife#513).

               Владелец увидел здесь 15,6 при настоящих 14,2: устаревшее число выглядело текущим на
               самой заметной поверхности телефона — туда смотрят чаще, чем в приложение. Возраст
               целиком сюда не влезает, и это не спор; но сказать «это не сейчас» можно и без него.

               Говорим двумя способами разом: цвет гаснет и появляется точка. Одного цвета мало —
               его не различают при ярком солнце и не все различают вообще. */
            HStack(spacing: 3) {
                if с.разрыв {
                    Image(systemName: "wifi.slash").foregroundStyle(Цвета.разрыв)
                } else {
                    Text(с.значение).font(.system(size: 15, weight: .medium)).monospacedDigit()
                        .foregroundStyle(с.старое ? Цвета.устарело : вид.число)
                    if с.старое {
                        Circle().fill(Цвета.устарело).frame(width: 4, height: 4)
                    }
                }
            }
        } compactTrailing: {
            /* У старого показания стрелки нет: направление, посчитанное по данным пятнадцатиминутной
               давности, — это направление, которого уже может не быть. */
            if !с.разрыв && !с.старое && !с.стрелка.isEmpty {
                Text(с.стрелка).font(.system(size: 15, weight: .semibold)).foregroundStyle(вид.число)
            }
        } minimal: {
            /* В минимальном виде места нет даже под точку — гасим цветом, а разрыв показываем
               прочерком: «—» честнее последнего известного числа. */
            Text(с.разрыв ? "—" : с.значение)
                .font(.system(size: 13, weight: .medium)).monospacedDigit()
                .foregroundStyle(с.старое ? Цвета.устарело : вид.число)
        }
        .keylineTint(вид.линия)
    }
}

/*
 ЖИВОЙ БАННЕР ТРЕБУЕТ iOS 18 — И ЭТО ОСОЗНАННО СУЖЕННОЕ ОБЕЩАНИЕ (#500).

 Раньше он объявлялся с iOS 16.1, но в машине выглядел болванкой: CarPlay рисует отдельное маленькое
 семейство, а объявить его умеет только iOS 18. Держать две конфигурации Swift не даёт: сборщик
 виджетов понимает `if #available` без «иначе», а модификатор возвращает свой тип. Значит выбор: либо
 баннер на iOS 16–17 без машины, либо машина начиная с iOS 18. Выбрана машина — ради неё функция и
 делалась, а телефонов на iOS 16–17 у нас нет. Приложение говорит об этом прямо: `liveBanner`
 отвечает «не умеем» на старых системах.
 */
@available(iOS 18.0, *)
struct ЖивойБаннерСемейства: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: СахарАтрибуты.self) { контекст in
            ВыборБаннера(состояние: контекст.state.состаренное(контекст.isStale))
                .activityBackgroundTint(Color.black)
                .activitySystemActionForegroundColor(Цвета.текст)
        } dynamicIsland: { контекст in
            ОстровБаннера.остров(контекст)
        }
        .supplementalActivityFamilies([.small])
    }
}

@main
struct SugarLifeWidgets: WidgetBundle {
    var body: some Widget {
        if #available(iOS 18.0, *) {
            ЖивойБаннерСемейства()
        }
        /* Виджет на рабочем столе живёт с iOS 16 — раньше баннера, и это не оплошность: у него нет
           ни CarPlay-семейства, ни «Динамического острова», из-за которых баннеру понадобилась 18-я. */
        if #available(iOS 16.0, *) {
            ВиджетСахара()
        }
    }
}
