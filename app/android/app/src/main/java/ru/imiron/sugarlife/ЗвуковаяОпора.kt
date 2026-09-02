package ru.imiron.sugarlife

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import java.io.File

/**
 * ЗВУКОВАЯ ОПОРА НА ANDROID (SugarLifeCore#209).
 *
 * В контракте (`Разрешения.ЗвуковойПоток`) это средство описано так: «на Android — запасное средство
 * против вендорских „убийц“: медиа-воспроизведение прошивки обычно щадят, музыка не должна
 * обрываться». Описано было давно, сделано — только на iOS (`BackgroundKeepAlive.swift`).
 *
 * ЗАЧЕМ ПОНАДОБИЛОСЬ. Замерено на песочнице (Huawei P40 lite, Android 10, 25 часов, служба переднего
 * плана работала всё время): телефон растянул наши минутные будильники **116 раз до 3–7 минут и 39 раз
 * до 9–10**. Пока мы спали, сокет облака не доставлял, данные приезжали пачками при переподписке, а
 * человека **четыре раза за ночь будили** тревогой о молчании — при том что данные в облаке были
 * полные. Службы переднего плана не хватило.
 *
 * ПОЧЕМУ НЕ БЕЛЫЙ СПИСОК ЭНЕРГОСБЕРЕЖЕНИЯ. Решение владельца: «на рабочем не включаем, нам нужно жить
 * в режиме экономии». Просить человека отключить экономию ради нас — переложить нашу задачу на него и
 * потратить его батарею. Живём внутри экономии.
 *
 * ГЛАВНОЕ ОТЛИЧИЕ ОТ iOS, И ОНО НЕ ТЕХНИЧЕСКОЕ. Здесь **не запрашивается аудиофокус**. Запросить его
 * значит остановить чужую музыку: человек включил подкаст, мы молча его выключили. Тишину и без фокуса
 * никто не услышит, а чужое воспроизведение продолжится как ни в чём не бывало. Приложение, глушащее
 * музыку, человек выключит — и решит вопрос окончательно, не в нашу пользу.
 *
 * ЧТО ЭТО СТОИТ. Заряд. Поэтому по умолчанию выключено и включается человеком — та же честная сделка,
 * что на iOS: живость против батареи, решает тот, чей телефон.
 */
class ЗвуковаяОпора(private val ctx: Context) {

    companion object {
        private const val НАСТРОЙКИ = "sugarlife-alarms"
        private const val КЛЮЧ = "audio-anchor"
        @Volatile private var общая: ЗвуковаяОпора? = null

        /** Одна на процесс: и служба, и мост говорят с одной и той же опорой. */
        @JvmStatic
        fun общая(ctx: Context): ЗвуковаяОпора = общая ?: synchronized(this) {
            общая ?: ЗвуковаяОпора(ctx.applicationContext).also { о ->
                общая = о
                о.режим = о.вспомнить()
            }
        }
    }

    private fun вспомнить(): Режим = runCatching {
        val имя = ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).getString(КЛЮЧ, null)
        Режим.entries.firstOrNull { it.name.equals(имя, ignoreCase = true) } ?: Режим.Выключено
    }.getOrDefault(Режим.Выключено)

    private fun запомнить(р: Режим) {
        runCatching {
            ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
                .edit().putString(КЛЮЧ, р.name.lowercase()).apply()
        }
    }

    val текущийРежим: Режим get() = режим

    /** Как часто напоминать системе о себе. Числа те же, что на iOS и у xDrip4iOS. */
    enum class Режим(val интервалМс: Long?) {
        Выключено(null),
        Обычное(5_000L),
        Настойчивое(2_000L),
    }

    private val руки = Handler(Looper.getMainLooper())
    private var проигрыватель: MediaPlayer? = null
    private var режим: Режим = Режим.Выключено
    private var вФоне = false
    /** Сколько тиков подряд звук не шёл: чтобы жаловаться один раз, а не каждые пять секунд. */
    private var молчалиПодряд = 0
    /** Сколько тиков отработали: чтобы докладывать «играю» раз в пять минут, а не каждый тик. */
    private var тиков = 0L

    /**
     * ФАКТ, А НЕ НАМЕРЕНИЕ (перенесено с iOS дословно).
     *
     * `режим` — это чего человек хотел. Держим ли мы звук на самом деле — отдельный вопрос: систему
     * никто не обязывал нас слушаться, и молчаливо умирающая опора неотличима от работающей.
     */
    val держимЗвук: Boolean get() = runCatching { проигрыватель?.isPlaying == true }.getOrDefault(false)

    fun установить(новый: Режим) {
        if (режим == новый) return
        режим = новый
        запомнить(новый)
        bleLog("Info", "опора: режим ${новый.name.lowercase()}", null)
        применить()
    }

    /** Ушли в фон или вернулись. На экране опора не нужна и заряд ей тратить незачем. */
    fun фон(да: Boolean) {
        if (вФоне == да) return
        вФоне = да
        применить()
    }

    private fun применить() {
        if (вФоне && режим != Режим.Выключено) начать() else остановить()
    }

    private fun начать() {
        val интервал = режим.интервалМс ?: return
        if (проигрыватель == null) собрать()
        завестиДозор(интервал)
    }

    private fun собрать() {
        val файл = тишинаНаДиске() ?: return
        проигрыватель = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        /* USAGE_MEDIA, а не ALARM или NOTIFICATION: прошивки щадят именно музыку, и
                           именно её человек ожидает увидеть в списке «что играет». Тревоги у нас
                           отдельные и звучат по-настоящему — путать их с опорой нельзя. */
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build(),
                )
                setDataSource(файл.absolutePath)
                isLooping = true
                setVolume(0f, 0f)
                /* Процессор не должен засыпать, пока мы играем: без этого опора держит процесс, но не
                   даёт ему работать — и толку от неё нет. */
                setWakeMode(ctx.applicationContext, PowerManager.PARTIAL_WAKE_LOCK)
                prepare()
                start()
            }
        }.onFailure { bleLog("Warn", "опора не собралась: $it", null) }.getOrNull()
        if (проигрыватель != null) {
            bleLog("Info", "ушли в фон с опорой", null, "тик" to "${(режим.интервалМс ?: 0) / 1000} с")
        }
    }

    private fun завестиДозор(интервал: Long) {
        руки.removeCallbacksAndMessages(null)
        руки.postDelayed(object : Runnable {
            override fun run() {
                if (!вФоне || режим == Режим.Выключено) return
                тиков++
                if (держимЗвук) {
                    if (молчалиПодряд > 0) {
                        bleLog("Info", "опора поднялась заново", null, "молчали тиков" to молчалиПодряд.toString())
                        молчалиПодряд = 0
                    }
                    // Раз в пять минут — живая строка: иначе утром не отличить «работала» от «не запускалась».
                    if (тиков % maxOf(1L, 300_000L / интервал) == 0L) {
                        bleLog("Debug", "опора держит звук", null, "тиков" to тиков.toString())
                    }
                } else {
                    /* ЗВУК У НАС ОТОБРАЛИ — И МЫ ПОДНИМАЕМСЯ, А НЕ ДЕРЖИМ СИЛОЙ. Перехват чужим
                       плеером на Android — обычное дело, и правильный ответ «уступить и встать
                       заново», а не бороться за выход. Первый раз жалуемся, дальше молчим. */
                    if (молчалиПодряд == 0) bleLog("Warn", "опора прервана — звук у нас отобрали", null)
                    молчалиПодряд++
                    runCatching { проигрыватель?.release() }
                    проигрыватель = null
                    собрать()
                }
                руки.postDelayed(this, интервал)
            }
        }, интервал)
    }

    private fun остановить() {
        руки.removeCallbacksAndMessages(null)
        val играли = проигрыватель != null
        runCatching { проигрыватель?.stop(); проигрыватель?.release() }
        проигрыватель = null
        молчалиПодряд = 0; тиков = 0
        if (играли) bleLog("Info", "опора снята", null)
    }

    /**
     * Миллисекунда тишины: заголовок WAV и сорок четыре нулевых сэмпла при 44,1 кГц, моно, 16 бит.
     *
     * Строим в коде, а не носим файлом — по тому же доводу, что на iOS: сотня байт, которую видно
     * целиком, не требует объяснений всякому, кто откроет проект. `MediaPlayer` умеет играть только
     * из источника, поэтому кладём во временный файл один раз.
     */
    private fun тишинаНаДиске(): File? = runCatching {
        val файл = File(ctx.cacheDir, "тишина.wav")
        if (файл.exists() && файл.length() > 0) return@runCatching файл
        val частота = 44_100
        val сэмплов = 44
        val данных = сэмплов * 2
        val out = java.io.ByteArrayOutputStream()
        fun u32(v: Int) { repeat(4) { out.write((v shr (it * 8)) and 0xFF) } }
        fun u16(v: Int) { repeat(2) { out.write((v shr (it * 8)) and 0xFF) } }
        out.write("RIFF".toByteArray()); u32(36 + данных); out.write("WAVE".toByteArray())
        out.write("fmt ".toByteArray()); u32(16); u16(1); u16(1)
        u32(частота); u32(частота * 2); u16(2); u16(16)
        out.write("data".toByteArray()); u32(данных)
        repeat(данных) { out.write(0) }
        файл.writeBytes(out.toByteArray())
        файл
    }.onFailure { bleLog("Warn", "тишину не записать: $it", null) }.getOrNull()
}
