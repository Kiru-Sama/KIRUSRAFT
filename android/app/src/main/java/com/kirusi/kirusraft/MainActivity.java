package com.kirusi.kirusraft;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(ProotPlugin.class);
        // v0.0.84：显式开 WebView 远程调试，供 Chrome chrome://inspect 捕获（Debug 构建）
        WebView.setWebContentsDebuggingEnabled(true);
    }
}
