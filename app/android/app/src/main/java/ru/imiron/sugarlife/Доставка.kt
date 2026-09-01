package ru.imiron.sugarlife

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import java.util.concurrent.Executors

/**
 * ЧТО ПЛАТФОРМА МОЖЕТ ПРЯМО СЕЙЧАС (SugarLife#482, контракт 1.30).
 *
 * Уровень «разбудить» назначает движок, а выполняем его мы. Пока он не знает, чем мы располагаем, он
 * обещает за нас: событие есть, звука нет, и человек узнаёт об этом утром. Поэтому оболочка обязана
 * докладывать — это не услуга движку, а условие, при котором его обещание чего-то стоит.
 *
 * ЧТО МЫ ЗДЕСЬ НЕ РЕШАЕМ. Опасность. Уровень тревоги от нашего доклада не меняется: сахар не становится
 * безопаснее оттого, что телефон беззвучен. Меняется только то, что мы вправе обещать, — и как раз это
 * движок и объявляет отдельным событием «обещание нарушено».
 *
 * ПОЧЕМУ ЭТО В KOTLIN. Доклад нужен и тогда, когда интерфейса нет: ночью webview спит, а доступ к «Не
 * беспокоить» человек мог отобрать вчера днём. Знание платформенное, живёт рядом с уведомлениями.
 */
object Доставка {
    private const val TAG = "SugarLifeДоставка"

    private val поток = Executors.newSingleThreadExecutor()
    @Volatile private var последнееСказанное: String? = null

    /**
     * Чистое правило: из кодов поломок и текущего режима «Не беспокоить» — один ответ.
     *
     * `"no"` — не дойдёт вовсе: уведомления выключены целиком, показывать нечем.
     * `"quiet"` — дойдёт молча: канал понижен человеком в системных настройках, либо сейчас включён
     * тихий режим, а доступа к нему у нас нет.
     * `"yes"` — разбудим.
     *
     * ПОЛНОЭКРАННЫЙ ПОКАЗ СЮДА НЕ ВХОДИТ, и это осознанно. Будит звук; полный экран решает, прочтёт ли
     * человек тревогу не разблокировав телефон. Понизить из-за него ответ значило бы объявлять охрану
     * нарушенной там, где она работает, — а ложное «обещание нарушено» учит не верить настоящему.
     */
    fun вывод(коды: List<String>, тихийРежимСейчас: Boolean): String = when {
        коды.contains("notifications-off") -> "no"
        коды.contains("channel-lowered") -> "quiet"
        коды.contains("dnd-access") && тихийРежимСейчас -> "quiet"
        else -> "yes"
    }

    /**
     * Доложить, если ответ изменился.
     *
     * Зовётся при старте службы, при каждом её запуске и при возврате приложения на экран (#685).
     * Раньше здесь стояло «и на каждом показании» — этого вызова не существовало ни одного, а пока
     * источник не настроен, показаний нет и подавно. То есть доклад делался ровно один раз в жизни
     * процесса, за секунду до того, как человек нажимал «Разрешить».
     *
     * Повтор гасится сам сравнением с [последнееСказанное], поэтому звать можно часто.
     */
    fun доложить(ctx: Context) {
        val app = ctx.applicationContext
        val ответ = runCatching { вывод(Тревоги.поломки(app).map { it.first }, тихийРежим(app)) }
            .getOrElse { return }
        /* Точность — по факту, а не по желанию (Точность.kt): включённый выключатель без выданного
           разрешения это по-прежнему девять минут, и доложить ноль значило бы дать движку пообещать
           человеку время, которого система не даст. */
        val точность = Точность.точностьМин(app)
        val путь = маршрут(app)
        val сказать = "$ответ/$точность/$путь"
        if (сказать == последнееСказанное) return
        последнееСказанное = сказать
        поток.execute {
            val json =
                """{"type":"reportDelivery","canWake":"$ответ","tickPrecisionMin":$точность,"route":"$путь"}"""
            runCatching { EngineHolder.engine(app).sendIntent(json) }
                .onSuccess { Log.i(TAG, "доложили: $ответ") }
                .onFailure {
                    /* Не дошло — забываем сказанное, чтобы следующий заход попробовал снова. Молчание
                       здесь опаснее повтора: движок будет считать, что разбудить может. */
                    последнееСказанное = null
                    Log.w(TAG, "доклад не ушёл: $it")
                }
        }
    }

    /* Включён ли тихий режим ПРЯМО СЕЙЧАС. Без этого «нет доступа к „Не беспокоить“» пришлось бы читать
       как вечное «разбудим тихо» — а человек включает тихий режим не всегда. */
    /**
     * КУДА СЕЙЧАС ИДЁТ ЗВУК (эпик SugarLifeCore#123).
     *
     * Поле `route` живёт в контракте с моста 1.31, движок его читает, светофор и звуковая опора на
     * него опираются — а посылать его не начала НИ ОДНА платформа. То есть все правила про машину не
     * срабатывали ни разу: ни «не поднимать громкость», ни «не разворачивать на весь экран», ни, с
     * сегодняшнего дня, «не держать опору».
     *
     * ОПРЕДЕЛЯЕМ ПО МАРШРУТУ, А НЕ ПО ПЕРЕМЕЩЕНИЮ. Мы не узнаём, едет ли человек и водитель ли он, —
     * и не должны. Смотрим на две вещи: режим автомобиля (Android Auto объявляет его системе) и класс
     * подключённого звукового устройства — автомобильная аудиосистема и громкая связь объявляют себя
     * сами.
     *
     * Наушники и колонку различаем тоже: «прозвучало» не значит «услышал», и человеку об этом
     * говорится (ЗвуковаяОбстановка в ядре).
     */
    fun маршрут(ctx: Context): String {
        val ui = ctx.getSystemService(Context.UI_MODE_SERVICE) as? android.app.UiModeManager
        if (ui?.currentModeType == android.content.res.Configuration.UI_MODE_TYPE_CAR) return "car"
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager ?: return "phone"
        val выходы = runCatching {
            am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS).toList()
        }.getOrDefault(emptyList())
        var наушники = false
        var колонка = false
        for (у in выходы) {
            when (у.type) {
                android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                -> return "car"   // громкая связь — почти всегда машина
                android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET,
                android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                android.media.AudioDeviceInfo.TYPE_USB_HEADSET,
                -> наушники = true
                android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                -> if (машинаПоКлассу(ctx)) return "car" else наушники = true
                android.media.AudioDeviceInfo.TYPE_BLE_SPEAKER,
                android.media.AudioDeviceInfo.TYPE_HDMI,
                -> колонка = true
            }
        }
        return when {
            наушники -> "headphones"
            колонка -> "speaker"
            else -> "phone"
        }
    }

    /**
     * Объявляет ли подключённое устройство себя автомобильным.
     *
     * Bluetooth-устройства сообщают свой класс, и автомобильные аудиосистемы честно ставят
     * «автомобильное аудио» или «громкая связь». Наушники ставят «наушники» — их мы за машину не
     * считаем, иначе человек с наушниками лишится подъёма громкости, который ему как раз нужен.
     */
    private fun машинаПоКлассу(ctx: Context): Boolean = runCatching {
        val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager
            ?: return false
        val подключены = bm.getConnectedDevices(android.bluetooth.BluetoothProfile.GATT) +
            bm.adapter?.bondedDevices.orEmpty()
        подключены.any { у ->
            val к = у.bluetoothClass?.deviceClass ?: 0
            к == android.bluetooth.BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO ||
                к == android.bluetooth.BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE
        }
    }.getOrDefault(false)

    private fun тихийРежим(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL &&
            nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN
    }
}
