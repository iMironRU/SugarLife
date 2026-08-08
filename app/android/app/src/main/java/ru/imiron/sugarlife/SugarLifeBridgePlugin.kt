package ru.imiron.sugarlife

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import ru.imiron.sugarlife.engine.DefaultDriverProvider
import ru.imiron.sugarlife.engine.SugarLifeEngine

/**
 * Нативная сторона моста на Android — зеркало iOS-плагина, но БЕЗ BLE (этап 1: UI + движок + Nightscout).
 * Держит тот же KMP-движок (SugarLifeEngine) и пробрасывает snapshot / sendIntent / query в webview.
 * JS-шим (native/sugarLifeBridge.ts) платформо-независим: то же имя SugarLifeBridge + событие "snapshot".
 * Реальные BLE-драйверы (сенсор/помпа) через нативный Android BLE-мост — этап 2.
 */
@CapacitorPlugin(name = "SugarLifeBridge")
class SugarLifeBridgePlugin : Plugin() {
    private var engine: SugarLifeEngine? = null
    private var unsubscribe: (() -> Unit)? = null
    private var providerAttached = false
    private val scanner by lazy {
        SugarLifeScanner(context.applicationContext) { json -> engine?.submitAdvertisement(json) }
    }

    /** Реальные BLE-драйверы цепляем по требованию (первый скан/добавление) — как iOS ensureProvider. */
    private fun ensureProvider() {
        val e = engine ?: return
        requestBlePermissions()
        if (providerAttached) return
        providerAttached = true
        val ctx = context.applicationContext
        e.attachDriverProvider(
            DefaultDriverProvider(
                nowMs = { System.currentTimeMillis() },
                sensorBridge = { bleId, _ -> AndroidSensorBridge(ctx, bleId) },
                pumpBridge = { bleId, _ -> AndroidPumpBridge(ctx, bleId) },
            ),
        )
    }

    private fun requestBlePermissions() {
        val perms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        val missing = perms.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) activity?.let { ActivityCompat.requestPermissions(it, missing.toTypedArray(), 7401) }
    }

    override fun load() {
        Log.i(TAG, "load: creating engine")
        val e = SugarLifeEngine(withSimulators = false)
        engine = e
        // Снимок из движка (фоновая корутина) → в webview на UI-потоке.
        unsubscribe = e.subscribe { json ->
            val data = JSObject().put("json", json)
            activity?.runOnUiThread { notifyListeners("snapshot", data) }
        }
        e.startAsync()
    }

    @PluginMethod
    fun requestSnapshot(call: PluginCall) {
        call.resolve(JSObject().put("json", engine?.requestSnapshot() ?: EMPTY))
    }

    @PluginMethod
    fun sendIntent(call: PluginCall) {
        val json = call.getString("json") ?: ""
        // Скан/подключение реальных устройств — на нативной стороне (как iOS): поднимаем провайдер + сканер.
        when {
            json.contains("\"startScan\"") -> { ensureProvider(); scanner.start() }
            json.contains("\"stopScan\"") -> scanner.stop()
            json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") -> ensureProvider()
        }
        val res = try {
            engine?.sendIntent(json) ?: """{"accepted":false,"error":"engine not ready"}"""
        } catch (t: Throwable) {
            Log.e(TAG, "sendIntent error", t); """{"accepted":false,"error":"${t.message}"}"""
        }
        call.resolve(JSObject().put("json", res))
    }

    @PluginMethod
    fun query(call: PluginCall) {
        val json = call.getString("json") ?: ""
        val res = engine?.query(json) ?: """{"glucose":[],"treatments":[]}"""
        call.resolve(JSObject().put("json", res))
    }

    override fun handleOnDestroy() {
        unsubscribe?.invoke()
        engine?.stop()
    }

    companion object {
        private const val TAG = "SugarLifeBridge"
        private const val EMPTY =
            "{\"bridgeRevision\":\"1.7\",\"monitor\":{\"glucose\":\"—\",\"glucoseMmol\":null,\"trend\":\"—\"," +
            "\"link\":\"Disconnected\",\"reservoir\":\"—\",\"battery\":\"—\",\"confirmedIOB\":0,\"assumedIOB\":0," +
            "\"conservativeIOB\":0,\"live\":false},\"devices\":[],\"availableDrivers\":[]}"
    }
}
