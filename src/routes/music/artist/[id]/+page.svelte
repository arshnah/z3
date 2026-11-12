<script lang="ts">
    import { page } from "$app/state";
    import { client } from "$lib/ephaptic";
    import Icon from "$lib/components/Icon.svelte";
    import Cover from "$lib/components/Cover.svelte";
    import TrackList from "$lib/components/TrackList.svelte";
    import MediaCard from "$lib/components/MediaCard.svelte";
    import { libraryState, FAVOURITES_ID } from "$lib/state/library.svelte";
    import {
        playerState,
        playPlaylist,
        togglePlay,
        setShuffle,
        addToQueue,
    } from "$lib/state/player.svelte";
    import { ui, type MenuItem } from "$lib/state/ui.svelte";
    import { toasts } from "$lib/state/toast.svelte";
    import {
        collectionMenu,
        openArtist,
        openCollection,
        playCollection,
        radioFrom,
        saveCollectionToLibrary,
    } from "$lib/actions";
    import { splitArtistCredits } from "$lib/music-metadata";
     import { bestThumbnailUrl } from "$lib/utils";
    import { tilt } from "$lib/tilt";
    import { isAndroid } from "$lib/platform";
    import type { ArtistDetails, CollectionSummary, Playlist, Song } from "$lib/schema";

    const rawId = $derived(decodeURIComponent(page.params.id ?? ""));
    const nameHint = $derived(
        page.url.searchParams.get("name") ||
            rawId.replace(/^(?:yt|js|name|js-name):/, ""),
    );

    let artist = $state<ArtistDetails | null>(null);
    let loading = $state(true);
    let error = $state("");
    let allSongs = $state<Song[] | null>(null);
    let loadingAllSongs = $state(false);
    let showAllSongs = $state(false);
    let songFilter = $state("");
    let bioExpanded = $state(false);

    function norm(s: string): string {
        return s
            .toLowerCase()
            .replace(/\(.*?\)|\[.*?\]/g, "")
            .replace(/[^\p{L}\p{N}]+/gu, "");
    }

    // Songs by this artist already in the user's library (works offline too).
    const librarySongs = $derived.by<Song[]>(() => {
        const targetName = norm(artist?.name || nameHint);
        const targetId = artist?.id || (rawId.startsWith("yt:") || rawId.startsWith("js:") ? rawId : "");
        if (!targetName && !targetId) return [];
        const out: Song[] = [];
        for (const song of libraryState.tracks.values()) {
            const credits = splitArtistCredits(song.artists);
            if (
                credits.some(
                    (c) =>
                        (targetId && c.id === targetId) ||
                        (targetName && norm(c.name) === targetName),
                )
            ) {
                out.push(song);
            }
        }
        return out;
    });

    let loadSeq = 0;
    async function loadArtist(targetId: string, hint: string) {
        const seq = ++loadSeq;
        loading = true;
        error = "";
        allSongs = null;
        showAllSongs = false;
        songFilter = "";
        bioExpanded = false;
        try {
            const res = await client.musicArtist(targetId, hint || undefined);
            if (seq !== loadSeq) return;
            artist = res;
        } catch (err: any) {
            if (seq !== loadSeq) return;
            error = err?.message ?? String(err);
            artist = null;
        } finally {
            if (seq === loadSeq) loading = false;
        }
    }

    $effect(() => {
        const id = rawId;
        const hint = nameHint;
        if (id) loadArtist(id, hint);
    });

    const displayName = $derived(artist?.name || nameHint || "Artist");
    const baseSongs = $derived<Song[]>(
        allSongs?.length
            ? allSongs
            : artist?.topSongs.length
              ? artist.topSongs
              : librarySongs,
    );

    const visibleSongs = $derived.by(() => {
        const q = songFilter.trim().toLowerCase();
        const filtered = q
            ? baseSongs.filter(
                  (t) =>
                      t.title.toLowerCase().includes(q) ||
                      (t.album?.title.toLowerCase().includes(q) ?? false),
              )
            : baseSongs;
        if (q || showAllSongs || allSongs) return filtered;
        return filtered.slice(0, 10);
    });

    const contextId = $derived(`artist:${artist?.id ?? rawId}`);
    const playingHere = $derived(playerState.currentPlaylist?.id === contextId);

    const artistPlaylist = $derived<Playlist>({
        id: contextId,
        name: displayName,
        tracks: baseSongs,
        createdAt: 0,
        isProtected: true,
         thumbnail: bestThumbnailUrl(artist?.thumbnails),
    });

    function playAll(start = 0) {
        if (!baseSongs.length) return;
        if (playingHere && start === 0) togglePlay();
        else playPlaylist(artistPlaylist, start);
    }

    function shuffleAll() {
        if (!baseSongs.length) return;
        setShuffle(true);
        playPlaylist(artistPlaylist, Math.floor(Math.random() * baseSongs.length));
    }

    async function expandSongs() {
        if (allSongs) {
            showAllSongs = true;
            return;
        }
        if (!artist?.hasMoreSongs) {
            showAllSongs = true;
            return;
        }
        loadingAllSongs = true;
        try {
            const full = await client.musicArtistSongs(artist.id, artist.name);
            if (full.length > (artist.topSongs?.length ?? 0)) {
                allSongs = full;
            }
            showAllSongs = true;
        } catch (err) {
            toasts.error(err);
            showAllSongs = true;
        } finally {
            loadingAllSongs = false;
        }
    }

    async function saveArtistSongsAsPlaylist() {
        if (!baseSongs.length) return;
        const pl = await libraryState.createPlaylist(`${displayName} · Top Songs`);
        if (!pl) return;
         const cover = bestThumbnailUrl(artist?.thumbnails);
        if (cover) await libraryState.saveThumbnail(pl.id, cover).catch(() => {});
        await libraryState.addTracksToPlaylist(pl.id, baseSongs);
    }

    function openMoreMenu(el: Element) {
        const items: MenuItem[] = [
            {
                label: "Queue all songs",
                icon: "list-end",
                disabled: !baseSongs.length,
                action: () => {
                    baseSongs.forEach((t) => addToQueue(t));
                    toasts.success(`Queued ${baseSongs.length} songs by ${displayName}`);
                },
            },
            {
                label: `Save as playlist (“${displayName} · Top Songs”)`,
                icon: "folder-plus",
                disabled: !baseSongs.length,
                action: saveArtistSongsAsPlaylist,
            },
            {
                label: "Add all songs to playlist",
                icon: "list-plus",
                disabled: !baseSongs.length,
                submenu: [
                    { label: "New playlist…", icon: "plus", action: saveArtistSongsAsPlaylist },
                    { separator: true },
                    ...libraryState.playlists
                        .filter((p) => p.id !== "music-folder" && (!isAndroid || p.id !== "downloads"))
                        .map((p) => ({
                            label: p.name,
                            icon: p.id === FAVOURITES_ID ? "heart" : "list-music",
                            action: () => libraryState.addTracksToPlaylist(p.id, baseSongs),
                        })),
                ],
            },
        ];
        ui.openMenuAt(el, items);
    }

    function playSongFromList(i: number) {
        const song = visibleSongs[i];
        if (!song) return;
        const idx = baseSongs.findIndex((s) => s.id === song.id);
        playPlaylist(artistPlaylist, idx >= 0 ? idx : 0);
    }

    const providerHint = $derived(rawId.startsWith("js") ? "js" : "yt");
</script>

<div class="page">
    {#if loading && !artist && !librarySongs.length}
        <div class="hero-skel island">
            <div class="skeleton avatar-skel"></div>
            <div class="skel-lines">
                <div class="skeleton" style="width:120px;height:18px"></div>
                <div class="skeleton" style="width:320px;height:48px"></div>
                <div class="skeleton" style="width:200px;height:20px"></div>
            </div>
        </div>
        <div class="rows">
            {#each Array(5) as _}
                <div class="skeleton" style="height:64px;border-radius:16px"></div>
            {/each}
        </div>
    {:else}
        <section class="hero island">
            <div class="avatar" use:tilt={{ max: 12 }}>
                <Cover
                    thumbnails={artist?.thumbnails?.length ? artist.thumbnails : librarySongs[0]?.thumbnails}
                    title={displayName}
                    size="100%"
                    radius="50%"
                />
                <div class="avatar-shine"></div>
            </div>

            <div class="hero-body">
                <span class="kicker"><Icon name="user-round" /> Artist</span>
                <h1 class="artist-name">{displayName}</h1>

                <div class="stats">
                    {#if artist?.subtitle}
                        <span>{artist.subtitle}</span>
                    {/if}
                    {#if librarySongs.length}
                        <span><strong>{librarySongs.length}</strong> in your library</span>
                    {/if}
                    {#if artist?.albums.length}
                        <span><strong>{artist.albums.length}</strong> {artist.albums.length === 1 ? "album" : "albums"}</span>
                    {/if}
                </div>

                {#if artist?.description}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                    <p
                        class="bio"
                        class:expanded={bioExpanded}
                        onclick={() => (bioExpanded = !bioExpanded)}
                        title={bioExpanded ? "Click to collapse" : "Click to read more"}
                    >
                        {artist.description}
                    </p>
                {/if}

                <div class="actions">
                    <button class="play-btn" aria-label="Play" disabled={!baseSongs.length} onclick={() => playAll(0)}>
                        <Icon name={playingHere && !playerState.paused ? "pause" : "play"} />
                    </button>
                    <button class="btn" disabled={!baseSongs.length} onclick={shuffleAll}>
                        <Icon name="shuffle" /> Shuffle
                    </button>
                    {#if baseSongs[0]}
                        <button class="btn" onclick={() => radioFrom(baseSongs[0])}>
                            <Icon name="radio" /> Radio
                        </button>
                    {/if}
                    <button class="btn" disabled={!baseSongs.length} onclick={saveArtistSongsAsPlaylist}>
                        <Icon name="folder-plus" /> Save top songs
                    </button>
                    <button class="icon-btn" title="More" onclick={(e) => openMoreMenu(e.currentTarget)}>
                        <Icon name="ellipsis" />
                    </button>
                </div>
            </div>
        </section>

        {#if error && !artist}
            <div class="error island">
                <Icon name="circle-alert" />
                <span>{error}</span>
                <button class="btn btn-ghost" onclick={() => loadArtist(rawId, nameHint)}>Retry</button>
            </div>
        {/if}

        {#if baseSongs.length}
            <section class="section songs-section island">
                <div class="section-head">
                    <div>
                        <span class="kicker"><Icon name="flame" /> Tracks</span>
                        <h2 class="section-title">{allSongs ? `All songs (${allSongs.length})` : "Popular songs"}</h2>
                    </div>
                    <div class="songs-tools">
                        {#if baseSongs.length > 5}
                            <div class="filter">
                                <Icon name="search" />
                                <input bind:value={songFilter} placeholder="Filter songs…" />
                                {#if songFilter}
                                    <button class="icon-btn sm" aria-label="Clear" onclick={() => (songFilter = "")}>
                                        <Icon name="x" />
                                    </button>
                                {/if}
                            </div>
                        {/if}
                        {#if (artist?.hasMoreSongs && !allSongs) || (!showAllSongs && baseSongs.length > 10)}
                            <button class="chip" disabled={loadingAllSongs} onclick={expandSongs}>
                                {#if loadingAllSongs}
                                    <span class="spin"><Icon name="loader-circle" /></span> Loading…
                                {:else}
                                    <Icon name="list-music" /> Show all songs
                                {/if}
                            </button>
                        {:else if showAllSongs && baseSongs.length > 10}
                            <button class="chip" onclick={() => (showAllSongs = false)}>
                                Show top 10
                            </button>
                        {/if}
                    </div>
                </div>

                <TrackList tracks={visibleSongs} showAlbum={true} onplay={playSongFromList} />
            </section>
        {/if}

        {#if librarySongs.length && artist?.topSongs.length}
            <section class="section island songs-section">
                <div class="section-head">
                    <div>
                        <span class="kicker"><Icon name="library-big" /> Saved</span>
                        <h2 class="section-title">In your library ({librarySongs.length})</h2>
                    </div>
                    <button
                        class="chip"
                        onclick={() =>
                            playPlaylist(
                                {
                                    id: `artist-lib:${artist?.id ?? rawId}`,
                                    name: `${displayName} (Library)`,
                                    tracks: librarySongs,
                                    createdAt: 0,
                                    isProtected: true,
                                },
                                0,
                            )}
                    >
                        <Icon name="play" /> Play saved
                    </button>
                </div>
                <TrackList
                    tracks={librarySongs}
                    showAlbum={true}
                    onplay={(i) =>
                        playPlaylist(
                            {
                                id: `artist-lib:${artist?.id ?? rawId}`,
                                name: `${displayName} (Library)`,
                                tracks: librarySongs,
                                createdAt: 0,
                                isProtected: true,
                            },
                            i,
                        )}
                />
            </section>
        {/if}

        {#snippet collectionShelf(title: string, kicker: string, icon: string, items: CollectionSummary[])}
            {#if items.length}
                <section class="section">
                    <div class="section-head">
                        <div>
                            <span class="kicker"><Icon name={icon} /> {kicker}</span>
                            <h2 class="section-title">{title}</h2>
                        </div>
                    </div>
                    <div class="shelf">
                        {#each items as col, i (col.id + ":" + i)}
                            <div class="col-card">
                                <MediaCard
                                    title={col.title}
                                    subtitle={col.year ?? col.subtitle ?? (col.kind === "single" ? "Single" : col.kind === "playlist" ? "Playlist" : "Album")}
                                    thumbnails={col.thumbnails}
                                    index={i}
                                    playing={playerState.currentPlaylist?.id === `collection:${col.id}`}
                                    paused={playerState.paused}
                                    onclick={() => openCollection(col, displayName)}
                                    onplay={() => playCollection(col)}
                                    oncontextmenu={(e) => ui.openMenu(e, collectionMenu(col))}
                                />
                                <div class="col-quick">
                                    <button
                                        class="icon-btn sm"
                                        title="Save to Library"
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            saveCollectionToLibrary(col);
                                        }}
                                    >
                                        <Icon name="folder-plus" />
                                    </button>
                                    <button
                                        class="icon-btn sm"
                                        title="More options"
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            ui.openMenuAt(e.currentTarget, collectionMenu(col));
                                        }}
                                    >
                                        <Icon name="ellipsis" />
                                    </button>
                                </div>
                            </div>
                        {/each}
                    </div>
                </section>
            {/if}
        {/snippet}

        {@render collectionShelf("Albums", "Discography", "disc-3", artist?.albums ?? [])}
        {@render collectionShelf("Singles & EPs", "Releases", "disc", artist?.singles ?? [])}
        {@render collectionShelf("Playlists & features", "Collections", "list-music", artist?.playlists ?? [])}

        {#if artist?.similarArtists.length}
            <section class="section">
                <div class="section-head">
                    <div>
                        <span class="kicker"><Icon name="sparkles" /> Related</span>
                        <h2 class="section-title">Fans might also like</h2>
                    </div>
                </div>
                <div class="shelf">
                    {#each artist.similarArtists as rel, i ((rel.id ?? rel.name) + ":" + i)}
                        <MediaCard
                            round
                            title={rel.name}
                            subtitle={rel.subtitle ?? "Artist"}
                            thumbnails={rel.thumbnails}
                            index={i}
                            onclick={() => openArtist(rel, providerHint)}
                        />
                    {/each}
                </div>
            </section>
        {/if}
    {/if}
</div>

<style>
    .hero-skel {
        display: flex;
        align-items: center;
        gap: 32px;
        padding: 36px;
        margin-bottom: 24px;
    }
    .avatar-skel {
        width: 196px;
        height: 196px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .skel-lines {
        display: flex;
        flex-direction: column;
        gap: 12px;
        flex: 1;
    }
    .rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .hero {
        position: relative;
        display: grid;
        grid-template-columns: 200px minmax(0, 1fr);
        align-items: center;
        gap: 36px;
        padding: 36px 40px;
        margin-top: 10px;
        overflow: hidden;
        animation: rise 0.65s var(--ease-out) both;
    }
    .hero::before {
        content: "";
        position: absolute;
        inset: -40% 25% auto -20%;
        height: 160%;
        background: radial-gradient(closest-side, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        pointer-events: none;
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(16px);
        }
    }
    .avatar {
        --rx: 0deg;
        --ry: 0deg;
        --mx: 50%;
        --my: 0%;
        position: relative;
        width: 200px;
        height: 200px;
        border-radius: 50%;
        transform: perspective(800px) rotateX(var(--rx)) rotateY(var(--ry));
        transition: transform 0.2s linear;
        box-shadow:
            0 30px 60px -20px rgb(0 0 0 / 0.85),
            0 0 50px -16px var(--accent-glow),
            0 0 0 1px rgb(255 255 255 / 0.1);
    }
    .avatar-shine {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: radial-gradient(55% 55% at var(--mx) var(--my), rgb(255 255 255 / 0.26), transparent 70%);
        mix-blend-mode: overlay;
        pointer-events: none;
    }
    .hero-body {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        min-width: 0;
    }
    .artist-name {
        font-size: clamp(32px, 4.2vw, 54px);
        font-weight: 850;
        letter-spacing: -0.04em;
        line-height: 1.05;
        overflow-wrap: anywhere;
    }
    .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        font-size: 14px;
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
    .bio {
        max-width: 68ch;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--text-2);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        cursor: pointer;
    }
    .bio.expanded {
        -webkit-line-clamp: unset;
        line-clamp: unset;
    }
    .actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 6px;
    }
    .actions .btn {
        height: 42px;
        background: rgb(255 255 255 / 0.09);
    }

    .error {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px;
        margin-top: 16px;
        color: var(--danger);
    }
    .error span {
        flex: 1;
        color: var(--text);
    }

    .songs-section {
        padding: 20px;
        margin-top: 22px;
    }
    .songs-section .section-head {
        margin-bottom: 14px;
        gap: 12px;
        flex-wrap: wrap;
    }
    .songs-tools {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }
    .filter {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 10px 0 12px;
        border-radius: var(--r-full);
        background: var(--surface-1);
        border: 1px solid var(--border);
        width: 210px;
    }
    .filter :global(svg) {
        width: 14px;
        height: 14px;
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

    .col-card {
        position: relative;
        min-width: 0;
    }
    .col-quick {
        position: absolute;
        top: 10px;
        right: 10px;
        z-index: 3;
        display: flex;
        gap: 4px;
        padding: 3px;
        border-radius: var(--r-full);
        background: rgb(10 8 16 / 0.72);
        border: 1px solid rgb(255 255 255 / 0.12);
        backdrop-filter: blur(10px);
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity 0.2s, transform 0.2s var(--ease-out);
    }
    .col-card:hover .col-quick,
    .col-card:focus-within .col-quick {
        opacity: 1;
        transform: none;
    }
    @media (pointer: coarse) {
        .col-quick {
            opacity: 1;
            transform: none;
        }
    }

    @media (max-width: 780px) {
        .hero {
            grid-template-columns: 1fr;
            justify-items: center;
            text-align: center;
            padding: 28px 22px;
        }
        .avatar {
            width: 152px;
            height: 152px;
        }
        .hero-body {
            align-items: center;
        }
        .actions {
            justify-content: center;
        }
    }
</style>
