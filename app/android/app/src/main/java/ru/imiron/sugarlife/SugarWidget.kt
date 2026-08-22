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

        /** Ниже и выше этих чисел кольцо краснеет. Те же границы, что в приложении. */
        private const val НИЗ = 3.9
        private const val ВЕРХ = 10.0
        /** Шкала кольца: от 2 до 22 ммоль — полный круг. */
        private const val ШКАЛА_НИЗ = 2.0
        private const val ШКАЛА_ВЕРХ = 22.0

        private const val ЗЕЛЁНЫЙ = 0xFF93C79B.toInt()
        private const val КРАСНЫЙ = 0xFFC96B7A.toInt()

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
                .apply()
            обновитьВсе(ctx)
        }

        private fun инсулинИз(monitor: JSONObject): String {
            if (monitor.isNull("confirmedIOB")) return ""
            val иоб = monitor.optDouble("confirmedIOB")
            if (иоб.isNaN() || иоб <= 0.0) return ""
            return "инсулин " + "%.1f".format(иоб).replace('.', ',') + " ед"
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

            /* Показания не было ни разу — прочерк и честная подпись. Ноль здесь означал бы
               гипогликемию, а пустое кольцо без слов — что приложение сломалось. */
            if (сахар <= 0.0 || когда <= 0L) {
                в.setTextViewText(R.id.sugar_value, "—")
                в.setTextViewText(R.id.sugar_sub, "нет показаний")
                в.setViewVisibility(R.id.sugar_age, android.view.View.GONE)
                в.setImageViewBitmap(R.id.sugar_ring, кольцо(ctx, null))
            } else {
                val стрелка = стрелкаТренда(н.getString(К_ТРЕНД, "") ?: "")
                в.setTextViewText(R.id.sugar_value, "%.1f".format(сахар).replace('.', ',') + стрелка)
                в.setImageViewBitmap(R.id.sugar_ring, кольцо(ctx, сахар))
                в.setViewVisibility(R.id.sugar_age, android.view.View.VISIBLE)
                /* Отсчёт ведёт лаунчер: база — момент показания, переведённый в часы работы системы.
                   Дальше он идёт сам, и наша остановка на него не влияет. */
                в.setChronometer(
                    R.id.sugar_age,
                    SystemClock.elapsedRealtime() - (System.currentTimeMillis() - когда),
                    null,
                    true,
                )
                val сырое = if (н.getBoolean(К_СЫРОЕ, false)) "сырое" else ""
                val иоб = н.getString(К_ИНСУЛИН, "") ?: ""
                в.setTextViewText(R.id.sugar_sub, listOf(сырое, иоб).filter { it.isNotEmpty() }.joinToString(" · "))
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
         * Кольцо-шкала: дуга — положение сахара между 2 и 22 ммоль, цвет — в диапазоне он или нет,
         * тусклый сектор — целевой диапазон. Правило то же, что в круге на экране «Сегодня».
         */
        private fun кольцо(ctx: Context, сахар: Double?): Bitmap {
            val плотность = ctx.resources.displayMetrics.density
            val сторона = (108 * плотность).toInt().coerceAtLeast(96)
            val толщина = 10 * плотность
            val bmp = Bitmap.createBitmap(сторона, сторона, Bitmap.Config.ARGB_8888)
            val холст = Canvas(bmp)
            val поле = RectF(
                толщина / 2f, толщина / 2f,
                сторона - толщина / 2f, сторона - толщина / 2f,
            )
            val кисть = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = толщина
                strokeCap = Paint.Cap.ROUND
            }
            // дорожка
            кисть.color = Color.argb(38, 255, 255, 255)
            холст.drawArc(поле, -90f, 360f, false, кисть)
            // целевой диапазон
            кисть.color = Color.argb(56, 147, 199, 155)
            val сНиз = доля(НИЗ) * 360f
            холст.drawArc(поле, -90f + сНиз, (доля(ВЕРХ) - доля(НИЗ)) * 360f, false, кисть)
            // значение
            if (сахар != null) {
                кисть.color = if (сахар in НИЗ..ВЕРХ) ЗЕЛЁНЫЙ else КРАСНЫЙ
                холст.drawArc(поле, -90f, доля(сахар) * 360f, false, кисть)
            }
            return bmp
        }

        private fun доля(в: Double): Float =
            (((в - ШКАЛА_НИЗ) / (ШКАЛА_ВЕРХ - ШКАЛА_НИЗ)).coerceIn(0.0, 1.0)).toFloat()
    }
}
