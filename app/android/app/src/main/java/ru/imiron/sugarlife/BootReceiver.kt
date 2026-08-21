package ru.imiron.sugarlife

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Поднять мониторинг после перезагрузки телефона и после обновления приложения (#380).
 *
 * Раньше после ночной перезагрузки или обновления системы мониторинг был просто выключен, и человек
 * узнавал об этом по дырке в графике. Приёмник загрузки есть и у xDrip+, и у Juggluco — обе живут
 * круглосуточно именно поэтому.
 *
 * Два условия, и оба существенные:
 *
 *  — **мониторинг должен был работать до перезагрузки.** Выключил человек — значит выключил; включать
 *    самовольно нельзя;
 *  — **должно быть выдано разрешение на Bluetooth.** Android 15 запрещает поднимать из BOOT_COMPLETED
 *    сервисы типа `dataSync` (бросает ForegroundServiceStartNotAllowedException), а `connectedDevice`
 *    разрешает. Без Bluetooth-разрешения нам доступен только первый — значит из загрузки не стартуем
 *    вовсе. Это честно: в облачном режиме приложение и так оживёт при первом открытии.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val ctx = context.applicationContext
        if (!SugarLifeService.былВключён(ctx)) {
            Log.i(TAG, "${intent.action}: мониторинг был выключен — не поднимаем")
            return
        }
        if (Build.VERSION.SDK_INT >= 35 && !SugarLifeService.bluetoothРазрешён(ctx)) {
            Log.i(TAG, "${intent.action}: нет разрешения на Bluetooth — из загрузки система стартовать не даст")
            return
        }
        Log.i(TAG, "${intent.action}: поднимаем мониторинг")
        runCatching { SugarLifeService.start(ctx) }
            .onFailure { Log.w(TAG, "не удалось поднять сервис после загрузки: $it") }
    }

    private companion object { const val TAG = "SugarLifeBoot" }
}
