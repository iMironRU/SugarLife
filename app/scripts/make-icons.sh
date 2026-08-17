#!/usr/bin/env bash
# Иконки приложения из одного набора исходников (resources/*.svg).
#
# Зачем скриптом, а не руками. Иконок тридцать штук в трёх местах — iOS, Android и
# public/ для PWA, — и разъезжаются они молча: на iOS лежала серая картинка, потому что
# её когда-то отрисовали инструментом без поддержки градиентов, а рядом в public/ жила
# та же иконка фиолетовой. Заметить это можно было только на телефоне.
#
# Рисуем headless-Chrome, а не ImageMagick: у здешнего IM свой внутренний SVG-рендерер
# без градиентов и фильтров — он и превратил каплю в серое пятно. Chrome рисует ровно
# то же, что увидит человек в браузере. qlmanage тоже умеет (WebKit), но кладёт
# прозрачность на белое, а прозрачность нам нужна: передний слой Android и тёмный
# вариант iOS без неё не работают.
#
# Имена переменных латиницей намеренно: bash не умеет присваивать переменным с
# нелатинскими именами и молча превращает строку в команду.
#
# Запуск: bash scripts/make-icons.sh   (из каталога app/)
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Нет Chrome: $CHROME"; exit 1; }
command -v magick >/dev/null || { echo "Нет ImageMagick (brew install imagemagick)"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Отрисовать SVG в PNG. Размер задаём окном, а не масштабированием.
draw() { # <svg> <размер> <куда>
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --window-size="$2,$2" --screenshot="$3" "file://$PWD/$1" >/dev/null 2>&1
}

# Исходник рисуем один раз в 1024 и уменьшаем: растровое уменьшение сохраняет альфу и
# на мелких размерах даёт более ровный результат, чем отрисовка вектора в 36 пикселей.
src() { draw "$1" 1024 "$TMP/$2.png"; }
size() { magick "$TMP/$1.png" -resize "$2x$2" -strip "$3"; }

# ИЗДАНИЕ (core#61). Без аргумента — Lite, как было. `pro` берёт исходники *-pro.svg и кладёт результат
# в отдельные места: иконки Android — в src/pro/res, iOS — в свой набор AppIcon-Pro. Общие файлы и
# иконки PWA при этом НЕ ТРОГАЮТСЯ: PWA — это Lite, и чёрно-белая иконка Pro на сайте была бы ошибкой.
EDITION="${1:-lite}"
[ "$EDITION" = lite ] || [ "$EDITION" = pro ] || { echo "издание: lite или pro, а не «$EDITION»"; exit 1; }
SUF=""; [ "$EDITION" = pro ] && SUF="-pro"
echo "издание: $EDITION"

src "resources/icon$SUF.svg" base
src "resources/icon-maskable$SUF.svg" mask
src "resources/icon-foreground$SUF.svg" fg
src "resources/icon-background$SUF.svg" bg
src "resources/icon-dark$SUF.svg" dark
src "resources/icon-tinted$SUF.svg" tint

if [ "$EDITION" = lite ]; then
  # Исходник для @capacitor/assets: им перегенерируют иконки те, кто не знает про этот
  # скрипт, и он обязан показывать то же самое.
  size base 1024 resources/icon.png

  # --- PWA и браузер ---------------------------------------------------------
  # Только для Lite: сайт — это Lite, и подменять его иконку изданием Pro нельзя.
  size base 512 public/icon-512.png
  size base 192 public/icon-192.png
  size base 180 public/apple-touch-icon.png
  size base 48  public/favicon-48.png
  size mask 512 public/icon-maskable-512.png
  size mask 192 public/icon-maskable-192.png
fi

# --- iOS ---------------------------------------------------------------------
# Один файл 1024 на все размеры — так Xcode работает с 14-й версии. Тёмный и
# тонированный варианты появились в iOS 18; без них система делает их сама, и капля
# на тёмном получается блеклой.
# У Pro свой НАБОР иконок рядом, а не поверх: какой брать, решает переменная сборки
# ASSETCATALOG_COMPILER_APPICON_NAME. Общий AppIcon остаётся иконкой Lite.
IOS=ios/App/App/Assets.xcassets/AppIcon.appiconset
[ "$EDITION" = pro ] && IOS=ios/App/App/Assets.xcassets/AppIcon-Pro.appiconset
mkdir -p "$IOS"
[ -f "$IOS/Contents.json" ] || cp ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json "$IOS/Contents.json"
size base 1024 "$IOS/AppIcon-512@2x.png"
size dark 1024 "$IOS/AppIcon-dark.png"
size tint 1024 "$IOS/AppIcon-tinted.png"

# --- Android -----------------------------------------------------------------
# Плотности: mdpi 1x … xxxhdpi 4x. Legacy-иконка (ic_launcher) 48dp, слои адаптивной —
# 108dp: у неё края уходят под маску, поэтому холст больше видимой части.
# Иконки Pro ложатся в свой sourceSet — общий res не трогаем вовсе.
AND=android/app/src/main/res
[ "$EDITION" = pro ] && AND=android/app/src/pro/res
mkdir -p "$AND"
for pair in "ldpi 36 81" "mdpi 48 108" "hdpi 72 162" "xhdpi 96 216" "xxhdpi 144 324" "xxxhdpi 192 432"; do
  set -- $pair
  mkdir -p "$AND/mipmap-$1"
  size mask "$2" "$AND/mipmap-$1/ic_launcher.png"
  size mask "$2" "$AND/mipmap-$1/ic_launcher_round.png"
  size fg   "$3" "$AND/mipmap-$1/ic_launcher_foreground.png"
  size bg   "$3" "$AND/mipmap-$1/ic_launcher_background.png"
done

echo "Готово. Посмотри глазами: public/icon-512.png, $IOS/AppIcon-512@2x.png, $AND/mipmap-xxxhdpi/ic_launcher_foreground.png"
