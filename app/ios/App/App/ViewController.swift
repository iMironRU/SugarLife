import Capacitor

/// SugarLifeBridgePlugin живёт прямо в таргете приложения (не отдельным SPM-пакетом
/// со своим Package.swift), поэтому автообнаружение плагинов Capacitor его не видит —
/// регистрируем явно (см. docs/native-bridge-integration.md).
class ViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SugarLifeBridgePlugin())
    }
}
