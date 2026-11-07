package com.zeta.z3;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "ZetaVerification")
public class ZetaVerificationPlugin extends Plugin {
    private WebView webview;
    private boolean initializing;
    private boolean ready;
    private final Map<String, PluginCall> calls = new HashMap<>();
    private final Map<String, JSObject> waiting = new HashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());

    @PluginMethod public void mint(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = UUID.randomUUID().toString();
            calls.put(id, call);
            waiting.put(id, call.getData());
            handler.postDelayed(() -> complete(id, "", "YouTube verification timed out. Try again."), 30000);
            if (ready) dispatch(id);
            else if (!initializing) initialize(call.getString("userAgent"));
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void initialize(String userAgent) {
        initializing = true;
        bridge.execute(() -> {
            try (java.io.InputStream input = getContext().getAssets().open("public/verification.js")) {
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[8192]; int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                String script = output.toString(StandardCharsets.UTF_8.name());
                getActivity().runOnUiThread(() -> {
                    webview = new WebView(getContext());
                    webview.getSettings().setJavaScriptEnabled(true);
                    webview.getSettings().setDomStorageEnabled(true);
                    webview.getSettings().setUserAgentString(userAgent);
                    webview.addJavascriptInterface(new Object() {
                        @JavascriptInterface public void complete(String id, String token, String error) {
                            handler.post(() -> ZetaVerificationPlugin.this.complete(id, token, error));
                        }
                    }, "ZetaVerification");
                    webview.setWebViewClient(new WebViewClient() {
                        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
                        @Override public void onPageFinished(WebView view, String url) {
                            view.evaluateJavascript(script, unused -> {
                                ready = true;
                                for (String id : new java.util.ArrayList<>(waiting.keySet())) dispatch(id);
                            });
                        }
                    });
                    // Bundled code only; the VM gets its expected origin without
                    // navigating the app or modifying its JavaScript globals.
                    webview.loadDataWithBaseURL("https://www.youtube.com/", "<!doctype html><html lang='en'><head><title></title></head><body></body></html>", "text/html", "UTF-8", null);
                });
            } catch (Exception error) {
                handler.post(() -> {
                    initializing = false;
                    for (String id : new java.util.ArrayList<>(calls.keySet())) complete(id, "", error.getMessage());
                });
            }
        });
    }

    private void dispatch(String id) {
        JSObject options = waiting.remove(id);
        if (options != null && calls.containsKey(id)) webview.evaluateJavascript("window.zetaVerify(" + org.json.JSONObject.quote(id) + "," + options + ")", null);
    }

    private void complete(String id, String token, String error) {
        PluginCall call = calls.remove(id);
        waiting.remove(id);
        if (call == null) return;
        if (token == null || token.isEmpty()) call.reject(error == null ? "YouTube verification failed." : error);
        else { JSObject value = new JSObject(); value.put("token", token); call.resolve(value); }
    }

    @Override protected void handleOnDestroy() {
        handler.removeCallbacksAndMessages(null);
        for (String id : new java.util.ArrayList<>(calls.keySet())) complete(id, "", "Verification closed.");
        if (webview != null) getActivity().runOnUiThread(() -> { webview.destroy(); webview = null; });
    }
}
