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
        fun создать(чувствительность: Float): ВендорскийАлгоритм? = runCatching {
            val класс = Class.forName(ЯДРО)
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
        }.onFailure { Log.w(TAG, "чужой алгоритм не поднялся: $it") }.getOrNull()

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
