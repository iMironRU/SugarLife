"""Вырезать декодер чувствительности из файла протокола JugglucoNG (GPL-3.0).

Нужен только он: чувствительность партии закодирована в последних четырёх символах кода сенсора, и без неё
алгоритм считает по умолчанию. Переписывать эту арифметику своими руками нельзя — это не спецификация, а
вендорское кодирование; ошибка в нём тихо сдвинет ВСЕ значения.
"""
import io
import sys

src = io.open(sys.argv[1], encoding="utf-8").read()
start = src.index("object SibionicsSensitivity {")
end = src.index("\n}\n", start) + 3
body = src[start:end].replace("SibionicsConstants.normalizeBleName(", "normalizeCode(")

# Обёртка `sensitivityFor` тянет вендорский тип Variant, которого у нас нет, и ничего не добавляет:
# «не разобрали код → значение по умолчанию» вызывающая сторона выражает одной строкой. Убираем её здесь,
# а не руками после скачивания — иначе следующий запуск скрипта вернёт её обратно.
i = body.find("    fun sensitivityFor(")
j = body.find("    fun tryDecode(")
if i != -1 and j > i:
    body = body[:i] + (
        "    // Обёртка sensitivityFor из первоисточника опущена: она тянет вендорский тип Variant.\n"
        "    // Поведение «не разобрали код → значение по умолчанию» задаёт вызывающая сторона.\n"
    ) + body[j:]

head = (
    "package ru.imiron.sugarlife.vendor\n\n"
    "// Взято из JugglucoNG (GPL-3.0), см. ПРОИСХОЖДЕНИЕ.md.\n"
    "// Изменено: объявление пакета и одна внешняя зависимость (нормализация кода).\n"
    "import java.util.Locale\n\n"
    "/** Нормализация кода сенсора, как в первоисточнике: обрезка, верхний регистр, только буквы и цифры. */\n"
    "private fun normalizeCode(raw: String?): String =\n"
    "    raw.orEmpty().trim().uppercase(Locale.US).filter { it.isLetterOrDigit() }\n\n"
)
# Ядро ссылается на маленький тип из соседнего файла — берём и его, иначе не соберётся.
signal = (
    "\n/** Взято оттуда же: маленький тип, на который ссылается ядро. */\n"
    "internal data class SibionicsChemicalSignal(\n"
    "    val mmol: Float,\n"
    "    val qualityFlags: Int,\n"
    ")\n"
)
io.open(sys.argv[2], "w", encoding="utf-8").write(head + body + signal)
print("  + SibionicsSensitivity.kt (%d строк)" % (head + body + signal).count("\n"))
