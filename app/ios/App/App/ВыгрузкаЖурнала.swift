import Foundation
import UIKit

/* ОТДАТЬ ЖУРНАЛ ЧЕЛОВЕКУ (SugarLife#666).

   Своим файлом, а не методом плагина. Причина та же, что у остальных поверхностей: пока код живёт
   в общем доме, соседняя правка его задевает. Здесь это особенно обидно — журнал нужен именно
   тогда, когда что-то сломалось, и ломаться он не должен вместе со всем остальным.

   Движок и контроллер приходят ПАРАМЕТРАМИ. Так этот код ничего не знает про плагин и его можно
   позвать откуда угодно — например, из будущей кнопки в другом месте: сегодня выяснилось, что
   существующую кнопку «Поделиться логом» за день разбора не нашёл никто (#656).

   Вычистку секретов делает ядро, до нас: `Logger` рендерит значения полей через `Redactor`. Здесь
   мы только складываем файл и показываем системный лист — отправляет человек, выбирая получателя. */
enum ВыгрузкаЖурнала {
    static func отдать(ndjson: String?, контроллер: UIViewController?,
                       вЖурнал: @escaping (String, String) -> Void) {
        guard let ndjson else { return }
        /* НОМЕР НАШЕЙ СБОРКИ — ТОЛЬКО У НАС (#656).

           Движок в свою шапку кладёт установку, коммит ядра и ревизию моста. Своей сборки он не
           знает и знать не может: её собираем мы.

           28 августа я трижды выяснял, какая сборка стоит на телефоне, — и каждый раз лазил в
           `build.json` внутри установленного пакета. Человек, приславший журнал издалека, такого
           не сможет, а без номера половина вопросов к журналу остаётся без ответа: «это до правки
           или после».

           Телефон и версию системы кладём туда же и по той же причине. Личного в них нет. */
        let версия = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "?"
        /* Номер сборки — из того же `build.json`, что показывает экран «О программе»: одна дорога к
           одному числу, иначе журнал и экран однажды назовут разные сборки. */
        var номерСборки = "?"
        if let url = Bundle.main.url(forResource: "build", withExtension: "json", subdirectory: "public"),
           let data = try? Data(contentsOf: url),
           let о = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let b = о["build"] as? String { номерСборки = b }
        let шапкаНатива = "{\"native\":{"
            + "\"app\":\(jsonStr(версия)),"
            + "\"appBuild\":\(jsonStr(номерСборки)),"
            + "\"device\":\(jsonStr(UIDevice.current.model)),"
            + "\"os\":\(jsonStr(UIDevice.current.systemVersion))"
            + "}}\n"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("sugarlife-log.ndjson")
        /* Выгрузка журнала не удалась — говорим об этом в сам журнал. Молчаливый отказ здесь дешевле
           прочих, но он того же рода: человек нажал «выгрузить» и не узнал, что файла нет. */
        do { try (шапкаНатива + ndjson).write(to: url, atomically: true, encoding: .utf8) }
        catch { вЖурнал("Warn", "выгрузка журнала не удалась: \(error.localizedDescription)"); return }
        DispatchQueue.main.async {
            guard let vc = контроллер else {
                вЖурнал("Warn", "выгрузка журнала: некому показать лист отправки")
                return
            }
            let av = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            // iPad: share sheet — popover, нужен якорь (иначе краш).
            av.popoverPresentationController?.sourceView = vc.view
            av.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
            av.popoverPresentationController?.permittedArrowDirections = []
            vc.present(av, animated: true)
        }
    }
}
