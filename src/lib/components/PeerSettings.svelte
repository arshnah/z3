<script lang="ts">
    import { onMount } from 'svelte';
    import QRCode from 'qrcode';
    import jsQR from 'jsqr';
    import { peers } from '$lib/state/peers.svelte';
    import { toasts } from '$lib/state/toast.svelte';
    import { client } from '$lib/ephaptic';
    import type { Song } from '$lib/schema';

    let { includeAudio }: { includeAudio: boolean } = $props();
    let code = $state('');
    let qr = $state('');
    let qrTooLarge = $state(false);
    let camera = $state<MediaStream | null>(null);
    let video = $state<HTMLVideoElement>();
    let scanFrame = 0;
    let query = $state('');
    let results = $state<Song[]>([]);
    const guest = $derived(peers.links.find((link) => !link.host && link.connected && link.mode !== 'backup'));

    $effect(() => {
        const pairing = peers.pending?.code;
        let cancelled = false;
        qr = '';
        qrTooLarge = false;
        if (pairing) void QRCode.toDataURL(pairing, { errorCorrectionLevel: 'L', scale: 6 })
            .then((value) => { if (!cancelled) qr = value; }).catch(() => { if (!cancelled) qrTooLarge = true; });
        return () => { cancelled = true; };
    });

    function stopCamera() {
        cancelAnimationFrame(scanFrame);
        camera?.getTracks().forEach((track) => track.stop());
        camera = null;
    }

    onMount(() => stopCamera);

    async function run(work: () => Promise<unknown>) {
        try { await work(); }
        catch (error) { toasts.error(error); }
    }

    async function useCode(value: string) {
        if (peers.pending?.host) await peers.finish(value);
        else await peers.join(value);
        code = '';
    }

    async function scan() {
        camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    }

    async function scanImage(file: File) {
        const image = await createImageBitmap(file);
        try {
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not read this image.');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(data, width, height)?.data;
            if (!code?.startsWith('zeta-peer:')) throw new Error('No Zeta pairing QR found in this image.');
            await useCode(code);
        } finally { image.close(); }
    }

    $effect(() => {
        const stream = camera;
        const element = video;
        if (!stream || !element) return;
        element.srcObject = stream;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let last = 0;
        function frame(now: number) {
            if (ctx && element && element.videoWidth && now - last >= 150) {
                last = now;
                // Keep small QR modules intact in the camera preview.
                const width = Math.min(element.videoWidth, 1280);
                const height = Math.round(width * element.videoHeight / element.videoWidth);
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                ctx.drawImage(element, 0, 0, canvas.width, canvas.height);
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const match = jsQR(pixels.data, pixels.width, pixels.height);
                if (match?.data.startsWith('zeta-peer:')) {
                    stopCamera();
                    void run(() => useCode(match.data));
                    return;
                }
            }
            scanFrame = requestAnimationFrame(frame);
        }
        scanFrame = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(scanFrame);
    });

    async function search() {
        if (query.trim()) results = (await client.musicSearch(query.trim(), 'yt')).slice(0, 10);
    }
</script>

<section class="card peer">
    <h2>Nearby devices</h2>
    <p class="muted">Use the same Wi-Fi. Exchange an invitation and a reply by QR or pairing code.</p>
    <div class="buttons">
        <button class="btn" disabled={!!peers.pending || peers.busy} onclick={() => run(() => peers.invite('backup', includeAudio))}>Send Zeta backup by QR</button>
        <button class="btn" disabled={!!peers.pending || peers.busy} onclick={() => run(() => peers.invite('remote'))}>Pair remote control</button>
        <button class="btn" disabled={!!peers.pending || peers.busy} onclick={() => run(() => peers.invite('party'))}>Invite to play together</button>
    </div>
    {#if peers.pending}
        <p>{peers.pending.host ? 'Scan this invitation on the other device.' : 'Scan this reply on the host.'}</p>
        {#if qr}<img src={qr} alt={peers.pending.host ? 'Pairing invitation QR code' : 'Pairing reply QR code'} />{/if}
        {#if qrTooLarge}<p class="muted">Use Copy code if this connection is too large for a QR code.</p>{/if}
        <div class="buttons">
            <button class="btn" onclick={() => run(() => navigator.clipboard.writeText(peers.pending!.code))}>Copy code</button>
            <button class="btn" onclick={() => peers.disconnect(peers.pending!.id)}>Cancel pairing</button>
        </div>
    {/if}
    {#if !peers.pending || peers.pending.host}
        <label for="peer-code">{peers.pending ? 'Reply code' : 'Invitation code'}</label>
        <textarea id="peer-code" bind:value={code} rows="2"></textarea>
        <div class="buttons">
            <button class="btn" disabled={!code.trim() || peers.busy} onclick={() => run(() => useCode(code))}>Use code</button>
            <button class="btn" onclick={() => camera ? stopCamera() : run(scan)}>{camera ? 'Close camera' : 'Scan QR'}</button>
            <label class="btn qr-image">
                Open QR image
                <input type="file" accept="image/*" aria-label="Open QR image" onchange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void run(() => scanImage(file));
                }} />
            </label>
        </div>
    {/if}
    {#if camera}<video bind:this={video} autoplay muted playsinline aria-label="QR scanner"></video>{/if}
    {#if peers.progress !== null}<progress aria-label="Backup transfer" value={peers.progress} max="1"></progress>{/if}
    {#each peers.links.filter((link) => link.connected) as link (link.id)}
        <div class="buttons">
            <span>{link.mode === 'party' ? 'Listening party' : link.mode === 'backup' ? 'Backup transfer' : 'Remote control'}</span>
            {#if link.mode === 'backup' && link.host}
                <button class="btn" disabled={peers.progress !== null} onclick={() => run(() => peers.sendBackup(link.id))}>Send backup again</button>
            {/if}
            <button class="btn" onclick={() => peers.disconnect(link.id)}>Disconnect</button>
        </div>
    {/each}
    {#if peers.links.some((link) => link.connected && link.host && link.mode === 'party')}
        <label><input type="checkbox" bind:checked={peers.partyControls} /> Let guests control playback</label>
    {/if}
    {#if guest}
        <p>{peers.remote?.song?.title ?? 'Waiting for the host to play a song'}</p>
        <div class="buttons">
            <button class="btn" onclick={() => peers.command('previous')}>Previous</button>
            <button class="btn" onclick={() => peers.command('toggle')}>{peers.remote?.paused ? 'Play' : 'Pause'}</button>
            <button class="btn" onclick={() => peers.command('next')}>Next</button>
        </div>
        {#if peers.remote?.duration}
            <label>Seek <input type="range" min="0" max={peers.remote.duration} value={peers.remote.position}
                onchange={(event) => peers.command('seek', Number(event.currentTarget.value))} /></label>
        {/if}
        <label>Volume <input type="range" min="0" max="1" step="0.01" onchange={(event) => peers.command('volume', Number(event.currentTarget.value))} /></label>
        {#if guest.mode === 'party'}
            <label><input type="checkbox" bind:checked={peers.following} /> Play along on this device</label>
            <form class="buttons" onsubmit={(event) => { event.preventDefault(); void run(search); }}>
                <input class="input" aria-label="Find a song for the party" bind:value={query} />
                <button class="btn" type="submit">Search YouTube Music</button>
            </form>
            {#each results as song (song.id)}
                <button class="btn" onclick={() => peers.queue(song)}>Add {song.title}</button>
            {/each}
        {/if}
        {#if peers.remote?.queue.length}<p class="muted">Up next: {peers.remote.queue.join(' · ')}</p>{/if}
    {/if}
</section>

<style>
    .peer { display: grid; gap: 12px; padding: 18px; }
    .buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    textarea { width: 100%; background: var(--surface-2); color: inherit; padding: 8px; }
    img, video { width: min(100%, 380px); border-radius: 8px; }
    .qr-image { position: relative; }
    .qr-image input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
    .qr-image:focus-within { outline: 2px solid currentColor; }
</style>
