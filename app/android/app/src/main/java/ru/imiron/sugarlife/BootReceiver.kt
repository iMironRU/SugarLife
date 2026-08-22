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

        /*
         * ЛОВУШКА НОЧНОГО ОБНОВЛЕНИЯ (#476).
         *
         * Система ставит обновление ночью и перезагружает телефон. BOOT_COMPLETED на телефоне с
         * шифрованием приходит ТОЛЬКО ПОСЛЕ первой разблокировки — а человек спит. Значит до утра нет
         * ни мониторинга, ни тревог, и он об этом не знает: телефон выглядит обычно.
         *
         * LOCKED_BOOT_COMPLETED приходит сразу. Поднять здесь движок нельзя — его база зашифрована до
         * ввода кода. Но СКАЗАТЬ можно, и это ровно то, что человек обязан узнать: защиты сейчас нет.
         */
        if (intent.action == Intent.ACTION_LOCKED_BOOT_COMPLETED) {
            if (SugarLifeService.былВключёнДоРазблокировки(ctx)) {
                Log.w(TAG, "перезагрузка до разблокировки — мониторинга нет, говорим вслух")
                Тревоги.сказатьПроПерезагрузку(ctx)
            }
            return
        }

        if (!SugarLifeService.былВключён(ctx)) {
            Log.i(TAG, "${intent.action}: мониторинг был выключен — не поднимаем")
            return
        }
        if (Build.VERSION.SDK_INT >= 35 && !SugarLifeService.bluetoothРазрешён(ctx)) {
            Log.i(TAG, "${intent.action}: нет разрешения на Bluetooth — из загрузки система стартовать не даст")
            return
        }
        Log.i(TAG, "${intent.action}: поднимаем мониторинг")
        // Разблокировали — тревога о перезагрузке своё отработала.
        Тревоги.снятьПроПерезагрузку(ctx)
        runCatching { SugarLifeService.start(ctx) }
            .onFailure { Log.w(TAG, "не удалось поднять сервис после загрузки: $it") }
    }

    private companion object { const val TAG = "SugarLifeBoot" }
}
