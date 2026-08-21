#!/usr/bin/env bash
# Проверка фоновой живучести на ЭМУЛЯТОРАХ — без телефона и на нескольких версиях Android сразу (#380).
#
# Зачем. Требование к каналу — стабильность на разных версиях системы, а различия там существенные:
# предел в 6 часов для dataSync есть только на Android 15, запрет стартовать из загрузки — тоже; до
# Android 12 нет отдельного разрешения на Bluetooth. Проверять это на одном телефоне бессмысленно, а
# держать три телефона незачем: всё перечисленное живёт в системе, а не в радио.
#
# Чего проверка НЕ заменяет. В эмуляторе нет Bluetooth: ни сенсор, ни мост здесь не подключатся. Живое
# железо остаётся обязательным — но к нему мы приходим, уже зная, что сервис поднимается верного типа и
# переживает перезагрузку.
#
# Использование:
#   bash emu-check.sh                  # все AVD с именами sl-*
#   bash emu-check.sh sl-a15 sl-a11    # только эти
#
# AVD создаются один раз:
#   sdkmanager --install "system-images;android-35;google_apis;arm64-v8a"
#   avdmanager create avd -n sl-a15 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_6
set -uo pipefail

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
PKG="ru.imiron.sugarlife.pro"
ACT="$PKG/ru.imiron.sugarlife.MainActivity"
APK="$(cd "$(dirname "$0")/.." && pwd)/android/app/build.nosync/outputs/apk/pro/debug/app-pro-debug.apk"

AVDS=("$@")
[ ${#AVDS[@]} -eq 0 ] && AVDS=($("$EMU" -list-avds | grep '^sl-'))
[ -f "$APK" ] || { echo "APK не собран: $APK"; exit 1; }

# Глушим ВСЕ живые эмуляторы и ДОЖИДАЕМСЯ их смерти. С двумя запущенными adb отказывается выбирать сам,
# и прогон осыпается на «more than one device». Просто «убить и поспать» не годится: эмулятор умирает
# неспешно, а мы за это время успеваем поднять следующий — и получаем ровно то, от чего убегали.
kill_all() {
    "$ADB" devices | grep emulator | cut -f1 | while read -r s; do "$ADB" -s "$s" emu kill >/dev/null 2>&1; done
    i=0
    while [ "$("$ADB" devices | grep -c emulator)" != "0" ] && [ $i -lt 30 ]; do sleep 2; i=$((i + 1)); done
}

SUMMARY=""
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; SUMMARY="$SUMMARY  ✗ $VERSION: $1\n"; }

# Тип foreground-сервиса числом: 0x10 connectedDevice, 0x01 dataSync. На Android 10 и старше система его
# не печатает — там проверяем только сам факт «сервис на переднем плане».
fgs_type() {
    "$ADB" shell dumpsys activity services "$PKG" 2>/dev/null \
        | grep -a "isForeground=true" | grep -ao "types=0x[0-9a-f]*" | head -1 | cut -d= -f2
}
is_foreground() { "$ADB" shell dumpsys activity services "$PKG" 2>/dev/null | grep -ac "isForeground=true"; }
restart()  { "$ADB" shell am force-stop "$PKG"; "$ADB" shell am start -n "$ACT" >/dev/null 2>&1; sleep 12; }

for AVD in "${AVDS[@]}"; do
    printf '\n\033[1m▶ %s\033[0m\n' "$AVD"
    kill_all
    nohup "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect >"/tmp/$AVD.log" 2>&1 &
    "$ADB" wait-for-device >/dev/null 2>&1
    "$ADB" shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 3; done' >/dev/null 2>&1
    VERSION="Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r') (API $("$ADB" shell getprop ro.build.version.sdk | tr -d '\r'))"
    SDKV=$("$ADB" shell getprop ro.build.version.sdk | tr -d '\r')
    echo "  $VERSION"
    "$ADB" install -r -g "$APK" >/dev/null 2>&1 || { bad "APK не установился"; continue; }

    # 1. С Bluetooth-разрешением сервис обязан быть connectedDevice — у него нет предела в 6 часов.
    "$ADB" shell pm grant "$PKG" android.permission.BLUETOOTH_CONNECT >/dev/null 2>&1
    "$ADB" shell pm grant "$PKG" android.permission.BLUETOOTH_SCAN >/dev/null 2>&1
    "$ADB" logcat -c
    restart
    T=$(fgs_type)
    # До Android 14 система тип в dumpsys не печатает — тогда спрашиваем сам сервис: он пишет в журнал,
    # чем стартовал. Без этого на старых версиях проверка вырождалась в «ну хоть поднялся».
    SAID=$("$ADB" logcat -d 2>/dev/null | grep -a "SugarLifeService: старт: тип" | tail -1 | sed 's/.*тип //')
    if [ "$(is_foreground)" = "0" ]; then bad "сервис не поднялся"
    elif [ "$T" = "0x00000010" ]; then ok "тип connectedDevice — без предела по времени"
    elif [ -n "$T" ]; then bad "тип $T вместо connectedDevice — на Android 15 это 6 часов в сутки"
    elif echo "$SAID" | grep -q "^connectedDevice"; then ok "тип connectedDevice (по журналу сервиса)"
    else bad "сервис стартовал как «$SAID» вместо connectedDevice"; fi

    # 2. Без разрешения — обязан УСТОЯТЬ, свалившись на dataSync. Слепая замена типа уронила бы облачный режим.
    "$ADB" shell pm revoke "$PKG" android.permission.BLUETOOTH_CONNECT >/dev/null 2>&1
    "$ADB" shell pm revoke "$PKG" android.permission.BLUETOOTH_SCAN >/dev/null 2>&1
    restart
    if [ "$(is_foreground)" = "0" ]; then bad "без Bluetooth-разрешения сервис не поднялся вовсе"
    else ok "без Bluetooth-разрешения сервис жив (облачный режим не сломан)"; fi

    # 3. Перезагрузка. На Android 15 включаем системное ограничение явно: из BOOT_COMPLETED там
    #    разрешён connectedDevice и запрещён dataSync — проверяем, что мы по разрешённой стороне.
    "$ADB" root >/dev/null 2>&1; sleep 3; "$ADB" wait-for-device >/dev/null 2>&1
    [ "$SDKV" -ge 35 ] && "$ADB" shell am compat enable FGS_BOOT_COMPLETED_RESTRICTIONS "$PKG" >/dev/null 2>&1
    "$ADB" shell pm grant "$PKG" android.permission.BLUETOOTH_CONNECT >/dev/null 2>&1
    "$ADB" shell am start -n "$ACT" >/dev/null 2>&1; sleep 10
    "$ADB" shell am kill "$PKG"; sleep 2      # именно kill, не force-stop: остановленное приложение broadcast не получает
    "$ADB" logcat -c
    "$ADB" shell am broadcast -a android.intent.action.BOOT_COMPLETED -p "$PKG" >/dev/null 2>&1
    sleep 8
    if [ "$(is_foreground)" = "0" ]; then bad "после перезагрузки мониторинг не поднялся"
    else ok "после перезагрузки мониторинг поднялся сам"; fi
    if "$ADB" logcat -d 2>/dev/null | grep -aq "ForegroundServiceStartNotAllowed"; then
        bad "система запретила старт из загрузки — тип сервиса не тот"
    fi

    # 4. Doze: процесс и сервис обязаны пережить глубокий сон.
    "$ADB" shell dumpsys battery unplug >/dev/null 2>&1
    "$ADB" shell dumpsys deviceidle enable >/dev/null 2>&1
    "$ADB" shell dumpsys deviceidle force-idle >/dev/null 2>&1
    sleep 10
    if [ "$(is_foreground)" = "0" ]; then bad "в Doze сервис пропал"; else ok "Doze пережит"; fi
    "$ADB" shell dumpsys deviceidle unforce >/dev/null 2>&1
    "$ADB" shell dumpsys battery reset >/dev/null 2>&1

    if "$ADB" logcat -d 2>/dev/null | grep -aqE "FATAL EXCEPTION.*$PKG"; then bad "падение в журнале"; fi
done

kill_all
printf '\n\033[1m== ИТОГ ==\033[0m\n'
[ -z "$SUMMARY" ] && echo "  всё сошлось" || printf "$SUMMARY"
