package ru.imiron.sugarlife

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground-сервис: держит процесс живым в фоне. Без него HyperOS/Android убивает приложение почти сразу после
 * ухода с переднего плана → холодный старт при возврате, теряется BLE-сенсор, прерывается мониторинг.
 * Сам движок живёт в [EngineHolder] (процесс-синглтон) — сервис лишь поднимает приоритет процесса и держит
 * постоянное уведомление (как AAPS/xDrip). Тип dataSync — без предусловий; долгосрочно лучше health.
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
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "sugarlife-monitor"
        private const val NOTIF_ID = 4711

        /** Запускать ТОЛЬКО с переднего плана (Android 12+ запрещает старт FGS из фона). */
        fun start(ctx: Context) {
            val i = Intent(ctx, SugarLifeService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, SugarLifeService::class.java)) }
    }
}
