#!/usr/bin/env bash
# Собрать и поставить приложение на подключённый iPhone — одной командой (#428).
#
# Зачем скриптом. Шагов четыре, и забывается всегда один и тот же: пересобрать веб перед
# синхронизацией. Тогда на телефон уезжает вчерашний интерфейс с сегодняшней нативкой, и
# concert выглядит как «правка не приехала».
#
# ПОДПИСЬ. Бесплатный Apple ID даёт профиль на семь дней: через неделю приложение
# перестаёт запускаться, пока не пересоберёшь. Данные при этом остаются — истекает право
# запуска, а не база. Команда разработчика берётся из DEVELOPMENT_TEAM или из Xcode.
#
# Запуск:  bash scripts/ios-на-телефон.sh            (телефон подключён и разблокирован)
#          DEVELOPMENT_TEAM=XXXXXXXXXX bash scripts/ios-на-телефон.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

echo "1/3 · веб (CAP=1, относительные пути)"
CAP=1 npm run build

echo "2/3 · capacitor sync ios"
npx cap sync ios

echo "3/3 · сборка и установка"
УСТР=$(xcrun devicectl list devices 2>/dev/null | awk '/connected/ {print $NF; exit}' || true)
if [ -z "${УСТР:-}" ]; then
  echo "Телефон не найден. Подключи его кабелем, разблокируй и разреши доверие — потом повтори." >&2
  echo "Либо открой app/ios/App/App.xcworkspace и нажми Run: результат тот же." >&2
  exit 1
fi
cd ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination "id=$УСТР" -allowProvisioningUpdates \
  ${DEVELOPMENT_TEAM:+DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM"} \
  build

echo
echo "Готово. Живой баннер включается в приложении: Профиль → Тревоги → «Показывать сахар"
echo "на экране блокировки». Подпись живёт семь дней — через неделю запусти этот скрипт снова."
