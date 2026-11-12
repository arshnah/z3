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
    let openingCamera = $state(false);
    let joining = $state(false);
    let cameraRequest = 0;
    let query = $state('');
    let results = $state<Song[]>([]);
    const guest = $derived(peers.links.find((link) => !link.host && link.connected && link.mode !== 'backup'));

    $effect(() => {
        const pairing = peers.pending?.code;
        let cancelled = false;
        qr = '';
        qrTooLarge = false;
        if (pairing) void QRCode.toDataURL(pairing, { errorCorrectionLevel: 'M', scale: 6, margin: 5 })
            .catch(() => QRCode.toDataURL(pairing, { errorCorrectionLevel: 'L', scale: 6, margin: 5 }))
            .then((value) => { if (!cancelled) qr = value; }).catch(() => { if (!cancelled) qrTooLarge = true; });
        return () => { cancelled = true; };
    });

    function stopCamera() {
        cameraRequest++;
        openingCamera = false;
        camera?.getTracks().forEach((track) => track.stop());
        camera = null;
    }

    onMount(() => stopCamera);

    async function run(work: () => Promise<unknown>) {
        try { await work(); }
        catch (error) { toasts.error(error); }
    }

    async function useCode(value: string) {
        if (joining || !value.trim()) return;
        joining = true;
        stopCamera();
        try {
            await peers.join(value.replace(/\s/g, ''));
            code = '';
        } finally { joining = false; }
    }

    function invite(mode: 'backup' | 'remote' | 'party') {
        stopCamera();
        return run(() => peers.invite(mode, includeAudio));
    }

    async function scan() {
        const request = ++cameraRequest;
        openingCamera = true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false,
            });
            if (request === cameraRequest) camera = stream;
            else stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
            if (request === cameraRequest) throw error;
        } finally {
            if (request === cameraRequest) openingCamera = false;
        }
    }

    function readQr(ctx: CanvasRenderingContext2D, source: CanvasImageSource,
        width: number, height: number, crop: number, resolution: number) {
        const square = Math.round(Math.min(width, height) * crop);
        const w = crop ? square : width;
        const h = crop ? square : height;
        const scale = Math.min(1, resolution / Math.max(w, h));
        const outWidth = Math.max(1, Math.round(w * scale));
        const outHeight = Math.max(1, Math.round(h * scale));
        const canvas = ctx.canvas;
        if (canvas.width !== outWidth || canvas.height !== outHeight) {
            canvas.width = outWidth;
            canvas.height = outHeight;
        }
        ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h, 0, 0, outWidth, outHeight);
        const { data } = ctx.getImageData(0, 0, outWidth, outHeight);
        const match = jsQR(data, outWidth, outHeight, { inversionAttempts: 'dontInvert' });
        return match?.data.startsWith('zeta-peer:') ? match.data : undefined;
    }

    async function scanImage(file: File) {
        const image = await createImageBitmap(file);
        try {
            const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('Could not read this image.');
            const match = readQr(ctx, image, image.width, image.height, 0, 1600)
                ?? readQr(ctx, image, image.width, image.height, 0.82, 1200)
                ?? readQr(ctx, image, image.width, image.height, 0, 1000);
            if (!match) throw new Error('No Zeta pairing QR found in this image.');
            await useCode(match);
        } finally { image.close(); }
    }

    $effect(() => {
        const stream = camera;
        const element = video;
        if (!stream || !element) return;
        element.srcObject = stream;
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        let frameId: number;
        let last = 0;
        let attempt = 0;
        // Try native detail in the center as well as the full frame at two scales.
        const views = [[0.8, 1200], [0, 1280], [0, 900], [0.6, 960]];
        function frame(now: number) {
            if (element && ctx && element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - last >= 150) {
                last = now;
                const [crop, resolution] = views[attempt++ % views.length];
                const match = readQr(ctx, element, element.videoWidth, element.videoHeight, crop, resolution);
                if (match) {
                    void run(() => useCode(match));
                    return;
                }
            }
            frameId = requestAnimationFrame(frame);
        }
        frameId = requestAnimationFrame(frame);
        return () => {
            cancelAnimationFrame(frameId);
            element.srcObject = null;
        };
    });

    async function search() {
        if (query.trim()) results = (await client.musicSearch(query.trim(), 'yt')).slice(0, 10);
    }
</script>

<section class="card peer">
    <h2>Nearby devices</h2>
    <p class="muted">Use the same local network. Scan the invitation once or paste its code.</p>
    <div class="buttons">
        <button class="btn" disabled={!!peers.pending || peers.busy || joining} onclick={() => invite('backup')}>Send Zeta backup by QR</button>
        <button class="btn" disabled={!!peers.pending || peers.busy || joining} onclick={() => invite('remote')}>Pair remote control</button>
        <button class="btn" disabled={!!peers.pending || peers.busy || joining} onclick={() => invite('party')}>Invite to play together</button>
    </div>
    {#if peers.pending}
        <p role="status">{peers.pending.host ? 'Scan this invitation on the other device.' : 'Connecting to the host…'}</p>
        {#if qr}<img src={qr} alt="Pairing invitation QR code" />{/if}
        {#if qrTooLarge}<p class="muted">Use Copy code if this connection is too large for a QR code.</p>{/if}
        <div class="buttons">
            {#if peers.pending.code}
                <button class="btn" onclick={() => run(() => navigator.clipboard.writeText(peers.pending!.code!))}>Copy code</button>
            {/if}
            <button class="btn" onclick={() => peers.disconnect(peers.pending!.id)}>Cancel pairing</button>
        </div>
    {/if}
    {#if !peers.pending && !joining}
        <form class="invitation" onsubmit={(event) => { event.preventDefault(); void run(() => useCode(code)); }}>
            <label for="peer-code">Invitation code</label>
            <div class="code-row">
                <input class="input" id="peer-code" type="text" bind:value={code} placeholder="Paste invitation code"
                    spellcheck={false} autocomplete="off" autocapitalize="off" />
                <button class="btn" type="submit" disabled={!code.trim() || peers.busy}>Join</button>
            </div>
        </form>
        <div class="buttons">
            <button class="btn" onclick={() => camera || openingCamera ? stopCamera() : run(scan)}>
                {camera ? 'Close camera' : openingCamera ? 'Cancel camera' : 'Scan QR'}
            </button>
            <label class="btn qr-image">
                Open QR image
                <input type="file" accept="image/*" aria-label="Open QR image" onchange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void run(() => scanImage(file));
                }} />
            </label>
        </div>
    {:else if joining && !peers.pending}
        <p role="status">Connecting to the host…</p>
    {/if}
    {#if camera}
        <div class="scanner">
            <video bind:this={video} autoplay muted playsinline aria-label="QR scanner"></video>
            <div class="viewfinder" aria-hidden="true"></div>
        </div>
        <p class="muted">Fit the whole QR code inside the frame and hold steady.</p>
    {/if}
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
    .invitation { display: grid; gap: 6px; min-width: 0; }
    .invitation label { color: var(--text-2); font-weight: 650; }
    .code-row { display: flex; align-items: center; gap: 8px; }
    .code-row .input { flex: 1; min-width: 0; }
    img {
        width: min(100%, 440px);
        border-radius: var(--r-sm);
        image-rendering: pixelated;
    }
    .scanner {
        position: relative;
        display: grid;
        place-items: center;
        width: min(100%, 440px);
        aspect-ratio: 4 / 3;
        overflow: hidden;
        border-radius: var(--r-md);
        background: var(--bg);
    }
    video { width: 100%; height: 100%; object-fit: cover; }
    .viewfinder {
        position: absolute;
        height: 78%;
        max-width: 85%;
        aspect-ratio: 1;
        border: 2px solid white;
        border-radius: var(--r-sm);
        box-shadow: 0 0 0 50vmax rgb(0 0 0 / 0.36);
        pointer-events: none;
    }
    .qr-image { position: relative; }
    .qr-image input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
    .qr-image:focus-within { outline: 2px solid currentColor; }
</style>
