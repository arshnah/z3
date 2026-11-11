import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { INVITE_LIFETIME, isNearbyAddress, PAIRING_PACKET_LIMIT } from '../../src/lib/nearby-pairing';

type Listener = { socket: Socket; packets: string[]; timer: ReturnType<typeof setTimeout> };
let listener: Listener | undefined;

function close() {
    const current = listener;
    listener = undefined;
    if (current) {
        clearTimeout(current.timer);
        current.socket.close();
    }
}

export const nearbyRoutes = {
    async nearbyListen() {
        close();
        const addresses = [...new Set(Object.values(networkInterfaces()).flatMap((entries) =>
            (entries ?? []).filter(({ family, address }) => family === 'IPv4' && isNearbyAddress(address)).map(({ address }) => address),
        ))].slice(0, 12);
        if (!addresses.length) throw new Error('Connect this device to a local network to create a pairing QR.');
        const socket = createSocket('udp4');
        await new Promise<void>((resolve, reject) => {
            socket.once('error', reject);
            socket.bind(0, '0.0.0.0', () => {
                socket.removeListener('error', reject);
                resolve();
            });
        }).catch((error) => { socket.close(); throw error; });
        const current: Listener = { socket, packets: [], timer: setTimeout(close, INVITE_LIFETIME) };
        listener = current;
        socket.on('error', () => { if (listener === current) close(); });
        socket.on('message', (packet, remote) => {
            if (packet.length <= PAIRING_PACKET_LIMIT && isNearbyAddress(remote.address) && current.packets.length < 24) {
                current.packets.push(packet.toString('ascii'));
            }
        });
        return { addresses, port: socket.address().port };
    },
    async nearbyReceive(): Promise<string[]> { return listener?.packets.splice(0) ?? []; },
    async nearbyClose(): Promise<void> { close(); },
    async nearbySend(addresses: string[], port: number, packet: string): Promise<void> {
        if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Array.isArray(addresses) ||
            !addresses.length || addresses.length > 12 || addresses.some((ip) => typeof ip !== 'string' || !isNearbyAddress(ip)) ||
            typeof packet !== 'string' || packet.length > PAIRING_PACKET_LIMIT || !/^[\w.-]+$/.test(packet)) {
            throw new Error('Invalid nearby pairing destination.');
        }
        const socket = createSocket('udp4');
        try {
            await Promise.all(addresses.map((address) => new Promise<void>((resolve) => {
                socket.send(packet, port, address, () => resolve());
            })));
        } finally { socket.close(); }
    },
};
