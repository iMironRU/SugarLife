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

@available(iOS 16.1, *)
struct ЖивойБаннер: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: СахарАтрибуты.self) { контекст in
            /* Экран блокировки. Тёмный фон и крупное число: читают его в темноте, боковым
               зрением и не разблокируя телефон. */
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(контекст.state.значение)
                    .font(.system(size: 38, weight: .semibold, design: .rounded))
                    .foregroundStyle(контекст.state.старое ? .secondary : .primary)
                if !контекст.state.стрелка.isEmpty {
                    Text(контекст.state.стрелка).font(.system(size: 26, weight: .semibold))
                }
                if !контекст.state.разница.isEmpty {
                    Text(контекст.state.разница).font(.system(size: 17)).foregroundStyle(.secondary)
                }
                Spacer()
                /* Возраст показания считает система: так он идёт вперёд сам и не врёт
                   между обновлениями. Наше дело — сказать, ОТ КАКОГО момента считать. */
                Text(контекст.state.когда, style: .timer)
                    .font(.system(size: 17, design: .rounded))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 64, alignment: .trailing)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
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
                    HStack(spacing: 8) {
                        if !контекст.state.стрелка.isEmpty { Text(контекст.state.стрелка) }
                        if !контекст.state.разница.isEmpty {
                            Text(контекст.state.разница).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(контекст.attributes.источник).font(.caption).foregroundStyle(.secondary)
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
