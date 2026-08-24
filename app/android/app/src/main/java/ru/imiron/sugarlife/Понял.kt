package ru.imiron.sugarlife

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors

/**
 * «ПОНЯЛ» ПО ТРЕВОГЕ — доставка (SugarLife#482, контракт 1.29).
 *
 * Тревогами теперь распоряжается движок: он решает, что случилось и какого это уровня. За нами доставка —
 * показать, дать ответить и донести ответ. Здесь последнее.
 *
 * ПОЧЕМУ ЭТО НЕ ПРОСТО ВЫЗОВ. Кнопка живёт в уведомлении, а уведомление переживает смерть процесса.
 * Человек жмёт её ночью по тревоге, которую показал движок, которого в памяти уже нет; поднять движок в
 * этот момент можно не всегда, а на старом ядре интента `acknowledgeAlarm` ещё и не существует —
 * он вернёт «не принято». Во всех трёх случаях ответ обязан не пропасть, иначе эскалация продолжится
 * после того, как человек ответил.
 *
 * Поэтому порядок такой: СНАЧАЛА записали, ПОТОМ пробуем отдать, и убираем только по «принято».
 * Правила самой очереди — в [ОчередьПонял], там же тест.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Решения, что делать с тревогой после «понял»: снуз, возврат, эскалация — всё это
 * движок. Мы не гасим ничего своего и ничего не пересчитываем: нажали — записали — отдали.
 */
object Понял {
    private const val TAG = "SugarLifeПонял"
    const val ДЕЙСТВИЕ = "ru.imiron.sugarlife.ПОНЯЛ"
    const val ЭКСТРА_ID = "alarmId"

    private const val НАСТРОЙКИ = "sugarlife-alarms"
    private const val КЛЮЧ = "ack-queue"

    /* Свой поток, а не главный: разговор с движком идёт через его очередь и может ждать (core#82), а
       приёмник broadcast'а выполняется на главном потоке — там ждать нельзя вовсе. */
    private val поток = Executors.newSingleThreadExecutor()

    /** Кнопка для уведомления. Появляется только у тревог, которым нужен ответ (`needsAck`). */
    fun действие(ctx: Context, alarmId: String): NotificationCompat.Action {
        val намерение = Intent(ctx, ПонялПриёмник::class.java).apply {
            action = ДЕЙСТВИЕ
            putExtra(ЭКСТРА_ID, alarmId)
        }
        val ожидание = PendingIntent.getBroadcast(
            ctx,
            /* Свой код на каждую тревогу: с общим кодом система переиспользовала бы одно намерение, и
               «понял» уходил бы по первой тревоге, какую показали в этот запуск. */
            alarmId.hashCode(),
            намерение,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(0, "Понял", ожидание).build()
    }

    /** Нажали кнопку. Записываем сразу — до всякой попытки отдать. */
    fun нажали(ctx: Context, alarmId: String) {
        val app = ctx.applicationContext
        if (!ОчередьПонял.годныйId(alarmId)) {
            Log.w(TAG, "негодный alarmId — не берём в очередь")
            return
        }
        /*
         * СНАЧАЛА ГАСИМ КАРТОЧКУ — МГНОВЕННО И ЛОКАЛЬНО (замечание владельца: «кнопка понял тут
         * зачем, если она не работает?»).
         *
         * Раньше уведомление ждало ответа движка: тревога после «понял» уходит в снуз, но остаётся
         * висящей, событие «снять» не приходит — и карточка жила дальше. Для человека это выглядело
         * как мёртвая кнопка, а мёртвая кнопка учит не нажимать.
         *
         * Нажатие — уже ответ, и экран обязан отозваться на него сразу. Если причина не исчезнет,
         * движок пришлёт повтор после снуза — покажем заново. Это и есть семантика снуза.
         */
        runCatching {
            (app.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager)
                .cancel(ПравилаПоказа.ключУведомления(alarmId))
        }.onFailure { Log.w(TAG, "не удалось снять карточку $alarmId: $it") }

        val prefs = app.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
        val было = prefs.getString(КЛЮЧ, "")
        prefs.edit().putString(КЛЮЧ, ОчередьПонял.добавить(было, alarmId, System.currentTimeMillis())).commit()
        разгрести(app)
    }

    /**
     * Отдать всё, что накопилось. Зовётся при нажатии и при старте процесса — второе и есть тот случай,
     * ради которого очередь заводилась: ночью движка не было, утром он поднялся.
     */
    fun разгрести(ctx: Context) {
        val app = ctx.applicationContext
        поток.execute {
            val prefs = app.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
            val записи = ОчередьПонял.живые(prefs.getString(КЛЮЧ, ""), System.currentTimeMillis())
            if (записи.isEmpty()) {
                /* Чистим хранилище от просроченного, даже когда отдавать нечего: иначе строка растёт
                   вечно, а читаем мы её при каждом старте. */
                if (!prefs.getString(КЛЮЧ, "").isNullOrEmpty()) prefs.edit().remove(КЛЮЧ).commit()
                return@execute
            }
            for (з in записи) {
                val принято = отдать(app, з.id, з.нажатоМс)
                if (!принято) continue
                val prefs2 = app.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
                prefs2.edit().putString(КЛЮЧ, ОчередьПонял.убрать(prefs2.getString(КЛЮЧ, ""), з.id)).commit()
            }
        }
    }

    /* Отдать один ответ. «Не принято» — законный исход, а не поломка: на ядре до 1.29 такого интента нет
       вовсе. Тогда запись остаётся и уедет со следующей попыткой, а через сутки истечёт сама.

       ВРЕМЯ НАЖАТИЯ, А НЕ ДОСТАВКИ (rev ≥ 1.30). Ответ, пролежавший на диске до утра, применяется тем
       моментом, когда человек нажал: иначе снуз отсчитается от утра и съест остаток ночи. Поле в
       контракте появилось ровно под этот случай, и очередь для того и хранит время. */
    private fun отдать(ctx: Context, alarmId: String, нажатоМс: Long): Boolean {
        val json = """{"type":"acknowledgeAlarm","alarmId":"${экранировать(alarmId)}","atMs":$нажатоМс}"""
        return runCatching {
            val ответ = EngineHolder.engine(ctx).sendIntent(json)
            val принято = ответ.contains("\"accepted\":true")
            if (!принято) Log.i(TAG, "«понял» пока не принят движком, оставляем в очереди")
            принято
        }.getOrElse {
            Log.w(TAG, "движок недоступен, «понял» остаётся в очереди: $it")
            false
        }
    }

    private fun экранировать(s: String): String =
        s.replace("\\", "\\\\").replace("\"", "\\\"")
}

/**
 * Приёмник нажатия. Отдельный класс, потому что нажатие приходит от системы, когда нашего процесса может
 * не быть: система его поднимет ради этого приёмника, и нам этого достаточно — записать ответ.
 */
class ПонялПриёмник : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra(Понял.ЭКСТРА_ID) ?: return
        /* goAsync — чтобы система не сочла процесс свободным, пока мы пишем ответ на диск. Работы тут на
           миллисекунды, но пишется она в тот самый момент, когда телефон готов нас усыпить. */
        val держим = goAsync()
        try {
            Понял.нажали(context, id)
        } finally {
            держим.finish()
        }
    }
}
