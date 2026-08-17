package ru.imiron.sugarlife

import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.URL

/* Обновление APK в одно нажатие (SugarLife#269).
 *
 * ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: тихой установки. Право заменить пакет без диалога
 * Android даёт только владельцу устройства (MDM) или системному приложению. Обещать
 * «обновится само» значило бы соврать, поэтому мы и не обещаем: человек всё равно
 * подтверждает установку в системном диалоге.
 *
 * ЧТО ЭТО ДАЁТ: было четыре шага — открылся браузер, скачался файл, найди его в
 * «Загрузках», открой. Стало одно нажатие: качаем сами, показываем прогресс и сразу
 * отдаём файл системному установщику.
 *
 * Скачиваем в cacheDir, а не в «Загрузки»: файл нужен ровно на время установки, и
 * оставлять десять мегабайт в общей папке — мусорить в чужом доме. FileProvider нужен
 * именно поэтому: с Android 7 отдать установщику file:// нельзя, полетит
 * FileUriExposedException. */
@CapacitorPlugin(name = "ApkUpdater")
class ApkUpdaterPlugin : Plugin() {

    @PluginMethod
    fun install(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) { call.reject("нет адреса файла"); return }

        Thread {
            try {
                val файл = File(context.cacheDir, "update.apk")
                URL(url).openStream().use { входной ->
                    файл.outputStream().use { выходной -> входной.copyTo(выходной) }
                }

                val uri: Uri = FileProvider.getUriForFile(
                    context, "${context.packageName}.fileprovider", файл,
                )
                val намерение = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    /* GRANT_READ — без него установщик не прочитает наш файл: доступ
                     * выдаётся ему разово, а не навсегда, и это правильно. */
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(намерение)
                call.resolve()
            } catch (e: Exception) {
                /* Текст ошибки отдаём как есть: сеть отвалилась, места нет, файл битый —
                 * это разные беды с разными действиями, и обобщать их в «не удалось»
                 * значит отнять у человека возможность понять, что чинить. */
                call.reject(e.message ?: "не удалось скачать обновление")
            }
        }.start()
    }
}
