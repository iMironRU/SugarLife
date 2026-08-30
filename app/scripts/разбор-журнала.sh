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
# ЖИВУЧЕСТЬ МЕРЯЕТСЯ МОЛЧАНИЕМ, А НЕ ЗАПУСКАМИ (SugarLife#682).
#
# Здесь стояло расстояние между событиями `engine/start`, и называлось оно «медианой жизни».
# Это расстояние между ЗАПУСКАМИ: сколько из него приложение работало, а сколько лежало мёртвым,
# оно не различает вовсе. 30 августа я по этой цифре доложил владельцу «медиана жизни 309 минут,
# приложение перестало умирать» — а оно в ту же ночь пролежало мёртвым два часа подряд. Владелец
# это видел своими глазами и поправил меня.
#
# Живое приложение пишет в журнал каждые несколько секунд. Значит тишина дольше десяти минут —
# это и есть смерть, и мерить надо её. Отрезки работы считаем между провалами.
#
# И сразу называем ПРИЧИНУ: последнее решение об опоре перед каждым провалом. Именно оно
# 30 августа показало, что приложение никто не закрывал — три раза его добила система после
# «ушли в фон без опоры: движок не велел при маршруте car», и дважды оно умерло с опорой.
SILENCE_MS=600000   # 10 минут молчания = приложение не работало
echo "═══ ЖИВУЧЕСТЬ — главное число"
Q "with e as (select atMs, lag(atMs) over (order by atMs) prev from logEntry),
        m as (select atMs, case when prev is null or atMs-prev > $SILENCE_MS then 1 else 0 end as новый from e),
        g as (select atMs, sum(новый) over (order by atMs) as отрезок from m),
        o as (select отрезок, max(atMs)-min(atMs) as длина from g group by отрезок)
   select 'отрезков работы', count(*) from o
   union all select 'медиана работы, мин', round((select длина/60000.0 from o order by длина limit 1 offset (select count(*)/2 from o)),0)
   union all select 'самый длинный, мин', round(max(длина)/60000.0,0) from o
   union all select 'провалов', (select count(*) from e where atMs-prev > $SILENCE_MS)
   union all select 'самый долгий провал, мин', round((select max(atMs-prev)/60000.0 from e where atMs-prev > $SILENCE_MS),0)
   union all select 'мёртвым, % охвата', round(100.0*(select sum(atMs-prev) from e where atMs-prev > $SILENCE_MS)/(select max(atMs)-min(atMs) from logEntry),1);"
echo
echo "   провалы и что им предшествовало:"
Q "with e as (select atMs, lag(atMs) over (order by atMs) prev from logEntry)
   select '   '||datetime(prev/1000,'unixepoch','localtime'),
          round((atMs-prev)/60000.0)||' мин',
          coalesce((select k.event from logEntry k where k.tag='keepalive' and k.atMs <= e.prev order by k.atMs desc limit 1),'—')
   from e where atMs-prev > $SILENCE_MS order by prev desc limit 8;"
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
