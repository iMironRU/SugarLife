package ru.imiron.sugarlife

import android.content.Context
import android.media.AudioManager
import android.util.Log

/**
 * ГРОМКОСТЬ БУДИЛЬНИКА НА ВРЕМЯ ТРЕВОГИ (мост 1.35, SugarLife#482).
 *
 * Владелец назвал дыру прямо: «не беспокоить», беззвучный режим и выкрученная в ноль громкость — ТРИ
 * РАЗНЫХ состояния. Канал с обходом тихого режима спасает от первых двух; от нуля громкости не спасает
 * ничто, кроме подъёма самой громкости.
 *
 * НАСКОЛЬКО поднимать — решает движок (`raiseVolumeTo`), а не мы: семьдесят процентов ночью и сто в
 * кармане — разные решения, и принимает их тот, кто знает обстановку. В машине поле приходит пустым:
 * уровень в колонках выставил человек под дорогу и пассажиров, и резкий подъём там опаснее, чем
 * недосказать.
 *
 * ТОЛЬКО ВВЕРХ И ОБЯЗАТЕЛЬНО ОБРАТНО. Если человек слушает громче — не трогаем: убавить чужую громкость
 * ради тревоги значит сделать её тише. А оставить себе чужую громкость после отбоя мы не вправе — утром
 * это будильник и музыка на полной.
 *
 * Поток именно AudioManager.STREAM_ALARM: тревога живёт в канале с `AudioAttributes.USAGE_ALARM`, и
 * поднимать медиа-поток здесь было бы мимо — прибавилась бы музыка, а не сигнал.
 */
object ГромкостьТревоги {

    private const val TAG = "SugarLifeГромкость"
    private var было: Int? = null

    fun поднять(ctx: Context, доПроцента: Int) {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        runCatching {
            val предел = am.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            val сейчас = am.getStreamVolume(AudioManager.STREAM_ALARM)
            val надо = (предел * доПроцента.coerceIn(0, 100) / 100).coerceIn(0, предел)
            if (надо <= сейчас) return
            if (было == null) было = сейчас
            am.setStreamVolume(AudioManager.STREAM_ALARM, надо, 0)
            Log.i(TAG, "громкость будильника $сейчас → $надо (из $предел)")
        }.onFailure { Log.w(TAG, "не удалось поднять громкость: $it") }
    }

    fun вернуть(ctx: Context) {
        val прежняя = было ?: return
        было = null
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        runCatching { am.setStreamVolume(AudioManager.STREAM_ALARM, прежняя, 0) }
            .onFailure { Log.w(TAG, "не удалось вернуть громкость: $it") }
    }
}
