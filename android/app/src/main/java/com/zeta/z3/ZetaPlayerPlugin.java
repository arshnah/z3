package com.zeta.z3;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.function.Consumer;

@CapacitorPlugin(name = "ZetaPlayer")
public class ZetaPlayerPlugin extends Plugin {
    private ListenableFuture<MediaController> connecting;
    private MediaController controller;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            emitState();
            handler.postDelayed(this, 500);
        }
    };

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            SessionToken token = new SessionToken(getContext(), new ComponentName(getContext(), PlaybackService.class));
            connecting = new MediaController.Builder(getContext(), token).buildAsync();
            connecting.addListener(() -> {
                try {
                    controller = connecting.get();
                    controller.addListener(new Player.Listener() {
                        @Override public void onEvents(Player player, Player.Events events) { emitState(); }
                        @Override public void onPlayerError(PlaybackException error) {
                            JSObject value = new JSObject();
                            value.put("message", error.getMessage());
                            value.put("id", controller.getCurrentMediaItem() == null ? "" : controller.getCurrentMediaItem().mediaId);
                            notifyListeners("playbackError", value);
                        }
                    });
                    handler.post(ticker);
                } catch (Exception error) {
                    JSObject value = new JSObject();
                    value.put("message", "Could not connect to Android playback: " + error.getMessage());
                    notifyListeners("playbackError", value, true);
                }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    private void run(PluginCall call, Consumer<MediaController> action) {
        getActivity().runOnUiThread(() -> {
            if (connecting == null) { call.reject("Android playback is starting. Try again."); return; }
            connecting.addListener(() -> {
                try { action.accept(connecting.get()); call.resolve(); }
                catch (Exception error) { call.reject("Android playback failed: " + error.getMessage(), error); }
            }, ContextCompat.getMainExecutor(getContext()));
        });
    }

    @PluginMethod
    public void setSource(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || !uri.startsWith("file://")) { call.reject("Choose a local audio file."); return; }
        run(call, player -> {
            MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .setTitle(call.getString("title", "Zeta"))
                .setArtist(call.getString("artist", ""));
            String artwork = call.getString("artwork");
            if (artwork != null && artwork.startsWith("https://")) metadata.setArtworkUri(Uri.parse(artwork));
            MediaItem item = new MediaItem.Builder().setUri(uri).setMediaId(call.getString("id", uri))
                .setMediaMetadata(metadata.build()).build();
            player.setMediaItem(item, (long) (call.getDouble("position", 0.0) * 1000));
            player.setPlayWhenReady(!call.getBoolean("paused", true));
            player.prepare();
        });
    }

    @PluginMethod public void setPaused(PluginCall call) {
        run(call, player -> { if (call.getBoolean("paused", true)) player.pause(); else player.play(); });
    }
    @PluginMethod public void seek(PluginCall call) {
        run(call, player -> player.seekTo((long) (Math.max(0, call.getDouble("position", 0.0)) * 1000)));
    }
    @PluginMethod public void setVolume(PluginCall call) {
        run(call, player -> player.setVolume((float) Math.max(0, Math.min(1, call.getDouble("volume", 1.0)))));
    }
    @PluginMethod public void clear(PluginCall call) {
        run(call, player -> { player.stop(); player.clearMediaItems(); });
    }
    @PluginMethod public void setKeepAwake(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (call.getBoolean("enabled", false)) getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    private void emitState() {
        if (controller == null || controller.getCurrentMediaItem() == null) return;
        JSObject state = new JSObject();
        state.put("id", controller.getCurrentMediaItem().mediaId);
        state.put("position", controller.getCurrentPosition() / 1000.0);
        state.put("duration", Math.max(0, controller.getDuration()) / 1000.0);
        state.put("paused", !controller.getPlayWhenReady());
        state.put("ready", controller.getPlaybackState() == Player.STATE_READY);
        state.put("ended", controller.getPlaybackState() == Player.STATE_ENDED);
        notifyListeners("state", state);
    }

    @Override
    protected void handleOnDestroy() {
        handler.removeCallbacks(ticker);
        if (connecting != null) MediaController.releaseFuture(connecting);
        controller = null;
    }
}
