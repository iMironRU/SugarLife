import Foundation
import Capacitor
import SugarLifeKit

/// Нативная сторона моста: держит KMP-движок (SugarLifeEngine из XCFramework SugarLifeKit),
/// инжектит window.SugarLifeBridge (через JS-шим) и гоняет JSON-строки в движок.
/// Домен/BLE/транзакции — в KMP; здесь только проводка Capacitor ↔ движок.
@objc(SugarLifeBridgePlugin)
public class SugarLifeBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SugarLifeBridgePlugin"
    public let jsName = "SugarLifeBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendIntent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
    ]

    private let engine = SugarLifeEngine()
    private var unsubscribe: (() -> Void)?

    override public func load() {
        // натив → веб: снимок толкаем событием "snapshot" (в main-очереди — колбэк идёт с фонового потока движка)
        unsubscribe = engine.subscribe(onSnapshot: { [weak self] json in
            DispatchQueue.main.async { self?.notifyListeners("snapshot", data: ["json": json]) }
        })
        engine.startAsync() // скелет: кормится симулятором. Реальные драйверы впаяются в движке.
    }

    deinit {
        unsubscribe?()
        engine.stop()
    }

    @objc func requestSnapshot(_ call: CAPPluginCall) {
        call.resolve(["json": engine.requestSnapshot()])
    }

    @objc func sendIntent(_ call: CAPPluginCall) {
        call.resolve(["json": engine.sendIntent(json: call.getString("json") ?? "")])
    }

    @objc func query(_ call: CAPPluginCall) {
        call.resolve(["json": engine.query(json: call.getString("json") ?? "")])
    }
}
