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
echo "sugarlife-core: $CORE_DIR"
cd "$CORE_DIR"
./gradlew :engine:embedAndSignAppleFrameworkForXcode --no-daemon
