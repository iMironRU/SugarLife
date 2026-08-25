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

    companion object {
        private const val TAG = "SugarLifeВиджет"
        private const val НАСТРОЙКИ = "sugarlife-widget"
        private const val К_САХАР = "mmol"
        private const val К_КОГДА = "at"
        private const val К_ТРЕНД = "trend"
        private const val К_СЫРОЕ = "raw"
        private const val К_ИНСУЛИН = "iob"
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
        private const val РАЗРЫВ_МС = 12 * 60 * 1000L

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
                .putString(К_РЯД, дописатьРяд(ctx, сахар, monitor.optLong("latestAtMs", System.currentTimeMillis())))
                .apply()
            обновитьВсе(ctx)
        }

        private fun инсулинИз(monitor: JSONObject): String {
            if (monitor.isNull("confirmedIOB")) return ""
            val иоб = monitor.optDouble("confirmedIOB")
            if (иоб.isNaN() || иоб <= 0.05) return ""
            return "инс. " + "%.1f".format(иоб).replace('.', ',') + " ед"
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
            return точки.sortedBy { it.first }.joinToString(",") { it.first.toString() + ":" + it.second }
        }

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
            } else {
                val стрелка = стрелкаТренда(н.getString(К_ТРЕНД, "") ?: "")
                val устарело = System.currentTimeMillis() - когда > 15 * 60 * 1000L
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
                val осталось = когда + ШАГ_МС - System.currentTimeMillis()
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
                val сырое = if (н.getBoolean(К_СЫРОЕ, false)) "сырое" else ""
                val иоб = н.getString(К_ИНСУЛИН, "") ?: ""
                в.setTextViewText(R.id.sugar_sub, listOf(сырое, иоб).filter { it.isNotEmpty() }.joinToString(" · "))
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
