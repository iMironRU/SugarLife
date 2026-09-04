package ru.imiron.sugarlife

import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState

/**
 * ЧТОБЫ СИСТЕМА СЧИТАЛА НАС ПЛЕЕРОМ, МАЛО ИГРАТЬ (SugarLifeCore#216).
 *
 * Замысел владельца был точный: «быть плеером и играть тишину как раз для этого». Сделали половину —
 * [ЗвуковаяОпора] честно крутит тишину через `MediaPlayer`. Но прошивка смотрит не на то, что идёт в
 * динамик, а на то, чем мы **представились**: список проигрывателей она берёт у `MediaSessionManager`,
 * а нас там не было. Звук шёл, а плеером мы не числились.
 *
 * Померено на песочнице (Huawei P40 lite): опора играла — за десять секунд до смерти в журнале стоит
 * `опора держит звук {тиков: 60}`, — и приложение всё равно убили через восемь минут после ухода в фон.
 *
 * ПОЧЕМУ ЭТО ВАЖНЕЕ ВСЕГО ОСТАЛЬНОГО ИМЕННО ДЛЯ ОПЕКУНА. У человека с прибором есть настоящая опора —
 * живое BLE-соединение, и тип службы `connectedDevice` без предела по времени. У того, кто смотрит за
 * ребёнком или за родителем по интернету, приборов нет вовсе: остаётся `dataSync`, а у него на
 * Android 15 **потолок шесть часов в сутки на всё приложение**. То есть режим опекуна выключается
 * системой по документации, а не по вредности прошивки. `mediaPlayback` предела не имеет.
 *
 * КАРТОЧКИ В ШТОРКЕ ЭТО НЕ ДОБАВЛЯЕТ. Управление медиа рисуется по уведомлению со стилем `MediaStyle`,
 * привязанному к сеансу. Мы такого уведомления не делаем: сеанс нужен системе, а не человеку, и
 * показывать ему безмолвный проигрыватель значило бы объяснять то, что его не касается.
 *
 * ФОКУС ЗВУКА ПО-ПРЕЖНЕМУ НЕ БЕРЁМ. Забрать его — остановить чужую музыку; приложение, глушащее
 * подкаст, человек выключит и решит вопрос окончательно, не в нашу пользу. Сеанс фокуса не требует.
 */
class СеансПлеера(private val ctx: Context) {

    private var сеанс: MediaSession? = null

    /** Числимся ли мы сейчас проигрывателем — факт, а не намерение. */
    val активен: Boolean get() = runCatching { сеанс?.isActive == true }.getOrDefault(false)

    fun начать() {
        if (сеанс != null) return
        сеанс = runCatching {
            MediaSession(ctx.applicationContext, "SugarLife").apply {
                setMetadata(
                    MediaMetadata.Builder()
                        /* Название видно там, куда система выводит список играющего. Пишем прямо, что
                           это: человек, заглянувший туда, не должен гадать, откуда взялся плеер. */
                        .putString(MediaMetadata.METADATA_KEY_TITLE, "Наблюдение за глюкозой")
                        .putString(MediaMetadata.METADATA_KEY_ARTIST, "SugarLife")
                        .build(),
                )
                setPlaybackState(состояние())
                isActive = true
            }
        }.onFailure { bleLog("Warn", "сеанс плеера не завёлся: $it", null) }.getOrNull()
        if (сеанс != null) bleLog("Info", "числимся плеером", null)
    }

    /**
     * Подтвердить, что мы всё ещё играем.
     *
     * Состояние с застывшей позицией система вправе счесть брошенным — поэтому позицию двигаем по
     * настоящим часам, а не по счётчику тиков: счётчик соврал бы ровно тогда, когда нас придушили и
     * тики стали реже.
     */
    fun подтвердить() {
        val с = сеанс ?: return
        runCatching { с.setPlaybackState(состояние()) }
            .onFailure { bleLog("Warn", "состояние плеера не обновилось: $it", null) }
    }

    fun остановить() {
        val с = сеанс ?: return
        сеанс = null
        runCatching {
            с.setPlaybackState(
                PlaybackState.Builder().setState(PlaybackState.STATE_STOPPED, 0L, 0f).build(),
            )
            с.isActive = false
            с.release()
        }
        bleLog("Info", "плеером больше не числимся", null)
    }

    private fun состояние(): PlaybackState = PlaybackState.Builder()
        .setState(PlaybackState.STATE_PLAYING, android.os.SystemClock.elapsedRealtime(), 1.0f)
        /* Кнопки мы не рисуем, но объявить их обязаны: сеанс без единого действия некоторые прошивки
           считают заглушкой. Обработчика нет — нажимать негде. */
        .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_STOP)
        .build()
}
