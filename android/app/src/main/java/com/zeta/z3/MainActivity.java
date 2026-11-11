package com.zeta.z3;

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
}
