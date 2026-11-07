package com.zeta.z3;

import android.app.Activity;
import android.content.Intent;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.UUID;

/** Uses the system picker, so importing audio needs no broad storage permission. */
@CapacitorPlugin(name = "ZetaFiles")
public class ZetaFilesPlugin extends Plugin {
    private PluginCall pendingImport;

    @PluginMethod
    public void importAudio(PluginCall call) {
        if (pendingImport != null) {
            call.reject("An audio import is already open.");
            return;
        }
        pendingImport = call;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("audio/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "audioPicked");
    }

    @ActivityCallback
    private void audioPicked(PluginCall call, ActivityResult result) {
        pendingImport = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("songs", new JSArray());
            call.resolve(cancelled);
            return;
        }
        Intent data = result.getData();
        // Large files and metadata parsing belong off the activity/UI thread.
        bridge.execute(() -> {
            JSArray songs = new JSArray();
            java.util.List<File> copied = new java.util.ArrayList<>();
            try {
                int count = data.getClipData() == null ? 1 : data.getClipData().getItemCount();
                for (int i = 0; i < count; i++) {
                    Uri uri = data.getClipData() == null ? data.getData() : data.getClipData().getItemAt(i).getUri();
                    if (uri == null) continue;
                    String key = UUID.randomUUID().toString();
                    String path = "zeta/audio/" + key;
                    File file = new File(getContext().getFilesDir(), path);
                    copied.add(file);
                    if (!file.getParentFile().isDirectory() && !file.getParentFile().mkdirs()) {
                        throw new java.io.IOException("Could not create the music directory.");
                    }
                    try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                         FileOutputStream output = new FileOutputStream(file)) {
                        if (input == null) throw new java.io.IOException("Could not read the selected song.");
                        byte[] buffer = new byte[64 * 1024];
                        int read;
                        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                    MediaMetadataRetriever tags = new MediaMetadataRetriever();
                    try {
                        tags.setDataSource(file.getAbsolutePath());
                        String title = tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
                        if (title == null || title.trim().isEmpty()) title = displayName(uri);
                        String artist = tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                        String duration = tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                        String mime = tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE);
                        JSObject song = new JSObject();
                        song.put("id", "local:" + key);
                        song.put("title", title);
                        JSObject artistObject = new JSObject();
                        artistObject.put("name", artist == null ? "Unknown Artist" : artist);
                        artistObject.put("thumbnails", new JSArray());
                        JSArray artists = new JSArray();
                        artists.put(artistObject);
                        song.put("artists", artists);
                        song.put("album", JSObject.NULL);
                        song.put("duration", duration == null ? 0 : Double.parseDouble(duration) / 1000);
                        song.put("isDownloaded", true);
                        JSArray thumbnails = new JSArray();
                        byte[] artwork = tags.getEmbeddedPicture();
                        if (artwork != null && artwork.length > 0) {
                            String coverPath = "zeta/audio/" + key + ".cover";
                            File cover = new File(getContext().getFilesDir(), coverPath);
                            copied.add(cover);
                            try (FileOutputStream output = new FileOutputStream(cover)) { output.write(artwork); }
                            JSObject thumb = new JSObject();
                            // JS converts the native file URI to the WebView's local URL.
                            thumb.put("url", Uri.fromFile(cover).toString());
                            thumbnails.put(thumb);
                        }
                        song.put("thumbnails", thumbnails);
                        JSObject stored = new JSObject();
                        stored.put("song", song);
                        stored.put("file", path);
                        stored.put("mimetype", mime == null ? "audio/mpeg" : mime);
                        songs.put(stored);
                    } finally { tags.release(); }
                }
                JSObject response = new JSObject();
                response.put("songs", songs);
                call.resolve(response);
            } catch (Exception error) {
                for (File file : copied) file.delete();
                call.reject("Could not import audio: " + error.getMessage(), error);
            }
        });
    }

    private String displayName(Uri uri) {
        try (android.database.Cursor cursor = getContext().getContentResolver().query(
                uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        }
        return "Imported song";
    }
}
