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
 * ПОКАЗ ТРЕВОГИ: канал, звук, полный экран (SugarLife#418, #482).
 *
 * РЕШЕНИЙ ЗДЕСЬ БОЛЬШЕ НЕТ. Пороги, подтверждения, повторы, тихие часы и сторож молчания уехали в
 * движок целиком (SugarLife#482): правила считаются один раз и одинаково на Android и на iPhone, а
 * оболочка их доставляет. Пока правило жило здесь, на айфоне тревог не было вовсе и появиться не могло —
 * файл был андроидным, а модель в нём.
 *
 * Осталось то, что нельзя посчитать в движке, потому что это свойства платформы: канал с обходом «не
 * беспокоить», звук будильника, полноэкранное намерение, проверка выданных разрешений и сообщение о
 * ночной перезагрузке. Что показывать и когда — говорит движок (ТревогиДвижка.kt).
 *
 * ПРОВЕРОЧНАЯ ТРЕВОГА ОСТАЁТСЯ И ОСТАЁТСЯ ЗДЕСЬ. Иначе узнать, работают ли тревоги, можно только когда
 * ночью случится гипогликемия, — худший из возможных способов узнать. Она проходит весь путь целиком:
 * канал, звук, обход «не беспокоить», полноэкранное уведомление.
 */
object Тревоги {
    private const val TAG = "SugarLifeТревоги"
    /* Канал виден снаружи: тем же каналом показывает будящие тревоги движка (ТревогиДвижка.kt).
       Второй канал с теми же настройками означал бы два переключателя в системе на одно и то же —
       человек приглушил бы один и не понял, почему звук остался. */
    const val КАНАЛ = "sugarlife-alarm"
    private const val ID_ГИПО = 4712
    /* Своё уведомление, а не переписывание гипо: это разные поводы, и «данных нет» не должно
       стирать с экрана «низкий сахар», а низкий — прятать то, что данных больше не идёт. */
    private const val ID_МОЛЧАНИЕ = 4713
    private const val ID_ПЕРЕЗАГРУЗКА = 4714

    private const val НАСТРОЙКИ = "sugarlife-alarms"
    private const val КЛЮЧ_ОТДАЛИ = "devices-released"

    fun приборыОтданы(ctx: Context, отданы: Boolean) {
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).edit()
            .putBoolean(КЛЮЧ_ОТДАЛИ, отданы).apply()
    }

    fun приборыОтданы(ctx: Context): Boolean =
        ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).getBoolean(КЛЮЧ_ОТДАЛИ, false)

    /**
     * ПРОБЬЁТСЯ ЛИ ТРЕВОГА НОЧЬЮ (#468).
     *
     * Разрешения в манифесте — это только право спросить. Доступ к «Не беспокоить» выдаёт человек
     * руками, и пока он не выдан, система молча игнорирует обход тихого режима: тревога придёт, но
     * беззвучной. Хуже всего, что выглядит это исправно — уведомление в шторке утром на месте.
     *
     * Поэтому спрашиваем сами и говорим вслух. Возвращаем то, чего не хватает, человеческим языком;
     * пустой список — всё на месте.
     */
    fun чегоНеХватаетДляНочи(ctx: Context): List<String> = поломки(ctx).map { it.second }

    /**
     * То же, но КОДОМ И ФРАЗОЙ (просьба интерфейса, SugarLife#473).
     *
     * Дословную строку нельзя разложить по разделам экрана: «услышим ли тревогу» и «заметим ли
     * пропажу данных» — разные пункты, а поломки разрешений валились в один. Код машине, фраза
     * человеку; фраза по-прежнему живёт здесь, чтобы на двух платформах не разошлась.
     *
     * Коды: `notifications-off`, `dnd-access`, `fullscreen`, `channel-lowered`.
     */
    fun поломки(ctx: Context): List<Pair<String, String>> {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val нет = mutableListOf<Pair<String, String>>()
        if (!nm.areNotificationsEnabled()) {
            нет += "notifications-off" to "уведомления выключены целиком"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !nm.isNotificationPolicyAccessGranted) {
            нет += "dnd-access" to "нет доступа к «Не беспокоить» — ночью тревога будет беззвучной"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && !nm.canUseFullScreenIntent()) {
            нет += "fullscreen" to "запрещены полноэкранные уведомления — тревога останется строкой в шторке"
        }
        val канал = nm.getNotificationChannel(КАНАЛ)
        if (канал != null && канал.importance < NotificationManager.IMPORTANCE_HIGH) {
            нет += "channel-lowered" to "канал тревог понижен в системных настройках — звука не будет"
        }
        return нет
    }

    /**
     * ТЕЛЕФОН ПЕРЕЗАГРУЗИЛСЯ, А МОНИТОРИНГА НЕТ (#476).
     *
     * Уровень «обещание нарушено»: это не событие о сахаре, а отказ самой охраны. Ночное обновление
     * системы выключает всё разом и ничего не поднимает — до разблокировки телефон шифрован, движку
     * негде взять свою базу.
     *
     * Звучим как тревога, а не как заметка: человек, которому нужно нажать одну кнопку, чтобы
     * вернуть себе защиту, должен об этом узнать сейчас, а не утром по дырке в графике.
     *
     * Хранилище устройства обязательно: обычное до разблокировки недоступно, и обращение к нему тут
     * просто упало бы.
     */
    fun сказатьПроПерезагрузку(ctx: Context) {
        val ctxУстройства = ctx.createDeviceProtectedStorageContext()
        показать(
            ctxУстройства,
            "Мониторинг не работает",
            "Телефон перезагрузился — похоже, ставилось обновление системы. Пока вы не разблокируете " +
                "телефон, данные не собираются и тревоги о низком сахаре сработать не могут.",
            ID_ПЕРЕЗАГРУЗКА,
        )
    }

    /** Разблокировали — сообщение своё отработало, висеть ему незачем. */
    fun снятьПроПерезагрузку(ctx: Context) {
        runCatching { снять(ctx.createDeviceProtectedStorageContext(), ID_ПЕРЕЗАГРУЗКА) }
    }

    /** Куда вести человека за доступом к «Не беспокоить». null — версия Android слишком старая. */
    fun экранДоступаКТихомуРежиму(): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            Intent(android.provider.Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
        else null

    /** «35 минут», «31 минуту», «32 минуты» — иначе тревога выглядит машинной запиской. */
    private fun минут(n: Long): String {
        val сотня = n % 100
        val единицы = n % 10
        return when {
            сотня in 11..14 -> "минут"
            единицы == 1L -> "минуту"
            единицы in 2..4 -> "минуты"
            else -> "минут"
        }
    }

    private fun снять(ctx: Context, id: Int) {
        runCatching {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(id)
        }.onFailure { Log.w(TAG, "не удалось снять уведомление $id: $it") }
    }

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

    private fun показать(ctx: Context, заголовок: String, текст: String, id: Int = ID_ГИПО,
                         цель: String = "охрана") {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        канал(nm)
        /* Проверку тревоги запускают из «Охраны» — туда и возвращаем (#524): человек проверяет
           настройку и хочет увидеть её же, а не главный экран. */
        val куда = Intent(ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?: Intent(Intent.ACTION_MAIN)).putExtra(ЦЕЛЬ, цель)
        val открыть = PendingIntent.getActivity(
            ctx, 2, куда,
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
        runCatching { nm.notify(id, n) }
            .onFailure { Log.w(TAG, "не удалось показать тревогу: $it") }
    }

    /**
     * Отдельный канал, и это не формальность (#418).
     *
     * У постоянной строки мониторинга важность LOW — она не должна звенеть. Тревоге нужен свой канал с
     * HIGH, звуком будильника и обходом «не беспокоить»: важность канала на Android 8+ человек может
     * поменять сам, но задать её при создании — наше дело, второй раз канал уже не переписать.
     */
    fun каналТревог(nm: NotificationManager) = канал(nm)

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
