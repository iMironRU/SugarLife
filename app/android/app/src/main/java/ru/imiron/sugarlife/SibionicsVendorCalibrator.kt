package ru.imiron.sugarlife

import android.util.Log
import kotlin.math.abs
import ru.imiron.sugarlife.contract.SensorCalibrator
import ru.imiron.sugarlife.vendor.SibionicsExactV115GCore
import ru.imiron.sugarlife.vendor.SibionicsSensitivity

/**
 * Калибровка Sibionics вендорским алгоритмом (core#88).
 *
 * Сенсор отдаёт только сырьё; калибровка целиком на телефоне. До сих пор мы клали сырое значение в поле
 * «калиброванное» — на живом приборе это давало 13.9 там, где у Juggluco было 9.8. По такому числу человек
 * считает дозу, поэтому поле мы очистили и ждали настоящего расчёта. Вот он.
 *
 * САМ АЛГОРИТМ — ЧУЖОЙ. Он портирован в JugglucoNG и лежит под GPL-3.0; в нашем дереве его нет, он
 * скачивается скриптом `app/scripts/fetch-vendor-calibration.sh` и в git не попадает. Обязательства GPL
 * наступают при передаче программы другому человеку — пока сборка личная, их нет. Этот файл — наш
 * переходник, и он остаётся нашим.
 *
 * Нет скачанных файлов — нет и калибровки: приложение честно покажет сырое значение и скажет, что оно
 * сырое. Заглушек здесь не будет.
 */
class SibionicsVendorCalibrator : SensorCalibrator {

    private var core: SibionicsExactV115GCore? = null
    private var чувствительность: Float = 0f
    /** Последняя разница между точным ответом и сырым — ею закрываются промежуточные минуты. */
    private var поправка: Float? = null

    override fun configure(sensorCode: String?) {
        /* ЧУВСТВИТЕЛЬНОСТЬ ПАРТИИ — ИЗ КОДА СЕНСОРА. Она закодирована в последних четырёх символах
           («671K» у XDUD671K) и входит в расчёт напрямую. Не узнав её, алгоритм считает по умолчанию
           (1.27) и расходится с прибором на всём диапазоне. */
        чувствительность = SibionicsSensitivity.tryDecode(sensorCode) ?: ПО_УМОЛЧАНИЮ
        core = SibionicsExactV115GCore(чувствительность)
        поправка = null
        Log.i(TAG, "калибратор настроен: код=${sensorCode ?: "—"} чувствительность=$чувствительность")
    }

    /**
     * ЗНАЧЕНИЕ КАЖДУЮ МИНУТУ, А ТОЧНЫЙ РАСЧЁТ — РАЗ В ПЯТЬ (core#88).
     *
     * Вендорский алгоритм отдаёт ответ каждую пятую минуту. Отдавать в остальные минуты пустоту — значит
     * оставить на графике четыре дырки из пяти, а петле не дать опоры. Первоисточник (JugglucoNG,
     * `liveValue`) поступает иначе: запоминает поправку `ответ − сырое` и в промежутках отдаёт
     * `сырое + поправка`.
     *
     * Границы оттуда же, и они не украшение: ответ принимается в пределах 1…50 ммоль, поправка — если по
     * модулю меньше 40. Вышли за них — забываем поправку и отдаём сырое, потому что дальше начинается
     * выдумывание.
     */
    override fun calibrate(rawMmol: Float, temperatureC: Float?, index: Int): Float? {
        val c = core ?: return null
        // БЕЗ ТЕМПЕРАТУРЫ НЕ СЧИТАЕМ. Она входит в компенсацию напрямую, и подставить сюда «примерно 30»
        // значит выдумать результат. Нет температуры — нет ответа, сырое значение остаётся рядом.
        val t = temperatureC ?: return null
        val ответ = c.process(rawMmol, t, index)
        if (ответ != null && ответ.isFinite() && ответ > МИН_ММОЛЬ && ответ <= МАКС_ММОЛЬ) {
            поправка = ответ - rawMmol
            return ответ
        }
        val п = поправка
        if (п == null || !п.isFinite() || abs(п) >= МАКС_ПОПРАВКА) return rawMmol
        return (rawMmol + п).coerceAtLeast(0f)
    }

    override fun reset() { core = SibionicsExactV115GCore(чувствительность); поправка = null }

    /* СОСТОЯНИЕ ПЕРЕЖИВАЕТ ПЕРЕЗАПУСК (core#88). У самого алгоритма для этого есть snapshot/restore — им и
       пользуемся, а не выдумываем своё: внутри фильтр и температурные средние, и правильно сохранить их
       умеет только он сам. */
    override fun snapshot(): ByteArray? = core?.snapshot()

    override fun restore(state: ByteArray?): Boolean {
        val c = core ?: SibionicsExactV115GCore(чувствительность).also { core = it }
        return c.restore(state)
    }

    private companion object {
        const val TAG = "SugarLifeCalib"
        /** Значение вендора, когда код не разобран. Оно же стоит и в первоисточнике. */
        const val ПО_УМОЛЧАНИЮ = 1.27f
        /** Границы первоисточника: ответ вне их не принимается, поправка вне их — забывается. */
        const val МИН_ММОЛЬ = 1f
        const val МАКС_ММОЛЬ = 50f
        const val МАКС_ПОПРАВКА = 40f
    }
}
