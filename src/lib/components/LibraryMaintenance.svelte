<script lang="ts">
    import { client } from '$lib/ephaptic';
    import { duplicateSongs, formatStorage, type StorageSummary, type StoredAudio } from '$lib/library-tools';
    import { downloads } from '$lib/state/downloads.svelte';
    import { libraryState } from '$lib/state/library.svelte';
    import { cache, playerState, playTrack } from '$lib/state/player.svelte';
    import { ui } from '$lib/state/ui.svelte';
    import { toasts } from '$lib/state/toast.svelte';
    import { isAndroid } from '$lib/platform';

    let inventory = $state<StorageSummary | null>(null);
    let loading = $state(false);
    let { showDuplicates = $bindable(false) }: { showDuplicates?: boolean } = $props();
    const duplicates = $derived(duplicateSongs(libraryState.tracks.values()));
    const total = $derived(inventory?.audio.reduce((sum, file) => sum + file.bytes, 0) ?? 0);

    async function refresh() {
        loading = true;
        try { inventory = await client.musicStorage(); }
        catch (error) { toasts.error(error); }
        finally { loading = false; }
    }

    async function remove(item: StoredAudio) {
        if (item.id === playerState.currentTrack?.id) return;
        if (!await ui.confirm('Remove download?', { message: `“${item.title}” stays in your playlists.`, confirmLabel: 'Remove download', danger: true })) return;
        try {
            await client.musicRemoveDownload(item.id);
            cache.delete(item.id);
            await Promise.all([refresh(), libraryState.refresh()]);
        } catch (error) { toasts.error(error); }
    }

    async function clearCache() {
        try {
            await client.musicClearCache();
            for (const id of cache.keys()) if (id !== playerState.currentTrack?.id) cache.delete(id);
            await refresh();
        } catch (error) { toasts.error(error); }
    }
</script>

<section class="card maintenance">
    <h2>Download queue</h2>
    <div class="buttons">
        <button class="btn" onclick={() => downloads.setPaused(!downloads.paused)}>{downloads.paused ? 'Resume queue' : 'Pause queue'}</button>
        <button class="btn" onclick={() => downloads.retry()} disabled={!downloads.jobs.some(({ status }) => status === 'failed')}>Retry failed</button>
        <button class="btn" onclick={() => downloads.clearFinished()} disabled={!downloads.jobs.some(({ status }) => status === 'done')}>Clear finished</button>
    </div>
    {#if !downloads.jobs.length}<p class="muted">Add songs to the queue from their track menu.</p>{/if}
    {#each downloads.jobs as job (job.song.id)}
        <div class="item">
            <span><strong>{job.song.title}</strong> · {job.status}{job.error ? ` · ${job.error}` : ''}</span>
            {#if job.status !== 'downloading'}<button class="btn" onclick={() => downloads.remove(job.song.id)}>Remove</button>{/if}
        </div>
    {/each}
</section>

<section class="card maintenance">
    <h2>Storage manager</h2>
    <div class="buttons">
        <button class="btn" disabled={loading} onclick={refresh}>{inventory ? 'Refresh storage' : 'Show storage'}</button>
        <button class="btn" disabled={loading} onclick={clearCache}>Clear playback cache</button>
    </div>
    {#if inventory}
        <p class="muted">{formatStorage(total)} offline audio{isAndroid ? ` · ${formatStorage(inventory.cacheBytes)} playback cache` : ''}</p>
        {#each inventory.audio.toSorted((a, b) => b.bytes - a.bytes) as item (item.id)}
            <div class="item">
                <span><strong>{item.title}</strong> · {formatStorage(item.bytes)}</span>
                {#if item.removable}
                    <button class="btn" disabled={item.id === playerState.currentTrack?.id} onclick={() => remove(item)}>Remove download</button>
                {/if}
            </div>
        {/each}
    {/if}
</section>

<section class="card maintenance" id="duplicate-review">
    <h2>Duplicate review</h2>
    <button class="btn" onclick={() => { showDuplicates = !showDuplicates; }}>{showDuplicates ? 'Hide possible duplicates' : 'Find possible duplicates'}</button>
    {#if showDuplicates}
        {#if !duplicates.length}<p class="muted">No matching titles and artists found.</p>{/if}
        {#each duplicates as group (group[0].id)}
            <div class="duplicates">
                <strong>{group[0].title} · {group[0].artists[0]?.name}</strong>
                {#each group as song (song.id)}
                    <button class="btn" onclick={() => playTrack(song)}>
                        {song.id.startsWith('yt:') ? 'YouTube' : song.id.startsWith('js:') ? 'JioSaavn' : 'Local'}
                        {song.isDownloaded ? ' · Offline' : ''} {song.album?.title ? ` · ${song.album.title}` : ''}
                    </button>
                {/each}
            </div>
        {/each}
    {/if}
</section>

<style>
    .maintenance { display: grid; gap: 10px; padding: 16px; }
    .maintenance h2 { margin: 0; font-size: 1rem; }
    .maintenance > button { justify-self: start; }
    .buttons, .duplicates { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .item { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .duplicates { border-top: 1px solid var(--border); padding-top: 8px; }
</style>
