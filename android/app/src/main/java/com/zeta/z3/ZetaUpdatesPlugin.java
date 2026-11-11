package com.zeta.z3;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "ZetaUpdates")
public class ZetaUpdatesPlugin extends Plugin {
    private static final long MAX_APK_BYTES = 128L * 1024 * 1024;
    private static final String RELEASES = "https://github.com/zeta-zx/z3/releases/download/";
    private final AtomicBoolean busy = new AtomicBoolean();

    @PluginMethod
    public void install(PluginCall call) {
        String version = call.getString("version", "");
        String digest = call.getString("digest", "");
        int size = call.getInt("size", 0);
        if (!version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") ||
            !digest.matches("[0-9a-f]{64}") || size <= 0 || size > MAX_APK_BYTES) {
            call.reject("GitHub did not provide a verified Zeta APK.");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("An update is already in progress.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())));
                    complete(call, true);
                } catch (Exception error) {
                    call.reject("Could not open Android’s install permission settings.", error);
                } finally {
                    busy.set(false);
                }
            });
            return;
        }

        bridge.execute(() -> {
            File file = null;
            try {
                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Could not create update cache.");
                file = File.createTempFile("zeta-", ".apk", directory);
                download(new URL(RELEASES + "v" + version + "/Zeta-" + version + "-android.apk"), file, size, digest);
                verifyPackage(file, version);
                File ready = new File(directory, "zeta-update.apk");
                if (!file.renameTo(ready)) throw new IOException("Could not stage the Zeta APK.");
                openInstaller(call, ready);
            } catch (Exception error) {
                busy.set(false);
                call.reject("Could not install the Zeta update: " + error.getMessage(), error);
            } finally {
                if (file != null && file.exists()) file.delete();
            }
        });
    }

    private void download(URL url, File file, long expectedSize, String expectedDigest) throws Exception {
        for (int redirects = 0; redirects < 5; redirects++) {
            if (!"https".equals(url.getProtocol()) || !Arrays.asList(
                "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com",
                "github-releases.githubusercontent.com").contains(url.getHost())) {
                throw new IOException("GitHub redirected to an unexpected download host.");
            }
            HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            try {
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    if (location == null) throw new IOException("GitHub returned an incomplete redirect.");
                    url = new URL(url, location);
                    continue;
                }
                if (status != 200) throw new IOException("GitHub returned HTTP " + status + ".");
                MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
                long size = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(file)) {
                    byte[] buffer = new byte[64 * 1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        size += count;
                        if (size > expectedSize) throw new IOException("The downloaded APK is larger than expected.");
                        sha256.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                    }
                }
                StringBuilder digest = new StringBuilder();
                for (byte value : sha256.digest()) digest.append(String.format(Locale.ROOT, "%02x", value & 0xff));
                if (size != expectedSize || !expectedDigest.contentEquals(digest)) {
                    throw new IOException("The downloaded APK does not match the GitHub release.");
                }
                return;
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException("Too many GitHub download redirects.");
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(File file, String version) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), flags);
        PackageInfo update = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (update == null || !installed.packageName.equals(update.packageName) || !version.equals(update.versionName) ||
            PackageInfoCompat.getLongVersionCode(update) <= PackageInfoCompat.getLongVersionCode(installed)) {
            throw new IOException("The APK is not a newer version of this Zeta installation.");
        }
        Set<Signature> current = signers(installed);
        if (current.isEmpty() || !current.equals(signers(update))) {
            throw new IOException("The APK signing certificate does not match this Zeta installation.");
        }
    }

    @SuppressWarnings("deprecation")
    private Set<Signature> signers(PackageInfo info) {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        return signatures == null ? new HashSet<>() : new HashSet<>(Arrays.asList(signatures));
    }

    private void openInstaller(PluginCall call, File apk) {
        getActivity().runOnUiThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(intent);
                complete(call, false);
            } catch (Exception error) {
                call.reject("Could not open the Android package installer.", error);
            } finally {
                busy.set(false);
            }
        });
    }

    private void complete(PluginCall call, boolean permissionRequired) {
        JSObject result = new JSObject();
        result.put("permissionRequired", permissionRequired);
        call.resolve(result);
    }
}
