package ru.imiron.sugarlife

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject

/**
 * ДОСТАВКА ТРЕВОГ ДВИЖКА (SugarLife#482, контракт 1.30).
 *
 * Раздел с ядром такой: движок решает, что случилось и какого оно уровня, оболочка — как это звучит и
 * выглядит. Здесь вторая половина: показать, дать ответить, снять.
 *
 * ПОЧЕМУ ЭТО НЕ ПОВТОРЯЕТ `Тревоги.kt`. Тот файл сам решает, будить ли: считает подтверждения, держит
 * пороги, отмеряет повторы. Здесь ничего не решается — приходит готовое событие с уровнем, и всё, что мы
 * делаем, это выбираем канал, звук и текст. Когда движок берёт дежурство, наша половина уходит в отставку
 * целиком ([Тревоги.уступить]) — двоевластие в тревогах владелец запретил прямо, и правильно: две
 * реализации, работающие параллельно, невозможно проверить по отдельности.
 *
 * ПЕРЕДАЧА ДЕЖУРСТВА — ПО ФАКТУ, А НЕ ПО ФЛАГУ СБОРКИ. Признак в снимке: мост 1.30 и непустые правила
 * (см. [ПравилаПоказа.ведётДвижок]). Так в каждый момент тревоги ведёт ровно один, и старая сборка
 * ядра не оставляет человека вовсе без охраны.
 */
object ТревогиДвижка {
    private const val TAG = "SugarLifeТревогиДвижка"

    /* Каналы по громкости, а не по поводу. Повод у тревоги свой каждый раз, а громкость человек
       настраивает в системе — и настраивает он именно «будить меня» против «сообщать тихо». */
    private const val КАНАЛ_ДЕНЬ = "sugarlife-alarm-day"
    private const val КАНАЛ_ЗАМЕТКА = "sugarlife-alarm-note"

    /* Что уже показано: id тревоги → что это было. Нужно для двух вещей: не показывать одно и то же
       дважды (снимок приходит часто) и знать, что снимать, когда движок сказал «отбой» списком. */
    private val показано = mutableMapOf<String, String>()
    @Volatile private var дежуритДвижок = false

    /** Ведёт ли тревоги движок прямо сейчас — по последнему снимку. */
    fun дежурит(): Boolean = дежуритДвижок

    /**
     * Снимок пришёл. Возвращает true, если тревоги ведёт движок, — тогда наша половина молчит.
     */
    fun приСнимке(ctx: Context, json: String): Boolean {
        val снимок = runCatching { JSONObject(json) }.getOrNull() ?: return дежуритДвижок
        val правила = снимок.optJSONArray("alarmRules")
        val правил = правила?.length() ?: 0
        /* Выключатель точных будильников приезжает в правилах молчания — там же, где пороги, которые он
           делает достижимыми или нет. Зеркалим в настройки: будильник заводится в фоне, где снимка нет. */
        for (i in 0 until правил) {
            val н = правила?.optJSONObject(i)?.optJSONObject("settings") ?: continue
            if (н.has("alarms.exactWakeups")) {
                Точность.запомнить(ctx, н.optString("alarms.exactWakeups", "off"))
                break
            }
        }
        val ведёт = ПравилаПоказа.ведётДвижок(снимок.optString("bridgeRevision", null), правил)
        if (ведёт != дежуритДвижок) {
            Log.i(TAG, if (ведёт) "движок ведёт тревоги" else "движок тревог не считает — показывать нечего")
            /* Ядро без модели тревог означает, что тревог нет вовсе: своей логики решений у нас
               больше не осталось (#482, шаг 5). Уведомления, показанные прежним ядром, снимаем —
               обновлять их некому, а висящая тревога, за которой никто не следит, хуже её отсутствия. */
            if (!ведёт) показано.keys.toList().forEach { снять(ctx, it) }
        }
        дежуритДвижок = ведёт
        if (!ведёт) return false

        val массив = снимок.optJSONArray("alarmEvents")
        val события = (0 until (массив?.length() ?: 0))
            .mapNotNull { массив?.optJSONObject(it) }
            .mapNotNull { разобрать(it) }
        val активные = снимок.optJSONArray("activeAlarms")?.let { висят ->
            (0 until висят.length()).mapNotNull { висят.optString(it, null) }
        }
        /* Что делать — считает чистая половина (ПравилаПоказа.план), здесь только исполняем. Сверка со
           списком висящих идёт там же: снять надо и то, о чём «отбоя» не приезжало вовсе. */
        for (шаг in ПравилаПоказа.план(события, активные, показано.keys.toSet())) {
            when (шаг) {
                is ПравилаПоказа.Шаг.Снять -> снять(ctx, шаг.id)
                is ПравилаПоказа.Шаг.Показать -> {
                    показать(ctx, шаг.событие, шаг.как)
                    показано[шаг.событие.id] = шаг.событие.what
                }
            }
        }
        return true
    }

    private fun разобрать(о: JSONObject): ПравилаПоказа.Событие? {
        val id = о.optString("id", "")
        if (id.isEmpty()) return null
        return ПравилаПоказа.Событие(
            id = id,
            what = о.optString("what", "started"),
            level = о.optString("level", "Сегодня"),
            baseLevel = о.optString("baseLevel", о.optString("level", "Сегодня")),
            atMs = о.optLong("atMs", 0L),
            throughSpeaker = о.optBoolean("throughSpeaker", false),
            words = о.optString("words", "").takeIf { it.isNotBlank() },
            needsAck = о.optBoolean("needsAck", false),
            mmol = if (о.isNull("mmol")) null else о.optDouble("mmol").takeIf { !it.isNaN() },
            /* Светофор доставки (мост 1.31…1.35). Умолчания — как у старого ядра: «show» уводит
               решение к прежнему выводу из уровня, и молчаливой тревога не станет. */
            sound = о.optBoolean("sound", true),
            loudness = о.optString("loudness", "show"),
            soundKind = о.optString("soundKind", "none"),
            bypassQuiet = о.optBoolean("bypassQuiet", false),
            fullScreen = о.optBoolean("fullScreen", false),
            repeatUntilAck = о.optBoolean("repeatUntilAck", false),
            distinctLook = о.optBoolean("distinctLook", false),
            raiseVolumeTo = if (о.isNull("raiseVolumeTo")) null else о.optInt("raiseVolumeTo").takeIf { it > 0 },
            inCar = о.optBoolean("inCar", false),
        )
    }

    private fun показать(ctx: Context, с: ПравилаПоказа.Событие, как: ПравилаПоказа.Как) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val канал = when (как) {
            ПравилаПоказа.Как.БУДИТЬ -> { Тревоги.каналТревог(nm); Тревоги.КАНАЛ }
            ПравилаПоказа.Как.ОБЫЧНО -> { тихиеКаналы(nm); КАНАЛ_ДЕНЬ }
            else -> { тихиеКаналы(nm); КАНАЛ_ЗАМЕТКА }
        }
        val (заголовок, текст) = ПравилаПоказа.слова(с.id, с.level, с.mmol, с.words)
        val открыть = PendingIntent.getActivity(
            ctx, ПравилаПоказа.ключУведомления(с.id),
            ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent(Intent.ACTION_MAIN),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val b = NotificationCompat.Builder(ctx, канал)
            .setContentTitle(заголовок)
            .setContentText(текст)
            .setStyle(NotificationCompat.BigTextStyle().bigText(текст))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setCategory(
                if (как == ПравилаПоказа.Как.БУДИТЬ) NotificationCompat.CATEGORY_ALARM
                else NotificationCompat.CATEGORY_STATUS,
            )
            .setContentIntent(открыть)
            /* Тревога, которую человек ещё не подтвердил, не должна исчезать от касания: смахнул
               случайно — и остался без единственного напоминания. Отбой даёт движок. */
            .setAutoCancel(!с.needsAck)
            .setOnlyAlertOnce(false)
        if (как == ПравилаПоказа.Как.БУДИТЬ) {
            b.setPriority(NotificationCompat.PRIORITY_MAX)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setOngoing(с.needsAck)
            /* ПОЛНЫЙ ЭКРАН — ПО ПРИКАЗУ, А НЕ ПО НАШЕЙ ДОГАДКЕ (мост 1.34). В машине движок присылает
               false: тревога поверх всего перед человеком за рулём отвлекает сильнее, чем помогает.
               Старое ядро поля не шлёт — тогда ведём себя как раньше и разворачиваем. */
            if (с.fullScreen || (с.loudness == "show" && !с.inCar)) b.setFullScreenIntent(открыть, true)
            /* ГРОМКОСТЬ БУДИЛЬНИКА — ДО УКАЗАННОГО ПРОЦЕНТА. «Не беспокоить», беззвучный режим и ноль
               громкости — три разных состояния, и от последнего не спасает ни канал, ни обход тихого:
               спасает только подъём. Поднимаем ТОЛЬКО вверх и возвращаем после отбоя. */
            с.raiseVolumeTo?.let { если -> if (!с.inCar) ГромкостьТревоги.поднять(ctx, если) }
        } else {
            b.setPriority(
                if (как == ПравилаПоказа.Как.ОБЫЧНО) NotificationCompat.PRIORITY_DEFAULT
                else NotificationCompat.PRIORITY_LOW,
            )
        }
        /* «Понял» — только там, где движок его ждёт. Кнопка, которая ничего не подтверждает, хуже её
           отсутствия: человек решит, что ответил, а тревога вернётся тем же уровнем. */
        if (с.needsAck) b.addAction(Понял.действие(ctx, с.id))
        runCatching { nm.notify(ПравилаПоказа.ключУведомления(с.id), b.build()) }
            .onFailure { Log.w(TAG, "не удалось показать тревогу ${с.id}: $it") }
    }

    private fun снять(ctx: Context, id: String) {
        показано.remove(id)
        /* Чужую громкость себе не оставляем: подняли ради тревоги — вернули, когда её не стало. */
        if (показано.isEmpty()) ГромкостьТревоги.вернуть(ctx)
        runCatching {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .cancel(ПравилаПоказа.ключУведомления(id))
        }.onFailure { Log.w(TAG, "не удалось снять тревогу $id: $it") }
    }

    /* Два тихих канала рядом с будящим. Разделять обязательно: важность канала человек меняет в системе,
       и «пусть заметки не звенят» не должно заодно приглушить то, что обязано будить. */
    private fun тихиеКаналы(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (nm.getNotificationChannel(КАНАЛ_ДЕНЬ) == null) {
            nm.createNotificationChannel(
                NotificationChannel(КАНАЛ_ДЕНЬ, "Тревоги днём", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Поводы, которые не будят: обычный звук и тихие часы системы"
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                    setSound(
                        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION),
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                },
            )
        }
        if (nm.getNotificationChannel(КАНАЛ_ЗАМЕТКА) == null) {
            nm.createNotificationChannel(
                NotificationChannel(КАНАЛ_ЗАМЕТКА, "Заметки", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Копятся молча: их читают, когда откроют приложение"
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
            )
        }
    }
}
