package com.zeta.z3;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import androidx.media3.common.Player;

public class ZetaPlaybackWidget extends AppWidgetProvider {
    private static final String CONTROL = "com.zeta.z3.WIDGET_CONTROL";

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        if (PlaybackService.active != null) PlaybackService.active.updateWidget();
        else refresh(context, null);
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (CONTROL.equals(intent.getAction()) && PlaybackService.active != null) {
            PlaybackService.active.widgetAction(intent.getStringExtra("control"));
        }
    }

    static void refresh(Context context, Player player) {
        var manager = AppWidgetManager.getInstance(context);
        var component = new ComponentName(context, ZetaPlaybackWidget.class);
        if (manager.getAppWidgetIds(component).length == 0) return;
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.zeta_widget);
        var metadata = player == null ? null : player.getMediaMetadata();
        view.setTextViewText(R.id.widget_title, metadata != null && metadata.title != null ? metadata.title : "Zeta");
        view.setTextViewText(R.id.widget_artist, metadata != null && metadata.artist != null ? metadata.artist : "Open Zeta to play music");
        view.setImageViewResource(R.id.widget_toggle, player != null && player.getPlayWhenReady()
            ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        view.setOnClickPendingIntent(R.id.widget_title, PendingIntent.getActivity(context, 0, new Intent(context, MainActivity.class), flags));
        int[] buttons = { R.id.widget_previous, R.id.widget_toggle, R.id.widget_next };
        String[] actions = { "previous", "toggle", "next" };
        for (int index = 0; index < buttons.length; index++) {
            var intent = new Intent(context, ZetaPlaybackWidget.class).setAction(CONTROL).putExtra("control", actions[index]);
            view.setOnClickPendingIntent(buttons[index], PendingIntent.getBroadcast(context, index, intent, flags));
        }
        manager.updateAppWidget(component, view);
    }
}
