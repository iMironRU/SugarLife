#!/usr/bin/env bash
# Синхронная сборка ВСЕХ вариантов из одного ядра: {Lite, Pro} × {Android, iOS}.
#
# Зачем одной командой. Ядро общее, а нативных оболочек две, и издания разводятся В ТРЁХ местах:
# веб-конфиг (`SUGARLIFE_EDITION` для `cap sync`), Android-флейвор (`-Pedition`), iOS — по bundle id.
# Собирая что-то одно, поломку в остальном узнаёшь через день, на железе, и не там, где искал.
#
# Использование:
#   bash build-all.sh              # всё: lite и pro, обе платформы
#   bash build-all.sh pro          # только Pro (обе платформы)
#   bash build-all.sh lite android # только Lite под Android
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"                # .../app
# ИМЯ КАТАЛОГА — ИМЯ РЕПОЗИТОРИЯ (SugarLife#716). Здесь стояло `Sibionic` — имя одной из копий
# ядра на машине владельца. Из-за него iOS и Android собирались из разных клонов, и те разъезжались
# на коммит-другой: «проверено на телефоне» могло означать проверку не той сборки.
CORE_DIR="${SUGARLIFE_CORE_DIR:-$HOME/Documents/github_dev/SugarLifeCore}"   # composite includeBuild
# Android требует JDK 21 (Capacitor/AGP). Это brew-версия: /usr/libexec/java_home её НЕ видит.
JDK21="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
JDK17="/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"   # ядро/iOS проверены на 17
export ANDROID_HOME="$HOME/Library/Android/sdk"
TEAM="U47P7HZ98U"
# Своя папка сборки Xcode ВНЕ ~/Documents: в Documents живёт iCloud, и его xattr'ы ломают codesign.
DD="/private/tmp/sugarlife-dd"

EDITIONS="${1:-all}"
PLATFORMS="${2:-all}"
[ "$EDITIONS" = "all" ] && EDITIONS="lite pro"
[ "$PLATFORMS" = "all" ] && PLATFORMS="android ios"

cd "$APP_DIR"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
RESULT=""
note() { RESULT="$RESULT$1\n"; }

# iCloud возрождает дубли вида `config 2.xml` / `build 2.gradle` при каждой синхронизации, а merge ресурсов
# Android на них падает («' ' is not a valid file-based resource name character»). Чистим ПОСЛЕ cap sync:
# именно он их и воскрешает.
drop_icloud_dupes() {
  find "$APP_DIR" -name "* [0-9].*" \
    -not -path "*/node_modules/*" -not -path "*/build/*" -not -path "*/build.nosync/*" \
    -delete 2>/dev/null || true
}

for ED in $EDITIONS; do
  step "веб + cap sync — издание $ED"
  if CAP=1 SUGARLIFE_EDITION="$ED" npm run build >/dev/null 2>&1 \
     && SUGARLIFE_EDITION="$ED" npx cap sync >/dev/null 2>&1; then
    note "веб+sync $ED: ✅"
    # Граница изданий проверяется на собранном, а не на намерениях (#296): в Lite не должно быть
    # ни экранов, ни строк управления подачей. Проверяем только Lite — в Pro они и должны быть.
    if [ "$ED" = "lite" ]; then
      if node scripts/edition-check.mjs >/dev/null 2>&1; then
        note "граница изданий lite: ✅"
      else
        node scripts/edition-check.mjs || true
        note "граница изданий lite: ❌ (в Lite попали команды прибору)"
      fi
    fi
  else
    note "веб+sync $ED: ❌ (дальше по этому изданию не идём)"
    continue
  fi
  drop_icloud_dupes

  for PL in $PLATFORMS; do
    case "$PL" in
      android)
        step "Android $ED (JDK 21)"
        # Флейвор и издание ЯДРА задаются отдельно — сборка сама проверит, что они не разъехались.
        FLAVOR="$(printf '%s' "$ED" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')"
        if ( cd android && JAVA_HOME="$JDK21" ./gradlew ":app:assemble${FLAVOR}Debug" -Pedition="$ED" -q ); then
          APK="$(ls -t android/app/build.nosync/outputs/apk/"$ED"/debug/*.apk 2>/dev/null | head -1)"
          note "Android $ED: ✅  ${APK:-апк не найден}"
        else
          note "Android $ED: ❌"
        fi
        ;;
      ios)
        step "iOS $ED (JDK 17, XCFramework + Swift)"
        # Издание на iOS выводится ИЗ BUNDLE ID (build-engine.sh) — поэтому его и переопределяем.
        BID="ru.imiron.sugarlife"; [ "$ED" = "pro" ] && BID="ru.imiron.sugarlife.pro"
        # Имя издания — вместе с идентификатором (#392): в проекте оно прописано как SugarLife.Lite в обеих
        # конфигурациях, и без этой строки Pro приезжает на телефон под чужим именем.
        DNAME="SugarLife.Lite"; [ "$ED" = "pro" ] && DNAME="SugarLife.Pro"
        if ( cd ios/App && JAVA_HOME="$JDK17" xcodebuild -project App.xcodeproj -scheme App \
              -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath "$DD" \
              -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" APP_BUNDLE_ID="$BID" \
              ${SL_ENTITLEMENTS:+SL_ENTITLEMENTS="$SL_ENTITLEMENTS"} \
              APP_DISPLAY_NAME="$DNAME" \
              build -quiet ); then
          note "iOS $ED: ✅  ($BID)"
        else
          note "iOS $ED: ❌  ($BID)"
        fi
        ;;
    esac
  done
done

printf '\n\033[1m== ИТОГ ==\033[0m\n'
printf "$RESULT"
printf "$RESULT" | grep -q '❌' && exit 1 || exit 0
