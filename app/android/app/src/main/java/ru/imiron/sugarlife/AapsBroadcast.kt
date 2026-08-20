package ru.imiron.sugarlife

import android.content.Context
import android.content.Intent
import android.util.Log
import ru.imiron.sugarlife.contract.GlucoseBroadcast
import ru.imiron.sugarlife.contract.GlucoseBroadcaster

/**
 * Отдаём показания соседнему приложению на этом же телефоне — AAPS (core#100).
 *
 * Нужно для длительной проверки: чтобы видеть, как приложение живёт сутками, показания должны доходить до
 * петли, а не только до нашего экрана.
 *
 * Формат — xDrip-совместимое вещание, снят с исходников AAPS (`XdripSourcePlugin`,
 * `core/interfaces/receivers/Intents.kt`), а не по памяти. AAPS кладёт эти поля прямо в свою базу.
 *
 * ВЫКЛЮЧЕНО ПО УМОЛЧАНИЮ, и это не осторожность ради осторожности: по этим числам петля считает дозу
 * инсулина. Пока наша калибровка не сверена с прибором производителя, включать вещание — осознанный шаг
 * человека, а не наше поведение из коробки.
 */
class AapsBroadcast(context: Context) : GlucoseBroadcaster {

    private val ctx = context.applicationContext

    override fun publish(reading: GlucoseBroadcast) {
        if (!включено(ctx)) return
        val i = Intent(ACTION).apply {
            putExtra(EXTRA_BG, reading.mgdl)
            reading.rawMgdl?.let { putExtra(EXTRA_RAW, it) }
            putExtra(EXTRA_TIME, reading.atMs)
            reading.trend?.let { putExtra(EXTRA_SLOPE, оноЖеУНих(it)) }
            reading.sensorStartedAtMs?.let { putExtra(EXTRA_SENSOR_STARTED, it) }
            putExtra(EXTRA_SOURCE, ИСТОЧНИК)
            putExtra(EXTRA_SOURCE_DESC, reading.source)
            // Вещание адресное: приёмник у AAPS не экспортирован для всех, а широкая рассылка на Android
            // всё равно не доходит до неявных приёмников с восьмой версии.
            setPackage(ПОЛУЧАТЕЛЬ)
        }
        runCatching { ctx.sendBroadcast(i) }
            .onSuccess { Log.d(TAG, "отдали в AAPS: ${reading.mgdl.toInt()} мг/дл") }
            .onFailure { Log.w(TAG, "не удалось отдать показание: $it") }
    }

    /**
     * Наши названия тренда — в те, что понимает получатель.
     *
     * У него это строки xDrip: `Flat`, `FortyFiveUp`, `SingleUp` и так далее. Незнакомое имя он молча
     * превратит в «неизвестно», поэтому переводим сами, а не надеемся на совпадение.
     */
    private fun оноЖеУНих(наш: String): String = when (наш) {
        "Rising", "Up" -> "SingleUp"
        "RisingSlowly", "SlowlyUp" -> "FortyFiveUp"
        "Stable", "Flat" -> "Flat"
        "FallingSlowly", "SlowlyDown" -> "FortyFiveDown"
        "Falling", "Down" -> "SingleDown"
        else -> "NOT COMPUTABLE"
    }

    companion object {
        private const val TAG = "SugarLifeAaps"
        private const val PREFS = "sugarlife-aaps"
        private const val KEY = "broadcast-enabled"

        /** Константы получателя (AAPS, `Intents.kt`) — сняты с исходников. */
        private const val ACTION = "com.eveningoutpost.dexdrip.BgEstimate"
        private const val EXTRA_BG = "com.eveningoutpost.dexdrip.Extras.BgEstimate"
        private const val EXTRA_RAW = "com.eveningoutpost.dexdrip.Extras.Raw"
        private const val EXTRA_TIME = "com.eveningoutpost.dexdrip.Extras.Time"
        private const val EXTRA_SLOPE = "com.eveningoutpost.dexdrip.Extras.BgSlopeName"
        private const val EXTRA_SENSOR_STARTED = "com.eveningoutpost.dexdrip.Extras.SensorStartedAt"
        private const val EXTRA_SOURCE = "com.eveningoutpost.dexdrip.Extras.SourceInfo"
        private const val EXTRA_SOURCE_DESC = "com.eveningoutpost.dexdrip.Extras.SourceDesc"
        private const val ПОЛУЧАТЕЛЬ = "info.nightscout.androidaps"
        /** Имя источника: пусть в AAPS будет видно, чьи это числа. */
        private const val ИСТОЧНИК = "SugarLife"

        fun включено(ctx: Context): Boolean =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY, false)

        fun включить(ctx: Context, on: Boolean) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY, on).apply()
            Log.i(TAG, "вещание в AAPS: ${if (on) "включено" else "выключено"}")
        }
    }
}
