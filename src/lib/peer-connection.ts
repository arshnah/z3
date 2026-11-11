export type PeerMode = 'backup' | 'remote' | 'party';
type Signal = { mode: PeerMode; type: 'offer' | 'answer'; sdp: string };

const PREFIX = 'zeta-peer:1:';
const MAX_SIGNAL = 24_000;

async function encodeSignal(signal: Signal): Promise<string> {
    const stream = new Blob([JSON.stringify(signal)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeSignal(code: string): Promise<Signal> {
    const value = code.trim();
    if (!value.startsWith(PREFIX) || value.length > MAX_SIGNAL) throw new Error('This is not a Zeta pairing code.');
    try {
        const bytes = Uint8Array.from(atob(value.slice(PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
        const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        let json = '';
        const decoder = new TextDecoder();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            json += decoder.decode(value, { stream: true });
            if (json.length > MAX_SIGNAL) {
                await reader.cancel();
                throw new Error();
            }
        }
        const signal = JSON.parse(json + decoder.decode()) as Signal;
        if (!['backup', 'remote', 'party'].includes(signal.mode) || !['offer', 'answer'].includes(signal.type) ||
            typeof signal.sdp !== 'string' || !signal.sdp.startsWith('v=0')) throw new Error();
        return signal;
    } catch {
        throw new Error('The pairing code is invalid or incomplete.');
    }
}

async function gather(peer: RTCPeerConnection) {
    if (peer.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
        const finish = () => {
            clearTimeout(timeout);
            peer.removeEventListener('icegatheringstatechange', change);
            resolve();
        };
        const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
        const timeout = setTimeout(finish, 4000);
        peer.addEventListener('icegatheringstatechange', change);
    });
}

export async function createPeer(
    mode: PeerMode,
    onChannel: (channel: RTCDataChannel) => void,
    offer?: Signal,
): Promise<{ peer: RTCPeerConnection; code: string }> {
    const peer = new RTCPeerConnection({ iceServers: [] });
    try {
        if (offer) {
            if (offer.type !== 'offer' || offer.mode !== mode) throw new Error('Use the invitation code to join.');
            peer.addEventListener('datachannel', ({ channel }) => onChannel(channel), { once: true });
            await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
            await peer.setLocalDescription(await peer.createAnswer());
        } else {
            onChannel(peer.createDataChannel('zeta', { ordered: true }));
            await peer.setLocalDescription(await peer.createOffer());
        }
        await gather(peer);
        const sdp = peer.localDescription?.sdp;
        if (!sdp) throw new Error('Could not create a pairing code.');
        return { peer, code: await encodeSignal({ mode, sdp, type: offer ? 'answer' : 'offer' }) };
    } catch (error) {
        peer.close();
        throw error;
    }
}

export async function acceptPeer(peer: RTCPeerConnection, mode: PeerMode, code: string) {
    const reply = await decodeSignal(code);
    if (reply.type !== 'answer' || reply.mode !== mode) throw new Error('Use the reply from the device that joined this invitation.');
    await peer.setRemoteDescription({ type: 'answer', sdp: reply.sdp });
}

export async function sendPeerBytes(channel: RTCDataChannel, bytes: Uint8Array, progress: (fraction: number) => void) {
    const chunkSize = 16 * 1024;
    channel.bufferedAmountLowThreshold = 128 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        if (channel.readyState !== 'open') throw new Error('The other device disconnected.');
        if (channel.bufferedAmount > 512 * 1024) {
            await new Promise<void>((resolve, reject) => {
                const finish = (error?: Error) => {
                    clearTimeout(timeout);
                    channel.removeEventListener('bufferedamountlow', drained);
                    channel.removeEventListener('close', closed);
                    if (error) reject(error); else resolve();
                };
                const drained = () => finish();
                const closed = () => finish(new Error('The other device disconnected.'));
                const timeout = setTimeout(() => finish(new Error('The transfer stalled.')), 15_000);
                channel.addEventListener('bufferedamountlow', drained, { once: true });
                channel.addEventListener('close', closed, { once: true });
            });
        }
        const chunk = Uint8Array.from(bytes.subarray(offset, offset + chunkSize));
        channel.send(chunk.buffer);
        progress((offset + chunk.length) / bytes.length);
    }
}
