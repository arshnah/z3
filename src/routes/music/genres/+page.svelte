<script lang="ts">
    import { onMount } from "svelte";
    import Icon from "$lib/components/Icon.svelte";
    import MediaCard from "$lib/components/MediaCard.svelte";
    import { client } from "$lib/ephaptic";
    import { collectionMenu, openCollection, playCollection } from "$lib/actions";
    import { playerState } from "$lib/state/player.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { ui } from "$lib/state/ui.svelte";
    import type { CollectionSummary } from "$lib/schema";

    const genres = [
        { name: "Pop", queries: ["Top 100 Pop Songs", "Best Pop Songs Playlist"] },
        { name: "Hip-hop", queries: ["Top 100 Hip Hop Songs", "Best Hip Hop Songs Playlist"] },
        { name: "R&B", queries: ["Top R&B Songs", "Best R&B Playlist"] },
        { name: "Rock", queries: ["Top 100 Rock Songs", "Best Rock Songs Playlist"] },
        { name: "Indie", queries: ["Top Indie Songs", "Best Indie Playlist"] },
        { name: "Electronic", queries: ["Top Electronic Songs", "Best Electronic Music Playlist"] },
        { name: "Dance", queries: ["Top Dance Songs", "Best Dance Hits Playlist"] },
        { name: "Latin", queries: ["Top Latin Songs", "Best Latin Music Playlist"] },
        { name: "K-pop", queries: ["Top K-pop Songs", "Best K-pop Playlist"] },
        { name: "Bollywood", queries: ["Top Bollywood Songs", "Best Bollywood Playlist"] },
        { name: "Jazz", queries: ["Top Jazz Songs", "Best Jazz Playlist"] },
        { name: "Classical", queries: ["Best Classical Music", "Classical Music Playlist"] },
        { name: "Country", queries: ["Top Country Songs", "Best Country Playlist"] },
        { name: "Afrobeats", queries: ["Top Afrobeats Songs", "Best Afrobeats Playlist"] },
        { name: "Metal", queries: ["Top Metal Songs", "Best Metal Playlist"] },
        { name: "Lo-fi", queries: ["Best Lo-fi Beats", "Lo-fi Focus Playlist"] },
    ];

    let playlistsByGenre = $state<Record<string, CollectionSummary[]>>({});
    let loading = $state(true);

    async function loadGenrePlaylists() {
        const tasks = genres.flatMap((genre) => genre.queries.map((query) => ({ genre: genre.name, query })));
        const failures: unknown[] = [];
        for (let i = 0; i < tasks.length; i += 4) {
            const batch = tasks.slice(i, i + 4);
            const results = await Promise.allSettled(batch.map(({ query }) => client.musicSearchPlaylists(query, "yt")));
            results.forEach((result, index) => {
                if (result.status === "rejected") {
                    failures.push(result.reason);
                    return;
                }
                const genre = batch[index].genre;
                const merged = [...(playlistsByGenre[genre] ?? []), ...result.value];
                playlistsByGenre[genre] = [...new Map(merged.map((playlist) => [playlist.id, playlist])).values()].slice(0, 12);
            });
        }
        loading = false;
        if (failures.length) toasts.error(failures[0]);
    }

    onMount(() => {
        void loadGenrePlaylists();
    });
</script>

<svelte:head>
    <title>Genres · Zeta</title>
</svelte:head>

<div class="page">
    <header class="genres-head">
        <span class="kicker"><Icon name="disc-3" /> Explore</span>
        <h1 class="page-title">Browse by genre</h1>
        <p class="muted">Top 100s, essential songs, and hand-picked YouTube Music playlists across every mood.</p>
        <nav class="genre-nav" aria-label="Jump to genre">
            {#each genres as genre}
                <a class="chip" href="#genre-{genre.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">{genre.name}</a>
            {/each}
        </nav>
    </header>

    {#each genres as genre}
        {@const genrePlaylists = playlistsByGenre[genre.name] ?? []}
        <section class="section" id="genre-{genre.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">
            <div class="section-head">
                <h2 class="section-title">{genre.name}</h2>
                <span class="section-sub">Top songs and playlists</span>
            </div>
            {#if genrePlaylists.length}
                <div class="shelf">
                    {#each genrePlaylists as playlist, i (playlist.id)}
                        <MediaCard
                            title={playlist.title}
                            subtitle={playlist.subtitle ?? `${genre.name} playlist`}
                            thumbnails={playlist.thumbnails}
                            providerHint="yt"
                            index={i}
                            playing={playerState.currentPlaylist?.id === `collection:${playlist.id}`}
                            paused={playerState.paused}
                            onclick={() => openCollection(playlist)}
                            onplay={() => playCollection(playlist)}
                            oncontextmenu={(e) => ui.openMenu(e, collectionMenu(playlist))}
                        />
                    {/each}
                </div>
            {:else if loading}
                <p class="muted genre-status">Loading {genre.name} playlists…</p>
            {:else}
                <p class="muted genre-status">No {genre.name} playlists found right now.</p>
            {/if}
        </section>
    {/each}
</div>

<style>
    .genres-head {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 18px 4px 8px;
    }
    .genres-head .page-title {
        font-size: clamp(42px, 7vw, 72px);
    }
    .genre-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }
    .genre-nav .chip {
        text-decoration: none;
    }
    .genre-status {
        padding: 8px 0;
    }
</style>
