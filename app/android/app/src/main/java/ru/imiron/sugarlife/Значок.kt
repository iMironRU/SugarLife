package ru.imiron.sugarlife

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import org.json.JSONObject

/**
 САХАР ЦИФРАМИ НА ЗНАЧКЕ ПРИЛОЖЕНИЯ (SugarLife#500).
 *
 * ЗНАЧОК УМЕЕТ ТОЛЬКО ЦЕЛОЕ ЧИСЛО — ни запятой, ни единиц. Поэтому вид числа это выбор с ценой, и его
 * делает человек; список и смысл видов те же, что на айфоне (ios/App/App/Значок.swift), и меняться они
 * обязаны разом.
 *
 * ЧЕМ ANDROID ОТЛИЧАЕТСЯ, И ЭТО ВАЖНО СКАЗАТЬ ЧЕЛОВЕКУ. Своего API для числа на иконке у Android нет:
 * система рисует точку, а число — дело лаунчера. Каждый производитель придумал свой способ, и работает
 * он только у него: Samsung слушает броадкаст, Huawei — запись в свой ContentProvider, Xiaomi требует
 * рефлексии над уведомлением. Мы говорим всем, кого знаем, и молчим о том, чего не можем: где лаунчер
 * не умеет, человек увидит точку или ничего — и об этом написано на экране, а не выяснится потом.
 *
 * Ошибки здесь глушим намеренно: непонятый броадкаст — это не поломка приложения, а особенность чужой
 * оболочки, и падать из-за неё нельзя.
 */
object Значок {

    private const val TAG = "SugarLifeЗначок"
    private const val PREFS = "sugarlife"
    private const val КЛЮЧ = "sl.badge-mode"

    /** Те же имена, что в iOS и в вебе: одно слово на три платформы. */
    val ВИДЫ = listOf("выключен", "десятые", "целые", "мг")

    fun вид(ctx: Context): String =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(КЛЮЧ, "выключен") ?: "выключен"

    fun задать(ctx: Context, вид: String) {
        val значение = if (вид in ВИДЫ) вид else "выключен"
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(КЛЮЧ, значение).apply()
        if (значение == "выключен") поставить(ctx, 0)
    }

    /** Что показать на значке по показанию. null — показывать нечего. */
    fun число(вид: String, mmol: Double): Int? = when (вид) {
        "десятые" -> Math.round(mmol * 10).toInt()
        "целые" -> Math.round(mmol).toInt()
        /* 18,018 — точный коэффициент, а не «примерно 18»: округлив его сами, мы разошлись бы с любым
           другим приложением на телефоне в последнем разряде. */
        "мг" -> Math.round(mmol * 18.018).toInt()
        else -> null
    }

    /**
     * Обновить по снимку движка. Устаревшие данные ГАСЯТ значок, а не оставляют последнее число:
     * цифра без возраста выглядит текущей всегда — то же правило, что у живого баннера на iOS.
     */
    fun приСнимке(ctx: Context, json: String) {
        val вид = вид(ctx)
        if (вид == "выключен") return
        val монитор = runCatching { JSONObject(json).optJSONObject("monitor") }.getOrNull() ?: return
        val mmol = монитор.optDouble("glucoseMmol", 0.0)
        val свежо = монитор.optString("status", "") == "Live"
        val n = if (mmol > 0 && свежо) число(вид, mmol) else null
        поставить(ctx, n ?: 0)
    }

    private var показано = -1

    private fun поставить(ctx: Context, число: Int) {
        if (число == показано) return
        показано = число
        val пакет = ctx.packageName
        val класс = ctx.packageManager.getLaunchIntentForPackage(пакет)?.component?.className ?: return
        самсунгу(ctx, пакет, класс, число)
        хуавею(ctx, пакет, класс, число)
    }

    /** Samsung, Sony и часть сторонних лаунчеров понимают этот броадкаст. */
    private fun самсунгу(ctx: Context, пакет: String, класс: String, число: Int) {
        runCatching {
            ctx.sendBroadcast(Intent("android.intent.action.BADGE_COUNT_UPDATE").apply {
                putExtra("badge_count", число)
                putExtra("badge_count_package_name", пакет)
                putExtra("badge_count_class_name", класс)
            })
        }.onFailure { Log.d(TAG, "броадкаст значка не принят: $it") }
    }

    /** Huawei/Honor — записью в свой ContentProvider. Тестовый телефон владельца именно такой. */
    private fun хуавею(ctx: Context, пакет: String, класс: String, число: Int) {
        runCatching {
            val данные = Bundle().apply {
                putString("package", пакет)
                putString("class", класс)
                putInt("badgenumber", число)
            }
            ctx.contentResolver.call(
                Uri.parse("content://com.huawei.android.launcher.settings/badge/"),
                "change_badge", null, данные,
            )
        }.onFailure { Log.d(TAG, "значок Huawei не принят: $it") }
        /* ContentValues-путь тоже встречается на части прошивок EMUI; вызываем оба — лишний отказ
           ничего не стоит, а неподдержанный путь молча ничего не делает. */
        runCatching {
            ctx.contentResolver.insert(
                Uri.parse("content://com.huawei.android.launcher.settings/badge/"),
                ContentValues().apply {
                    put("package", пакет); put("class", класс); put("badgenumber", число)
                },
            )
        }.onFailure { Log.d(TAG, "значок Huawei (insert) не принят: $it") }
    }
}
