package ru.imiron.sugarlife

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.Manifest
import android.content.IntentFilter
import android.content.Intent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.location.LocationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import ru.imiron.sugarlife.engine.SugarLifeEngine
import java.io.File

/**
 * Нативная сторона моста на Android — зеркало iOS-плагина, но БЕЗ BLE (этап 1: UI + движок + Nightscout).
 * Держит тот же KMP-движок (SugarLifeEngine) и пробрасывает snapshot / sendIntent / query в webview.
 * JS-шим (native/sugarLifeBridge.ts) платформо-независим: то же имя SugarLifeBridge + событие "snapshot".
 * Реальные BLE-драйверы (сенсор/помпа) через нативный Android BLE-мост — этап 2.
 */
@CapacitorPlugin(name = "SugarLifeBridge")
class SugarLifeBridgePlugin : Plugin() {
    private val engine: SugarLifeEngine get() = EngineHolder.engine(context.applicationContext)
    private var unsubscribe: (() -> Unit)? = null
    private val scanner by lazy {
        SugarLifeScanner(context.applicationContext) { json -> engine.submitAdvertisement(json) }
    }

    /** Реальные BLE-драйверы цепляем по требованию (первый скан/добавление) — как iOS ensureProvider. */
    private fun ensureProvider() {
        requestBlePermissions()
        EngineHolder.ensureProvider(context.applicationContext)
    }

    /** Экспорт диагностического лога (редактированный NDJSON из движка) → OS share sheet (Telegram/почта/файл).
     *  Механизм сбора телеметрии от волонтёров (share sheet, без сервера — по раннему решению; сборщик — позже). */
    private fun exportAndShare() {
        try {
            val file = File(context.cacheDir, "sugarlife-log.ndjson").apply { writeText(engine.exportLog()) }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "SugarLife — диагностический лог")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, "Отправить лог").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity?.runOnUiThread { (activity ?: context).startActivity(chooser) }
        } catch (t: Throwable) {
            Log.e(TAG, "exportLog share error", t)
        }
    }

    private fun blePermissions(): Array<String> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    private fun hasBlePermissions(): Boolean =
        blePermissions().all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }

    private fun requestBlePermissions() {
        val missing = blePermissions().filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) activity?.let { ActivityCompat.requestPermissions(it, missing.toTypedArray(), 7401) }
    }

    /**
     * Сообщить движку, можем ли мы вообще слушать эфир (core#61, SugarLife#331).
     *
     * Провал тихий: на Android 10 при выключенной СЛУЖБЕ геолокации скан возвращает пустой список без
     * единой ошибки — «Пока никого» тогда означает не «прибора нет рядом», а «система не дала искать».
     * Отличить может только натив, поэтому факт уходит в движок, а показывает его интерфейс.
     *
     * Вызываем при старте и при возврате в приложение: человек мог включить Bluetooth или геолокацию
     * в шторке, не перезапуская нас.
     */
    private fun reportScanReadiness() {
        val bt = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        // Геолокация нужна для скана только до Android 12; дальше — null, чтобы движок не требовал лишнего.
        val locationNeeded = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
        val locationOn = if (!locationNeeded) null else {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            lm?.let { LocationManagerCompat.isLocationEnabled(it) }
        }
        val json = buildString {
            append("{\"bluetoothOn\":").append(bt?.isEnabled ?: false)
            append(",\"permissionsGranted\":").append(hasBlePermissions())
            if (locationOn != null) append(",\"locationEnabled\":").append(locationOn)
            append("}")
        }
        Log.i(TAG, "scan readiness: $json")
        engine.submitScanReadiness(json)
    }

    override fun handleOnResume() {
        super.handleOnResume()
        reportScanReadiness()   // могли включить Bluetooth/геолокацию в шторке, не перезапуская приложение
    }

    /**
     * Слушаем систему, а не только возвраты в приложение: человек включает Bluetooth или геолокацию прямо
     * из шторки, НЕ уходя с нашего экрана. Без этого он исправит причину и продолжит читать подсказку
     * про уже исправленное — то есть мы будем врать ровно тому, кто нас послушался.
     */
    private val systemStateWatcher = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) = reportScanReadiness()
    }

    private fun watchSystemState() {
        val f = IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(LocationManager.PROVIDERS_CHANGED_ACTION)
        }
        runCatching { context.registerReceiver(systemStateWatcher, f) }
            .onFailure { Log.w(TAG, "не удалось подписаться на состояние системы: ${it.message}") }
    }

    override fun handleOnDestroy() {
        runCatching { context.unregisterReceiver(systemStateWatcher) }
        super.handleOnDestroy()
    }

    override fun load() {
        Log.i(TAG, "load: attach to engine")
        telemetrySink = { json -> engine.submitTelemetry(json) }   // натив→движок телеметрия (issue #38)
        // Держим процесс живым в фоне (иначе HyperOS убьёт → потеря сенсора). Стартуем с переднего плана — ОК.
        SugarLifeService.start(context.applicationContext)
        // Снимок из движка-синглтона (переживает пересоздание Activity) → в webview на UI-потоке.
        unsubscribe = engine.subscribe { json ->
            val data = JSObject().put("json", json)
            activity?.runOnUiThread { notifyListeners("snapshot", data) }
        }
        // Boot-реконнект BLE: если разрешения уже выданы — цепляем провайдер сразу, движок переподнимет
        // сохранённые сенсор/помпу из БД (без ожидания скана). Нет разрешений — отложим до первого скана
        // (не спамим запрос на старте; restore всё равно сработает при первом attachDriverProvider).
        if (hasBlePermissions()) EngineHolder.ensureProvider(context.applicationContext)
        reportScanReadiness()
        watchSystemState()
    }

    @PluginMethod
    fun requestSnapshot(call: PluginCall) {
        call.resolve(JSObject().put("json", engine.requestSnapshot()))
    }

    @PluginMethod
    fun sendIntent(call: PluginCall) {
        val json = call.getString("json") ?: ""
        // Скан/подключение реальных устройств — на нативной стороне (как iOS): поднимаем провайдер + сканер.
        when {
            json.contains("\"startScan\"") -> { ensureProvider(); scanner.start() }
            json.contains("\"stopScan\"") -> scanner.stop()
            json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") -> ensureProvider()
            json.contains("\"exportLog\"") -> { exportAndShare(); return call.resolve(JSObject().put("json", """{"accepted":true}""")) }
        }
        val res = try {
            engine.sendIntent(json)
        } catch (t: Throwable) {
            Log.e(TAG, "sendIntent error", t); """{"accepted":false,"error":"${t.message}"}"""
        }
        call.resolve(JSObject().put("json", res))
    }

    @PluginMethod
    fun query(call: PluginCall) {
        call.resolve(JSObject().put("json", engine.query(call.getString("json") ?: "")))
    }

    override fun handleOnDestroy() {
        // Только отписываемся. Движок НЕ останавливаем — он живёт в EngineHolder, процесс держит SugarLifeService.
        unsubscribe?.invoke()
    }

    companion object {
        private const val TAG = "SugarLifeBridge"
    }
}
