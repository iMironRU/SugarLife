package ru.imiron.sugarlife;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Смерть отрисовщика WebView — беда, которую до сих пор не обрабатывал никто (SugarLifeCore#210).
     * Подробности и цена бездействия — в {@link СторожОтрисовщика}.
     */
    private СторожОтрисовщика сторожОтрисовщика;

    /** На виду ли мы сейчас: пересобирать невидимый экран значит тратить память там, где её и нет. */
    private volatile boolean наВиду = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Регистрируем нативный мост до старта Capacitor-моста (тот же плагин, что на iOS).
        registerPlugin(SugarLifeBridgePlugin.class);
        // Обновление APK в одно нажатие (#269): скачать и отдать системному установщику.
        registerPlugin(ApkUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
        завестиСторожаОтрисовщика();
    }

    /**
     * Ставим СВОЙ клиент поверх капаситоровского, наследуясь от него.
     *
     * Именно наследуясь: в `BridgeWebViewClient` живёт обработка ссылок и схем, и подменить его
     * целиком ради одного метода значило бы починить серый экран и сломать переходы.
     */
    private void завестиСторожаОтрисовщика() {
        try {
            сторожОтрисовщика = new СторожОтрисовщика(getBridge(), this, () -> наВиду);
            getBridge().getWebView().setWebViewClient(сторожОтрисовщика);
        } catch (Throwable e) {
            // Не поднялся — приложение работает как раньше. Молчать нельзя: без строки в журнале
            // отсутствие сторожа неотличимо от того, что беда просто не случалась.
            android.util.Log.w("SugarLife", "сторож отрисовщика не встал: " + e);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        наВиду = true;
        /* Отрисовщик мог умереть, пока нас не было видно: тогда экран пересобираем СЕЙЧАС, в тот
           момент, когда человек на него смотрит, — а не в фоне, где память и так кончилась. */
        if (сторожОтрисовщика != null && сторожОтрисовщика.нуженПодъём()) {
            сторожОтрисовщика.поднятьЭкран();
        }
    }

    @Override
    public void onPause() {
        наВиду = false;
        super.onPause();
    }
}
