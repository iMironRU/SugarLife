package ru.imiron.sugarlife

import android.util.Log
import java.lang.reflect.Method

/**
 * МОСТ К ЧУЖОМУ АЛГОРИТМУ, КОТОРОГО МОЖЕТ НЕ БЫТЬ (core#88, SugarLife#439).
 *
 * Алгоритм калибровки Sibionics портирован в JugglucoNG и лежит под GPL-3.0. В нашем дереве его нет: он
 * скачивается скриптом и в git не попадает. Значит собираться приложение обязано и БЕЗ него — иначе наше
 * же обещание («нет файлов — нет калибровки, честно покажем сырое») превращается в неправду: сборка просто
 * не проходит.
 *
 * Раньше переходник импортировал вендорские классы напрямую, и это обещание не выполнялось. Теперь связь с
 * ними — через отражение: классов нет, [доступен] отвечает `false`, и калибровки не будет. Никаких заглушек,
 * никаких выдуманных чисел.
 *
 * Цена отражения здесь ничтожна: вызов раз в минуту, дескрипторы методов ищутся однажды.
 *
 * ЧУЖОГО КОДА ЗДЕСЬ НЕТ — расписка для сторожа (app/src/чужойКод.test.ts): файл про GPL говорит, но под
 * ней не лежит.
 */
class ВендорскийАлгоритм private constructor(
    private val ядро: Any,
    private val process: Method,
    private val snapshot: Method,
    private val restore: Method,
) {

    fun process(rawMmol: Float, temperatureC: Float, index: Int): Float? =
        runCatching { process.invoke(ядро, rawMmol, temperatureC, index) as Float? }.getOrNull()

    fun snapshot(): ByteArray? = runCatching { snapshot.invoke(ядро) as ByteArray? }.getOrNull()

    fun restore(state: ByteArray?): Boolean =
        runCatching { restore.invoke(ядро, state) as Boolean }.getOrDefault(false)

    /**
     * СЕМЕЙСТВ ДВА, И ВЫБОР НЕ КОСМЕТИЧЕСКИЙ (SugarLifeCore#206).
     *
     * У Sibionics пять вариантов, и три из них считают V116A: EU (SiJoy), Hematonix
     * (Русибионикс) и Sibionics 2. Китайский и GS3 — V115G. До сих пор мы качали и звали только
     * V115G, то есть российский Русибионикс наша сборка не посчитала бы вовсе — и узнали бы мы об
     * этом, когда прибор окажется в руках.
     *
     * Подпакет `v116a` сохранён намеренно: оба файла получены одним декомпилятором и объявляют
     * одинаковые внутренние помощники. В одном пакете они сталкиваются.
     */
    enum class Семейство(val класс: String) {
        V115G("ru.imiron.sugarlife.vendor.SibionicsExactV115GCore"),
        V116A("ru.imiron.sugarlife.vendor.v116a.SibionicsExactV116ACore"),
        ;

        companion object {
            /** Какое семейство положено варианту прибора. Незнакомый вариант → V115G, как было. */
            fun поВарианту(вариант: String?): Семейство = when (вариант?.trim()?.lowercase()) {
                "eu", "hematonix", "sibionics2" -> V116A
                else -> V115G
            }
        }
    }

    companion object {
        private const val TAG = "SugarLifeVendor"
        private const val ЯДРО = "ru.imiron.sugarlife.vendor.SibionicsExactV115GCore"
        private const val ЧУВСТВИТЕЛЬНОСТЬ = "ru.imiron.sugarlife.vendor.SibionicsSensitivityKt"

        /** Скачан ли чужой алгоритм в эту сборку. Нет — приложение работает, но калибровки не будет. */
        val доступен: Boolean by lazy {
            runCatching { Class.forName(ЯДРО) }.isSuccess.also {
                Log.i(TAG, if (it) "чужой алгоритм на месте" else "чужого алгоритма нет — калибровки не будет")
            }
        }

        /** Собрать ядро под конкретную чувствительность партии. `null` — алгоритма в сборке нет. */
        fun создать(
            чувствительность: Float,
            семейство: Семейство = Семейство.V115G,
        ): ВендорскийАлгоритм? = runCatching {
            val класс = Class.forName(семейство.класс)
            val конструктор = класс.getDeclaredConstructor(Float::class.javaPrimitiveType)
                .apply { isAccessible = true }
            ВендорскийАлгоритм(
                ядро = конструктор.newInstance(чувствительность),
                process = класс.getDeclaredMethod(
                    "process", Float::class.javaPrimitiveType, Float::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType,
                ).apply { isAccessible = true },
                snapshot = класс.getDeclaredMethod("snapshot").apply { isAccessible = true },
                restore = класс.getDeclaredMethod("restore", ByteArray::class.java).apply { isAccessible = true },
            )
        }.onFailure { Log.w(TAG, "чужой алгоритм не поднялся ($семейство): $it") }.getOrNull()

        /**
         * Чувствительность партии из кода сенсора. Живёт в чужом файле, поэтому тоже через отражение;
         * не нашли — отдаём `null`, и калибратор возьмёт своё значение по умолчанию.
         */
        fun чувствительностьИзКода(код: String?): Float? = runCatching {
            val класс = Class.forName(ЧУВСТВИТЕЛЬНОСТЬ)
            класс.getDeclaredMethod("tryDecode", String::class.java)
                .apply { isAccessible = true }
                .invoke(null, код) as Float?
        }.getOrNull()
    }
}
