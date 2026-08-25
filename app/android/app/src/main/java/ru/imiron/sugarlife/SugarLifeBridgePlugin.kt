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
import android.net.Uri
import android.provider.Settings
import android.util.Log
import org.json.JSONArray
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

    /**
     * Открыть системный экран, где чинят помеху поиску (SugarLife#333).
     *
     * Куда вести — решает движок (`scanReadiness.settingsTarget`), потому что он один знает, что
     * именно мешает. Как открыть — знаем только мы: у каждой ОС свои экраны, и у Android они ещё и
     * меняются по версиям.
     *
     * ЗАПАСНОЙ ПУТЬ ОБЯЗАТЕЛЕН. Экран может отсутствовать: у части прошивок нет отдельного экрана
     * Bluetooth, а вендорские оболочки любят переносить настройки к себе. Тогда ведём в настройки
     * приложения — оттуда до нужного места два шага, и это лучше, чем кнопка, которая не делает
     * ничего.
     */
    private fun открытьСистемныйЭкран(куда: String): Boolean {
        val адреса = when (куда) {
            "bluetooth" -> listOf(Settings.ACTION_BLUETOOTH_SETTINGS, Settings.ACTION_SETTINGS)
            "location" -> listOf(Settings.ACTION_LOCATION_SOURCE_SETTINGS, Settings.ACTION_SETTINGS)
            /* «Разрешения приложения» отдельным экраном есть не везде; сведения о приложении есть
               всегда, и разрешения — первый пункт внутри. */
            else -> listOf(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Settings.ACTION_SETTINGS)
        }
        for (адрес in адреса) {
            val i = Intent(адрес).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (адрес == Settings.ACTION_APPLICATION_DETAILS_SETTINGS) {
                i.data = Uri.fromParts("package", context.packageName, null)
            }
            val получилось = runCatching {
                (activity ?: context).startActivity(i)
                true
            }.getOrElse { false }
            if (получилось) {
                Log.i(TAG, "открыли системный экран: $куда ($адрес)")
                return true
            }
        }
        Log.w(TAG, "не нашлось системного экрана для: $куда")
        return false
    }

    private fun requestBlePermissions() {
        val missing = blePermissions().filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) return
        activity?.let {
            /* Запоминаем сам ФАКТ вопроса — без него нельзя отличить «ещё не спрашивали» от «отказали
               насовсем»: система в обоих случаях отвечает `shouldShowRationale = false` (см. ниже). */
            context.getSharedPreferences(НАСТРОЙКИ_ДОСТУПА, Context.MODE_PRIVATE).edit()
                .putBoolean(КЛЮЧ_СПРАШИВАЛИ, true).apply()
            ActivityCompat.requestPermissions(it, missing.toTypedArray(), 7401)
        }
    }

    /**
     * ПОКАЖЕТ ЛИ СИСТЕМА ДИАЛОГ ЕЩЁ РАЗ (SugarLife#333).
     *
     * Движок по этому признаку меняет и слова, и кнопку: «сейчас спросим» против «включите в настройках
     * приложения». Без него человек, отказавший дважды, видит кнопку «Разрешить», которая не делает
     * ничего, — тупик, из которого он выходит с выводом, что сломано приложение.
     *
     * Одного `shouldShowRequestPermissionRationale` мало: он отвечает `false` И до первого вопроса, И
     * после окончательного отказа. Различает их только память о том, что мы спрашивали.
     *
     * Activity нет (сервис в фоне) — не отвечаем вовсе: выдумать здесь хуже, чем промолчать.
     */
    private fun спроситьМожноЕщёРаз(): Boolean? {
        val a = activity ?: return null
        val спрашивали = context.getSharedPreferences(НАСТРОЙКИ_ДОСТУПА, Context.MODE_PRIVATE)
            .getBoolean(КЛЮЧ_СПРАШИВАЛИ, false)
        if (!спрашивали) return true
        return blePermissions()
            .filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
            .any { ActivityCompat.shouldShowRequestPermissionRationale(a, it) }
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
        val можноЕщёРаз = if (hasBlePermissions()) null else спроситьМожноЕщёРаз()
        val json = buildString {
            append("{\"bluetoothOn\":").append(bt?.isEnabled ?: false)
            append(",\"permissionsGranted\":").append(hasBlePermissions())
            if (locationOn != null) append(",\"locationEnabled\":").append(locationOn)
            /* Только когда есть что сказать: поле отсутствует — движок не знает, и это честнее
               выдуманного `true`, по которому он пообещал бы диалог. */
            if (можноЕщёРаз != null) append(",\"canAskAgain\":").append(можноЕщёРаз)
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

    /* ПЕРЕХОД ПО УВЕДОМЛЕНИЮ (#524). Webview подписывается сам, но цель может прийти раньше него —
       тогда она ждёт в ЦельПерехода и уедет наверх, как только появится слушатель. */
    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        ЦельПерехода.из(intent)
    }

    @PluginMethod
    fun ожидающаяЦель(call: PluginCall) {
        call.resolve(JSObject().put("цель", ЦельПерехода.забрать()))
    }

    /* СЕТЬ ВЕРНУЛАСЬ — СКАЗАТЬ ДВИЖКУ СРАЗУ (#544, мост 1.42).

       Облачные потоки движка переподключаются сами, с нарастающей паузой до минуты. Пауза бережёт
       недоступный сервер, но после возвращения Wi-Fi мы досиживаем её впустую: ночью это стоит
       пропущенных показаний, а за ними — тревоги о молчании, которой не должно было быть.

       Слушаем только переход «не было → есть»: `onAvailable` система шлёт и при смене сети, а
       будить движок на каждое переключение Wi-Fi↔LTE незачем. Интент идемпотентен — поток жив,
       значит ничего не случится, — поэтому лишний раз безвреден, а вот молчание стоит дорого. */
    private var сетьБыла = true
    private var подпискаНаСеть: android.net.ConnectivityManager.NetworkCallback? = null

    private fun слушатьСеть() {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE)
            as? android.net.ConnectivityManager ?: return
        val обратно = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                if (сетьБыла) return
                сетьБыла = true
                Log.i(TAG, "сеть вернулась — будим облако")
                deviceEvents.execute { engine.sendIntent(СЕТЬ_ВЕРНУЛАСЬ) }
            }

            override fun onLost(network: android.net.Network) { сетьБыла = false }
        }
        runCatching { cm.registerDefaultNetworkCallback(обратно) }
            .onSuccess { подпискаНаСеть = обратно }
            .onFailure { Log.w(TAG, "не удалось следить за сетью: " + it.message) }
    }

    override fun load() {
        Log.i(TAG, "load: attach to engine")
        слушатьСеть()
        ЦельПерехода.слушатель = { цель ->
            runCatching { notifyListeners("цель", JSObject().put("цель", цель)) }
                .onFailure { Log.w(TAG, "цель перехода не доехала: ${it.message}") }
        }
        /* Холодный старт из уведомления: активность уже создана с намерением, onNewIntent не будет. */
        ЦельПерехода.из(activity?.intent)
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
            /* СНИМОК В WEBVIEW — С ФОНА И НЕ ЧАЩЕ, ЧЕМ ЭКРАН УСПЕВАЕТ (#517).
             *
             * Поймано на эмуляторе: приложение вставало в ANR, и в трейсе главный поток сидел
             * внутри `JSONObject.toString` капаситоровского `notifyListeners`. Снимок — большой
             * объект (монитор, приборы, все правила тревог), а приходит он пачками: при загрузке
             * истории движок эмитит десятки штук в секунду. Каждый такой снимок сериализовался НА
             * ГЛАВНОМ ПОТОКЕ — и телефон переставал отвечать на касания ровно тогда, когда человек
             * открывает приложение.
             *
             * Чиним двумя правилами. Первое: сериализация уходит с главного потока — `notifyListeners`
             * потокобезопасен, ему нужна не очередь UI, а сам факт вызова. Второе: шлём не чаще
             * четверти секунды, и всегда ПОСЛЕДНИЙ снимок — экран не успевает показать больше, а
             * промежуточные состояния никому не нужны: снимок это «как сейчас», а не журнал. */
            unsubscribe = engine.subscribe { json ->
                последнийСнимокДляЭкрана.set(json)
                отправитьСнимокЭкрану()
            }
            // Разрешения уже выданы — цепляем провайдер сразу, движок переподнимет сохранённые сенсор/помпу
            // из БД (без ожидания скана). Нет — отложим до первого скана, чтобы не спамить запросом на старте.
            if (permitted) EngineHolder.ensureProvider(context.applicationContext)
        }
        reportScanReadiness()
        watchSystemState()
    }

    /** Последний снимок, который ещё не доехал до экрана. Промежуточные затираются: нужен свежий. */
    private val последнийСнимокДляЭкрана = java.util.concurrent.atomic.AtomicReference<String?>(null)
    private val отправкаЗапланирована = java.util.concurrent.atomic.AtomicBoolean(false)
    private val отправщикСнимков = java.util.concurrent.Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "sl-snapshot-ui").apply { isDaemon = true }
    }

    /** Не чаще, чем экран успевает перерисоваться. Четверть секунды — шаг, незаметный человеку. */
    private val ПАУЗА_СНИМКОВ_МС = 250L

    private fun отправитьСнимокЭкрану() {
        if (!отправкаЗапланирована.compareAndSet(false, true)) return
        отправщикСнимков.schedule({
            отправкаЗапланирована.set(false)
            val json = последнийСнимокДляЭкрана.getAndSet(null) ?: return@schedule
            /* Сериализация тяжёлая — и потому здесь, на своём потоке, а не на главном. */
            runCatching { notifyListeners("snapshot", JSObject().put("json", json)) }
                .onFailure { Log.w(TAG, "снимок не доехал до экрана: $it") }
        }, ПАУЗА_СНИМКОВ_МС, java.util.concurrent.TimeUnit.MILLISECONDS)
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

    /* ЧТО НАМ РАЗРЕШЕНО — ОДНИМ СПИСКОМ (#538).

       Разрешения Android раскиданы так, что собрать картину невозможно: уведомления в одном месте,
       Bluetooth в разрешениях приложения, батарея в третьем, показ поверх экрана в четвёртом.
       Человек узнаёт о запрете не когда его дал, а когда ночью не сработала тревога.

       Список ЧИТАЕТСЯ, а меняется по возможности: часть переключателей держит система, и для них
       единственное честное действие — открыть нужный экран. Коды пунктов те же, что на iOS, а слова
       живут в вебе: одно разрешение не может называться на двух телефонах по-разному. Платформенные
       пункты (батарея, поверх экрана) есть только здесь — придумывать им пару на iOS не станем. */
    @PluginMethod
    fun permissions(call: PluginCall) {
        call.resolve(JSObject().put("список", собратьРазрешения()))
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        when (call.getString("id")) {
            "уведомления" -> if (Build.VERSION.SDK_INT >= 33) спроситьРазрешение(Manifest.permission.POST_NOTIFICATIONS)
            "bluetooth" -> requestBlePermissions()
            "камера" -> спроситьРазрешение(Manifest.permission.CAMERA)
            else -> {}
        }
        /* Отвечаем свежим списком, а не «да/нет»: системный диалог живёт своей жизнью, и к моменту
           ответа состояние соседних строк тоже могло измениться. Сам ответ человека придёт позже —
           экран перечитает список, когда вернётся из фона. */
        call.resolve(JSObject().put("список", собратьРазрешения()))
    }

    /* У каждого запрета свой экран, и общий «о приложении» для них — не ответ: до исключения из
       энергосбережения оттуда четыре шага, а до показа поверх экрана человек просто не дойдёт.
       Ведём точно, а в настройки приложения падаем только когда точного экрана нет. */
    @PluginMethod
    fun openPermissionSettings(call: PluginCall) {
        val ctx = context.applicationContext
        val адрес = when (call.getString("id")) {
            "батарея" -> Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:" + ctx.packageName))
            "поверх-экрана" ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                    Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                        .setData(Uri.parse("package:" + ctx.packageName))
                else null
            else -> null
        }
        val открыли = адрес?.let {
            runCatching { ctx.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
        } ?: открытьСистемныйЭкран("appSettings")
        call.resolve(JSObject().put("ok", открыли))
    }

    private fun спроситьРазрешение(имя: String) {
        if (ContextCompat.checkSelfPermission(context, имя) == PackageManager.PERMISSION_GRANTED) return
        context.getSharedPreferences(НАСТРОЙКИ_ДОСТУПА, Context.MODE_PRIVATE).edit()
            .putBoolean(КЛЮЧ_СПРАШИВАЛИ + имя, true).apply()
        activity?.let { ActivityCompat.requestPermissions(it, arrayOf(имя), 7402) }
    }

    /**
     * Состояние одного обычного разрешения.
     *
     * «Не спрашивали» и «отказано насовсем» система не различает вовсе: в обоих случаях
     * `shouldShowRationale` отвечает false. Поэтому факт вопроса помним сами — без него список
     * предлагал бы «спросить» там, где диалог уже не покажется, и кнопка не делала бы ничего.
     */
    private fun состояние(имя: String): Pair<String, Boolean> {
        if (ContextCompat.checkSelfPermission(context, имя) == PackageManager.PERMISSION_GRANTED) {
            return "разрешено" to false
        }
        val спрашивали = context.getSharedPreferences(НАСТРОЙКИ_ДОСТУПА, Context.MODE_PRIVATE)
            .getBoolean(КЛЮЧ_СПРАШИВАЛИ + имя, false)
        if (!спрашивали) return "не спрашивали" to true
        val покажут = activity?.let { ActivityCompat.shouldShowRequestPermissionRationale(it, имя) } ?: false
        return "нет" to покажут
    }

    private fun пункт(id: String, статус: String, спросить: Boolean): JSObject =
        JSObject().put("id", id).put("статус", статус).put("спросить", спросить)

    private fun собратьРазрешения(): JSONArray {
        val список = JSONArray()
        val ctx = context.applicationContext

        /* Уведомления — основание всего остального: без них нет ни тревоги, ни сводки. До Android 13
           разрешения не существовало, но человек мог выключить канал целиком — спрашиваем менеджера. */
        if (Build.VERSION.SDK_INT >= 33) {
            val (с, ещё) = состояние(Manifest.permission.POST_NOTIFICATIONS)
            список.put(пункт("уведомления", с, ещё))
        } else {
            val вкл = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
            список.put(пункт("уведомления", if (вкл) "разрешено" else "нет", false))
        }

        /* Bluetooth: на облаке не нужен вовсе, с сенсором без него нет ничего. До Android 12 радио
           требовало геопозиции — это одно и то же разрешение по сути, поэтому и пункт один. */
        val нужноBle = blePermissions()
        val естьBle = нужноBle.all { ContextCompat.checkSelfPermission(ctx, it) == PackageManager.PERMISSION_GRANTED }
        val можноBle = if (естьBle) false else (спроситьМожноЕщёРаз() ?: false)
        список.put(пункт("bluetooth", if (естьBle) "разрешено" else "нет", можноBle))

        val (кам, камЕщё) = состояние(Manifest.permission.CAMERA)
        список.put(пункт("камера", кам, камЕщё))

        /* Батарея: без исключения система усыпляет службу, и ночью тревоги приходят с опозданием
           или не приходят вовсе. Спросить нельзя — только отправить на системный экран. */
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val батарея = pm.isIgnoringBatteryOptimizations(ctx.packageName)
        список.put(пункт("батарея", if (батарея) "разрешено" else "нет", false))

        /* Показ поверх экрана: этим тревога разворачивается на заблокированном телефоне, а не лежит
           строкой в шторке, которую утром смахнут вместе с почтой. */
        if (Build.VERSION.SDK_INT >= 34) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            val можно = runCatching { nm.canUseFullScreenIntent() }.getOrDefault(true)
            список.put(пункт("поверх-экрана", if (можно) "разрешено" else "нет", false))
        }

        return список
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
     * ПРОБЬЁТСЯ ЛИ ТРЕВОГА НОЧЬЮ (#468).
     *
     * Разрешение в манифесте — только право спросить. Доступ к «Не беспокоить» и полноэкранные
     * уведомления выдаёт человек руками, и пока он не выдал, система молча делает вид, что обход
     * тихого режима работает: тревога приходит беззвучной. Утром в шторке она на месте — то есть
     * поломка не выглядит поломкой ровно до той ночи, когда понадобится.
     *
     * Отдаём голые факты платформы и список того, чего не хватает, человеческим языком. Пустой
     * `missing` — всё на месте.
     */
    /**
     * Сахар цифрами на значке приложения (Значок.kt).
     *
     * Список видов отдаём вместе со значением: экран не держит их копией, иначе новый вид появится в
     * нативе, а выбрать его будет негде. Имена те же, что на айфоне.
     */
    @PluginMethod
    fun glucoseBadge(call: PluginCall) {
        call.resolve(JSObject()
            .put("mode", Значок.вид(context))
            .put("modes", JSONArray(Значок.ВИДЫ)))
    }

    @PluginMethod
    fun setGlucoseBadge(call: PluginCall) {
        Значок.задать(context, call.getString("mode") ?: "выключен")
        call.resolve(JSObject().put("mode", Значок.вид(context)))
    }

    @PluginMethod
    fun alarmReadiness(call: PluginCall) {
        val ctx = context.applicationContext
        val нет = Тревоги.поломки(ctx)
        val список = com.getcapacitor.JSArray()
        нет.forEach { (_, фраза) -> список.put(фраза) }
        // Коды — чтобы экран мог разложить поломки по своим пунктам, а не показывать их одной кучей
        // (просьба интерфейса, SugarLife#473). Старое поле `missing` оставлено: выкинем, когда экран
        // перейдёт на `problems`, а не одновременно с ним — иначе сломаем то, что уже работает.
        val подробно = com.getcapacitor.JSArray()
        нет.forEach { (код, фраза) -> подробно.put(JSObject().put("code", код).put("text", фраза)) }
        call.resolve(
            JSObject()
                .put("problem", нет.isNotEmpty())
                .put("missing", список)
                .put("problems", подробно),
        )
    }

    /**
     * Открыть экран разрешения на полноэкранные уведомления (#468).
     *
     * Отдельный от «Не беспокоить» и появился в Android 14: право есть в манифесте, но система выдаёт
     * его сама только приложениям-звонилкам и будильникам. Всем остальным — руками человека, и найти
     * этот пункт, не зная, что он существует, практически нельзя.
     *
     * До Android 14 разрешение не требуется — отвечаем честно «экрана нет», а не молча ничего не делаем.
     */
    @PluginMethod
    fun openFullScreenAccess(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.reject("на этой версии Android разрешение не требуется"); return
        }
        val ctx = context.applicationContext
        runCatching {
            ctx.startActivity(
                Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(android.net.Uri.parse("package:" + ctx.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }.onSuccess { call.resolve() }
            .onFailure { call.reject("не удалось открыть настройки: ${it.message}") }
    }

    /** Открыть системный экран доступа к «Не беспокоить» (#468). Без него обход тихого режима мёртв. */
    @PluginMethod
    fun openDndAccess(call: PluginCall) {
        val i = Тревоги.экранДоступаКТихомуРежиму()
        if (i == null) { call.reject("на этой версии Android такого экрана нет"); return }
        runCatching {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.applicationContext.startActivity(i)
        }.onSuccess { call.resolve() }
            .onFailure { call.reject("не удалось открыть настройки: ${it.message}") }
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
        /* ЭТИ ДВА ИНТЕНТА — НАШИ, А НЕ ДВИЖКА (SugarLife#333, контракт: «куда вести, знает движок,
           КАК открыть — натив»).

           До этой правки они уходили в движок, тот честно писал в журнал `intent-not-handled` и всё
           равно отвечал `accepted: true`. То есть кнопки «Разрешить» и «Открыть настройки» в блоке
           «что мешает найти приборы» не делали ничего, а выглядели рабочими. Худший вид тупика:
           человек нажимает, ничего не происходит, и он решает, что сломано приложение. */
        if (json.contains("\"requestScanPermissions\"")) {
            requestBlePermissions()
            return call.resolve(JSObject().put("json", """{"accepted":true}"""))
        }
        if (json.contains("\"openSystemScreen\"")) {
            val куда = Regex("\"target\"\\s*:\\s*\"([^\"]+)\"").find(json)?.groupValues?.get(1) ?: "appSettings"
            val ок = открытьСистемныйЭкран(куда)
            return call.resolve(JSObject().put("json",
                if (ок) """{"accepted":true}"""
                /* Не открылось — говорим об этом. Молчаливый отказ здесь неотличим от «открылось и
                   закрылось», и человек будет жать снова. */
                else """{"accepted":false,"error":"экран настроек не открылся"}"""))
        }
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
        private const val НАСТРОЙКИ_ДОСТУПА = "sugarlife-доступ"
        private const val КЛЮЧ_СПРАШИВАЛИ = "ble-perm-asked"
        private const val СЕТЬ_ВЕРНУЛАСЬ = "{\"type\":\"networkBack\"}"
    }
}

/** Экранирование строки в JSON: значения приезжают из эфира и содержат кавычки и слэши. */
private fun jsonStr(s: String): String =
    "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
