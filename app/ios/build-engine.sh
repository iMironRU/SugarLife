#!/bin/sh
# Собирает и встраивает KMP-движок (SugarLifeKit) из репозитория sugarlife-core.
# Вызывается Xcode build-phase’ой. Путь к движку: env SUGARLIFE_CORE_DIR → app/ios/engine-path.local → сосед.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE_DIR="${SUGARLIFE_CORE_DIR:-}"
[ -z "$CORE_DIR" ] && [ -f "$HERE/engine-path.local" ] && CORE_DIR="$(cat "$HERE/engine-path.local")"
[ -z "$CORE_DIR" ] && CORE_DIR="$(cd "$HERE/../../.." 2>/dev/null && pwd)/sugarlife-core"
if [ ! -d "$CORE_DIR" ]; then
  echo "error: sugarlife-core не найден ('$CORE_DIR'). Укажи путь в app/ios/engine-path.local или env SUGARLIFE_CORE_DIR." >&2
  exit 1
fi
echo "sugarlife-core: $CORE_DIR (commit $(git -C "$CORE_DIR" rev-parse --short HEAD 2>/dev/null || echo '?'))"
cd "$CORE_DIR"
# Профилактика APFS-дублей 'SugarLifeKit N.framework': Finder/APFS плодит их при копировании поверх занятого
# файла, из-за чего Xcode встраивал УСТАРЕВШИЙ фреймворк → iOS крутил старый движок, пока Android свежий
# (composite). Чистим прежний выход копии перед сборкой и сносим дубли после — фреймворк всегда свежий из ядра.
rm -rf engine/build/xcode-frameworks 2>/dev/null || true
# ИЗДАНИЕ ЯДРА (core#61) выводим из идентификатора приложения, а не из отдельной переменной: так
# «Pro-приложение с Lite-ядром» невозможно по построению — забыть выставить второй флаг просто негде.
EDITION=lite
case "${PRODUCT_BUNDLE_IDENTIFIER:-}" in *.pro) EDITION=pro;; esac
echo "издание ядра: $EDITION (bundle ${PRODUCT_BUNDLE_IDENTIFIER:-неизвестен})"
./gradlew :engine:embedAndSignAppleFrameworkForXcode --no-daemon -Pedition="$EDITION"
find engine/build/xcode-frameworks -name '* [0-9].framework' -exec rm -rf {} + 2>/dev/null || true
