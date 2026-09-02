#!/usr/bin/env bash
# Забрать чужой алгоритм калибровки Sibionics в ЛОКАЛЬНУЮ сборку (core#88).
#
# ПОЧЕМУ ОТДЕЛЬНЫМ СКРИПТОМ, А НЕ В РЕПОЗИТОРИИ
#
# Алгоритм портирован в JugglucoNG и лежит под GPL-3.0. Пока сборка личная — обязательств нет: GPL
# включается при ПЕРЕДАЧЕ программы другому человеку. Но как только сборка уедет тестировщику, всё
# приложение обязано стать GPL-3.0 с открытыми исходниками.
#
# Поэтому чужой код живёт вне нашего дерева: скачивается сюда, в git не попадает (см. .gitignore), а решение
# о лицензии остаётся открытым и осознанным. Нет файлов — нет калибровки: приложение честно покажет сырое
# значение и скажет, что оно сырое. Заглушек не будет.
#
# Использование:  bash app/scripts/fetch-vendor-calibration.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$APP_DIR/android/app/src/main/java/ru/imiron/sugarlife/vendor"
SRC_REPO="https://github.com/ctqvva/JugglucoNG.git"
SRC_PATH="Common/src/main/java/tk/glucodata/drivers/sibionics"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▶ качаю JugglucoNG (GPL-3.0) …"
git clone --depth 1 -q "$SRC_REPO" "$TMP/jugng"
COMMIT="$(git -C "$TMP/jugng" rev-parse --short HEAD)"

mkdir -p "$DEST"
for f in SibionicsExactV115GCore.kt SibionicsExactV115GClip.kt; do
    [ -f "$TMP/jugng/$SRC_PATH/$f" ] || { echo "нет файла $f — структура репозитория изменилась"; exit 1; }
    # Пакет переписываем на наш: файлы должны собираться в нашем модуле, а не притворяться чужими.
    sed "s|^package tk.glucodata.drivers.sibionics|package ru.imiron.sugarlife.vendor|" \
        "$TMP/jugng/$SRC_PATH/$f" > "$DEST/$f"
    echo "  ✔ $f ($(wc -l < "$DEST/$f" | tr -d ' ') строк)"
done

# Декодер чувствительности живёт внутри большого файла протокола — вырезаем только его.
python3 "$APP_DIR/scripts/extract-sensitivity.py" \
    "$TMP/jugng/$SRC_PATH/SibionicsProtocol.kt" "$DEST/SibionicsSensitivity.kt"

# ВТОРОЕ СЕМЕЙСТВО АЛГОРИТМА — V116A (SugarLifeCore#206).
#
# Из пяти вариантов Sibionics ТРИ считают им, а не V115G: EU (SiJoy), Hematonix (Русибионикс) и
# Sibionics 2. До сих пор мы качали только V115G — то есть российский Русибионикс наша сборка
# посчитать не смогла бы вовсе, и узнали бы мы об этом, когда прибор окажется в руках.
#
# Файл один, самодостаточный: внутри и ядро (`SibionicsExactV116ACore`), и вся машинерия. Наружу ему
# нужны два типа из соседнего пакета — их дописываем ниже сами, потому что тащить ради двух
# объявлений весь `SibionicsAlgorithm.kt` (с их собственными моделями поверх вендорской) незачем.
V116="v116a/SibionicsExactV116A.kt"
[ -f "$TMP/jugng/$SRC_PATH/$V116" ] || { echo "нет файла $V116 — структура репозитория изменилась"; exit 1; }
# ПОДПАКЕТ СОХРАНЯЕМ, А НЕ СПЛЮЩИВАЕМ. Первая попытка положила V116A рядом с V115G в один пакет —
# и они столкнулись: оба объявляют одинаковые внутренние помощники (`Ptr`, `f32`, `uLt`), потому что
# оба получены одним декомпилятором. У NG они разведены по пакетам, и это не украшение.
mkdir -p "$DEST/v116a"
sed -e "s|^package tk.glucodata.drivers.sibionics.v116a|package ru.imiron.sugarlife.vendor.v116a|" \
    -e "s|^import tk\.glucodata\.drivers\.sibionics\.|import ru.imiron.sugarlife.vendor.|" \
    "$TMP/jugng/$SRC_PATH/$V116" > "$DEST/v116a/SibionicsExactV116A.kt"
echo "  ✔ v116a/SibionicsExactV116A.kt ($(wc -l < "$DEST/v116a/SibionicsExactV116A.kt" | tr -d ' ') строк)"

# Два типа, которых ждёт V116A. Объявления, а не поведение: поля и один вычисляемый признак.
cat > "$DEST/SibionicsНаблюдение.kt" <<'KT'
package ru.imiron.sugarlife.vendor

/** Наблюдение вендорского алгоритма — то, что он знает о сенсоре в этот момент.
 *  Объявление нужно V116A; поведения здесь нет, только поля. */
internal data class SibionicsSensorObservation(
    val calibratedMmol: Float,
    val chemicalMmol: Float,
    val sensorStateCompensationMmol: Float,
    val qualityFlags: Int,
    val factorySensitivity: Float,
    val activeSensitivity: Float,
    val sensorAgeMinutes: Int,
    val family: Int,
) {
    val isUsable: Boolean
        get() = calibratedMmol.isFinite() && calibratedMmol > 0f &&
            activeSensitivity.isFinite() && activeSensitivity > 0f
}
KT
echo "  ✔ SibionicsНаблюдение.kt (тип для V116A)"

cat > "$DEST/ПРОИСХОЖДЕНИЕ.md" <<EOF
# Чужой код — откуда и на каких условиях

Файлы \`SibionicsExactV115GCore.kt\`, \`SibionicsExactV115GClip.kt\` и \`SibionicsExactV116A.kt\` взяты из **JugglucoNG**,
$SRC_REPO, коммит \`$COMMIT\`, каталог \`$SRC_PATH\`.

**Лицензия — GNU GPL v3.** Изменено только объявление пакета, чтобы файлы собирались у нас.

Обязательства GPL наступают при ПЕРЕДАЧЕ программы другому человеку. Пока сборка личная, их нет. Если эта
сборка уедет кому-то ещё — тестировщику в том числе, — приложение целиком обязано стать GPL-3.0 с
открытыми исходниками. Решение осознанное, и принимать его должен владелец, а не скрипт.

Каталог в git не попадает: см. \`.gitignore\`. Обновить — перезапустить
\`app/scripts/fetch-vendor-calibration.sh\`.

Забрано: $(date '+%Y-%m-%d %H:%M')
EOF

echo "▶ готово: $DEST"
echo "  в git не попадёт; условия и происхождение — в ПРОИСХОЖДЕНИЕ.md"
