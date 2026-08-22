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

cat > "$DEST/ПРОИСХОЖДЕНИЕ.md" <<EOF
# Чужой код — откуда и на каких условиях

Файлы \`SibionicsExactV115GCore.kt\` и \`SibionicsExactV115GClip.kt\` взяты из **JugglucoNG**,
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
