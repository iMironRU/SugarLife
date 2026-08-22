package ru.imiron.sugarlife

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Foreground-сервис: держит процесс живым в фоне. Без него HyperOS/Android убивает приложение почти сразу после
 * ухода с переднего плана → холодный старт при возврате, теряется BLE-сенсор, прерывается мониторинг.
 * Сам движок живёт в [EngineHolder] (процесс-синглтон) — сервис лишь поднимает приоритет процесса и держит
 * постоянное уведомление (как AAPS/xDrip).
 *
 * ТИП СЕРВИСА ВЫБИРАЕТСЯ В МОМЕНТ ЗАПУСКА (#380), и это не придирка:
 *
 *  — `connectedDevice` — то, чем мы занимаемся по существу: постоянный обмен с прибором по Bluetooth.
 *    Предела по времени у него нет. Ровно его объявляют xDrip+ и Juggluco — оба читают сенсоры круглосуточно.
 *  — `dataSync` — то, что стояло здесь раньше. На Android 15 у него потолок 6 часов в сутки на всё
 *    приложение: посмотрел на экран вечером, лёг спать — под утро мониторинг выключен. Ровно в те часы,
 *    когда он нужнее всего.
 *
 * Просто заменить одно на другое нельзя: предусловие `connectedDevice` — ВЫДАННОЕ разрешение на Bluetooth.
 * У человека на одном облаке (Nightscout, без BLE-приборов) его нет, и `startForeground` там упадёт с
 * SecurityException — то есть мы починили бы одному и сломали другому. Поэтому спрашиваем разрешение и
 * выбираем тип по факту.
 */
class SugarLifeService : Service() {

    override fun onCreate() {
        super.onCreate()
        /* Ответы «понял», не доехавшие раньше (#482). Ровно тот случай, ради которого очередь и заведена:
           ночью человек нажал, движка в памяти не было, утром процесс поднялся — отдаём. */
        Понял.разгрести(applicationContext)
        /* Чем мы располагаем прямо сейчас (#482, контракт 1.30). Пока движок этого не знает, он
           обещает разбудить за нас — а доступ к «Не беспокоить» человек мог отобрать вчера днём. */
        Доставка.доложить(applicationContext)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Мониторинг", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Фоновый мониторинг глюкозы"
                },
            )
        }
        val notif: Notification = уведомление()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val тип = if (bluetoothРазрешён(this)) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            Log.i(TAG, "старт: тип ${if (тип == ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) "connectedDevice" else "dataSync (нет разрешения на Bluetooth — предел 6ч/сут на Android 15)"}")
            startForeground(NOTIF_ID, notif, тип)
        } else {
            startForeground(NOTIF_ID, notif)
        }
        слушатьРадиТревог()
        /* Приборы у нас — значит молчание больше ничем не объяснено, и сторож имеет право говорить.
           Счёт начинается заново: что было, пока сервиса не существовало, мы не знаем (#243). */
        Тревоги.приборыОтданы(applicationContext, false)
        SilenceWatchdog.поНастройке(applicationContext)
    }

    /**
     * Тревоги считаются ЗДЕСЬ, а не в интерфейсе (#418).
     *
     * Ночью интерфейса нет: экран погашен, webview усыплён, и решение «пора будить» принять некому. До сих
     * пор `notify()` звали с экрана «Сегодня» — то есть тревога работала ровно тогда, когда человек и так
     * смотрел на телефон. Ночная гипогликемия — единственное, ради чего всё это существует, — приходила
     * беззвучно.
     *
     * Сервис живёт в фоне (#380) и держит движок, значит снимки доходят и в три часа ночи. Отписки нет
     * намеренно: сервис живёт столько же, сколько процесс, и подписка умирает вместе с ним.
     */
    private fun слушатьРадиТревог() {
        runCatching {
            EngineHolder.engine(applicationContext).subscribe { json ->
                /* Сначала спрашиваем движок (#482): если тревоги ведёт он, наша половина молчит —
                   двоевластия в тревогах быть не должно. Вернул false — дежурим по-прежнему мы. */
                if (!ТревогиДвижка.приСнимке(applicationContext, json)) {
                    Тревоги.приСнимке(applicationContext, json)
                }
                показатьСахар(json)   // человек чаще всего смотрит сюда (#449)
                SugarWidget.приСнимке(applicationContext, json)   // и на рабочий стол (#449)
            }
        }.onFailure { Log.w(TAG, "не удалось подписаться на снимки для тревог: $it") }
    }

    /**
     * Android 15 зовёт это, когда исчерпаны 6 часов в сутки для `dataSync` — и даёт несколько секунд на
     * остановку. Не остановиться означает `RemoteServiceException` и падение приложения (#380).
     *
     * Мы сюда попадаем только в облачном режиме (иначе тип `connectedDevice`, у него предела нет). Останов
     * при этом не должен быть немым: человек обязан узнать, что мониторинг в фоне выключила система, и что
     * лечится это открытием приложения — отсчёт обнуляется, когда оно выходит на передний план.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "система исчерпала лимит фонового времени (dataSync, 6ч/сут) — останавливаемся сами")
        сообщить(
            "Фоновый мониторинг остановлен",
            "Система ограничивает фоновую работу без Bluetooth-прибора шестью часами в сутки. Откройте приложение — счёт начнётся заново.",
        )
        stopSelf()
    }

    /** То же на старых сборках Android 15, где сигнатура без типа. */
    override fun onTimeout(startId: Int) = onTimeout(startId, 0)

    private fun сообщить(заголовок: String, текст: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(
            NOTIF_ID + 1,
            NotificationCompat.Builder(this, CHANNEL)
                .setContentTitle(заголовок).setContentText(текст)
                .setStyle(NotificationCompat.BigTextStyle().bigText(текст))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .build(),
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Нажали кнопку прямо в уведомлении (#395) — не открывая приложение.
        when (intent?.action) {
            ОТДАТЬ -> отдатьПриборы("нажали в уведомлении")
            ВЗЯТЬ -> взятьПриборы()
        }
        return START_STICKY
    }

    /**
     * Приложение убрали из недавних (#395).
     *
     * Для системы оно живо — его держит этот сервис, а вместе с ним и соединения с приборами. Для человека
     * оно закрыто. Пока эти два понимания расходились, случалось вот что: на одном телефоне приложение
     * «закрыли», а мост к помпе остался занят — и на ДРУГОМ телефоне настоящая петля не смогла подключиться,
     * пока не выключили Bluetooth руками. Догадаться до причины нельзя: занятость прибора со стороны не
     * видна, второй телефон просто получает «помпа не отвечает».
     *
     * Поэтому приборы отпускаем. Вред несимметричен: занятый мост ломает чужую петлю, а отпущенный сенсор
     * всего лишь прерывает наш сбор. Осознанная фоновая работа при этом остаётся — она видна уведомлением, и
     * приборы держатся, пока приложение не убрали с глаз.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        отдатьПриборы("приложение убрали из недавних")
        super.onTaskRemoved(rootIntent)
    }

    /**
     * САХАР В ПОСТОЯННОМ УВЕДОМЛЕНИИ (#449).
     *
     * Уведомление висит круглосуточно и до сих пор говорило только «приборы заняты этим телефоном». А
     * человек берёт телефон в руки не за этим: он хочет число. На iOS его показывает живой баннер, на
     * Android такого механизма нет — зато есть эта строка, и она уже на экране блокировки.
     *
     * ВОЗРАСТ ПОКАЗАНИЯ ВСЕГДА РЯДОМ. «7,3 · 2 мин» и «7,3 · 40 мин» — разные сообщения, и второе значит
     * «не верь». Число без возраста хуже пустоты: вчерашнее выглядит как сегодняшнее.
     *
     * СЫРОЕ НАЗЫВАЕМ СЫРЫМ. Пока калибратор не прогрет, значение не калиброванное — и мы это пишем, а не
     * подсовываем как готовое (core#109).
     */
    private fun показатьСахар(json: String) {
        val строка = runCatching { сахарИзСнимка(json) }.getOrNull() ?: return
        if (строка == последняяСтрока) return          // не дёргаем систему одинаковыми обновлениями
        последняяСтрока = строка
        показать(держимПриборы)
    }

    /** Что писать в заголовке: число, стрелка, возраст. `null` — числа нет, выдумывать нечего. */
    private fun сахарИзСнимка(json: String): String? {
        val monitor = org.json.JSONObject(json).optJSONObject("monitor") ?: return null
        if (monitor.isNull("glucoseMmol")) return null
        val сахар = monitor.optDouble("glucoseMmol").takeIf { !it.isNaN() && it > 0.0 } ?: return null
        последнийСахар = сахар
        val калиброван = monitor.optBoolean("glucoseCalibrated", false)
        val когда = monitor.optLong("latestAtMs", 0L)
        val минут = if (когда > 0) ((System.currentTimeMillis() - когда) / 60_000L).toInt() else -1
        val возраст = when {
            минут < 0 -> ""
            минут <= 1 -> " · только что"
            минут < 60 -> " · $минут мин"
            else -> " · ${минут / 60} ч"
        }
        /* Имена трендов — из ядра (Trend), а не выдуманные: RisingRapidly … FallingRapidly, Unknown.
           Незнакомое имя даёт пустую стрелку — врать направлением хуже, чем молчать о нём. */
        val стрелка = when (monitor.optString("trend")) {
            "RisingRapidly" -> " ⇑"
            "Rising" -> " ↑"
            "RisingSlowly" -> " ↗"
            "Stable" -> " →"
            "FallingSlowly" -> " ↘"
            "Falling" -> " ↓"
            "FallingRapidly" -> " ⇓"
            else -> ""
        }
        val число = "%.1f".format(сахар).replace('.', ',')
        return число + стрелка + (if (калиброван) "" else " (сырое)") + возраст
    }

    /** Последняя показанная строка и то, держим ли мы приборы: по ним решаем, обновлять ли уведомление. */
    private var последняяСтрока: String? = null
    /** Само число — для значка в строке состояния: из готовой строки его пришлось бы разбирать обратно. */
    private var последнийСахар: Double? = null
    private var держимПриборы = true

    private fun отдатьПриборы(причина: String) {
        Log.i(TAG, "отдаём приборы: $причина")
        runCatching {
            EngineHolder.engine(applicationContext).sendIntent("""{"type":"releaseBle"}""")
        }.onFailure { Log.w(TAG, "не удалось отдать приборы: $it") }
        /* Молчание теперь объяснено: приборы у другого телефона. Сторож обязан замолчать вместе с
           ними — тревога, ругающая за собственное решение человека, будет выключена первой (#243). */
        Тревоги.приборыОтданы(applicationContext, true)
        показать(держим = false)
    }

    /**
     * Взять приборы обратно — тем же нажатием, что и отпустили (#395).
     *
     * Обратный ход обязан быть там же, где прямой. Иначе человек, отпустивший приборы, чтобы подключиться со
     * второго телефона, возвращается к первому — и не находит способа вернуть сбор, кроме как открыть
     * приложение. Ровно от этого лишнего шага мы и избавлялись, когда добавляли первую кнопку.
     */
    private fun взятьПриборы() {
        Log.i(TAG, "берём приборы обратно: нажали в уведомлении")
        runCatching {
            EngineHolder.engine(applicationContext).sendIntent("""{"type":"connectAll"}""")
        }.onFailure { Log.w(TAG, "не удалось взять приборы: $it") }
        Тревоги.приборыОтданы(applicationContext, false)
        показать(держим = true)
    }

    /**
     * Число, нарисованное как значок строки состояния (#449).
     *
     * ОКРУГЛЯЕМ ОСОЗНАННО. В строке состояния значок величиной с ноготь: «13,5» тремя глифами с запятой
     * превращается в кашу и не читается вовсе. Поэтому ниже десяти — одна десятая («5,4»), выше — целое
     * («14»). Это подсказка на бегу, а не значение: точное число в заголовке того же уведомления, на
     * расстоянии одного взгляда вниз.
     *
     * Цвет не задаём: систему это не касается, она берёт из значка только форму и красит его сама по
     * теме строки состояния. Рисуем белым по прозрачному — получится силуэт цифр.
     */
    private fun значокСахара(сахар: Double): androidx.core.graphics.drawable.IconCompat {
        val сторона = 96
        val bmp = android.graphics.Bitmap.createBitmap(сторона, сторона, android.graphics.Bitmap.Config.ARGB_8888)
        val холст = android.graphics.Canvas(bmp)
        val текст = if (сахар >= 10) Math.round(сахар).toString()
        else "%.1f".format(сахар).replace('.', ',')
        val кисть = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            color = android.graphics.Color.WHITE
            textAlign = android.graphics.Paint.Align.CENTER
            typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
            textSize = сторона * 0.92f
        }
        /* Ужимаем по ширине, а не подбираем размер заранее: «5,4» и «14» занимают разное место, и
           значок, подогнанный под одно, обрежет другое. */
        val ширина = кисть.measureText(текст)
        val предел = сторона * 0.96f
        if (ширина > предел) кисть.textSize = кисть.textSize * предел / ширина
        val м = кисть.fontMetrics
        холст.drawText(текст, сторона / 2f, сторона / 2f - (м.ascent + м.descent) / 2f, кисть)
        return androidx.core.graphics.drawable.IconCompat.createWithBitmap(bmp)
    }

    /** Переписать постоянное уведомление под текущее состояние. */
    private fun показать(держим: Boolean) {
        держимПриборы = держим
        runCatching {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIF_ID, уведомление(держим))
        }.onFailure { Log.w(TAG, "не удалось обновить уведомление: $it") }
    }
    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Постоянное уведомление — единственное, что человек видит, когда приложение закрыто. Значит оно должно
     * говорить правду о состоянии и давать выход (#395): раньше здесь стояло «Мониторинг активен», и отдать
     * приборы можно было только открыв приложение.
     */
    private fun уведомление(держим: Boolean = true): Notification {
        /*
         * ДВА СОСТОЯНИЯ — ДВА ТЕКСТА И ДВЕ КНОПКИ (#395).
         *
         * Раньше текст был один: «Приборы заняты этим телефоном». После отпускания он оставался прежним —
         * то есть единственное, что человек видит при закрытом приложении, утверждало обратное тому, что
         * произошло. И ровно в том сценарии, ради которого всё делалось: он отпустил приборы, пошёл
         * подключаться со второго телефона, а первый по-прежнему пишет «заняты». Кончилось бы это тем, что
         * он выключит Bluetooth руками — тем самым, от чего мы его избавляли.
         */
        val действие = if (держим) ОТДАТЬ else ВЗЯТЬ
        val кнопка = PendingIntent.getService(
            this, if (держим) 1 else 2, Intent(this, SugarLifeService::class.java).setAction(действие),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            /* Число — в заголовок, а не в текст: заголовок виден и на экране блокировки, и в свёрнутой
               шторке, а текст система прячет первым. Нет числа — прежний заголовок про мониторинг. */
            .setContentTitle(последняяСтрока?.let { "$it ммоль/л" }
                ?: if (держим) "SugarLife: мониторинг идёт" else "SugarLife: приборы отпущены")
            .setContentText(if (держим) "Приборы заняты этим телефоном" else "По радио сейчас ничего не приходит")
            .setStyle(
                NotificationCompat.BigTextStyle().bigText(
                    if (держим) {
                        "Приборы заняты этим телефоном: пока они здесь, другой телефон к ним не подключится."
                    } else {
                        "Приборы отпущены — их может взять другой телефон. Мы пока ничего не получаем."
                    },
                ),
            )
            .apply {
                /* ЗНАЧОК В СТРОКЕ СОСТОЯНИЯ — С ЧИСЛОМ (#449).
                   Строка состояния видна всегда: и поверх чужого приложения, и на экране блокировки, и
                   не разворачивая шторку. Значок приложения там не говорит ничего — его и так видно на
                   рабочем столе. Число говорит всё. Так делает xDrip, и это единственный андроидный
                   ответ на «цифру на иконке»: числовых значков система не умеет, только точку. */
                val значок = последнийСахар?.let { значокСахара(it) }
                if (значок != null) setSmallIcon(значок) else setSmallIcon(R.mipmap.ic_launcher)
            }
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, if (держим) "Отдать приборы" else "Взять обратно", кнопка)
            .build()
    }

    companion object {
        private const val TAG = "SugarLifeService"
        private const val CHANNEL = "sugarlife-monitor"
        /** Действия уведомления: отпустить приборы и взять их обратно (#395). */
        private const val ОТДАТЬ = "ru.imiron.sugarlife.RELEASE_DEVICES"
        private const val ВЗЯТЬ = "ru.imiron.sugarlife.TAKE_DEVICES"
        private const val NOTIF_ID = 4711
        private const val PREFS = "sugarlife-service"
        private const val KEY_ВКЛЮЧЁН = "monitoring-on"

        /** Есть ли выданное разрешение на Bluetooth — от него зависит допустимый тип сервиса. */
        fun bluetoothРазрешён(ctx: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true   // до Android 12 отдельного runtime-разрешения нет
            return ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED ||
                ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        }

        /** Запускать ТОЛЬКО с переднего плана (Android 12+ запрещает старт FGS из фона) — либо из приёмника
         *  загрузки, которому это разрешено отдельно. */
        fun start(ctx: Context) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ВКЛЮЧЁН, true).apply()
            // Дубль в хранилище устройства: его читает приёмник загрузки до разблокировки (#476).
            хранилищеУстройства(ctx).edit().putBoolean(KEY_ВКЛЮЧЁН, true).apply()
            val i = Intent(ctx, SugarLifeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ВКЛЮЧЁН, false).apply()
            хранилищеУстройства(ctx).edit().putBoolean(KEY_ВКЛЮЧЁН, false).apply()
            ctx.stopService(Intent(ctx, SugarLifeService::class.java))
        }

        /** Был ли мониторинг включён до перезагрузки. Поднимать его после загрузки самовольно нельзя:
         *  выключил человек — значит выключил. */
        fun былВключён(ctx: Context): Boolean =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ВКЛЮЧЁН, false)

        /**
         * ТО ЖЕ, НО ЧИТАЕМОЕ ДО РАЗБЛОКИРОВКИ (#476).
         *
         * Обычные настройки лежат в хранилище, зашифрованном ключом человека: пока телефон не
         * разблокирован после перезагрузки, их не прочитать. А узнать «был ли включён мониторинг»
         * надо именно там — ночью, сразу после того как система поставила обновление и перезагрузилась.
         *
         * Поэтому один-единственный флаг дублируем в хранилище устройства. Секрета в нём нет: это
         * «да/нет», а не данные о здоровье.
         */
        fun былВключёнДоРазблокировки(ctx: Context): Boolean =
            хранилищеУстройства(ctx).getBoolean(KEY_ВКЛЮЧЁН, false)

        private fun хранилищеУстройства(ctx: Context) =
            ctx.createDeviceProtectedStorageContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }
}
