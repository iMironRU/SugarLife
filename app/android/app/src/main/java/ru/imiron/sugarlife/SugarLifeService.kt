package ru.imiron.sugarlife

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
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
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Мониторинг", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Фоновый мониторинг глюкозы"
                },
            )
        }
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("SugarLife")
            .setContentText("Мониторинг активен")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val тип = if (bluetoothРазрешён(this)) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            else ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            Log.i(TAG, "старт: тип ${if (тип == ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) "connectedDevice" else "dataSync (нет разрешения на Bluetooth — предел 6ч/сут на Android 15)"}")
            startForeground(NOTIF_ID, notif, тип)
        } else {
            startForeground(NOTIF_ID, notif)
        }
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

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "SugarLifeService"
        private const val CHANNEL = "sugarlife-monitor"
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
            val i = Intent(ctx, SugarLifeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ВКЛЮЧЁН, false).apply()
            ctx.stopService(Intent(ctx, SugarLifeService::class.java))
        }

        /** Был ли мониторинг включён до перезагрузки. Поднимать его после загрузки самовольно нельзя:
         *  выключил человек — значит выключил. */
        fun былВключён(ctx: Context): Boolean =
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ВКЛЮЧЁН, false)
    }
}
