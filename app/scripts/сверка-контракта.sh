#!/usr/bin/env bash
# Что ядро отдаёт, а мы не читаем (SugarLife#544).
#
# Ядро ушло на 1.43, пока мы читали 1.40 — три ревизии с полями, которые закрывали задачи, названные
# в тот же день «нерешаемыми без ядра». Нашли это не мы: ядро прогнало свою сверку (SugarLifeCore#127)
# и написало, что светофор пролежал непрочитанным двое суток. Такое надо находить проверкой, а не
# случайным чтением чужого кода.
#
# Скрипт сравнивает поля снимка и интенты ядра с упоминаниями в нашем коде. Он ищет СЛОВО, а не
# осмысленное использование: field может упоминаться и лежать без дела. Обратное надёжно — если слова
# нет вовсе, field не читается точно, и для нашей задачи этого достаточно.
#
# ИМЕНА ПЕРЕМЕННЫХ ЛАТИНИЦЕЙ — вынужденно: bash в macOS версии 3.2 и не-ASCII имён не понимает,
# читает их как команду и падает. Остальные слова здесь по-прежнему русские.
#
# Запуск:  SUGARLIFE_CORE_DIR=~/path/to/core bash scripts/сверка-контракта.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${SUGARLIFE_CORE_DIR:-}"

if [ -z "$CORE" ] || [ ! -d "$CORE" ]; then
  echo "Не задан SUGARLIFE_CORE_DIR — не с чем сверять." >&2
  exit 1
fi

BRIDGE="$CORE/bridge/src/commonMain/kotlin/ru/imiron/sugarlife/bridge"
[ -d "$BRIDGE" ] || { echo "В $CORE не найден мост ($BRIDGE)" >&2; exit 1; }

# Ревизия объявлена рядом со снимком, но искать её по одному файлу — способ однажды промолчать:
# у ядра она уже переезжала. Ищем по всему мосту.
CORE_REV=$(grep -rh 'BRIDGE_REVISION *=' "$BRIDGE" | grep -oE '[0-9]+\.[0-9]+' | head -1)
OUR_REV=$(grep -oE 'rev ≥ [0-9]+\.[0-9]+' "$HERE/src/sources/bridge.ts" | grep -oE '[0-9]+\.[0-9]+' | sort -V | tail -1)

echo "мост ядра:     $CORE_REV"
echo "наше зеркало:  $OUR_REV (самая поздняя ревизия, упомянутая в bridge.ts)"
[ "$CORE_REV" = "$OUR_REV" ] || echo "  ↑ расходятся — ниже видно, чего именно не хватает"
echo

# Поля снимка: `val имя:` в UiSnapshot.kt. Служебные и приватные не берём.
FIELDS=$(grep -hoE '^\s+val [a-zA-Z][a-zA-Z0-9]*' "$BRIDGE"/UiSnapshot.kt | awk '{print $2}' | sort -u)
MISSING=0
echo "Поля снимка, которых нет в нашем коде:"
for field in $FIELDS; do
  # Однобуквенные и слишком общие слова дают ложные совпадения — их сверять бессмысленно.
  [ ${#field} -ge 4 ] || continue
  if ! grep -rqF "$field" "$HERE/src" 2>/dev/null; then
    echo "  · $field"
    MISSING=$((MISSING + 1))
  fi
done
[ "$MISSING" -eq 0 ] && echo "  (все упоминаются)"
echo

# Интенты: значения type в Intent.kt (`@SerialName("…")` либо строковый литерал).
INTENTS=$(grep -hoE '"[a-zA-Z][a-zA-Z0-9]+"' "$BRIDGE"/Intent.kt 2>/dev/null | tr -d '"' | sort -u || true)
echo "Интенты ядра, которых мы не шлём:"
NOSEND=0
for it in $INTENTS; do
  [ ${#it} -ge 5 ] || continue
  if ! grep -rqF "$it" "$HERE/src" 2>/dev/null; then
    echo "  · $it"
    NOSEND=$((NOSEND + 1))
  fi
done
[ "$NOSEND" -eq 0 ] && echo "  (все упоминаются)"
