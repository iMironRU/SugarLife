import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        /* НА КАКОМ ЯЗЫКЕ ГОВОРЯТ СИСТЕМНЫЕ ЧАСТИ (#534).

           Меню «Скопировать / Вставить» над текстом, кнопки системных запросов, «Отменить» в
           диалогах рисует UIKit, и язык он берёт не из телефона, а из списка локализаций самого
           приложения. Список короткий и меняется редко — зато когда над русским текстом внезапно
           всплывает «Copy · Paste», без этой строки в логе остаётся только гадать. */
        NSLog("SugarLife: язык интерфейса — \(Bundle.main.preferredLocalizations.joined(separator: ", "))")
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        /* ПОСЛЕДНЯЯ СЕКУНДА, КОГДА БАННЕР ЕЩЁ МОЖНО ПОДНЯТЬ (#559).

           Дальше приложение уходит в фон, и система перестаёт разрешать запуск живых уведомлений —
           «Target is not foreground». Если баннера сейчас нет, следующие часы человек проведёт без
           него, а узнает об этом ночью. */
        if #available(iOS 16.2, *) { SugarLifeBridgePlugin.общий?.оживитьБаннер("уходим в фон") }
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        /* Пока приложение спало, сеть могла уйти и вернуться, а наблюдатель в усыплённом процессе
           событий не получает (#544). Человек смотрит на экран и ждёт свежего числа — худший момент
           досиживать минутную паузу движка. Интент идемпотентен: лишний раз безвреден. */
        Сеть.общая.приВозвращении()
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        /* ПОДНИМАЕМ БАННЕР ЗДЕСЬ, А НЕ В `willEnterForeground` (#428).

           Раньше стояло на возвращении из фона — и с появлением проверки `applicationState == .active`
           это перестало работать: в `willEnterForeground` приложение ещё `.inactive`, а карточку
           система разрешает родить только активному. То есть хук остался, а толку от него не стало —
           карточка поднималась случайно, следующим пришедшим снимком.

           `didBecomeActive` — первый момент, когда состояние и правда `.active`. Он же зовётся и
           при первом запуске, и после разблокировки экрана: все три случая нам подходят одинаково.

           Осталось объяснить, почему я это заметил: журнал показал четырнадцать минут «рождение
           отложено» подряд и запуск ровно тогда, когда пришёл снимок при открытом приложении, — а
           не тогда, когда приложение открыли. */
        if #available(iOS 16.2, *) { SugarLifeBridgePlugin.общий?.оживитьБаннер("стали активны") }
        // Restart any tasks that were paused (or not yet started) while the application was inactive.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
