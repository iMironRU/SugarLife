package ru.imiron.sugarlife

import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log

/**
 * Кто занял прибор (SugarLife#422).
 *
 * ОТОБРАТЬ НЕЛЬЗЯ, И ЭТО ПРАВИЛЬНО. Приложение управляет только своим подключением;
 * разорвать чужое нечем — иначе любое приложение выбивало бы соседей с их приборов.
 *
 * УЗНАТЬ ТОЧНО, КТО ИМЕННО, — ТОЖЕ НЕЛЬЗЯ. Перечислить чужие GATT-подключения приложению
 * не дают; это видно только через `dumpsys bluetooth_manager` с правами отладки.
 *
 * Но два доступных факта складываются в честный ответ:
 *
 *  1. прибор подключён НА ЭТОМ ТЕЛЕФОНЕ (системный список подключений), а данные идут не
 *     нам — значит линк держит кто-то другой здесь же;
 *  2. на телефоне УСТАНОВЛЕНО приложение, которое умеет этот прибор.
 *
 * Вместе это не «кто держит», а «кто мог бы» плюс «кто-то точно держит» — и человеку
 * этого достаточно: решение у него простое, закрыть одно из двух.
 *
 * ОСТОРОЖНО СО СЛОВАМИ. Семантику системного списка я на приборе не проверял, поэтому
 * наружу отдаём наблюдение, а не приговор: «подключён на этом телефоне, но данные идут
 * не нам». Утверждать «его держит Juggluco» мы права не имеем — мы этого не знаем.
 */
object КтоДержит {
    private const val TAG = "SugarLifeКтоДержит"

    /** Известные приложения, которые умеют наши приборы. Имя — как его знает человек. */
    private val ЗНАКОМЫЕ = listOf(
        "tk.glucodata" to "Juggluco",
        "tk.glucodata.ng" to "JugglucoNG",
        "com.eveningoutpost.dexdrip" to "xDrip+",
        "info.nightscout.androidaps" to "AndroidAPS",
        "com.sibionics.cgm" to "приложение производителя сенсора",
    )

    /**
     * @param адрес MAC прибора, как его знает движок; пусто — спрашиваем только про
     *   установленные приложения.
     * @return пара: занят ли прибор на этом телефоне и кто из знакомых установлен.
     */
    fun посмотреть(ctx: Context, адрес: String?): Pair<Boolean, List<String>> {
        val занят = адрес?.let { подключёнСистемой(ctx, it) } ?: false
        return занят to установленные(ctx)
    }

    private fun подключёнСистемой(ctx: Context, адрес: String): Boolean = runCatching {
        val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager ?: return false
        /* GATT — профиль, по которому работают сенсоры и мосты. Список системный: в нём
           наши подключения тоже есть, поэтому один этот факт ничего не доказывает —
           смысл он приобретает только рядом с «а данных у нас нет». */
        bm.getConnectedDevices(BluetoothProfile.GATT).any { it.address.equals(адрес, ignoreCase = true) }
    }.onFailure { Log.w(TAG, "не смогли спросить систему о подключениях: $it") }.getOrDefault(false)

    private fun установленные(ctx: Context): List<String> {
        val pm = ctx.packageManager
        return ЗНАКОМЫЕ.mapNotNull { (пакет, имя) ->
            runCatching {
                pm.getPackageInfo(пакет, 0)
                имя
            }.getOrNull()
        }
    }
}
