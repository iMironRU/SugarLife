package ru.imiron.sugarlife;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Регистрируем нативный мост до старта Capacitor-моста (тот же плагин, что на iOS).
        registerPlugin(SugarLifeBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
