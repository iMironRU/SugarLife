package ru.imiron.sugarlife

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * СЕМЕЙСТВО АЛГОРИТМА НЕ ТЕРЯЕТСЯ НА СБРОСЕ (SugarLifeCore#225).
 *
 * `reset()` пересоздавал ядро без семейства — то есть с умолчанием V115G, — и молча менял алгоритм с
 * того, что выбрал `configure`. Драйвер зовёт `reset()` перед КАЖДЫМ прогревом историей, значит
 * считали мы всё время не тем.
 *
 * В логе при этом стояло «семейство=V116A»: строка пишется в `configure` и в свой миг верна.
 *
 * Цена на приборе владельца: 7,9 там, где тот же алгоритм на стенде отвечал 10,6. Поймали только
 * потому, что рядом стоит чужая программа с тем же сенсором.
 *
 * ПОЧЕМУ ТЕСТ СМОТРИТ НА ЧИСЛА, А НЕ НА ПОЛЕ. Поле приватно, и проверять его — значит проверять
 * запись, а не поведение. Два семейства на одном входе дают РАЗНЫЕ ответы; на этом и ловим.
 */
class СемействоНеТеряетсяTest {

    /** Ровный подъём: любой ряд, лишь бы алгоритм успел ответить. Числа человеческие. */
    private fun прогнать(к: SibionicsVendorCalibrator, точек: Int = 400): List<Float> {
        val ответы = mutableListOf<Float>()
        for (i in 1..точек) {
            val сырьё = 8.0f + (i % 60) * 0.05f
            к.calibrate(сырьё, 30.0f, i)?.let { ответы += it }
        }
        return ответы
    }

    @Test
    fun сброс_не_меняет_семейство() {
        assumeTrue("чужой алгоритм не скачан — проверять нечего", ВендорскийАлгоритм.доступен)

        val к = SibionicsVendorCalibrator()
        к.configure("7K0J680KEW7", "hematonix")
        val доСброса = прогнать(к)
        assertNotNull("алгоритм не ответил ни разу — тест ни о чём", доСброса.lastOrNull())

        к.reset()
        val послеСброса = прогнать(к)
        assertNotNull(послеСброса.lastOrNull())

        assertEquals(
            "после сброса тот же вход даёт другой ответ — значит сменилось семейство алгоритма",
            доСброса.last(), послеСброса.last(), 0.001f,
        )
    }

    @Test
    fun два_семейства_и_правда_отвечают_по_разному() {
        /*
         * Опора всего теста выше. Если бы V115G и V116A отвечали одинаково, предыдущая проверка была
         * бы зелёной и при потерянном семействе — то есть не проверяла бы ничего.
         */
        assumeTrue("чужой алгоритм не скачан — проверять нечего", ВендорскийАлгоритм.доступен)

        val a = SibionicsVendorCalibrator().apply { configure("7K0J680KEW7", "hematonix") }   // V116A
        val b = SibionicsVendorCalibrator().apply { configure("7K0J680KEW7", "chinese") }     // V115G
        val оа = прогнать(a).lastOrNull()
        val об = прогнать(b).lastOrNull()
        assertNotNull(оа); assertNotNull(об)
        assertTrue(
            "семейства отвечают одинаково ($оа и $об) — тогда проверка на сброс ничего не ловит",
            kotlin.math.abs(оа!! - об!!) > 0.01f,
        )
    }
}
