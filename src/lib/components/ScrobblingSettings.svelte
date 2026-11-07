<script lang="ts">
    import { onMount } from 'svelte';
    import { client } from '$lib/ephaptic';
    import Icon from './Icon.svelte';
    import { toasts } from '$lib/state/toast.svelte';
    import type { ScrobbleProvider } from '$lib/scrobbling/service';

    let status = $state<Awaited<ReturnType<typeof client.scrobbleStatus>> | null>(null);
    let token = $state('');
    let busy = $state(false);

    async function load() { status = await client.scrobbleStatus(); }
    async function run(action: () => Promise<unknown>) {
        busy = true;
        try { await action(); await load(); }
        catch (error) { toasts.error(error); }
        finally { busy = false; }
    }
    async function connectLastfm() {
        const url = await client.scrobbleLastfmStart();
        await load();
        await client.openScrobblingLink(url);
    }
    async function disconnect(provider: ScrobbleProvider) { await client.scrobbleDisconnect(provider); }
    onMount(() => { void load().catch((error) => toasts.error(error)); });
</script>

<section class="scrobbling">
    <h2><Icon name="radio" /> Scrobbling</h2>
    <p class="intro muted">Connect your accounts to send now-playing updates and listening history. A listen counts after half a song or four minutes, for songs longer than 30 seconds. Offline listens wait here until you reconnect.</p>
    <div class="card account">
        <div class="account-head"><strong>Last.fm</strong><span class="badge">{status?.lastfm.connected ? status.lastfm.username : 'Not connected'}</span></div>
        {#if status?.lastfm.connected}
            <div class="toggle-row">
                <span>Scrobble to Last.fm</span>
                <button class="switch" role="switch" aria-label="Scrobble to Last.fm" aria-checked={status.lastfm.enabled} disabled={busy}
                    onclick={() => run(() => client.scrobbleSetEnabled('lastfm', !status!.lastfm.enabled))}></button>
            </div>
            <button class="btn" disabled={busy} onclick={() => run(() => disconnect('lastfm'))}>Disconnect Last.fm</button>
        {:else if status?.lastfm.pending}
            <p class="muted">Approve Zeta in your browser, then return here to finish connecting.</p>
            <div class="buttons">
                <button class="btn btn-primary" disabled={busy} onclick={() => run(() => client.scrobbleLastfmFinish())}>Finish connecting</button>
                <button class="btn" disabled={busy} onclick={() => run(connectLastfm)}>Restart authorization</button>
            </div>
        {:else}
            <p class="muted">Authorize Zeta in Last.fm. Your password stays in your browser.</p>
            <button class="btn" disabled={busy || !status?.lastfm.configured} onclick={() => run(connectLastfm)}><Icon name="external-link" /> Connect Last.fm</button>
            {#if status && !status.lastfm.configured}<small class="subtle">Last.fm is not configured in this build.</small>{/if}
        {/if}
        {#if status?.lastfm.queued}<small class="subtle">{status.lastfm.queued} listens waiting to sync</small>{/if}
        {#if status?.lastfm.error}<p class="error" role="status">{status.lastfm.error}</p>{/if}
    </div>
    <div class="card account">
        <div class="account-head"><strong>ListenBrainz</strong><span class="badge">{status?.listenbrainz.connected ? status.listenbrainz.username : 'Not connected'}</span></div>
        {#if status?.listenbrainz.connected}
            <div class="toggle-row">
                <span>Scrobble to ListenBrainz</span>
                <button class="switch" role="switch" aria-label="Scrobble to ListenBrainz" aria-checked={status.listenbrainz.enabled} disabled={busy}
                    onclick={() => run(() => client.scrobbleSetEnabled('listenbrainz', !status!.listenbrainz.enabled))}></button>
            </div>
            <button class="btn" disabled={busy} onclick={() => run(() => disconnect('listenbrainz'))}>Disconnect ListenBrainz</button>
        {:else}
            <p class="muted">Use the personal user token from your ListenBrainz account.</p>
            <label for="listenbrainz-token">User token</label>
            <input id="listenbrainz-token" class="input" type="password" autocomplete="off" placeholder="ListenBrainz user token" bind:value={token} disabled={busy} />
            <div class="buttons">
                <button class="btn btn-primary" disabled={busy || !token.trim()} onclick={() => run(async () => { await client.scrobbleListenbrainzConnect(token); token = ''; })}>Connect ListenBrainz</button>
                <button class="btn" disabled={busy} onclick={() => run(() => client.openScrobblingLink('https://listenbrainz.org/settings/'))}><Icon name="external-link" /> Get user token</button>
            </div>
        {/if}
        {#if status?.listenbrainz.queued}<small class="subtle">{status.listenbrainz.queued} listens waiting to sync</small>{/if}
        {#if status?.listenbrainz.error}<p class="error" role="status">{status.listenbrainz.error}</p>{/if}
    </div>
    <button class="btn" disabled={busy} onclick={() => run(() => client.scrobbleRetry())}><Icon name="refresh-cw" /> {busy ? 'Working…' : 'Retry pending listens'}</button>
</section>

<style>
    .scrobbling { margin-top: 26px; }
    h2 { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--text-2); margin: 0 0 10px 4px; }
    h2 :global(svg) { width: 17px; height: 17px; }
    .intro { margin: 0 4px 14px; line-height: 1.6; }
    .account { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px; margin-bottom: 12px; }
    .account-head, .toggle-row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .account-head strong { font-size: 17px; }
    .buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    .input { width: 100%; }
    .error { color: var(--danger); overflow-wrap: anywhere; }
</style>
