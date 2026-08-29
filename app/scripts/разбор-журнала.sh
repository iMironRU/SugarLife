#!/usr/bin/env bash
# Разбор журнала с телефона одной командой (SugarLife#672).
#
# ЗАЧЕМ. 28 августа разбор занял день, и добрая половина его ушла на то, чтобы КАЖДЫЙ РАЗ заново
# вспоминать запрос: сколько прожили между запусками, сколько отправили карточек и сколько из них
# применила система, не вернулось ли мерцание. Три раза за день я сделал вывод по неполным данным
# и трижды сказал владельцу неверное.
#
# Здесь эти вопросы записаны один раз. Ответ на них — не мнение, а число, и одно и то же число
# завтра и через месяц.
#
# ЧЕГО ЗДЕСЬ НЕТ. Ни одной строки с показаниями сахара, едой и дозами: разбор отвечает на вопросы
# о РАБОТЕ приложения. Данные человека остаются в базе, из которой их читают глазами и по делу.
#
# Запуск:  bash scripts/разбор-журнала.sh [файл.db]
#          без файла — снимет свежий с телефона по воздуху
set -euo pipefail

DB="${1:-}"
# Имена переменных латиницей: bash 3.2 в macOS не понимает не-ASCII имён. Шестой раз за проект.
DEVICE="${SUGARLIFE_DEVICE:-}"
OUTDIR="${SUGARLIFE_LOGDIR:-$HOME/Documents/github_dev/SugarLife-журналы}"

if [ -z "$DB" ]; then
  # СНИМАЕМ И .db, И .db-wal. Свежие записи лежат в журнале транзакций, и без него база показывает
  # ПРОШЛОЕ. 28 августа я на этом объявил приложение мёртвым, когда оно работало.
  if [ -z "$DEVICE" ]; then
    DEVICE=$(xcrun devicectl list devices 2>/dev/null | grep -v unavailable | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1 || true)
  fi
  [ -n "$DEVICE" ] || { echo "Телефон не виден. Подключите или укажите файл базы." >&2; exit 1; }
  mkdir -p "$OUTDIR"
  DB="$OUTDIR/снимок.db"
  rm -f "$DB" "$DB-wal"
  for f in sugarlife.db sugarlife.db-wal; do
    xcrun devicectl device copy from --device "$DEVICE" \
      --domain-type appDataContainer --domain-identifier ru.imiron.sugarlife --user mobile \
      --source "Library/Application Support/databases/$f" \
      --destination "$DB${f#sugarlife.db}" >/dev/null 2>&1 || true
  done
  [ -s "$DB" ] || { echo "Не удалось снять журнал." >&2; exit 1; }
fi

Q() { sqlite3 -separator ' | ' "$DB" "$1"; }

echo "═══ ОХВАТ"
Q "select datetime(min(atMs)/1000,'unixepoch','localtime')||'  →  '||datetime(max(atMs)/1000,'unixepoch','localtime')||'   записей: '||count(*) from logEntry;"
echo
echo "═══ ЖИВУЧЕСТЬ — главное число"
Q "with s as (select atMs, lag(atMs) over (order by atMs) prev from logEntry where tag='engine' and event='start')
   select 'запусков за охват', count(*)+1 from s
   union all select 'медиана жизни, мин', round((select (atMs-prev)/60000.0 from s where prev is not null order by (atMs-prev) limit 1 offset (select count(*)/2 from s where prev is not null)),0)
   union all select 'самый длинный отрезок, мин', round(max(atMs-prev)/60000.0,0) from s
   union all select 'отрезков короче 30 мин', count(*) from s where atMs-prev < 1800000;"
echo
echo "   последние отрезки:"
Q "with s as (select atMs, lag(atMs) over (order by atMs) prev from logEntry where tag='engine' and event='start')
   select '   '||time(atMs/1000,'unixepoch','localtime'), round((atMs-prev)/60000.0)||' мин' from s where prev is not null order by atMs desc limit 8;"
echo
echo "═══ ЖИВАЯ КАРТОЧКА — просили против дали"
Q "select 'отправили', count(*) from logEntry where tag='banner' and event like 'карточка обновлена%'
   union all select 'система применила', count(*) from logEntry where tag='banner' and event like 'система показала%'
   union all select 'отказ «не передний план»', count(*) from logEntry where tag='banner' and event like 'не удалось%foreground%'
   union all select 'создавали заново', count(*) from logEntry where tag='banner' and event='запущено';"
echo
echo "═══ МЕРЦАНИЕ ЧУЖОГО ЗВУКА (должно быть около нуля)"
Q "select 'переворотов', count(*) from logEntry where event like 'чужой звук%'
   union all select 'отчётов о доставке', count(*) from logEntry where tag='alarm' and event='delivery';"
echo
echo "═══ ТРЕВОГИ — приказ и исход"
Q "select time(atMs/1000,'unixepoch','localtime'), event from logEntry
   where tag='alarm' and (event like 'приказ %' or event like 'звук тревоги%' or event='Началась')
   order by atMs desc limit 8;"
echo
echo "═══ ОСТАТОК РЕЗЕРВУАРА (движку нужно 6 часов охвата)"
Q "select 'точек', count(*) from reservoir
   union all select 'охват, ч', round((max(atMs)-min(atMs))/3600000.0,1) from reservoir;"
echo
echo "═══ ПОКАЗАНИЯ — разрывы дольше 10 минут"
Q "with g as (select atMs, lag(atMs) over (order by atMs) prev from glucose)
   select coalesce(nullif(count(*),0), 0)||' разрывов' from g where atMs-prev > 600000;"
echo
echo "═══ ЧТО ВООБЩЕ ПИСАЛОСЬ (топ событий)"
Q "select tag||' · '||event, count(*) from logEntry group by tag, event order by count(*) desc limit 8;"
