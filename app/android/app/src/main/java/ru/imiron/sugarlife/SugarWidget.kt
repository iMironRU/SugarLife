package ru.imiron.sugarlife

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.util.Log
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Виджет на рабочем столе: сахар, кольцо и возраст показания (SugarLife#449).
 *
 * ПОЧЕМУ ОН РИСУЕТСЯ КАРТИНКОЙ. Виджет разворачивает не наш процесс, а лаунчер, и ему разрешён узкий
 * список вьюх — WebView среди них нет, дуги тоже. Значит наш круг с экрана «Сегодня» показать как есть
 * нельзя: кольцо рисуем на холсте и отдаём готовым изображением. Число и возраст при этом остаются
 * настоящим текстом поверх — иначе они не подчинялись бы размеру шрифта в системе.
 *
 * ВОЗРАСТ СЧИТАЕТ ЛАУНЧЕР, А НЕ МЫ. `Chronometer` идёт вперёд сам, внутри чужого процесса — поэтому
 * «2 мин» превращается в «17 мин» даже когда наша служба остановлена. Это главное: виджет, показывающий
 * вчерашнее число как сегодняшнее, хуже пустого, а обновлять его каждую минуту нам никто не даст —
 * система разрешает не чаще раза в полчаса.
 *
 * ДАННЫЕ ЛЕЖАТ НА ДИСКЕ. Виджет спрашивают в любой момент, в том числе когда служба выключена человеком
 * или убита системой. Поэтому последнее показание пишется в настройки при каждом снимке и читается
 * отсюда без движка — иначе на рабочем столе был бы прочерк ровно тогда, когда человек туда смотрит.
 */
class SugarWidget : AppWidgetProvider() {

    override fun onUpdate(ctx: Context, менеджер: AppWidgetManager, ids: IntArray) {
        for (id in ids) нарисовать(ctx, менеджер, id)
    }

    /* БУДИЛЬНИК НА МОМЕНТ, КОГДА ЧИСЛУ ВЕРИТЬ НЕЛЬЗЯ (#530).

       Виджет рисует то, что ему положили в последний раз. Пока приложение живо, оно кладёт заново
       каждые пять минут, и всё честно. Но когда оно замолчало — а замолкает оно ровно тогда, когда
       пропала связь, — на рабочем столе остаётся яркое число, под которым лаунчер бодро отсчитывает
       сорок минут. Сам себя виджет перерисовать не может: система разрешает не чаще раза в полчаса.

       Поэтому мы будим себя сами — один раз, на момент устаревания показания. Это дешевле, чем
       периодические обновления, и попадает точно в ту секунду, когда картинку надо изменить. */
    override fun onReceive(ctx: Context, намерение: Intent) {
        super.onReceive(ctx, намерение)
        if (намерение.action == УСТАРЕЛО || намерение.action == ОСЛЕПЛИ) обновитьВсе(ctx)
    }

    companion object {
        private const val TAG = "SugarLifeВиджет"
        private const val НАСТРОЙКИ = "sugarlife-widget"
        private const val К_САХАР = "mmol"
        private const val К_КОГДА = "at"
        private const val К_ТРЕНД = "trend"
        private const val К_СЫРОЕ = "raw"
        private const val К_ИНСУЛИН = "iob"
        /* Когда движок ждёт следующее показание (мост 1.41). Раньше виджет считал по своей
           пятиминутке — у минутного сенсора счётчик врал вчетверо. */
        private const val К_СЛЕДУЮЩЕЕ = "next"
        /* Ряд показаний за три часа — тем же способом, что на айфоне: снимок несёт одно число,
           а линии нужна история, и взять её в лаунчере неоткуда. Храним строкой «время:значение»
           через запятую: два десятка пар — это сотни байт, и разбирать их дешевле, чем заводить базу. */
        private const val К_РЯД = "series"
        private const val ОКНО_МС = 3 * 60 * 60 * 1000L
        /* Пауза НМГ. Пока движок не отдаёт, когда ждать следующее показание, считаем по ней —
           ровно как на айфоне, и переедем на поле контракта в одном месте. */
        private const val ШАГ_МС = 5 * 60 * 1000L

        /** Ниже и выше этих чисел кольцо краснеет. Те же границы, что в приложении. */
        private const val НИЗ = 3.9
        private const val ВЕРХ = 10.0
        /** Ось графика: 2…16 ммоль, как на баннере айфона. Не по данным — см. объяснение у `график`. */
        private const val ОСЬ_НИЗ = 2.0
        private const val ОСЬ_ВЕРХ = 16.0
        /** Больше этого промежутка — не линия, а дыра: две обычные паузы НМГ плюс запас. */
        /* Дыра в линии — тот же порог, что «показание устарело» (docs/поверхности-показа.md).
           Было двенадцать минут против пятнадцати у устаревания: два числа про одно молчание. */
        private const val РАЗРЫВ_МС = 15 * 60 * 1000L
        /* Пороги старения и правило «что мы вправе утверждать» живут в `ВозрастПоказания`: здесь их
           не проверить — отрисовка идёт в чужом процессе, и беду видно только глазами на рабочем
           столе. Так её и нашли (#694). */
        private const val УСТАРЕЛО = "ru.imiron.sugarlife.ВИДЖЕТ_УСТАРЕЛ"
        private const val ОСЛЕПЛИ = "ru.imiron.sugarlife.ВИДЖЕТ_ОСЛЕП"

        private const val ТЕКСТ = 0xFFE9E9ED.toInt()
        private const val ТУСКЛО = 0xFF8B90A3.toInt()
        private const val АКЦЕНТ = 0xFF9184D9.toInt()
        private const val ВЫШЕ = 0xFFE8B980.toInt()
        private const val НИЖЕ = 0xFFE58A95.toInt()

        /**
         * Запомнить показание из снимка и перерисовать виджеты.
         *
         * Зовётся из службы на каждый снимок. Если виджетов на экране нет, работа сводится к записи в
         * настройки — рисовать некому и незачем.
         */
        fun приСнимке(ctx: Context, json: String) {
            val monitor = runCatching { JSONObject(json).optJSONObject("monitor") }.getOrNull() ?: return
            if (monitor.isNull("glucoseMmol")) return
            val сахар = monitor.optDouble("glucoseMmol")
            if (сахар.isNaN() || сахар <= 0.0) return
            ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE).edit()
                .putFloat(К_САХАР, сахар.toFloat())
                .putLong(К_КОГДА, monitor.optLong("latestAtMs", System.currentTimeMillis()))
                .putString(К_ТРЕНД, monitor.optString("trend"))
                .putBoolean(К_СЫРОЕ, !monitor.optBoolean("glucoseCalibrated", false))
                .putString(К_ИНСУЛИН, инсулинИз(monitor))
                .putLong(К_СЛЕДУЮЩЕЕ, monitor.optLong("nextExpectedAtMs", 0L))
                /* Ряд — от движка, когда он ответил; своя копилка остаётся запасным путём: до
                   первого ответа и на случай, если истории у него ещё нет (#562). */
                .putString(К_РЯД, историяИзДвижка(ctx)?.let { собратьРяд(проредить(it)) }
                    ?: дописатьРяд(ctx, сахар, monitor.optLong("latestAtMs", System.currentTimeMillis())))
                .apply()
            обновитьВсе(ctx)
        }

        /* ТО ЖЕ ЧИСЛО, ЧТО НА ЭКРАНЕ (#566), и снова наше (мост 1.47).

           Обход с чужим числом заводили, когда наш `confirmedIOB` занижал втрое: ядро выбрасывало
           записи временного базала при разборе. Починено — возвращаем свой расчёт вперёд.
           Подробности в шапке `инсулинИзСнимка` на айфоне, порядок здесь тот же. */
        private fun инсулинИз(monitor: JSONObject): String {
            // Наш первым снова (мост 1.47): ядро починило разбор временного базала, и занижения
            // втрое больше нет. Чужой остаётся запасным — для тех, у кого профиля нет.
            val наш = monitor.optDouble("confirmedIOB", Double.NaN)
            val чужой = monitor.optDouble("loopIOB", Double.NaN)
            val иоб = if (!наш.isNaN() && наш > 0.05) наш else чужой
            if (иоб.isNaN() || иоб <= 0.05) return ""
            return "инс. " + "%.1f".format(иоб).replace('.', ',') + " ед"
        }

        /* ИСТОРИЯ ДЛЯ ГРАФИКА — У ДВИЖКА, А НЕ ИЗ СВОЕЙ КОПИЛКИ (#562).

           Виджет копил ряд сам: по точке на снимок, начиная с момента, когда служба работает. Дыры в
           линии — это не пропажи данных, а часы, когда система нас усыпляла; на айфоне то же самое
           владелец увидел первым и спросил, не разучились ли мы догружать историю.

           У движка она есть целиком — он тянет её из облака и держит в своей базе. Спрашиваем ЕГО.

           Не чаще раза в пять минут: запрос идёт в базу, а снимки приходят пачками. Пять минут — общий
           такт внешних поверхностей (docs/поверхности-показа.md).

           Прореживаем сами: `maxPoints` в постоянном хранилище движка означает «последние N», а не
           «прореди окно» (SugarLifeCore#132), и при минутном такте мы получили бы сорок восемь минут
           вместо трёх часов. */
        private var историяВзятаМс = 0L

        fun историяИзДвижка(ctx: Context): List<Pair<Long, Double>>? {
            val сейчас = System.currentTimeMillis()
            if (сейчас - историяВзятаМс < 5 * 60 * 1000L) return null
            историяВзятаМс = сейчас
            val от = сейчас - ОКНО_МС
            val запрос = "{\"kind\":\"Glucose\",\"fromMs\":$от,\"toMs\":$сейчас}"
            val ответ = runCatching { EngineHolder.engine(ctx).query(запрос) }.getOrNull() ?: return null
            val список = runCatching { JSONObject(ответ).optJSONArray("glucose") }.getOrNull() ?: return null
            val точки = ArrayList<Pair<Long, Double>>(список.length())
            for (i in 0 until список.length()) {
                val т = список.optJSONObject(i) ?: continue
                val когда = т.optLong("atMs", 0L)
                val ммоль = т.optDouble("mmol", 0.0)
                if (когда > 0 && ммоль > 0) точки.add(когда to ммоль)
            }
            return точки.takeIf { it.isNotEmpty() }?.sortedBy { it.first }
        }

        /* Не чаще точки в пять минут: на карточке шириной в ладонь соседние минуты ложатся в один
           пиксель, а строка в настройках раздувается впятеро. Последняя точка сохраняется всегда —
           она и есть текущее показание. */
        private fun проредить(точки: List<Pair<Long, Double>>, шагМс: Long = 5 * 60 * 1000L): List<Pair<Long, Double>> {
            if (точки.isEmpty()) return точки
            val итог = ArrayList<Pair<Long, Double>>()
            for (т in точки) {
                val прошлая = итог.lastOrNull()
                if (прошлая == null || т.first - прошлая.first >= шагМс) итог.add(т)
            }
            if (итог.lastOrNull()?.first != точки.last().first) итог.add(точки.last())
            return итог
        }

        /**
         * Дописать показание в ряд и вернуть его строкой.
         *
         * ПРОПУСКИ НЕ ЗАШИВАЕМ. Если данных не было полчаса, в ряду останется дыра — и линия обязана
         * показать её разрывом, а не прямой через всю карточку: ровная линия через молчание читается
         * как ровный сахар, и это худшее враньё, какое здесь можно нарисовать.
         */
        private fun дописатьРяд(ctx: Context, сахар: Double, когда: Long): String {
            val н = ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
            val порог = System.currentTimeMillis() - ОКНО_МС
            val точки = разобратьРяд(н.getString(К_РЯД, "") ?: "")
                .filter { it.first >= порог }
                .toMutableList()
            /* То же показание приходит несколько раз: снимок эмитится на любое изменение, и без
               этой проверки один момент времени породил бы десяток точек подряд. */
            if (точки.none { kotlin.math.abs(it.first - когда) < 1000 }) точки.add(когда to сахар)
            return собратьРяд(точки.sortedBy { it.first })
        }

        private fun собратьРяд(точки: List<Pair<Long, Double>>): String =
            точки.joinToString(",") { it.first.toString() + ":" + it.second }

        private fun разобратьРяд(строка: String): List<Pair<Long, Double>> =
            строка.split(',').mapNotNull { пара ->
                val части = пара.split(':')
                if (части.size != 2) return@mapNotNull null
                val t = части[0].toLongOrNull() ?: return@mapNotNull null
                val v = части[1].toDoubleOrNull() ?: return@mapNotNull null
                t to v
            }

        fun обновитьВсе(ctx: Context) {
            val менеджер = AppWidgetManager.getInstance(ctx) ?: return
            val ids = runCatching {
                менеджер.getAppWidgetIds(ComponentName(ctx, SugarWidget::class.java))
            }.getOrNull() ?: return
            for (id in ids) нарисовать(ctx, менеджер, id)
        }

        private fun нарисовать(ctx: Context, менеджер: AppWidgetManager, id: Int) {
            val н = ctx.getSharedPreferences(НАСТРОЙКИ, Context.MODE_PRIVATE)
            val сахар = н.getFloat(К_САХАР, 0f).toDouble()
            val когда = н.getLong(К_КОГДА, 0L)
            val в = RemoteViews(ctx.packageName, R.layout.sugar_widget)

            /* УЗКИЙ ВИДЖЕТ ПОКАЗЫВАЕТ МЕНЬШЕ, А НЕ МЕЛЬЧЕ. В два столбца на одну строку график
               превращается в закорючку, а нижняя строка — в обрезанные слова. Оставляем то, ради
               чего виджет ставят: число, стрелку и возраст. */
            val ширина = runCatching {
                менеджер.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
            }.getOrDefault(0)
            val высота = runCatching {
                менеджер.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            }.getOrDefault(0)
            val узкий = высота in 1..109
            в.setViewVisibility(R.id.sugar_chart, если(!узкий))
            в.setViewVisibility(R.id.sugar_bottom, если(!узкий))

            /* Показания не было ни разу — прочерк и честная подпись. Ноль здесь означал бы
               гипогликемию, а пустой виджет без слов — что приложение сломалось. */
            if (сахар <= 0.0 || когда <= 0L) {
                в.setTextViewText(R.id.sugar_value, "—")
                в.setTextViewText(R.id.sugar_sub, "нет показаний")
                в.setViewVisibility(R.id.sugar_age, android.view.View.GONE)
                в.setViewVisibility(R.id.sugar_next, android.view.View.GONE)
                в.setImageViewBitmap(R.id.sugar_chart, график(ctx, emptyList(), ширина, узкий))
            } else if (ВозрастПоказания.стадия(System.currentTimeMillis() - когда) == Стадия.СЛЕПО) {
                /* ЧАС БЕЗ ПЕРЕРИСОВКИ — ВИДЖЕТ НЕ УТВЕРЖДАЕТ НИЧЕГО (#694).
                   Ни числа, ни секундомеров: секундомер идёт в чужом процессе и растёт вечно, а
                   «данных нет» с ним рядом — утверждение о том, чего мы знать не можем. Час
                   последнего известного показания ставим часами, а не длительностью: «9:24» не
                   протухает, сколько бы виджет ни провисел.

                   На узком виджете нижней строки нет вовсе, и остаётся один прочерк. Это молчание,
                   а не ложь: пусть лучше не скажет ничего, чем скажет неправду. */
                в.setTextViewText(R.id.sugar_value, "—")
                в.setTextColor(R.id.sugar_value, ТУСКЛО)
                в.setViewVisibility(R.id.sugar_age, android.view.View.GONE)
                в.setViewVisibility(R.id.sugar_next, android.view.View.GONE)
                val час = java.text.SimpleDateFormat("H:mm", java.util.Locale.getDefault())
                    .format(java.util.Date(когда))
                val число = "%.1f".format(сахар).replace('.', ',')
                в.setTextViewText(R.id.sugar_sub, "неизвестно · последнее $число в $час")
                в.setImageViewBitmap(
                    R.id.sugar_chart,
                    график(ctx, разобратьРяд(н.getString(К_РЯД, "") ?: ""), ширина, узкий),
                )
            } else {
                val стрелка = стрелкаТренда(н.getString(К_ТРЕНД, "") ?: "")
                val устарело = ВозрастПоказания.стадия(System.currentTimeMillis() - когда) == Стадия.УСТАРЕЛО
                в.setTextViewText(R.id.sugar_value, "%.1f".format(сахар).replace('.', ',') + стрелка)
                /* Устаревшее число гаснет — то же правило, что на баннере айфона: цифра без возраста
                   выглядит текущей всегда, а на рабочем столе на неё смотрят мельком. */
                в.setTextColor(R.id.sugar_value, if (устарело) ТУСКЛО else ТЕКСТ)
                в.setViewVisibility(R.id.sugar_age, android.view.View.VISIBLE)
                /* Отсчёт ведёт лаунчер: база — момент показания, переведённый в часы работы системы.
                   Дальше он идёт сам, и наша остановка на него не влияет.

                   «05:01» без слова читается как время суток — на рабочем столе рядом с часами это
                   особенно легко перепутать. Формат добавляет «назад», и число становится возрастом. */
                в.setChronometer(
                    R.id.sugar_age,
                    SystemClock.elapsedRealtime() - (System.currentTimeMillis() - когда),
                    "%s назад",
                    true,
                )
                /* Секундомер до следующего показания — «ждать или уже беспокоиться». Считает тоже
                   лаунчер, обратным ходом; когда время вышло, показываем прочерк вместо обещания. */
                /* Момент следующего показания знает движок — он измеряет такт источника. Своей
                   пятиминутки держимся только если он молчит (старое ядро). */
                val ждёмК = н.getLong(К_СЛЕДУЮЩЕЕ, 0L).let { if (it > 0) it else когда + ШАГ_МС }
                val осталось = ждёмК - System.currentTimeMillis()
                if (осталось > 0) {
                    в.setViewVisibility(R.id.sugar_next, android.view.View.VISIBLE)
                    в.setChronometer(
                        R.id.sugar_next,
                        SystemClock.elapsedRealtime() + осталось,
                        "через %s",
                        true,
                    )
                    runCatching { в.setChronometerCountDown(R.id.sugar_next, true) }
                } else {
                    в.setViewVisibility(R.id.sugar_next, android.view.View.GONE)
                }
                /* У устаревшего показания подпись меняется целиком: «инс. 1,2 ед» рядом с числом
                   сорокаминутной давности — это не уточнение, а второе устаревшее утверждение.
                   Слово «данных нет» вместе с возрастом отвечает на единственный вопрос, который
                   тут остался: почему число не меняется. */
                val сырое = if (н.getBoolean(К_СЫРОЕ, false)) "сырое" else ""
                val иоб = н.getString(К_ИНСУЛИН, "") ?: ""
                в.setTextViewText(
                    R.id.sugar_sub,
                    if (устарело) "данных нет"
                    else listOf(сырое, иоб).filter { it.isNotEmpty() }.joinToString(" · "),
                )
                /* ДВА БУДИЛЬНИКА, А НЕ ОДИН. Первый — на пятнадцатую минуту, когда числу перестают
                   верить. Второй — на час, когда перестаём верить себе: без него слово «данных нет»
                   и растущий секундомер висели бы сутками (#694). */
                val стадия = if (устарело) Стадия.УСТАРЕЛО else Стадия.СВЕЖЕЕ
                ВозрастПоказания.следующийРубеж(когда, стадия)?.let {
                    разбудить(ctx, it, if (устарело) ОСЛЕПЛИ else УСТАРЕЛО)
                }
                в.setImageViewBitmap(
                    R.id.sugar_chart,
                    график(ctx, разобратьРяд(н.getString(К_РЯД, "") ?: ""), ширина, узкий),
                )
            }

            /* Нажатие открывает приложение — виджет без этого выглядит сломанным: на рабочем столе всё
               куда-нибудь ведёт. */
            val открыть = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
                ?: Intent(Intent.ACTION_MAIN)
            в.setOnClickPendingIntent(
                R.id.sugar_root,
                PendingIntent.getActivity(
                    ctx, 7, открыть,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            runCatching { менеджер.updateAppWidget(id, в) }
                .onFailure { Log.w(TAG, "не удалось обновить виджет $id: $it") }
        }

        /**
         * Разбудить себя один раз — в момент, когда виджет обязан сказать другое.
         *
         * Таких моментов два, и оба известны заранее: пятнадцатая минута (числу больше не верим) и
         * час (не верим и себе, #694). Действия у них разные, иначе второй будильник перезаписал бы
         * первый: `PendingIntent` различаются по коду и действию, а не по времени.
         *
         * Неточный будильник намеренно: минута туда-сюда здесь ничего не решает, а точный на Android 12+
         * требует отдельного разрешения и тратит батарею ради секундной разницы. Заводится заново при
         * каждой отрисовке со свежим показанием, так что живое приложение просто переносит его вперёд.
         */
        private fun разбудить(ctx: Context, когда: Long, действие: String) {
            val менеджер = ctx.getSystemService(Context.ALARM_SERVICE) as? android.app.AlarmManager ?: return
            val намерение = PendingIntent.getBroadcast(
                ctx, if (действие == ОСЛЕПЛИ) 9 else 8,
                Intent(ctx, SugarWidget::class.java).setAction(действие),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            runCatching { менеджер.set(android.app.AlarmManager.RTC, когда + 2000, намерение) }
                .onFailure { Log.w(TAG, "будильник ($действие) не поставлен: $it") }
        }

        private fun если(видно: Boolean) =
            if (видно) android.view.View.VISIBLE else android.view.View.GONE

        /** Имена трендов приходят из ядра. Незнакомое — пустая стрелка: врать направлением хуже, чем молчать. */
        private fun стрелкаТренда(имя: String): String = when (имя) {
            "RisingRapidly" -> " ⇑"
            "Rising" -> " ↑"
            "RisingSlowly" -> " ↗"
            "Stable" -> " →"
            "FallingSlowly" -> " ↘"
            "Falling" -> " ↓"
            "FallingRapidly" -> " ⇓"
            else -> ""
        }

        /**
         * ТРИ ЧАСА НА ФИКСИРОВАННОЙ ОСИ — те же правила, что на баннере айфона.
         *
         * Ось не подстраивается под данные намеренно: автомасштаб рисует спокойный вечер и качели от
         * 3,8 до 13,1 одинаково — линия всегда во весь кадр. Фиксированная платит масштабом (мелкое
         * колебание выглядит плоским), но не врёт про амплитуду, а на рабочем столе смотрят мельком.
         *
         * Коридор 3,9–10 показан полосой и двумя линиями: «где я относительно нормы» читается без цифр.
         * Линия темнеет к прошлому — это заменяет подписи времени, на которые здесь нет места.
         *
         * Дыры в данных рвут линию: ровная линия через полчаса молчания читается как ровный сахар.
         */
        private fun график(ctx: Context, точки: List<Pair<Long, Double>>, минШиринаDp: Int, узкий: Boolean): Bitmap {
            val плотность = ctx.resources.displayMetrics.density
            val ш = ((if (минШиринаDp > 0) минШиринаDp else 250) * плотность).toInt().coerceIn(160, 1200)
            val в = (56 * плотность).toInt()
            val bmp = Bitmap.createBitmap(ш, в, Bitmap.Config.ARGB_8888)
            if (узкий || точки.isEmpty()) return bmp
            val холст = Canvas(bmp)

            val конец = точки.maxOf { it.first }
            val начало = конец - ОКНО_МС
            val y = { значение: Double ->
                val доля = (ОСЬ_ВЕРХ - значение.coerceIn(ОСЬ_НИЗ, ОСЬ_ВЕРХ)) / (ОСЬ_ВЕРХ - ОСЬ_НИЗ)
                (доля * в).toFloat()
            }
            val x = { момент: Long ->
                (((момент - начало).toDouble() / ОКНО_МС).coerceIn(0.0, 1.0) * ш).toFloat()
            }

            val кисть = Paint(Paint.ANTI_ALIAS_FLAG)
            // Коридор полосой.
            кисть.style = Paint.Style.FILL
            кисть.color = Color.argb(20, 147, 199, 155)
            холст.drawRect(0f, y(ВЕРХ), ш.toFloat(), y(НИЗ), кисть)
            // Границы коридора.
            кисть.style = Paint.Style.STROKE
            кисть.strokeWidth = 1f * плотность
            кисть.color = Color.argb(36, 233, 233, 237)
            холст.drawLine(0f, y(ВЕРХ), ш.toFloat(), y(ВЕРХ), кисть)
            холст.drawLine(0f, y(НИЗ), ш.toFloat(), y(НИЗ), кисть)

            /* Цвет линии — по последнему значению: зона, а не «где началась». Правило то же, что
               в приложении и на баннере, иначе один и тот же цвет значил бы разное. */
            val последнее = точки.maxByOrNull { it.first }?.second ?: 0.0
            val цвет = if (последнее in НИЗ..ВЕРХ) АКЦЕНТ else if (последнее > ВЕРХ) ВЫШЕ else НИЖЕ
            кисть.strokeWidth = 2.2f * плотность
            кисть.strokeCap = Paint.Cap.ROUND
            кисть.strokeJoin = Paint.Join.ROUND

            var прошлая: Pair<Long, Double>? = null
            for (т in точки.sortedBy { it.first }.filter { it.first >= начало }) {
                val п = прошлая
                if (п != null && т.first - п.first <= РАЗРЫВ_МС) {
                    /* Прошлое тусклее настоящего: слева старое, справа свежее. */
                    val доля = ((т.first - начало).toDouble() / ОКНО_МС).coerceIn(0.0, 1.0)
                    кисть.alpha = (40 + 215 * доля).toInt().coerceIn(40, 255)
                    кисть.color = Color.argb(кисть.alpha, Color.red(цвет), Color.green(цвет), Color.blue(цвет))
                    холст.drawLine(x(п.first), y(п.second), x(т.first), y(т.second), кисть)
                }
                прошлая = т
            }

            // Точка «сейчас» — чтобы конец линии был виден и на плоском участке.
            прошлая?.let { т ->
                кисть.style = Paint.Style.FILL
                кисть.color = цвет
                холст.drawCircle(x(т.first), y(т.second), 3.2f * плотность, кисть)
            }
            return bmp
        }
    }
}
