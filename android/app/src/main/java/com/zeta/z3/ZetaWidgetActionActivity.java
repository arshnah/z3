package com.zeta.z3;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public class ZetaWidgetActionActivity extends Activity {
    static final String OPEN_MUSIC = "com.zeta.z3.OPEN_MUSIC_FROM_WIDGET";

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        String command = getIntent().getStringExtra("control");
        if ("toggle".equals(command) || "next".equals(command) || "previous".equals(command)) {
            PlaybackService service = PlaybackService.active;
            if (service == null || !service.widgetAction(command)) {
                ZetaPlayerPlugin.queueWidgetCommand(command);
                startActivity(new Intent(this, MainActivity.class).setAction(OPEN_MUSIC).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        }
        finish();
    }
}
