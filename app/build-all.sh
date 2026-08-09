#!/usr/bin/env bash
# Синхронная сборка обеих платформ из ОДНОГО ядра (SugarLifeCore через composite/XCFramework).
# Ловит платформенные поломки сразу: правка ядра → собираем и Android, и iOS.
# Пути под dev-машину (JDK/SDK/team). Android требует JDK 21 (Capacitor), core/iOS проверены на JDK 17.
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")" && pwd)"           # .../app
CORE_DIR="$HOME/Documents/github_dev/Sibionic"     # SugarLifeCore (composite includeBuild)
JDK21="$HOME/jdks/temurin21/Contents/Home"
JDK17="/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
TEAM="U47P7HZ98U"
cd "$APP_DIR"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

# Профилактика D8 «Error while dexing»: composite-сборка core под android оставляет дубли `X 2.class` в
# runtime_library_classes_dir (Gradle+APFS quirk при повторном копировании). Чистим их перед Android.
clean_core_android() {
  for m in core/contract sim state history persistence bridge drivers/sibionics drivers/medtronic drivers/cloud engine; do
    rm -rf "$CORE_DIR/$m/build/intermediates/runtime_library_classes_dir" \
           "$CORE_DIR/$m/build/intermediates/bundleLibRuntimeToDirDebug" 2>/dev/null
  done
}

step "web (CAP=1 npm run build)"
CAP=1 npm run build && WEB=1 || WEB=0

step "cap sync (ios + android)"
npx cap sync && SYNC=1 || SYNC=0

step "Android APK (JDK 21)"
clean_core_android
( cd android && JAVA_HOME="$JDK21" ./gradlew :app:assembleDebug ) && AND=1 || AND=0

step "iOS build (JDK 17, XCFramework + Swift)"
( cd ios/App && JAVA_HOME="$JDK17" xcodebuild -project App.xcodeproj -scheme App \
    -configuration Debug -destination 'generic/platform=iOS' \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" build -quiet ) && IOS=1 || IOS=0

ok() { [ "$1" = 1 ] && echo "✅" || echo "❌"; }
printf '\n\033[1m== ИТОГ ==\033[0m\n'
printf 'web:     %s\n' "$(ok $WEB)"
printf 'sync:    %s\n' "$(ok $SYNC)"
printf 'Android: %s  (%s)\n' "$(ok $AND)" "android/app/build/outputs/apk/debug/app-debug.apk"
printf 'iOS:     %s\n' "$(ok $IOS)"
[ "$WEB" = 1 ] && [ "$AND" = 1 ] && [ "$IOS" = 1 ]
