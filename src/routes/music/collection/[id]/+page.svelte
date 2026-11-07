<script lang="ts">
    import { page } from "$app/state";
    import { client } from "$lib/ephaptic";
    import Icon from "$lib/components/Icon.svelte";
    import Cover from "$lib/components/Cover.svelte";
    import TrackList from "$lib/components/TrackList.svelte";
    import ArtistLinks from "$lib/components/ArtistLinks.svelte";
    import {
        playerState,
        playPlaylist,
        togglePlay,
        setShuffle,
        addToQueue,
    } from "$lib/state/player.svelte";
    import { ui } from "$lib/state/ui.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import { collectionMenu, radioFrom, saveCollectionToLibrary } from "$lib/actions";
    import { artistNames, formatLongDuration, updateThumbnailUrl } from "$lib/utils";
    import { tilt } from "$lib/tilt";
    import type { CollectionDetails, Playlist } from "$lib/schema";

    const rawId = $derived(decodeURIComponent(page.params.id ?? ""));
    const titleHint = $derived(page.url.searchParams.get("title") ?? "");

    let collection = $state<CollectionDetails | null>(null);
    let loading = $state(true);
    let error = $state("");
    let filter = $state("");
    let saving = $state(false);

    let loadSeq = 0;
    async function load(targetId: string) {
        const seq = ++loadSeq;
        loading = true;
        error = "";
        filter = "";
        try {
            const res = await client.musicCollection(targetId);
            if (seq !== loadSeq) return;
            collection = res;
        } catch (err: any) {
            if (seq !== loadSeq) return;
            error = err?.message ?? String(err);
            collection = null;
        } finally {
            if (seq === loadSeq) loading = false;
        }
    }

    $effect(() => {
        const id = rawId;
        if (id) load(id);
    });

    const contextId = $derived(`collection:${collection?.id ?? rawId}`);
    const playingHere = $derived(playerState.currentPlaylist?.id === contextId);

    const asPlaylist = $derived<Playlist>({
        id: contextId,
        name: collection?.title || titleHint || "Album",
        tracks: collection?.tracks ?? [],
        createdAt: 0,
        isProtected: true,
        thumbnail: updateThumbnailUrl(collection?.thumbnails.at(-1)?.url ?? collection?.thumbnails[0]?.url),
    });

    const view = $derived.by(() => {
        const tracks = collection?.tracks ?? [];
        const q = filter.trim().toLowerCase();
        const indices: number[] = [];
        const list = tracks.filter((t, i) => {
            if (!q || t.title.toLowerCase().includes(q) || artistNames(t).toLowerCase().includes(q)) {
                indices.push(i);
                return true;
            }
            return false;
        });
        return { list, indices };
    });

    const totalSeconds = $derived(
        (collection?.tracks ?? []).reduce((s, t) => s + (t.duration || 0), 0),
    );

    function playAll(start = 0) {
        if (!collection?.tracks.length) return;
        if (playingHere && start === 0) togglePlay();
        else playPlaylist(asPlaylist, start);
    }

    function shuffleAll() {
        if (!collection?.tracks.length) return;
        setShuffle(true);
        playPlaylist(asPlaylist, Math.floor(Math.random() * collection.tracks.length));
    }

    async function saveToLibrary() {
        if (!collection || saving) return;
        saving = true;
        try {
            await saveCollectionToLibrary(collection);
        } finally {
            saving = false;
        }
    }
</script>

<div class="page">
    {#if loading && !collection}
        <div class="layout">
            <div class="skeleton" style="height:440px;border-radius:30px"></div>
            <div class="rows">
                {#each Array(7) as _}
                    <div class="skeleton" style="height:64px;border-radius:16px"></div>
                {/each}
            </div>
        </div>
    {:else if error && !collection}
        <div class="empty">
            <Icon name="disc-3" />
            <h3>Couldn't load {titleHint ? `“${titleHint}”` : "this release"}</h3>
            <p>{error}</p>
            <div class="empty-actions">
                <button class="btn btn-primary" onclick={() => load(rawId)}>Retry</button>
                <a class="btn" href="/music/search">Back to search</a>
            </div>
        </div>
    {:else if collection}
        <div class="layout">
            <aside class="sleeve island">
                <div class="cover" use:tilt={{ max: 14 }}>
                    <Cover
                        thumbnails={collection.thumbnails}
                        title={collection.title}
                        size="100%"
                        radius="22px"
                    />
                    <span class="cover-shine"></span>
                </div>

                <div class="meta">
                    <span class="kicker">
                        {#if collection.kind === "playlist"}
                            <Icon name="list-music" /> Playlist
                        {:else if collection.kind === "single"}
                            <Icon name="disc" /> Single & EP
                        {:else}
                            <Icon name="disc-3" /> Album
                        {/if}
                    </span>

                    <h1 class="name" title={collection.title}>{collection.title}</h1>

                    {#if collection.artists.length}
                        <p class="artists">
                            <ArtistLinks
                                artists={collection.artists}
                                providerHint={collection.id.startsWith("js") ? "js" : "yt"}
                            />
                        </p>
                    {/if}

                    <div class="stats">
                        {#if collection.year}
                            <span><strong>{collection.year}</strong></span>
                        {/if}
                        <span>
                            <strong>{collection.tracks.length}</strong>
                            {collection.tracks.length === 1 ? "song" : "songs"}
                        </span>
                        {#if totalSeconds}
                            <span><strong>{formatLongDuration(totalSeconds)}</strong></span>
                        {/if}
                    </div>

                    {#if collection.description}
                        <p class="desc">{collection.description}</p>
                    {/if}

                    {#if collection.tracks.length}
                        <div class="actions">
                            <button class="play-btn" aria-label="Play" onclick={() => playAll(0)}>
                                <Icon name={playingHere && !playerState.paused ? "pause" : "play"} />
                            </button>
                            <button class="btn" title="Shuffle" onclick={shuffleAll}>
                                <Icon name="shuffle" /> Shuffle
                            </button>
                            <button
                                class="btn"
                                disabled={saving}
                                title="Save as a playlist in your Library"
                                onclick={saveToLibrary}
                            >
                                {#if saving}
                                    <span class="spin"><Icon name="loader-circle" /></span> Saving…
                                {:else}
                                    <Icon name="folder-plus" /> Save to Library
                                {/if}
                            </button>
                            {#if collection.tracks[0]}
                                <button class="icon-btn" title="Start radio" onclick={() => radioFrom(collection!.tracks[0])}>
                                    <Icon name="radio" />
                                </button>
                            {/if}
                            <button
                                class="icon-btn"
                                title="More"
                                onclick={(e) => ui.openMenuAt(e.currentTarget, collectionMenu(collection!))}
                            >
                                <Icon name="ellipsis" />
                            </button>
                        </div>
                    {/if}
                </div>
            </aside>

            <div class="main">
                {#if collection.tracks.length > 4}
                    <div class="toolbar">
                        <div class="filter">
                            <Icon name="search" />
                            <input bind:value={filter} placeholder="Filter in this release…" />
                            {#if filter}
                                <button class="icon-btn sm" aria-label="Clear" onclick={() => (filter = "")}>
                                    <Icon name="x" />
                                </button>
                            {/if}
                        </div>
                        <button
                            class="chip"
                            onclick={() => {
                                collection!.tracks.forEach((t) => addToQueue(t));
                                toasts.success(`Queued ${collection!.tracks.length} songs`);
                            }}
                        >
                            <Icon name="list-end" /> Queue all
                        </button>
                    </div>
                {/if}

                {#if view.list.length}
                    <TrackList
                        tracks={view.list}
                        indices={view.indices}
                        showAlbum={false}
                        onplay={(i) => playPlaylist(asPlaylist, view.indices[i])}
                    />
                {:else}
                    <div class="empty">
                        <Icon name="disc-3" />
                        <h3>No matching tracks</h3>
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .layout {
        display: grid;
        grid-template-columns: 296px minmax(0, 1fr);
        gap: 28px;
        align-items: start;
        padding-top: 8px;
    }
    .rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .sleeve {
        position: sticky;
        top: 8px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 18px;
        animation: sleeve-in 0.65s var(--ease-out) both;
    }
    @keyframes sleeve-in {
        from {
            opacity: 0;
            transform: translateY(20px) scale(0.96);
        }
    }
    .cover {
        --rx: 0deg;
        --ry: 0deg;
        --mx: 50%;
        --my: 0%;
        position: relative;
        aspect-ratio: 1;
        border-radius: 22px;
        transform: perspective(800px) rotateX(var(--rx)) rotateY(var(--ry));
        transition: transform 0.2s linear;
        box-shadow:
            0 30px 60px -25px rgb(0 0 0 / 0.9),
            0 0 50px -20px var(--accent-glow);
    }
    .cover-shine {
        position: absolute;
        inset: 0;
        border-radius: 22px;
        background: radial-gradient(50% 50% at var(--mx) var(--my), rgb(255 255 255 / 0.3), transparent 70%);
        mix-blend-mode: overlay;
        pointer-events: none;
    }
    .meta {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        min-width: 0;
    }
    .name {
        font-size: clamp(24px, 2.4vw, 32px);
        font-weight: 850;
        letter-spacing: -0.04em;
        line-height: 1.1;
        max-width: 100%;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .artists {
        font-size: 15px;
        font-weight: 650;
        color: var(--text-2);
        max-width: 100%;
    }
    .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        font-size: 13.5px;
        color: var(--text-2);
    }
    .stats span + span::before {
        content: "·";
        margin-right: 14px;
        color: var(--text-3);
    }
    .stats strong {
        color: var(--text);
        font-weight: 700;
    }
    .desc {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-3);
        display: -webkit-box;
        -webkit-line-clamp: 3;
        line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }
    .actions .btn {
        height: 40px;
        background: rgb(255 255 255 / 0.08);
    }
    .empty-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }

    .main {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
    }
    .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }
    .filter {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 10px 0 12px;
        border-radius: var(--r-full);
        background: var(--surface-1);
        border: 1px solid var(--border);
        width: 240px;
    }
    .filter :global(svg) {
        width: 15px;
        height: 15px;
        color: var(--text-3);
        flex-shrink: 0;
    }
    .filter input {
        flex: 1;
        min-width: 0;
        background: none;
        border: none;
        outline: none;
        color: var(--text);
        font: inherit;
        font-size: 13px;
    }
    .filter input::placeholder {
        color: var(--text-3);
    }

    @media (max-width: 900px) {
        .layout {
            grid-template-columns: 1fr;
        }
        .sleeve {
            position: static;
            display: grid;
            grid-template-columns: 180px minmax(0, 1fr);
            align-items: center;
            gap: 24px;
        }
    }
    @media (max-width: 600px) {
        .sleeve {
            grid-template-columns: 96px minmax(0, 1fr);
            gap: 14px;
            padding: 14px;
        }
        .sleeve .actions {
            grid-column: 1 / -1;
        }
        .filter {
            width: 100%;
        }
    }
</style>
