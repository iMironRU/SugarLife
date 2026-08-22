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

    /**
     * ПОТОК ДЛЯ РАЗГОВОРА С ДВИЖКОМ (core#82).
     *
     * Публичные методы движка синхронны и ждут своей очереди: внутри у него один поток, которым он защищает
     * состояние от гонок. Ждать в этой очереди можно откуда угодно, кроме одного места — главного потока
     * Android. Пять секунд ожидания там, и система показывает «приложение не отвечает» и убивает процесс.
     *
     * Ровно это мы и словили на железе 19 августа: три перезапуска за восемь минут, два ANR, приборы не
     * подключились ни разу — движок стоял в очереди за UI-потоком, а на экране висело «ждём первое показание».
     *
     * Так делают все, у кого это работает: у очереди команд AndroidAPS свой `HandlerThread`, долгая работа
     * с помпой уходит в `QueueWorker` на `Dispatchers.IO`; у `rileylink_ios` своя `sessionQueue`, и вход в неё
     * охраняется `dispatchPrecondition`; Juggluco держит `HandlerThread` на каждый прибор. Никто не разговаривает
     * с железом с главного потока.
     *
     * Поток ОДИН и последовательный: он не про параллельность, а про то, чтобы не занимать чужой.
     */
    private val engineThread = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "SugarLifeEngineCall").apply { isDaemon = true }
    }

    /**
     * ОТДЕЛЬНЫЙ ПОТОК ДЛЯ ПОТОКА СОБЫТИЙ ОТ ЖЕЛЕЗА (core#82).
     *
     * Журнал обмена и телеметрию зовут из GATT-колбэков, а их Android доставляет на главный поток. Вызов
     * движка синхронный: пока драйвер занимает очередь обменом с прибором, колбэк ждёт — и главный поток
     * вместе с ним. Так мы получили второй ANR: вызовы из интерфейса при этом укладывались в десятки
     * миллисекунд, то есть виноват был не интерфейс.
     *
     * Поток отдельный от [engineThread] намеренно: поток событий от железа плотный (в подробном режиме —
     * каждый кадр), и он не должен стоять в одной очереди с тем, что человек нажал прямо сейчас.
     * Один поток, а не пул: порядок записей в журнале — это и есть их смысл.
     */
    private val deviceEvents = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "SugarLifeDeviceEvents").apply { isDaemon = true }
    }

    /** Выполнить вызов движка вне главного потока и ответить в JS. `call.resolve` можно звать из любого потока. */
    private fun onEngineThread(call: PluginCall, work: () -> JSObject) = onEngineThread(call.methodName ?: "call") {
        try {
            call.resolve(work())
        } catch (t: Throwable) {
            Log.e(TAG, "вызов движка не удался", t)
            call.reject(t.message ?: "ошибка движка")
        }
    }

    /**
     * Любая работа, которую мы отдаём движку, — с отметками входа и выхода (core#82).
     *
     * Зависание очереди движка снаружи неотличимо от «ничего не происходит»: приложение живо, эфир идёт,
     * а движок молчит. Отметки превращают это в конкретный вопрос: какой вызов вошёл и не вышел. Без них
     * мы час гадали, что именно встало.
     */
    private fun onEngineThread(name: String, work: () -> Unit) {
        engineThread.execute {
            val startedAt = System.currentTimeMillis()
            Log.d(TAG, "→ $name")
            try {
                work()
            } catch (t: Throwable) {
                Log.e(TAG, "✗ $name", t)
            } finally {
                Log.d(TAG, "← $name за ${System.currentTimeMillis() - startedAt} мс")
            }
        }
    }
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

    override fun load() {
        Log.i(TAG, "load: attach to engine")
        telemetrySink = { json -> deviceEvents.execute { engine.submitTelemetry(json) } }   // натив→движок телеметрия (issue #38)
        // BLE-слой → ОБЩИЙ журнал (core#72). Раньше эти строки жили только в logcat, то есть не доходили ни
        // до человека, ни до выгрузки диагностики — а именно они решили разбор помпы. deviceId отдаём MAC-ом:
        // сопоставление с логической записью прибора делает движок, у него для этого есть реестр.
        logSink = { level, event, deviceId, fields, frame ->
            val f = fields.entries.joinToString(",") { (k, v) -> "${jsonStr(k)}:${jsonStr(v)}" }
            val json = """{"type":"submitLog","level":${jsonStr(level)},"tag":"ble","event":${jsonStr(event)},""" +
                (if (deviceId != null) """"deviceId":${jsonStr(deviceId)},""" else "") +
                """"fields":{$f},"hasIdentifiers":$frame}"""
            // Строку собрали здесь (она про ЭТОТ момент), а отдаём движку с другого потока: запись в журнал
            // не должна останавливать того, кто разговаривает с прибором, — и тем более главный поток.
            deviceEvents.execute { engine.sendIntent(json) }
        }
        // Держим процесс живым в фоне (иначе HyperOS убьёт → потеря сенсора). Стартуем с переднего плана — ОК.
        SugarLifeService.start(context.applicationContext)
        // Подписка и boot-реконнект — тоже вызовы движка, то есть тоже мимо главного потока (core#82).
        // Особенно они: `subscribe` отдаёт первый снимок сразу, а `ensureProvider` тянет за собой
        // восстановление приборов из БД. Раньше это выполнялось в `load()` на UI-потоке, и первый же
        // затянувшийся старт превращался в «приложение не отвечает».
        val permitted = hasBlePermissions()   // спрашивать разрешения можно только с главного потока
        onEngineThread("boot: subscribe+provider") {
            // Снимок из движка-синглтона (переживает пересоздание Activity) → в webview на UI-потоке.
            unsubscribe = engine.subscribe { json ->
                val data = JSObject().put("json", json)
                activity?.runOnUiThread { notifyListeners("snapshot", data) }
            }
            // Разрешения уже выданы — цепляем провайдер сразу, движок переподнимет сохранённые сенсор/помпу
            // из БД (без ожидания скана). Нет — отложим до первого скана, чтобы не спамить запросом на старте.
            if (permitted) EngineHolder.ensureProvider(context.applicationContext)
        }
        reportScanReadiness()
        watchSystemState()
    }

    /**
     * Исключены ли мы из оптимизации батареи — и можно ли об этом попросить (#380).
     *
     * Это не косметика. В режиме Doze (экран выключен, телефон лежит неподвижно) система **игнорирует
     * wake-lock'и** и **приостанавливает доступ в сеть** — всем, кроме приложений из списка исключений.
     * То есть без исключения наш замок бодрствования вокруг обмена с помпой ночью не действует, а данные
     * из облака приходят только в редкие «окна обслуживания», которые со временем становятся всё реже.
     *
     * Просить об этом обязано приложение, а показывать просьбу — экран готовности (#333): человек должен
     * понимать, за что платит батареей, иначе такие разрешения снимают обратно.
     */
    /**
     * Отдача показаний в AAPS (core#100): узнать состояние и переключить.
     *
     * Держим отдельным выключателем, а не «включено, раз есть AAPS»: по этим числам петля считает дозу
     * инсулина, и решение должно быть человеческим.
     */
    @PluginMethod
    fun aapsBroadcast(call: PluginCall) {
        call.resolve(JSObject().put("enabled", AapsBroadcast.включено(context.applicationContext)))
    }

    @PluginMethod
    fun setAapsBroadcast(call: PluginCall) {
        val on = call.getBoolean("enabled") ?: run { call.reject("не сказано, включать или выключать"); return }
        AapsBroadcast.включить(context.applicationContext, on)
        call.resolve(JSObject().put("enabled", on))
    }

    @PluginMethod
    fun batteryOptimization(call: PluginCall) {
        val ctx = context.applicationContext
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val исключены = pm.isIgnoringBatteryOptimizations(ctx.packageName)
        // ЧТО СКАЗАТЬ ЧЕЛОВЕКУ — РЕШАЕТ ЯДРО (SugarLife#380). Здесь только факты платформы: выдано ли
        // исключение и что за прошивка. Слова одни на обе платформы и на оба издания — иначе на один и
        // тот же вопрос человек получит разные ответы.
        val совет = ru.imiron.sugarlife.contract.BackgroundReadiness.advise(
            manufacturer = android.os.Build.MANUFACTURER,
            exemptFromBatteryOptimization = исключены,
        )
        call.resolve(
            JSObject()
                .put("ignoring", исключены)
                .put("packageName", ctx.packageName)
                .put("manufacturer", android.os.Build.MANUFACTURER)
                // Готовый ответ для экрана готовности: проблема ли это, что происходит, что делать и
                // можем ли мы открыть нужный экран сами.
                .put("problem", совет.problem)
                .put("reason", совет.reason)
                .put("whatToDo", совет.whatToDo)
                .put("weCanOpenSettings", совет.weCanOpenSettings),
        )
    }

    /**
     * Показать системную просьбу об исключении из оптимизации батареи (#380).
     *
     * Сначала пробуем прямой диалог: одно нажатие вместо блужданий по настройкам. Его может не быть на
     * прошивке или он может быть запрещён — тогда открываем сам список исключений, он есть везде. Молча
     * не отказываем: экран, который «ничего не сделал», хуже честного «откройте настройки».
     */
    @PluginMethod
    fun requestBatteryExemption(call: PluginCall) {
        val ctx = context.applicationContext
        val прямой = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(android.net.Uri.parse("package:${ctx.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val список = Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val открыт = runCatching { ctx.startActivity(прямой); "dialog" }
            .recoverCatching { ctx.startActivity(список); "settings" }
            .getOrNull()
        if (открыт == null) call.reject("не удалось открыть настройки энергосбережения")
        else call.resolve(JSObject().put("opened", открыт))
    }

    /**
     * Настройки тревоги о низком сахаре (#418).
     *
     * Пороги и «включено ли» задаёт человек в приложении — здесь их только сохраняют. Считает и будит
     * [Тревоги] в сервисе: ночью интерфейса нет, и решение «пора будить» принять некому.
     */
    @PluginMethod
    fun setHypoAlarm(call: PluginCall) {
        Тревоги.настроить(
            context.applicationContext,
            включено = call.getBoolean("on") ?: false,
            порогMmol = call.getDouble("mmol") ?: Тревоги.ПОРОГ_ПО_УМОЛЧАНИЮ,
            высокийВкл = call.getBoolean("highOn") ?: false,
            высокийMmol = call.getDouble("highMmol") ?: Тревоги.ВЫСОКИЙ_ПО_УМОЛЧАНИЮ,
            тихоС = call.getInt("quietFrom") ?: Тревоги.ТИХО_ВЫКЛ,
            тихоДо = call.getInt("quietTo") ?: Тревоги.ТИХО_ВЫКЛ,
            молчаниеВкл = call.getBoolean("silenceOn") ?: false,
            молчаниеМин = call.getInt("silenceMin") ?: Тревоги.МОЛЧАНИЕ_ПО_УМОЛЧАНИЮ_МИН,
        )
        /* Сторожа заводим здесь же, а не при следующем запуске сервиса: человек включает тревогу
           вечером и ложится спать — она обязана начать работать в ту же минуту (#243). */
        SilenceWatchdog.поНастройке(context.applicationContext)
        call.resolve()
    }

    @PluginMethod
    fun hypoAlarm(call: PluginCall) {
        val ctx = context.applicationContext
        call.resolve(
            JSObject()
                .put("on", Тревоги.включено(ctx)).put("mmol", Тревоги.порог(ctx))
                .put("highOn", Тревоги.высокийВключён(ctx)).put("highMmol", Тревоги.высокийПорог(ctx))
                .put("quietFrom", Тревоги.тихоС(ctx)).put("quietTo", Тревоги.тихоДо(ctx))
                .put("quietNow", Тревоги.тихоСейчас(ctx))
                .put("silenceOn", Тревоги.молчаниеВключено(ctx)).put("silenceMin", Тревоги.молчаниеПорог(ctx)),
        )
    }

    /**
     * Проверочная тревога — тем же путём, что настоящая (#418).
     *
     * Иначе проверить нечем: человек включает тревоги вечером и узнаёт, работают ли они, только когда ночью
     * случится гипогликемия. Это худший из возможных способов узнать.
     */
    /**
     * Кто занял прибор (#422). Отдаём НАБЛЮДЕНИЕ, а не приговор: занят ли прибор на этом
     * телефоне и кто из знакомых приложений установлен. Складывать это в фразу — дело
     * интерфейса, и фраза не должна утверждать больше, чем мы знаем.
     */
    @PluginMethod
    fun whoHolds(call: PluginCall) {
        val (занят, кандидаты) = КтоДержит.посмотреть(context.applicationContext, call.getString("address"))
        val список = com.getcapacitor.JSArray()
        кандидаты.forEach { список.put(it) }
        call.resolve(JSObject().put("busyHere", занят).put("candidates", список))
    }

    /**
     * Поставить виджет на рабочий стол — из приложения, а не поиском в лаунчере (#449).
     *
     * Иначе путь такой: долго нажать на пустое место, найти «Виджеты», пролистать чужой список до
     * буквы S, потянуть плитку. Половина людей до конца не доходит и решает, что виджета нет.
     * Система умеет предложить это сама одним диалогом — спрашиваем её.
     *
     * Умеет не всякий лаунчер: до Android 8 такого механизма нет вовсе, а часть прошивок его не
     * поддерживает. Тогда честно отвечаем «нет» — и экран скажет, как добавить руками.
     */
    @PluginMethod
    fun pinWidget(call: PluginCall) {
        val ctx = context.applicationContext
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(JSObject().put("supported", false).put("asked", false))
            return
        }
        val менеджер = android.appwidget.AppWidgetManager.getInstance(ctx)
        if (менеджер == null || !менеджер.isRequestPinAppWidgetSupported) {
            call.resolve(JSObject().put("supported", false).put("asked", false))
            return
        }
        val ок = runCatching {
            менеджер.requestPinAppWidget(android.content.ComponentName(ctx, SugarWidget::class.java), null, null)
        }.getOrDefault(false)
        call.resolve(JSObject().put("supported", true).put("asked", ок))
    }

    @PluginMethod
    fun testAlarm(call: PluginCall) {
        Тревоги.проверочная(context.applicationContext)
        call.resolve()
    }

    @PluginMethod
    fun requestSnapshot(call: PluginCall) {
        /*
         * СНАЧАЛА ПОСЛЕДНИЙ ИЗВЕСТНЫЙ, И ТОЛЬКО ПОТОМ ОЧЕРЕДЬ (core#110).
         *
         * Поймано на живом приборе: пока драйвер добирал историю, возвращение в приложение давало серое
         * полотно и предложение системы закрыть приложение — этот вызов ждал в очереди движка позади тысяч
         * событий. Последний разосланный снимок отстаёт на сотую долю секунды и рисуется мгновенно.
         *
         * `null` бывает только на самом старте, когда снимка ещё не было ни разу; тогда ждём — очередь в
         * этот момент пуста.
         */
        val последний = engine.lastSnapshot()
        if (последний != null) { call.resolve(JSObject().put("json", последний)); return }
        onEngineThread(call) { JSObject().put("json", engine.requestSnapshot()) }
    }

    @PluginMethod
    fun sendIntent(call: PluginCall) {
        val json = call.getString("json") ?: ""
        // Разрешения и share sheet — дела главного потока (диалоги системы), их не уносим.
        if (json.contains("\"startScan\"") || json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"")) {
            requestBlePermissions()
        }
        if (json.contains("\"exportLog\"")) { exportAndShare(); return call.resolve(JSObject().put("json", """{"accepted":true}""")) }
        // Всё остальное — за очередью движка, то есть НЕ здесь (core#82).
        onEngineThread(call) {
            when {
                json.contains("\"startScan\"") -> { EngineHolder.ensureProvider(context.applicationContext); scanner.start() }
                json.contains("\"stopScan\"") -> scanner.stop()
                json.contains("\"addDevice\"") || json.contains("\"addDiscovered\"") ->
                    EngineHolder.ensureProvider(context.applicationContext)
            }
            val res = try {
                engine.sendIntent(json)
            } catch (t: Throwable) {
                Log.e(TAG, "sendIntent error", t); """{"accepted":false,"error":"${t.message}"}"""
            }
            JSObject().put("json", res)
        }
    }

    @PluginMethod
    fun query(call: PluginCall) = onEngineThread(call) {
        JSObject().put("json", engine.query(call.getString("json") ?: ""))
    }

    /**
     * Журнал обмена с прибором (core#72): LogQuery JSON → LogResult JSON.
     *
     * Отдельный метод, а не поле снимка: записей тысячи, а снимок уходит на каждое изменение состояния.
     * Без этого метода журнал существовал только внутри движка — то есть был не нужен никому.
     */
    @PluginMethod
    fun logQuery(call: PluginCall) = onEngineThread(call) {
        JSObject().put("json", engine.logQuery(call.getString("json") ?: "{}"))
    }

    override fun handleOnDestroy() {
        // Только отписываемся. Движок НЕ останавливаем — он живёт в EngineHolder, процесс держит SugarLifeService.
        unsubscribe?.invoke()
        // И от системных событий тоже: receiver переживёт плагин, если его не снять.
        runCatching { context.unregisterReceiver(systemStateWatcher) }
    }

    companion object {
        private const val TAG = "SugarLifeBridge"
    }
}

/** Экранирование строки в JSON: значения приезжают из эфира и содержат кавычки и слэши. */
private fun jsonStr(s: String): String =
    "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
