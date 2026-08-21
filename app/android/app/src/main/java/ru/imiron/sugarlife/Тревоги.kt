package ru.imiron.sugarlife

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * Тревога о низком сахаре (SugarLife#418).
 *
 * ПОЧЕМУ ЭТО ЖИВЁТ В KOTLIN, А НЕ В ИНТЕРФЕЙСЕ. Ночью интерфейса нет: экран погашен, webview усыплён, и
 * решение «пора будить» принять некому. Тревога, работающая только при открытом приложении, — не тревога,
 * а сообщение. Поэтому правило исполняется здесь, рядом с движком, который в фоне живёт (см. #380).
 *
 * ОДНО МНЕНИЕ, А НЕ ДВА. Пороги и «включено ли» задаёт человек в приложении; они приезжают сюда один раз и
 * лежат в настройках. Здесь их не пересчитывают и не додумывают — здесь только исполняют. Два мнения о том,
 * что считать гипогликемией, разошлись бы в первую же ночь.
 *
 * ПОДТВЕРЖДЕНИЕ ВТОРЫМ ПОКАЗАНИЕМ. Сенсор шумит, и одиночный выброс вниз — повод посмотреть, а не будить.
 * Будим, когда подряд идут два показания ниже порога. Цена ошибки несимметрична, но в обе стороны: ложная
 * тревога в три часа ночи учит выключать тревоги вообще, и следующая — настоящая — не разбудит.
 *
 * ПОВТОР С РАСТУЩИМ ИНТЕРВАЛОМ. Тревога, звучащая одинаково каждые пять минут, тоже учит её выключать.
 * Первый повтор через 10 минут, дальше вдвое, до получаса — пока сахар не поднялся выше порога.
 */
object Тревоги {
    private const val TAG = "SugarLifeТревоги"
    private const val КАНАЛ = "sugarlife-alarm"
    private const val ID_ГИПО = 4712

    private const val НАСТРОЙКИ = "sugarlife-alarms"
    private const val КЛЮЧ_ВКЛ = "hypo-on"
    private const val КЛЮЧ_ПОРОГ = "hypo-mmol"
    private const val КЛЮЧ_ВЫСОКИЙ_ВКЛ = "high-on"
    private const val КЛЮЧ_ВЫСОКИЙ = "high-mmol"
    private const val КЛЮЧ_ТИХО_С = "quiet-from"
    private const val КЛЮЧ_ТИХО_ДО = "quiet-to"

    /** Значения по умолчанию — те же, что показывает экран настроек. */
    const val ПОРОГ_ПО_УМОЛЧАНИЮ = 3.9
    const val ВЫСОКИЙ_ПО_УМОЛЧАНИЮ = 13.9
    /** Тихие часы выключены: -1 означает «не заданы», а не полночь. */
    const val ТИХО_ВЫКЛ = -1

    private const val ПЕРВЫЙ_ПОВТОР_МС = 10 * 60_000L
    private const val МАКС_ПОВТОР_МС = 30 * 60_000L

    /** Сколько подряд показаний ниже порога нужно, чтобы будить. */
    private const val ПОДТВЕРЖДЕНИЙ = 2

    @Volatile private var подрядНиже = 0
    @Volatile private var последняяТревогаМс = 0L
    @Volatile private var следующийПовторМс = ПЕРВЫЙ_ПОВТОР_МС
    @Volatile private var последнееПоказаниеМс = 0L

    /* Высокий считается отдельным счётчиком: это другой повод, и путать их нельзя.
       Повтор у него реже — высокий сахар не требует действий в ту же минуту, а тревога,
       звучащая каждые десять минут при 14 ммоль, будет выключена в первую же ночь. */
    @Volatile private var подрядВыше = 0
    @Volatile private var последняяВысокаяМс = 0L
    private const val ПОВТОР_ВЫСОКОГО_МС = 60 * 60_000L

    fun настроить(
        ctx: Context,
        включено: Boolean,
        порогMmol: Double,
        высокийВкл: Boolean,
        высокийMmol: Double,
        тихоС: Int,
        тихоДо: Int,
    ) {
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).edit()
            .putBoolean(КЛЮЧ_ВКЛ, включено)
            .putFloat(КЛЮЧ_ПОРОГ, порогMmol.toFloat())
            .putBoolean(КЛЮЧ_ВЫСОКИЙ_ВКЛ, высокийВкл)
            .putFloat(КЛЮЧ_ВЫСОКИЙ, высокийMmol.toFloat())
            .putInt(КЛЮЧ_ТИХО_С, тихоС)
            .putInt(КЛЮЧ_ТИХО_ДО, тихоДо)
            .apply()
        Log.i(TAG, "настройки: гипо=$включено/$порогMmol высокий=$высокийВкл/$высокийMmol тихо=$тихоС..$тихоДо")
    }

    fun высокийВключён(ctx: Context): Boolean =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).getBoolean(КЛЮЧ_ВЫСОКИЙ_ВКЛ, false)

    fun высокийПорог(ctx: Context): Double =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
            .getFloat(КЛЮЧ_ВЫСОКИЙ, ВЫСОКИЙ_ПО_УМОЛЧАНИЮ.toFloat()).toDouble()

    fun тихоС(ctx: Context): Int =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).getInt(КЛЮЧ_ТИХО_С, ТИХО_ВЫКЛ)

    fun тихоДо(ctx: Context): Int =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).getInt(КЛЮЧ_ТИХО_ДО, ТИХО_ВЫКЛ)

    /**
     * Идут ли сейчас тихие часы.
     *
     * Окно может переходить через полночь (с 23 до 7) — это обычный случай, а не край:
     * тихие часы для того и заводят, чтобы захватить ночь. Поэтому сравнение разное в
     * зависимости от того, перевалило ли окно за сутки.
     */
    fun тихоСейчас(ctx: Context, час: Int = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)): Boolean {
        val с = тихоС(ctx); val до = тихоДо(ctx)
        if (с == ТИХО_ВЫКЛ || до == ТИХО_ВЫКЛ || с == до) return false
        return if (с < до) час in с until до else час >= с || час < до
    }

    fun включено(ctx: Context): Boolean =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).getBoolean(КЛЮЧ_ВКЛ, false)

    fun порог(ctx: Context): Double =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
            .getFloat(КЛЮЧ_ПОРОГ, ПОРОГ_ПО_УМОЛЧАНИЮ.toFloat()).toDouble()

    /**
     * Разобрать снимок движка и решить, будить ли.
     *
     * Снимок приходит целиком и часто; нас интересует одно число и его время. Время нужно, чтобы не считать
     * подтверждением ПОВТОР одного и того же показания: движок эмитит снимок на любое изменение, и без
     * проверки времени два одинаковых снимка сошли бы за два показания.
     */
    fun приСнимке(ctx: Context, json: String) {
        if (!включено(ctx) && !высокийВключён(ctx)) return
        val (сахар, когдаМс) = разобрать(json) ?: return
        if (когдаМс != 0L && когдаМс == последнееПоказаниеМс) return
        последнееПоказаниеМс = когдаМс

        высокий(ctx, сахар)
        if (!включено(ctx)) return

        val порог = порог(ctx)
        if (сахар >= порог) {
            /* Поднялся — счётчик и повторы сбрасываем. Тревога кончилась не потому, что мы устали
               спрашивать, а потому, что причина ушла. */
            if (подрядНиже > 0 || последняяТревогаМс != 0L) Log.i(TAG, "сахар $сахар ≥ порога $порог — отбой")
            подрядНиже = 0
            последняяТревогаМс = 0
            следующийПовторМс = ПЕРВЫЙ_ПОВТОР_МС
            return
        }

        подрядНиже++
        if (подрядНиже < ПОДТВЕРЖДЕНИЙ) {
            Log.i(TAG, "сахар $сахар ниже порога $порог, но это первое показание — ждём подтверждения")
            return
        }

        val сейчас = System.currentTimeMillis()
        if (последняяТревогаМс != 0L && сейчас - последняяТревогаМс < следующийПовторМс) return
        if (последняяТревогаМс != 0L) следующийПовторМс = minOf(следующийПовторМс * 2, МАКС_ПОВТОР_МС)
        последняяТревогаМс = сейчас

        показать(
            ctx,
            "Низкий сахар: ${"%.1f".format(сахар).replace('.', ',')}",
            "Ниже вашего порога ${"%.1f".format(порог).replace('.', ',')} ммоль/л. Проверьте глюкометром.",
        )
    }

    /**
     * Высокий сахар (#418).
     *
     * ТИХИЕ ЧАСЫ ГЛУШАТ ЕГО, А ГИПО — НЕТ, и это главное различие между двумя тревогами.
     * Высокий сахар ночью требует решения утром; низкий — сейчас. Тихие часы заводят,
     * чтобы спать, и тревога, которая будит ради «13,9», приведёт к тому, что человек
     * выключит тревоги вообще — вместе с той, которая спасает.
     *
     * Повтор реже: раз в час против десяти минут у гипо. Тревога, звучащая каждые десять
     * минут при высоком, — это не помощь, а наказание за то, что человек уже знает.
     */
    private fun высокий(ctx: Context, сахар: Double) {
        if (!высокийВключён(ctx)) return
        val порог = высокийПорог(ctx)
        if (сахар <= порог) {
            подрядВыше = 0
            последняяВысокаяМс = 0
            return
        }
        подрядВыше++
        if (подрядВыше < ПОДТВЕРЖДЕНИЙ) return
        if (тихоСейчас(ctx)) {
            Log.i(TAG, "высокий $сахар, но идут тихие часы — молчим до утра")
            return
        }
        val сейчас = System.currentTimeMillis()
        if (последняяВысокаяМс != 0L && сейчас - последняяВысокаяМс < ПОВТОР_ВЫСОКОГО_МС) return
        последняяВысокаяМс = сейчас
        показать(
            ctx,
            "Высокий сахар: ${"%.1f".format(сахар).replace('.', ',')}",
            "Выше вашего порога ${"%.1f".format(порог).replace('.', ',')} ммоль/л уже второе показание подряд.",
        )
    }

    /** Разбор снимка: сахар в ммоль и время показания. null — числа нет, и выдумывать его нельзя. */
    private fun разобрать(json: String): Pair<Double, Long>? = runCatching {
        val monitor = JSONObject(json).optJSONObject("monitor") ?: return null
        if (monitor.isNull("glucoseMmol")) return null
        val сахар = monitor.optDouble("glucoseMmol")
        if (сахар.isNaN() || сахар <= 0.0) return null
        сахар to monitor.optLong("latestAtMs", 0L)
    }.getOrNull()

    /**
     * Проверочная тревога — та же дорога, что и настоящая (#418).
     *
     * Иначе проверить нечем: человек включает тревоги вечером и узнаёт, работают ли они, только когда ночью
     * случится гипогликемия. Это худший из возможных способов узнать. Кнопка проходит весь путь целиком:
     * канал, звук, обход «не беспокоить», полноэкранное намерение.
     */
    fun проверочная(ctx: Context) {
        показать(
            ctx,
            "Проверка тревоги",
            "Так будет выглядеть и звучать тревога о низком сахаре. Это проверка — сахар в порядке.",
        )
    }

    private fun показать(ctx: Context, заголовок: String, текст: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        канал(nm)
        val открыть = PendingIntent.getActivity(
            ctx, 2,
            ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
                ?: Intent(Intent.ACTION_MAIN),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n: Notification = NotificationCompat.Builder(ctx, КАНАЛ)
            .setContentTitle(заголовок)
            .setContentText(текст)
            .setStyle(NotificationCompat.BigTextStyle().bigText(текст))
            .setSmallIcon(R.mipmap.ic_launcher)
            /* CATEGORY_ALARM — то, чем «не беспокоить» отличает будильник от почты: в режиме DND
               системные исключения для будильников пропускают именно эту категорию. */
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            /* Полноэкранное намерение: на заблокированном экране система показывает тревогу поверх, а не
               строкой в шторке, которую утром смахнут вместе с почтой. */
            .setFullScreenIntent(открыть, true)
            .setContentIntent(открыть)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(ID_ГИПО, n) }
            .onFailure { Log.w(TAG, "не удалось показать тревогу: $it") }
    }

    /**
     * Отдельный канал, и это не формальность (#418).
     *
     * У постоянной строки мониторинга важность LOW — она не должна звенеть. Тревоге нужен свой канал с
     * HIGH, звуком будильника и обходом «не беспокоить»: важность канала на Android 8+ человек может
     * поменять сам, но задать её при создании — наше дело, второй раз канал уже не переписать.
     */
    private fun канал(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (nm.getNotificationChannel(КАНАЛ) != null) return
        val звук: Uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
            ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
        nm.createNotificationChannel(
            NotificationChannel(КАНАЛ, "Тревоги", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Низкий сахар и другие поводы разбудить"
                enableVibration(true)
                setBypassDnd(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                setSound(
                    звук,
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
            },
        )
    }
}
