package com.zeta.z3;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZetaFilesPlugin.class);
        registerPlugin(ZetaMediaDownloadPlugin.class);
        registerPlugin(ZetaBackupsPlugin.class);
        registerPlugin(ZetaNearbyPlugin.class);
        registerPlugin(ZetaUpdatesPlugin.class);
        registerPlugin(ZetaPlayerPlugin.class);
        registerPlugin(ZetaVerificationPlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setBackgroundColor(android.graphics.Color.rgb(7, 6, 11));
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent == null || !ZetaWidgetActionActivity.OPEN_MUSIC.equals(intent.getAction()) || getBridge() == null) return;
        var view = getBridge().getWebView();
        String current = view.getUrl();
        String path = current == null ? null : Uri.parse(current).getPath();
        if (path != null && (path.equals("/music") || path.startsWith("/music/"))) return;
        view.loadUrl(Uri.parse(getBridge().getAppUrl()).buildUpon().path("/music").build().toString());
    }
}
