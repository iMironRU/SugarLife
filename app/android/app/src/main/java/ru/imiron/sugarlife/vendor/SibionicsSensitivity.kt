package ru.imiron.sugarlife.vendor

// Взято из JugglucoNG (GPL-3.0), см. ПРОИСХОЖДЕНИЕ.md.
// Изменено: объявление пакета и одна внешняя зависимость (нормализация кода).
import java.util.Locale

/** Нормализация кода сенсора, как в первоисточнике: обрезка, верхний регистр, только буквы и цифры. */
private fun normalizeCode(raw: String?): String =
    raw.orEmpty().trim().uppercase(Locale.US).filter { it.isLetterOrDigit() }

object SibionicsSensitivity {
    const val MIN_SENSITIVITY = 0.8f
    const val MAX_SENSITIVITY = 2.5f

    fun isSupported(value: Float): Boolean =
        value.isFinite() && value in MIN_SENSITIVITY..MAX_SENSITIVITY

    fun deriveShortCode(source: String?, fallback: String): String {
        val normalized = normalizeCode(source)
        if (normalized.length >= 8) {
            val prefix = normalized.take(8)
            if (tryDecode(prefix) != null) return prefix
        }

        val shortName = when {
            normalized.length <= 11 && normalized.startsWith("LT") && normalized.length >= 8 ->
                (normalized.takeLast(4) + normalized).take(11)
            normalized.length in 1..10 -> normalized.padStart(11, '0')
            normalized.length >= 11 -> normalized.take(11)
            else -> fallback
        }
        val candidate = shortName.take(8)
        return if (candidate.length == 8) candidate else fallback
    }

    // Обёртка sensitivityFor из первоисточника опущена: она тянет вендорский тип Variant.
    // Поведение «не разобрали код → значение по умолчанию» задаёт вызывающая сторона.
    fun tryDecode(shortCode: String?): Float? {
        val token = normalizeCode(shortCode).takeLast(4)
        if (token.length != 4) return null
        if (token.all(Char::isDigit)) {
            val value = token.toFloatOrNull()?.div(1000f) ?: return null
            return value.takeIf(::isSupported)
        }
        decodedDigits(token, 'A')?.let {
            val value = it / 100f
            if (isSupported(value)) return value
        }
        decodedDigits(token, 'P')?.let {
            val value = it / 100f
            if (isSupported(value)) return value
        }
        return null
    }

    private const val DEFAULT_SENSITIVITY = 1.27f

    private fun decodedDigits(token: String, base: Char): Int? {
        val mapped = token.uppercase(Locale.US).map {
            when (it) {
                'K' -> 'I'
                'I' -> '!'
                else -> it
            }
        }
        if (mapped.size != 4) return null
        val chars = mapped.map { it.code }
        val baseValue = base.code
        val t0 = chars[0]
        val t1 = chars[1]
        val t2 = chars[2]
        val t3 = chars[3]

        val out3 = (baseValue - t3) + 57
        var w9 = (t3 - baseValue) + 48

        val w10: Int
        val out2: Int
        if (t2 >= baseValue) {
            val w11 = t2 - baseValue
            val localW10 = w11 + 48
            val w12 = 9 - w11
            w9 = w12 + w9
            w10 = localW10
            out2 = w9
        } else {
            val w11 = if (t2 <= (w9 and 0xFF)) 48 else 57
            val w12 = w11 - t2
            val localW10 = t2
            w9 = w12 + w9
            w10 = localW10
            out2 = w9
        }

        val out1: Int
        val w11b: Int
        var w10b = w10
        if (t1 >= baseValue) {
            val w12 = t1 - baseValue
            w11b = w12 + 48
            val w12b = 9 - w12
            w10b = w12b + w10b
            out1 = w10b
        } else {
            val w12 = (if (t1 <= (w10b and 0xFF)) 48 else 57) - t1
            w11b = t1
            w10b = w12 + w10b
            out1 = w10b
        }

        val out0 = if (t0 >= baseValue) {
            (baseValue - t0) + 9 + w11b
        } else {
            val w12 = (if (t0 <= (w11b and 0xFF)) 48 else 57) - t0
            w12 + w11b
        }

        val checksum = (out0 + out1 + out2 - 0x90).floorMod(10)
        if (out3 - 48 != checksum) return null
        val charsOut = charArrayOf(out0.toChar(), out1.toChar(), out2.toChar())
        return String(charsOut).toIntOrNull()
    }

    private fun Int.floorMod(other: Int): Int {
        val r = this % other
        return if (r < 0) r + other else r
    }
}

/** Взято оттуда же: маленький тип, на который ссылается ядро. */
internal data class SibionicsChemicalSignal(
    val mmol: Float,
    val qualityFlags: Int,
)
