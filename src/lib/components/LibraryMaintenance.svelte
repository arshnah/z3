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

<div class="card maintenance">
    <section class="tool" aria-labelledby="download-queue-title">
        <div class="tool-head">
            <div class="summary">
                <h3 id="download-queue-title">Download queue</h3>
                {#if !downloads.jobs.length}<p>Add songs from their track menu.</p>{/if}
            </div>
            <div class="buttons">
                <button class="btn" onclick={() => downloads.setPaused(!downloads.paused)}>{downloads.paused ? 'Resume queue' : 'Pause queue'}</button>
                <button class="btn" onclick={() => downloads.retry()} disabled={!downloads.jobs.some(({ status }) => status === 'failed')}>Retry failed</button>
                <button class="btn" onclick={() => downloads.clearFinished()} disabled={!downloads.jobs.some(({ status }) => status === 'done')}>Clear finished</button>
            </div>
        </div>
        {#each downloads.jobs as job (job.song.id)}
            <div class="item">
                <span><strong>{job.song.title}</strong> · {job.status}{job.error ? ` · ${job.error}` : ''}</span>
                {#if job.status !== 'downloading'}<button class="btn" onclick={() => downloads.remove(job.song.id)}>Remove</button>{/if}
            </div>
        {/each}
    </section>

    <section class="tool" aria-labelledby="storage-manager-title">
        <div class="tool-head">
            <div class="summary">
                <h3 id="storage-manager-title">Storage manager</h3>
                <p>{#if inventory}{formatStorage(total)} offline audio{isAndroid ? ` · ${formatStorage(inventory.cacheBytes)} playback cache` : ''}
                    {:else}See how much space your downloads use.{/if}</p>
            </div>
            <div class="buttons">
                <button class="btn" disabled={loading} onclick={refresh}>{inventory ? 'Refresh storage' : 'Show storage'}</button>
                <button class="btn" disabled={loading} onclick={clearCache}>Clear playback cache</button>
            </div>
        </div>
        {#if inventory}
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

    <section class="tool" id="duplicate-review" aria-labelledby="duplicate-review-title">
        <div class="tool-head">
            <div class="summary">
                <h3 id="duplicate-review-title">Duplicate review</h3>
                <p>{showDuplicates && !duplicates.length ? 'No matching titles and artists found.' : 'Compare tracks with matching titles and artists.'}</p>
            </div>
            <div class="buttons">
                <button class="btn" aria-expanded={showDuplicates} onclick={() => { showDuplicates = !showDuplicates; }}>{showDuplicates ? 'Hide possible duplicates' : 'Find possible duplicates'}</button>
            </div>
        </div>
        {#if showDuplicates}
            {#each duplicates as group (group[0].id)}
                <div class="item">
                    <strong>{group[0].title} · {group[0].artists[0]?.name}</strong>
                    <div class="buttons">
                        {#each group as song (song.id)}
                            <button class="btn" onclick={() => playTrack(song)}>
                                {song.id.startsWith('yt:') ? 'YouTube' : song.id.startsWith('js:') ? 'JioSaavn' : 'Local'}
                                {song.isDownloaded ? ' · Offline' : ''} {song.album?.title ? ` · ${song.album.title}` : ''}
                            </button>
                        {/each}
                    </div>
                </div>
            {/each}
        {/if}
    </section>
</div>

<style>
    .maintenance { container-type: inline-size; }
    .tool { padding: 14px 20px; }
    .tool + .tool { border-top: 1px solid var(--border); }
    .tool-head, .item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px 20px;
    }
    .summary { min-width: 0; }
    h3 { margin: 0; font-size: 14px; font-weight: 650; }
    .summary p { margin: 3px 0 0; color: var(--text-3); font-size: 13px; }
    .buttons { display: flex; flex-wrap: wrap; gap: 8px; }
    .item {
        border-top: 1px solid var(--border);
        margin-top: 12px;
        padding-top: 12px;
        overflow-wrap: anywhere;
    }
    .item > .btn { flex-shrink: 0; }
    #duplicate-review { scroll-margin-top: 84px; }

    @container (max-width: 650px) {
        .tool-head, .item { align-items: flex-start; flex-direction: column; }
    }
    @container (max-width: 480px) {
        .tool { padding-inline: 14px; }
    }
</style>
