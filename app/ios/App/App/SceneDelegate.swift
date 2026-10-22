import UIKit
import Capacitor

/*
 ЖИЗНЬ ПРИЛОЖЕНИЯ ПО СЦЕНАМ (iOS 27, 22.10.2026).

 Владелец обновил телефон на iOS 27.0.1 — и приложение перестало запускаться. В отчёте о падении
 одна строка объясняет всё: `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. Это
 не наша ошибка в коде: система дошла до того места, где требует сценную схему, не нашла её и
 оборвала процесс. Падение на старте, каждый раз, лечения со стороны человека нет.

 ЧТО ЭТО ЗНАЧИТ НА ДЕЛЕ. Раньше окно и состояния приложения (ушли в фон, вернулись, стали
 активны) вёл `AppDelegate`. Теперь окно принадлежит СЦЕНЕ, и те же состояния приходят сюда.
 Методы `applicationWillResignActive`, `applicationDidBecomeActive` и прочие у делегата
 приложения больше НЕ ЗОВУТСЯ ВОВСЕ — поэтому всё, что на них висело, переехало сюда дословно.
 Оставить их там значило бы получить приложение, которое запускается и молча не делает половины
 работы: не поднимает живой баннер, не будит облако при возвращении на экран.

 ЧТО НЕ ПЕРЕЕХАЛО И ПОЧЕМУ. Подписки на `UIApplication.didEnterBackgroundNotification` и
 `willEnterForegroundNotification` (фоновое бодрствование, #388) остались как были: система
 по-прежнему шлёт эти уведомления, и трогать работающую опору ради переезда незачем.

 ССЫЛКИ И УНИВЕРСАЛЬНЫЕ ССЫЛКИ тоже теперь приходят сцене. Передаём их в ту же
 `ApplicationDelegateProxy` Capacitor, что и прежде: иначе переход по ссылке из уведомления и
 возврат из браузера после входа в Nightscout молча перестали бы работать.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        /* Окно собирает UIKit по раскадровке, названной в `UISceneStoryboardFile`: сборка окна
           руками здесь повторила бы то, что система делает сама, и разошлась бы с ней при первой
           же правке раскадровки. Нам остаётся принять ссылки, пришедшие вместе с запуском. */
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func sceneWillResignActive(_ scene: UIScene) {
        /* ПОСЛЕДНЯЯ СЕКУНДА, КОГДА БАННЕР ЕЩЁ МОЖНО ПОДНЯТЬ (#559). Дальше система перестаёт
           разрешать запуск живых уведомлений — «Target is not foreground», — и если баннера сейчас
           нет, следующие часы человек проведёт без него, а узнает об этом ночью. */
        if #available(iOS 16.2, *) { SugarLifeBridgePlugin.общий?.оживитьБаннер("уходим в фон") }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        /* Пока приложение спало, сеть могла уйти и вернуться, а наблюдатель в усыплённом процессе
           событий не получает (#544). Человек смотрит на экран и ждёт свежего числа — худший момент
           досиживать минутную паузу движка. Интент идемпотентен: лишний раз безвреден. */
        Сеть.общая.приВозвращении()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        /* ПОДНИМАЕМ БАННЕР ЗДЕСЬ, А НЕ ПРИ ВОЗВРАЩЕНИИ НА ЭКРАН (#428): карточку система разрешает
           родить только активному приложению, а при возвращении оно ещё `.inactive`. Этот момент —
           первый, когда состояние и правда активно, и он же зовётся при запуске и после
           разблокировки экрана. */
        if #available(iOS 16.2, *) { SugarLifeBridgePlugin.общий?.оживитьБаннер("стали активны") }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
