package com.zeta.z3;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.LinkedHashSet;

@CapacitorPlugin(name = "ZetaNearby")
public class ZetaNearbyPlugin extends Plugin {
    private static final int MAX_PACKET = 16_384;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayDeque<String> packets = new ArrayDeque<>();
    private DatagramSocket listener;

    private static boolean isNearby(InetAddress address) {
        return address instanceof Inet4Address && (address.isSiteLocalAddress() || address.isLinkLocalAddress());
    }

    @PluginMethod public synchronized void listen(PluginCall call) {
        stopListener();
        try {
            var addresses = new LinkedHashSet<String>();
            var interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                var network = interfaces.nextElement();
                if (!network.isUp()) continue;
                var ips = network.getInetAddresses();
                while (ips.hasMoreElements() && addresses.size() < 12) {
                    var address = ips.nextElement();
                    if (isNearby(address)) addresses.add(address.getHostAddress());
                }
            }
            if (addresses.isEmpty()) {
                call.reject("Connect this device to a local network to create a pairing QR.");
                return;
            }
            var socket = new DatagramSocket();
            listener = socket;
            new Thread(() -> receivePackets(socket), "zeta-nearby").start();
            handler.postDelayed(() -> {
                synchronized (this) {
                    if (listener == socket) stopListener();
                }
            }, 120_000);
            var result = new JSObject();
            result.put("addresses", new JSArray(addresses));
            result.put("port", socket.getLocalPort());
            call.resolve(result);
        } catch (IOException error) {
            call.reject("Could not listen for nearby Zeta devices.", error);
        }
    }

    private void receivePackets(DatagramSocket socket) {
        byte[] bytes = new byte[MAX_PACKET + 1];
        try {
            while (!socket.isClosed()) {
                var packet = new DatagramPacket(bytes, bytes.length);
                socket.receive(packet);
                if (packet.getLength() > MAX_PACKET || !isNearby(packet.getAddress())) continue;
                synchronized (this) {
                    if (listener == socket && packets.size() < 24) {
                        packets.add(new String(bytes, 0, packet.getLength(), StandardCharsets.US_ASCII));
                    }
                }
            }
        } catch (IOException error) {
            synchronized (this) {
                if (listener == socket) stopListener();
            }
        }
    }

    @PluginMethod public synchronized void receive(PluginCall call) {
        var result = new JSObject();
        result.put("packets", new JSArray(packets));
        packets.clear();
        call.resolve(result);
    }

    @PluginMethod public synchronized void close(PluginCall call) {
        stopListener();
        call.resolve();
    }

    private synchronized void stopListener() {
        if (listener != null) listener.close();
        listener = null;
        packets.clear();
        handler.removeCallbacksAndMessages(null);
    }

    @PluginMethod public void send(PluginCall call) {
        var addresses = call.getArray("addresses");
        int port = call.getInt("port", 0);
        String packet = call.getString("packet", "");
        if (addresses == null || addresses.length() < 1 || addresses.length() > 12 ||
            port < 1024 || port > 65535 || packet.length() > MAX_PACKET || !packet.matches("[A-Za-z0-9_.-]+")) {
            call.reject("Invalid nearby pairing destination.");
            return;
        }
        try (var socket = new DatagramSocket()) {
            byte[] bytes = packet.getBytes(StandardCharsets.US_ASCII);
            IOException failure = null;
            boolean sent = false;
            for (int index = 0; index < addresses.length(); index++) {
                String ip = addresses.optString(index);
                if (!ip.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) {
                    call.reject("Invalid nearby pairing address.");
                    return;
                }
                var address = InetAddress.getByName(ip);
                if (!isNearby(address)) {
                    call.reject("Invalid nearby pairing address.");
                    return;
                }
                try {
                    socket.send(new DatagramPacket(bytes, bytes.length, address, port));
                    sent = true;
                } catch (IOException error) {
                    failure = error;
                }
            }
            if (!sent && failure != null) throw failure;
            call.resolve();
        } catch (IOException error) {
            call.reject("Could not reach the other Zeta device.", error);
        }
    }

    @Override protected void handleOnDestroy() { stopListener(); }
}
