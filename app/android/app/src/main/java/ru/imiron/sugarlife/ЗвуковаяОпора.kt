package ru.imiron.sugarlife

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log

/**
 * ЗВУКОВАЯ ОПОРА: держимся за счёт воспроизведения (эпик SugarLifeCore#123).
 *
 * Идея владельца: «а как же идея с тем, чтобы быть плеером? Андроид выключает? Айос нет — вот я на
 * айосе без сенсоров прожил ночь с тревогами».
 *
 * НА СТОКОВОМ ANDROID ЭТО НЕ НУЖНО, и включать по умолчанию нельзя. Служба переднего плана с типом
 * «подключённое устройство» переживает дремоту системы сама: прибор читается, тревога о низком сахаре
 * считается в момент прихода показания.
 *
 * НУЖНО ЭТО ПРОТИВ ВЕНДОРСКОЙ ЗАЩИТЫ. Прошивки Xiaomi, Huawei, Oppo и родственных выгружают
 * приложения по своему усмотрению — вместе со службой и BLE, никого не спрашивая и никому не
 * сообщая. Но воспроизведение они обычно щадят: музыка не должна обрываться на полуслове, и это
 * единственное, что у них считается уважительной причиной жить.
 *
 * ПОЧЕМУ ТИШИНА, А НЕ ЗВУК. Мы играем поток нулей: системе он неотличим от музыки, человеку — от
 * молчания. Расход на это — доли процента батареи в час: заполнять буфер нулями дешевле, чем
 * декодировать что-либо.
 *
 * ЦЕНА, И О НЕЙ НАДО ГОВОРИТЬ ЧЕЛОВЕКУ. Пока мы «играем», телефон считает нас источником звука:
 * магнитола в машине может переключиться на нас, кнопки гарнитуры будут обращаться к нам. Ровно ту же
 * цену мы уже платим на айфоне, и там она записана.
 *
 * ЗАЧЕМ ВООБЩЕ ИМЕТЬ ЭТО ВЫКЛЮЧАЕМЫМ. Потому что помогает не всем и стоит не ноль. Включать имеет
 * смысл там, где журнал жизни показал смерти, — и проверять по нему же, стало ли лучше.
 */
object ЗвуковаяОпора {
    private const val TAG = "SugarLifeЗвук"

    /* 8 кГц моно 16 бит — минимум, который принимает AudioTrack. Качество здесь не при чём: значение
       имеет сам факт воспроизведения, а не то, что воспроизводится. */
    private const val ЧАСТОТА = 8_000

    private var дорожка: AudioTrack? = null
    private var поток: Thread? = null
    @Volatile private var играем = false

    val работает: Boolean get() = играем

    /**
     * Начать держаться звуком.
     *
     * Идемпотентно: повторный вызов ничего не делает. Ошибку не считаем аварией — если система не дала
     * играть, мы остаёмся на службе переднего плана, как и раньше.
     */
    @Synchronized
    fun начать(ctx: Context) {
        if (играем) return
        val размер = AudioTrack.getMinBufferSize(
            ЧАСТОТА,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (размер <= 0) { Log.w(TAG, "система не дала буфер — остаёмся на службе"); return }
        val т = runCatching {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        /* Именно МЕДИА: прошивки щадят проигрыватели, а не «служебные» звуки. Со
                           звуками тревоги это никак не связано — те идут своим путём и своим потоком. */
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(ЧАСТОТА)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(размер * 2)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
        }.getOrElse { Log.w(TAG, "не удалось создать дорожку: $it"); return }

        дорожка = т
        играем = true
        runCatching { т.play() }.onFailure { Log.w(TAG, "не удалось запустить: $it"); играем = false; return }

        поток = Thread {
            val тишина = ShortArray(размер / 2)
            while (играем) {
                val записано = runCatching { т.write(тишина, 0, тишина.size) }.getOrDefault(-1)
                if (записано < 0) { Log.w(TAG, "запись прервана ($записано) — прекращаем"); break }
            }
        }.apply { isDaemon = true; name = "sugarlife-audio-keepalive"; start() }

        Log.i(TAG, "звуковая опора включена: держимся воспроизведением")
    }

    /**
     * Отпустить звук.
     *
     * Обязательно при выключении: пока мы держим поток, магнитола считает нас источником, и человек
     * не поймёт, почему музыка не играет с телефона.
     */
    @Synchronized
    fun прекратить() {
        if (!играем) return
        играем = false
        runCatching { дорожка?.stop() }
        runCatching { дорожка?.release() }
        дорожка = null
        поток = null
        Log.i(TAG, "звуковая опора выключена")
    }

    /** Слышит ли система нас как источник звука — для честной строки в «Охране». */
    fun системаСчитаетНасПлеером(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
        return играем && am.isMusicActive
    }
}
