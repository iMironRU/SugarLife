package ru.imiron.sugarlife

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log

/**
 * Сторож молчания: единственная проверка, которую нельзя привязать к приходу данных (SugarLife#243).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ БУДИЛЬНИК. Всё остальное в тревогах считается на снимке движка: пришло показание —
 * посмотрели, ниже ли порога. Молчание так проверить нельзя по определению: снимков в молчание не
 * бывает, и код, который просыпается только от данных, узнает об их отсутствии никогда. Нужен
 * независимый от данных повод проснуться — им и служит будильник системы.
 *
 * НЕТОЧНЫЙ БУДИЛЬНИК ЗДЕСЬ ДОСТАТОЧЕН, и это не компромисс. `setExactAndAllowWhileIdle` с Android 12
 * требует отдельного разрешения; мы берём `setAndAllowWhileIdle`, который в глубоком сне система
 * вправе сдвигать — по документации не чаще раза в девять минут на приложение. Порог молчания у нас
 * полчаса: сдвиг на девять минут превращает «сказали на тридцатой» в «сказали на тридцать девятой»,
 * а не в «не сказали». Просить у человека разрешение на точные будильники ради этого нечестно.
 *
 * ЗАВОДИМ ПО ОДНОМУ, а не `setRepeating`: повторяющийся будильник система в Doze не запускает вовсе,
 * поэтому каждый раз ставим следующий сами — этим же приёмом пользуется драйверный [AlarmWakeups].
 *
 * Замка бодрствования здесь нет намеренно: вся работа — сравнить два числа и, может быть, показать
 * уведомление. Система держит процессор на время `onReceive`, и этого хватает с запасом.
 */
class SilenceWatchdog : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        runCatching { Тревоги.проверитьМолчание(ctx) }
            .onFailure { Log.w(TAG, "проверка молчания не удалась: $it") }
        /* Следующий заводим ВСЕГДА, даже если проверка упала: сторож, замолчавший из-за одной
           ошибки, ничем не отличается от выключенного, а узнать об этом было бы негде. */
        завести(ctx)
    }

    companion object {
        private const val TAG = "SugarLifeСторож"
        private const val КОД = 4713

        /* Шаг вдвое меньше самого короткого порога (15 минут): тогда о молчании говорят с задержкой
           не больше половины порога, и увеличивать частоту незачем — она стоит батареи, а точности
           не добавляет, потому что система всё равно пакует неточные будильники. */
        private const val ШАГ_МС = 7 * 60_000L

        private fun намерение(ctx: Context): PendingIntent = PendingIntent.getBroadcast(
            ctx, КОД, Intent(ctx, SilenceWatchdog::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        /** Завести следующую проверку. Звать можно сколько угодно — будильник один, он переписывается. */
        fun завести(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            runCatching {
                am.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + ШАГ_МС,
                    намерение(ctx),
                )
            }.onFailure { Log.w(TAG, "не удалось завести проверку молчания: $it") }
        }

        fun отменить(ctx: Context) {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            runCatching { am.cancel(намерение(ctx)) }
                .onFailure { Log.w(TAG, "не удалось отменить проверку молчания: $it") }
        }

        /** Включена тревога о молчании — сторож ходит, выключена — не тратим на него пробуждения. */
        fun поНастройке(ctx: Context) {
            if (Тревоги.молчаниеВключено(ctx)) завести(ctx) else отменить(ctx)
        }
    }
}
