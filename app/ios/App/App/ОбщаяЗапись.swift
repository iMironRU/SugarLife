import Foundation

/**
 ОБЩАЯ ЗАПИСЬ ПРИЛОЖЕНИЯ И ВИДЖЕТА — ЧЕРЕЗ СВЯЗКУ КЛЮЧЕЙ (SugarLife#542).

 Виджет на рабочем столе живёт отдельным процессом и данных не имеет: что положили — то и рисует.
 Обычный путь передачи — общий контейнер (App Group), но это платная возможность: личной команде
 разработчика Apple её не выдаёт, и сборка с ней просто не подпишется.

 ЗАТО СВЯЗКА КЛЮЧЕЙ ДОСТУПНА: в профиле личной команды есть `keychain-access-groups: <команда>.*`,
 то есть приложение и его расширение вправе делить общую группу связки. Через неё и передаём —
 маленький JSON на пару килобайт. Связка задумана для секретов, и сахар секретом не является, но
 других общих полок у бесплатной подписи нет, а прятать данные глубже, чем нужно, вреда не наносит.

 ДОСТУПНОСТЬ — `AfterFirstUnlock`, и это не мелочь: виджет рисуется и при заблокированном экране.
 С умолчанием (`WhenUnlocked`) он показывал бы прочерк каждый раз, когда телефон лежит на столе
 запертым, — то есть ровно тогда, когда на виджет и смотрят.

 ЧТО ЗДЕСЬ НЕ ХРАНИТСЯ: ничего, чего нет на экране. Виджет показывает то же, что «Сегодня», и
 знать больше ему незачем.
 */
enum ОбщаяЗапись {

    /* Имя группы собирается из префикса команды: он подставляется системой в момент подписи, и
       зашивать его строкой нельзя — у другого разработчика сборка молча перестала бы делиться
       данными сама с собой. */
    private static var группа: String {
        let префикс = Bundle.main.object(forInfoDictionaryKey: "AppIdentifierPrefix") as? String ?? ""
        return префикс + "ru.imiron.sugarlife.общее"
    }
    private static let служба = "ru.imiron.sugarlife.виджет"
    private static let счёт = "снимок"

    /// Что показывает виджет. Всё уже посчитано приложением: единицы, формат, зона.
    struct Снимок: Codable {
        var значение: String
        var стрелка: String
        var разница: String
        var mmol: Double?
        var зона: String
        var инсулин: String
        var когдаМс: Double
        var ряд: [Точка]

        struct Точка: Codable {
            var т: Double   // секунды эпохи
            var в: Double
        }
    }

    static func записать(_ с: Снимок) {
        guard let данные = try? JSONEncoder().encode(с) else { return }
        let ключ: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: служба,
            kSecAttrAccount as String: счёт,
            kSecAttrAccessGroup as String: группа,
        ]
        /* Сначала пробуем обновить: SecItemAdd на существующий элемент вернёт ошибку, и снимок
           перестал бы обновляться навсегда после первой же записи. */
        let новое: [String: Any] = [
            kSecValueData as String: данные,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let итог = SecItemUpdate(ключ as CFDictionary, новое as CFDictionary)
        if итог == errSecItemNotFound {
            var добавить = ключ
            добавить[kSecValueData as String] = данные
            добавить[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(добавить as CFDictionary, nil)
        }
    }

    static func прочитать() -> Снимок? {
        let запрос: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: служба,
            kSecAttrAccount as String: счёт,
            kSecAttrAccessGroup as String: группа,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var результат: CFTypeRef?
        guard SecItemCopyMatching(запрос as CFDictionary, &результат) == errSecSuccess,
              let данные = результат as? Data else { return nil }
        return try? JSONDecoder().decode(Снимок.self, from: данные)
    }
}
