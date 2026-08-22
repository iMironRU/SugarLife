package ru.imiron.sugarlife

import android.content.Context
import ru.imiron.sugarlife.engine.DefaultDriverProvider
import ru.imiron.sugarlife.engine.SugarLifeEngine
import ru.imiron.sugarlife.persistence.DatabaseDriverFactory

/**
 * Процесс-синглтон движка. Capacitor пересоздаёт Activity/плагин при возврате из фона — если бы движок жил в
 * плагине, он пересоздавался бы каждый раз (терялись сессии BLE/NS). Здесь он живёт на уровне процесса; плагин
 * лишь подписывается/отписывается. Живучесть самого процесса в фоне обеспечивает [SugarLifeService] (foreground).
 */
object EngineHolder {
    @Volatile private var engine: SugarLifeEngine? = null
    @Volatile private var providerAttached = false

    @Synchronized
    fun engine(appContext: Context): SugarLifeEngine {
        var e = engine
        if (e == null) {
            // Персист-БД (SQLite) → история переживает перезапуск. appContext (не Activity) — живёт всё приложение.
            e = SugarLifeEngine(
                withSimulators = false,
                dbDriverFactory = DatabaseDriverFactory(appContext.applicationContext),
            )
            engine = e
            /* Будильник — и самому движку, не только драйверам (core#113, SugarLife#454).
               Внутри движка крутится сторож тишины: раз в полминуты смотрит, не сменился ли статус
               источника от одного хода времени, и раз в пять минут рассылает снимок. Спит он через
               `wakeups.sleep`, а по умолчанию это обычная корутинная задержка — в Doze она едет вместе
               с телефоном. То есть плитка в интерфейсе оставалась бы бодрой с числом получасовой
               давности ровно тогда, когда телефон лежит в кармане ночью.

               Ставим ДО startAsync: сторож заводится при старте, и будильник должен быть у него уже
               тогда, а не через минуту. */
            e.setWakeups(AlarmWakeups(appContext.applicationContext))
            e.startAsync()
        }
        return e
    }

    /** Реальные BLE-драйверы — по требованию (первый скан/добавление). Идемпотентно между пересозданиями плагина. */
    @Synchronized
    fun ensureProvider(appContext: Context) {
        if (providerAttached) return
        providerAttached = true
        val provider = DefaultDriverProvider(
            nowMs = { System.currentTimeMillis() },
            sensorBridge = { bleId, _ -> AndroidSensorBridge(appContext, bleId) },
            pumpBridge = { bleId, _ -> AndroidPumpBridge(appContext, bleId) },
        )
        // Долгие паузы отмеряет будильник, а не корутина (core#93): в Doze процессор ради `delay` не будят,
        // и пятиминутный цикл помпы превращается в «когда система разрешит».
        provider.setWakeups(AlarmWakeups(appContext))
        // Калибровка сенсора вендорским алгоритмом (core#88). Сам алгоритм скачивается скриптом и в
        // репозиторий не попадает; нет его — нет и калиброванного значения, приложение покажет сырое и
        // скажет, что оно сырое.
        provider.setCalibratorFactory { SibionicsVendorCalibrator() }
        engine(appContext).attachDriverProvider(provider)
    }
}
