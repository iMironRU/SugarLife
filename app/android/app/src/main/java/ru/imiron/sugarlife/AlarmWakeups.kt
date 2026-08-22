package ru.imiron.sugarlife

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import ru.imiron.sugarlife.contract.Wakeups
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume

/**
 * Долгие паузы драйвера отмеряет будильник, а не корутина (core#93).
 *
 * В режиме Doze — экран выключен, телефон лежит неподвижно — процессор ради корутины никто не будит:
 * `delay(5 минут)` срабатывает поздно, и насколько поздно, решает система. Для помпы это значит, что
 * «читаем раз в пять минут» превращается в «читаем, когда разрешат».
 *
 * Так же поступает xDrip: свои периодические дела он заводит будильником, а не задержкой.
 *
 * Две оговорки, обе важные:
 *
 *  — **точный будильник требует разрешения.** С Android 12 `setExactAndAllowWhileIdle` доступен только с
 *    разрешением на точные будильники; без него — `setAndAllowWhileIdle`, он срабатывает в Doze тоже, но
 *    система вправе сдвинуть его на своё усмотрение (в Doze — не чаще раза в девять минут на приложение).
 *    Мы берём лучшее из доступного и **говорим в журнал, что взяли**: молча отдавать неточное время нельзя,
 *    иначе «пропуски раз в девять минут» будут искать в приборе.
 *
 *  — **проснуться мало, надо не уснуть снова.** Система держит процессор ровно на время `onReceive`, а
 *    дальше он свободен уснуть — посреди разговора с помпой. Поэтому на пробуждение берётся замок
 *    бодрствования, и отпускается он при следующем засыпании: работаем — не спим, спим — не держим.
 */
class AlarmWakeups(context: Context) : Wakeups {

    private val ctx = context.applicationContext
    private val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    private val замок = Пробуждение(ctx, "SugarLife:wakeups")
    private val счётчик = AtomicInteger(0)

    /**
     * Спим ДВУМЯ способами сразу и просыпаемся по первому — это результат замера, а не осторожность.
     *
     * Проверено на живом Doze (эмулятор, Android 15, глубокий сон): будильник действительно срабатывает —
     * но ПОЗЖЕ обычной задержки. Просили 90 секунд: задержка отдавала 90.0 с ровно, будильник — 112 и 157 с.
     * Так и должно быть, ведь без разрешения на точные будильники система вправе его паковать.
     *
     * При этом эмулятор не умеет доказать обратное — то, ради чего всё затевалось. Процессор он по-настоящему
     * не усыпляет, поэтому корутинная задержка там всегда точна; на живом телефоне с погашенным экраном
     * процессор засыпает, и она опаздывает ровно настолько, насколько он спал.
     *
     * Отсюда вывод: не выбирать между ними, а взять оба и проснуться по первому. Где процесс живёт своим
     * ходом — платит задержка, и опоздания нет вовсе; где процессор уснул — выручает будильник. И в журнал
     * пишем, КТО разбудил: на железе это и будет ответом, нужен ли будильник вообще.
     */
    override suspend fun sleep(ms: Long) {
        замок.отпустить()                    // засыпаем — держать процессор незачем
        if (ms < ПОРОГ_МС) { delay(ms); return }   // короткую паузу Doze не съест, будильник тут лишний

        val начало = System.currentTimeMillis()
        val ктоРазбудил = kotlinx.coroutines.CompletableDeferred<String>()
        kotlinx.coroutines.coroutineScope {
            val задержка = launch { delay(ms); ктоРазбудил.complete("задержка") }
            val будильник = launch { ждатьБудильник(ms); ктоРазбудил.complete("будильник") }
            val кто = ктоРазбудил.await()
            задержка.cancel(); будильник.cancel()
            bleLog(
                "Debug", "проснулись после паузы", null,
                "просили мс" to ms.toString(),
                "прошло мс" to (System.currentTimeMillis() - начало).toString(),
                "разбудил" to кто,
            )
        }
    }

    private suspend fun ждатьБудильник(ms: Long) {
        val номер = счётчик.incrementAndGet()
        val действие = "$ДЕЙСТВИЕ.$номер"
        suspendCancellableCoroutine { продолжение ->
            val приёмник = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) {
                    // Замок берём ЗДЕСЬ: пока идёт onReceive, процессор держит система, а сразу после —
                    // уже никто. Разговор с прибором начнётся на пару строк позже, и уснуть между этим
                    // нельзя (core#93).
                    замок.взять()
                    runCatching { ctx.unregisterReceiver(this) }
                    if (продолжение.isActive) продолжение.resume(Unit)
                }
            }
            ContextCompat.registerReceiver(ctx, приёмник, IntentFilter(действие), ContextCompat.RECEIVER_NOT_EXPORTED)

            val намерение = PendingIntent.getBroadcast(
                ctx, номер, Intent(действие).setPackage(ctx.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val когда = System.currentTimeMillis() + ms
            /* Точность — решение человека (#482): выключатель `alarms.exactWakeups` плюс выданное
               разрешение. Одного разрешения мало: на Android 12 система выдаёт его при установке сама,
               и считать это согласием нельзя — человек ничего не выбирал. */
            val точный = Точность.точныйБудильник(ctx)
            runCatching {
                if (точный) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, когда, намерение)
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, когда, намерение)
            }.onFailure {
                // Система отказала — не молчим и не пропадаем: остаётся обычная задержка, и она хотя бы
                // сработает, пока телефон бодрствует.
                Log.w(TAG, "будильник не поставился ($it) — отмеряем паузу как раньше")
                runCatching { ctx.unregisterReceiver(приёмник) }
                if (продолжение.isActive) продолжение.resume(Unit)
                return@suspendCancellableCoroutine
            }
            bleLog(
                "Debug", "поставлен будильник на паузу", null,
                "мс" to ms.toString(),
                "будильник" to if (точный) "точный" else "неточный (нет разрешения на точные — система вправе сдвинуть)",
            )

            продолжение.invokeOnCancellation {
                runCatching { ctx.unregisterReceiver(приёмник) }
                runCatching { am.cancel(намерение) }
            }
        }
    }

    private companion object {
        const val TAG = "SugarLifeWakeups"
        const val ДЕЙСТВИЕ = "ru.imiron.sugarlife.WAKEUP"
        /** Ниже этого порога будильник не нужен: такие паузы система не откладывает. */
        const val ПОРОГ_МС = 60_000L
    }
}
