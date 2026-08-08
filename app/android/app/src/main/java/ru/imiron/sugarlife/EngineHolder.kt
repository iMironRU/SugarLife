package ru.imiron.sugarlife

import android.content.Context
import ru.imiron.sugarlife.engine.DefaultDriverProvider
import ru.imiron.sugarlife.engine.SugarLifeEngine

/**
 * Процесс-синглтон движка. Capacitor пересоздаёт Activity/плагин при возврате из фона — если бы движок жил в
 * плагине, он пересоздавался бы каждый раз (терялись сессии BLE/NS). Здесь он живёт на уровне процесса; плагин
 * лишь подписывается/отписывается. Живучесть самого процесса в фоне обеспечивает [SugarLifeService] (foreground).
 */
object EngineHolder {
    @Volatile private var engine: SugarLifeEngine? = null
    @Volatile private var providerAttached = false

    @Synchronized
    fun engine(): SugarLifeEngine {
        var e = engine
        if (e == null) {
            e = SugarLifeEngine(withSimulators = false)
            engine = e
            e.startAsync()
        }
        return e
    }

    /** Реальные BLE-драйверы — по требованию (первый скан/добавление). Идемпотентно между пересозданиями плагина. */
    @Synchronized
    fun ensureProvider(appContext: Context) {
        if (providerAttached) return
        providerAttached = true
        engine().attachDriverProvider(
            DefaultDriverProvider(
                nowMs = { System.currentTimeMillis() },
                sensorBridge = { bleId, _ -> AndroidSensorBridge(appContext, bleId) },
                pumpBridge = { bleId, _ -> AndroidPumpBridge(appContext, bleId) },
            ),
        )
    }
}
