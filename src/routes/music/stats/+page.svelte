<script lang="ts">
    import Icon from "$lib/components/Icon.svelte";
    import Cover from "$lib/components/Cover.svelte";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import { statsState } from "$lib/state/stats.svelte";
    import { playTrack } from "$lib/state/player.svelte";
    import { openArtist } from "$lib/actions";
    import { formatDate, formatLongDuration } from "$lib/utils";
    import { client } from '$lib/ephaptic';
    import { toasts } from '$lib/state/toast.svelte';
    import { shareListeningPoster } from '$lib/listening-poster';
    import type { Song } from "$lib/schema";

    $effect(() => {
        statsState.load();
    });

    let query = $state('');
    let since = $state('');
    const today = new Date();
    let month = $state(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
    let history = $state<Awaited<ReturnType<typeof client.statsSummary>>['history'] | null>(null);
    let searching = $state(false);
    let posterBusy = $state(false);

    async function searchHistory(event: SubmitEvent) {
        event.preventDefault();
        searching = true;
        try {
            const from = since ? new Date(`${since}T00:00:00`).getTime() : undefined;
            history = (await client.statsSummary(120, { query, from })).history;
        } catch (error) { toasts.error(error); }
        finally { searching = false; }
    }

    async function makePoster() {
        if (!/^\d{4}-\d{2}$/.test(month)) return;
        posterBusy = true;
        try {
            const [year, number] = month.split('-').map(Number);
            const summary = await client.statsSummary(9, { from: new Date(year, number - 1, 1).getTime(), until: new Date(year, number, 1).getTime() });
            if (!summary.totals.totalPlays) throw new Error('There is no listening history for this month.');
            await shareListeningPoster(month, summary);
        } catch (error) { toasts.error(error); }
        finally { posterBusy = false; }
    }

    let s = $derived(statsState.summary);
    const maxSong = $derived(Math.max(1, ...(s?.topSongs.map((x) => x.playTimeMs) ?? [1])));
    const maxArtist = $derived(Math.max(1, ...(s?.topArtists.map((x) => x.playTimeMs) ?? [1])));
    const hours = $derived(((s?.totals.totalPlayTimeMs ?? 0) / 3_600_000).toFixed(1));

    const play = (x: { id: string; title: string; artists: string[]; thumbnailUrl?: string }) =>
        playTrack({
            id: x.id,
            title: x.title,
            artists: x.artists.map((name) => ({ name, thumbnails: [] })),
            thumbnails: x.thumbnailUrl ? [{ url: x.thumbnailUrl }] : [],
            album: null,
            duration: 0,
            isDownloaded: false,
        } satisfies Song);
</script>

<div class="page">
    <header class="head">
        <h1 class="page-title">Your listening</h1>
        <p class="muted">Everything you've played in Zeta (and imported from Muzza).</p>
    </header>

    <div class="history-tools">
        <input class="input" type="month" aria-label="Poster month" bind:value={month} />
        <button class="btn" onclick={makePoster} disabled={posterBusy || !month}>Share monthly listening poster</button>
    </div>

    {#if statsState.loading && !s}
        <div class="totals">{#each Array(3) as _}<div class="skeleton" style="height:112px"></div>{/each}</div>
    {:else if s}
        <div class="totals">
            <div class="stat">
                <Icon name="headphones" />
                <strong>{hours}<small>hrs</small></strong>
                <span>Listening time</span>
            </div>
            <div class="stat">
                <Icon name="play" />
                <strong>{s.totals.totalPlays.toLocaleString()}</strong>
                <span>Plays</span>
            </div>
            <div class="stat">
                <Icon name="music-4" />
                <strong>{s.totals.uniqueSongs.toLocaleString()}</strong>
                <span>Different songs</span>
            </div>
        </div>

        {#if s.totals.totalPlays === 0}
            <div class="empty"><Icon name="chart-no-axes-column" /><h3>No plays yet</h3><p>Listen to some music and your stats will appear here.</p></div>
        {:else}
            <div class="grid">
                <section class="card panel">
                    <h2 class="section-title">Top songs</h2>
                    <ol class="ranks">
                        {#each s.topSongs.slice(0, 15) as song, i (song.id)}
                            <li>
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <div
                                    class="rank-row clickable"
                                    role="button"
                                    tabindex="0"
                                    onclick={(e) => !(e.target as HTMLElement).closest("a") && play(song)}
                                    onkeydown={(e) => e.key === "Enter" && play(song)}
                                >
                                    <span class="pos" class:podium={i < 3}>{i + 1}</span>
                                    <Cover src={song.thumbnailUrl} title={song.title} size={42} radius="var(--r-xs)" />
                                    <span class="info">
                                        <span class="t ellipsis">{song.title}</span>
                                        <span class="subtle ellipsis a">
                                            <ArtistLinks artists={song.artists.map((name) => ({ name }))} providerHint={song.id.startsWith("js:") ? "js" : "yt"} />
                                        </span>
                                        <span class="bar"><i style:width="{(song.playTimeMs / maxSong) * 100}%" style:animation-delay="{i * 40}ms"></i></span>
                                    </span>
                                    <span class="meta">
                                        <span>{formatLongDuration(song.playTimeMs / 1000)}</span>
                                        <small>{song.plays} play{song.plays === 1 ? "" : "s"}</small>
                                    </span>
                                </div>
                            </li>
                        {/each}
                    </ol>
                </section>

                <section class="card panel">
                    <h2 class="section-title">Top artists</h2>
                    <ol class="ranks">
                        {#each s.topArtists.slice(0, 15) as artist, i (artist.name)}
                            <li>
                                <button class="rank-row" onclick={() => openArtist({ name: artist.name })}>
                                    <span class="pos" class:podium={i < 3}>{i + 1}</span>
                                    <Cover src={artist.thumbnailUrl} title={artist.name} size={42} radius="50%" />
                                    <span class="info">
                                        <span class="t ellipsis">{artist.name}</span>
                                        <span class="bar"><i style:width="{(artist.playTimeMs / maxArtist) * 100}%" style:animation-delay="{i * 40}ms"></i></span>
                                    </span>
                                    <span class="meta">
                                        <span>{formatLongDuration(artist.playTimeMs / 1000)}</span>
                                        <small>{artist.plays} play{artist.plays === 1 ? "" : "s"}</small>
                                    </span>
                                </button>
                            </li>
                        {/each}
                    </ol>
                </section>

                <section class="card panel wide">
                    <h2 class="section-title">Listening history</h2>
                    <form class="history-tools" onsubmit={searchHistory}>
                        <input class="input" type="search" aria-label="Song or artist" placeholder="Song or artist" bind:value={query} />
                        <input class="input" type="date" aria-label="Played on or after" bind:value={since} />
                        <button class="btn" disabled={searching}>Search history</button>
                        {#if history}<button type="button" class="btn" onclick={() => { history = null; query = ''; since = ''; }}>Clear search</button>{/if}
                    </form>
                    {#if history && !history.length}<p class="muted">No matching listens.</p>{/if}
                    <div class="history">
                        {#each history ?? s.history as ev, i (ev.timestamp + ev.id + i)}
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <div
                                class="rank-row clickable"
                                role="button"
                                tabindex="0"
                                onclick={(e) => !(e.target as HTMLElement).closest("a") && play(ev)}
                                onkeydown={(e) => e.key === "Enter" && play(ev)}
                            >
                                <Cover src={ev.thumbnailUrl} title={ev.title} size={40} radius="var(--r-xs)" />
                                <span class="info">
                                    <span class="t ellipsis">{ev.title}</span>
                                    <span class="subtle ellipsis a">
                                        <ArtistLinks artists={ev.artists.map((name) => ({ name }))} providerHint={ev.id.startsWith("js:") ? "js" : "yt"} />
                                    </span>
                                </span>
                                <span class="meta">
                                    <small>{formatDate(ev.timestamp)}</small>
                                </span>
                            </div>
                        {/each}
                    </div>
                </section>
            </div>
        {/if}
    {/if}
</div>

<style>
    .history-tools { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 16px; }
    .head {
        padding: 20px 0 22px;
    }
    .head p {
        margin-top: 6px;
    }
    .totals {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
    }
    .stat {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 20px 22px;
        border-radius: var(--r-xl);
        background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 16%, transparent), rgb(255 255 255 / 0.03));
        border: 1px solid var(--border);
        overflow: hidden;
        animation: rise 0.5s var(--ease-out) both;
    }
    .stat:nth-child(2) {
        animation-delay: 60ms;
    }
    .stat:nth-child(3) {
        animation-delay: 120ms;
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(10px);
        }
    }
    .stat > :global(svg) {
        position: absolute;
        right: 18px;
        top: 18px;
        width: 22px;
        height: 22px;
        color: var(--accent);
        opacity: 0.8;
    }
    .stat strong {
        font-family: var(--font-display);
        font-size: 38px;
        font-weight: 850;
        letter-spacing: -0.04em;
    }
    .stat strong small {
        font-size: 16px;
        margin-left: 4px;
        color: var(--text-2);
        font-weight: 700;
    }
    .stat span {
        color: var(--text-2);
        font-weight: 550;
    }
    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-top: 16px;
    }
    .panel {
        padding: 20px 14px 14px;
        min-width: 0;
    }
    .panel .section-title {
        padding: 0 8px 12px;
    }
    .wide {
        grid-column: 1 / -1;
    }
    .ranks {
        list-style: none;
        margin: 0;
        padding: 0;
    }
    .rank-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 7px 8px;
        border-radius: var(--r-sm);
        text-align: left;
        transition: background 0.18s;
    }
    .rank-row.clickable {
        cursor: pointer;
    }
    button.rank-row:hover,
    .rank-row.clickable:hover {
        background: var(--surface-2);
    }
    .pos {
        width: 22px;
        text-align: center;
        font-weight: 700;
        color: var(--text-3);
        font-variant-numeric: tabular-nums;
    }
    .pos.podium {
        color: var(--accent);
    }
    .info {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-width: 0;
    }
    .t {
        font-weight: 600;
    }
    .a {
        font-size: 12.5px;
        margin-top: -4px;
    }
    .bar {
        height: 4px;
        border-radius: 4px;
        background: var(--surface-2);
        overflow: hidden;
    }
    .bar i {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 70%, transparent), var(--accent));
        transform-origin: left;
        animation: grow 0.9s var(--ease-out) both;
    }
    @keyframes grow {
        from {
            transform: scaleX(0);
        }
    }
    .meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        font-size: 13px;
        font-weight: 600;
        flex-shrink: 0;
    }
    .meta small {
        color: var(--text-3);
        font-weight: 500;
        font-size: 12px;
    }
    .history {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
        gap: 2px 16px;
    }
    @media (max-width: 960px) {
        .grid {
            grid-template-columns: 1fr;
        }
        .totals {
            grid-template-columns: 1fr;
        }
    }
</style>
