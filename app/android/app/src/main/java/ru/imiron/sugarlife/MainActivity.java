package ru.imiron.sugarlife;

import android.graphics.Color;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;
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
        // Сторож главного потока (SugarLifeCore#236). Здесь тоже, а не только в службе: зависание
        // владелец видел при выходе из фона, то есть на этом самом экране, и следить надо с первой
        // же секунды его жизни. Повторный вызов ничего не делает.
        СторожГлавного.завести();
        завестиСторожаОтрисовщика();
        поднятьЗаставку();
    }

    /**
     * Ставим СВОЙ клиент поверх капаситоровского, наследуясь от него.
     *
     * Именно наследуясь: в `BridgeWebViewClient` живёт обработка ссылок и схем, и подменить его
     * целиком ради одного метода значило бы починить серый экран и сломать переходы.
     */
    private void завестиСторожаОтрисовщика() {
        try {
            сторожОтрисовщика = new СторожОтрисовщика(
                    getBridge(), this, () -> наВиду, () -> { снятьЗаставку(); return null; });
            getBridge().getWebView().setWebViewClient(сторожОтрисовщика);
            // Говорим, что встали. Молчание здесь читалось бы как успех, а это разные вещи: сторож
            // может не подняться, и тогда мы вернёмся к прежнему поведению, не заметив этого.
            СторожОтрисовщика.встали();
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

    /**
     * НАТИВНАЯ ЗАСТАВКА С ПОСЛЕДНИМ ЧИСЛОМ (SugarLifeCore#232).
     *
     * Человек открыл приложение с одним вопросом: какой у меня сахар. Пока Capacitor поднимает
     * страницу — секунду-две, а на слабом телефоне дольше — мы показывали ожидание. HTML-заставка
     * тут не помощник по построению: она сама живёт в том WebView, которого ещё нет.
     *
     * Рисуем системой, поверх, и снимаем по факту готовности страницы.
     *
     * Строим кодом, а не разметкой: три текстовых строки не стоят файла layout, который придётся
     * держать в согласии с этим кодом. Слова и решение «показывать ли вообще» — в
     * {@link ЗаставкаЧисла}, под тестами; здесь только показ.
     */
    private View заставка;

    private void поднятьЗаставку() {
        try {
            kotlin.Pair<String, String> слова = ЗаставкаЧисла.INSTANCE.слова(this, System.currentTimeMillis());
            // Числа нет — заставки нет. Пусто бывает честно: свежая установка, выключенный
            // мониторинг, сутки без данных. Выдуманное число было бы хуже пустоты.
            if (слова == null) {
                ЗаставкаЧисла.сказать("заставка не нужна: числа нет");
                return;
            }

            LinearLayout столбик = new LinearLayout(this);
            столбик.setOrientation(LinearLayout.VERTICAL);
            столбик.setGravity(Gravity.CENTER);
            столбик.setBackgroundColor(Color.parseColor("#12141A"));
            // Съедаем касания: под заставкой поднимается страница, и нажатия вслепую ей ни к чему.
            столбик.setClickable(true);

            TextView число = new TextView(this);
            число.setText(слова.getFirst());
            число.setTextColor(Color.parseColor("#F2F4F8"));
            число.setTextSize(TypedValue.COMPLEX_UNIT_SP, 64);
            число.setGravity(Gravity.CENTER);

            TextView подпись = new TextView(this);
            подпись.setText("ммоль/л · " + слова.getSecond());
            подпись.setTextColor(Color.parseColor("#8B93A3"));
            подпись.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            подпись.setGravity(Gravity.CENTER);

            столбик.addView(число);
            столбик.addView(подпись);

            ViewGroup корень = findViewById(android.R.id.content);
            корень.addView(столбик, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            заставка = столбик;
            /* ГОЛОС У ЗАСТАВКИ ОБЯЗАТЕЛЕН. Без записи «не показали» неотличимо от «показали и сняли
               так быстро, что человек не заметил», а это разные вещи: первое надо чинить. */
            ЗаставкаЧисла.сказать("заставка поднята: " + слова.getFirst() + " · " + слова.getSecond());
        } catch (Throwable e) {
            // Заставка — удобство, а не работа. Не поднялась — молча живём как раньше, но в журнал
            // пишем: молчание тут читалось бы как «заставки не понадобилось».
            android.util.Log.w("SugarLife", "заставка не поднялась: " + e);
        }
    }

    private void снятьЗаставку() {
        final View в = заставка;
        if (в == null) return;
        заставка = null;
        ЗаставкаЧисла.сказать("заставка снята: страница поднялась");
        runOnUiThread(() -> {
            try {
                ViewGroup р = (ViewGroup) в.getParent();
                if (р != null) р.removeView(в);
            } catch (Throwable ignored) {
            }
        });
    }
}
