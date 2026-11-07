import { goto } from "$app/navigation";
import { client } from "$lib/ephaptic";
import type { CollectionDetails, CollectionSummary, MusicProvider, Playlist, Song } from "$lib/schema";
import { libraryState, FAVOURITES_ID } from "$lib/state/library.svelte";
import { addToQueue, playNext, playPlaylist, playTrack, setShuffle, startRadio } from "$lib/state/player.svelte";
import { toasts } from "$lib/state/toast.svelte";
import { ui, type MenuItem } from "$lib/state/ui.svelte";
import { isAndroid } from '$lib/platform';
import { splitArtistCredits } from "$lib/music-metadata";
import { updateThumbnailUrl } from "$lib/utils";

export function artistHref(artist: { id?: string; name: string }, providerHint?: MusicProvider): string {
    const name = (artist.name ?? "").trim();
    const id = artist.id || (providerHint === "js" ? `js-name:${name}` : `name:${name}`);
    const query = artist.id && name ? `?name=${encodeURIComponent(name)}` : "";
    return `/music/artist/${encodeURIComponent(id)}${query}`;
}

export function openArtist(artist: { id?: string; name: string }, providerHint?: MusicProvider) {
    if (!artist.name?.trim() && !artist.id) return;
    ui.nowPlayingOpen = false;
    goto(artistHref(artist, providerHint));
}

export function collectionHref(col: { id?: string; title: string }, artistHint?: string): string {
    const id = col.id || `album:${artistHint ?? ""}:${col.title}`;
    const query = col.title ? `?title=${encodeURIComponent(col.title)}` : "";
    return `/music/collection/${encodeURIComponent(id)}${query}`;
}

export function openCollection(col: { id?: string; title: string }, artistHint?: string) {
    if (!col.title?.trim() && !col.id) return;
    ui.nowPlayingOpen = false;
    goto(collectionHref(col, artistHint));
}

async function resolveCollectionTracks(col: CollectionSummary | CollectionDetails): Promise<CollectionDetails> {
    if ("tracks" in col && Array.isArray(col.tracks) && col.tracks.length) return col;
    return client.musicCollection(col.id);
}

export async function playCollection(col: CollectionSummary | CollectionDetails, shuffleFirst = false) {
    const toast = "tracks" in col && col.tracks.length ? null : toasts.info(`Loading “${col.title}”…`, 0);
    try {
        const details = await resolveCollectionTracks(col);
        if (!details.tracks.length) {
            toasts.info(`No playable tracks found in “${col.title}”.`);
            return;
        }
        if (shuffleFirst) setShuffle(true);
        const startIdx = shuffleFirst ? Math.floor(Math.random() * details.tracks.length) : 0;
        playPlaylist(
            {
                id: `collection:${details.id}`,
                name: details.title,
                tracks: details.tracks,
                createdAt: 0,
                isProtected: true,
                thumbnail: updateThumbnailUrl(details.thumbnails[0]?.url),
            },
            startIdx,
        );
    } catch (err) {
        toasts.error(err);
    } finally {
        if (toast !== null) toasts.dismiss(toast);
    }
}

export async function queueCollection(col: CollectionSummary | CollectionDetails) {
    const toast = "tracks" in col && col.tracks.length ? null : toasts.info(`Loading “${col.title}”…`, 0);
    try {
        const details = await resolveCollectionTracks(col);
        if (!details.tracks.length) return;
        for (const t of details.tracks) addToQueue(t);
        toasts.success(`Queued ${details.tracks.length} songs from “${details.title}”`);
    } catch (err) {
        toasts.error(err);
    } finally {
        if (toast !== null) toasts.dismiss(toast);
    }
}

export async function saveCollectionToLibrary(col: CollectionSummary | CollectionDetails): Promise<Playlist | null> {
    const toast = "tracks" in col && col.tracks.length ? null : toasts.info(`Loading “${col.title}”…`, 0);
    try {
        const details = await resolveCollectionTracks(col);
        if (!details.tracks.length) {
            toasts.info(`No tracks found in “${col.title}”.`);
            return null;
        }
        if (toast !== null) toasts.dismiss(toast);
        const playlist = await libraryState.createPlaylist(details.title);
        if (!playlist) return null;
        const cover = updateThumbnailUrl(details.thumbnails.at(-1)?.url ?? details.thumbnails[0]?.url);
        if (cover) await libraryState.saveThumbnail(playlist.id, cover).catch(() => {});
        await libraryState.addTracksToPlaylist(playlist.id, details.tracks);
        return playlist;
    } catch (err) {
        if (toast !== null) toasts.dismiss(toast);
        toasts.error(err);
        return null;
    }
}

export async function addCollectionToPlaylist(playlistId: string, col: CollectionSummary | CollectionDetails) {
    const toast = "tracks" in col && col.tracks.length ? null : toasts.info(`Loading “${col.title}”…`, 0);
    try {
        const details = await resolveCollectionTracks(col);
        if (toast !== null) toasts.dismiss(toast);
        await libraryState.addTracksToPlaylist(playlistId, details.tracks);
    } catch (err) {
        if (toast !== null) toasts.dismiss(toast);
        toasts.error(err);
    }
}

export function collectionMenu(col: CollectionSummary | CollectionDetails): MenuItem[] {
    const kindLabel = col.kind === "playlist" ? "playlist" : col.kind === "single" ? "single" : "album";
    const addSubmenu: MenuItem[] = [
        { label: `Save as new playlist (“${col.title}”)`, icon: "plus", action: () => saveCollectionToLibrary(col) },
        { separator: true },
        ...libraryState.playlists
            .filter((p) => !isAndroid || p.id !== "downloads")
            .map((p) => ({
                label: p.name,
                icon: p.id === FAVOURITES_ID ? "heart" : "list-music",
                action: () => addCollectionToPlaylist(p.id, col),
            })),
    ];
    return [
        { label: `Play ${kindLabel}`, icon: "play", action: () => playCollection(col, false) },
        { label: `Shuffle ${kindLabel}`, icon: "shuffle", action: () => playCollection(col, true) },
        { label: "Add to queue", icon: "list-end", action: () => queueCollection(col) },
        { separator: true },
        { label: "Save to Library", icon: "folder-plus", action: () => saveCollectionToLibrary(col) },
        { label: "Add all to playlist", icon: "list-plus", submenu: addSubmenu },
        ...(col.artists?.[0]?.name
            ? [
                  { separator: true },
                  { label: `Go to ${col.artists[0].name}`, icon: "user-round", action: () => openArtist(col.artists[0]) },
              ]
            : []),
    ];
}

export function songUrl(track: Song): string | null {
    if (track.id.startsWith("yt:")) return `https://music.youtube.com/watch?v=${track.id.slice(3)}`;
    return null;
}

export async function createPlaylistWith(track?: Song) {
    const name = await ui.prompt("New playlist", { placeholder: "Give it a name", confirmLabel: "Create" });
    if (!name) return null;
    const playlist = await libraryState.createPlaylist(name);
    if (playlist && track) await libraryState.addToPlaylist(playlist.id, track);
    return playlist;
}

export async function radioFrom(track: Song) {
    const id = toasts.info(`Tuning in to “${track.title}” radio…`, 0);
    try {
        await startRadio(track);
    } catch (err) {
        toasts.error(err);
    } finally {
        toasts.dismiss(id);
    }
}

export function playlistSubmenu(track: Song): MenuItem[] {
    return [
        { label: "New playlist…", icon: "plus", action: () => createPlaylistWith(track) },
        { separator: true },
        ...libraryState.playlists.filter((p) => !isAndroid || p.id !== 'downloads').map((p) => ({
            label: p.name,
            icon: p.id === FAVOURITES_ID ? "heart" : "list-music",
            checked: libraryState.isInPlaylist(p.id, track.id),
            action: () => libraryState.toggleFromPlaylist(p.id, track),
        })),
    ];
}

/** The standard right-click menu for a track. */
export function trackMenu(track: Song, opts: { playlist?: Playlist | null; extra?: MenuItem[] } = {}): MenuItem[] {
    const fav = libraryState.isFavourite(track.id);
    const url = songUrl(track);
    const editable = opts.playlist && !(isAndroid && opts.playlist.id === 'downloads') && libraryState.playlists.some((p) => p.id === opts.playlist!.id);
    const index = opts.playlist?.tracks.findIndex((song) => song.id === track.id) ?? -1;
    const move = async (delta: number) => {
        const playlist = opts.playlist ? libraryState.getPlaylist(opts.playlist.id) : undefined;
        if (!playlist) return;
        const ids = playlist.tracks.map((song) => song.id);
        const from = ids.indexOf(track.id), to = from + delta;
        if (from < 0 || to < 0 || to >= ids.length) return;
        [ids[from], ids[to]] = [ids[to], ids[from]];
        await libraryState.reorderPlaylist(playlist.id, ids);
    };

    const credits = splitArtistCredits(track.artists).filter((a) => a.name && a.name.toLowerCase() !== "unknown artist");
    const providerHint: MusicProvider | undefined = track.id.startsWith("js:") ? "js" : track.id.startsWith("yt:") ? "yt" : undefined;
    const artistItems: MenuItem[] =
        credits.length === 1
            ? [{ label: `Go to ${credits[0].name}`, icon: "user-round", action: () => openArtist(credits[0], providerHint) }]
            : credits.length > 1
              ? [
                    {
                        label: "Go to artist",
                        icon: "user-round",
                        submenu: credits.map((c) => ({
                            label: c.name,
                            icon: "user-round",
                            action: () => openArtist(c, providerHint),
                        })),
                    },
                ]
              : [];
    const albumItem: MenuItem[] = track.album?.title
        ? [{ label: `Go to album (${track.album.title})`, icon: "disc-3", action: () => openCollection(track.album!, credits[0]?.name) }]
        : [];

    return [
        { label: "Play", icon: "play", action: () => playTrack(track) },
        { label: "Play next", icon: "list-start", action: () => { playNext(track); toasts.success("Playing next"); } },
        { label: "Add to queue", icon: "list-end", action: () => { addToQueue(track); toasts.success("Added to queue"); } },
        { label: "Start song radio", icon: "radio", action: () => radioFrom(track) },
        ...(artistItems.length || albumItem.length ? [{ separator: true }, ...artistItems, ...albumItem] : []),
        { separator: true },
        { label: fav ? "Remove from Favourites" : "Add to Favourites", icon: fav ? "heart-off" : "heart", action: () => libraryState.toggleFavourite(track) },
        { label: "Add to playlist", icon: "list-plus", submenu: playlistSubmenu(track) },
        ...(editable
            ? [{ label: "Remove from this playlist", icon: "trash-2", danger: true, action: () => libraryState.removeFromPlaylist(opts.playlist!.id, track.id) }]
            : []),
        ...(isAndroid && editable ? [
            { label: 'Move up', icon: 'arrow-up', disabled: index <= 0, action: () => move(-1) },
            { label: 'Move down', icon: 'arrow-down', disabled: index < 0 || index >= (opts.playlist?.tracks.length ?? 0) - 1, action: () => move(1) },
        ] : []),
        ...(!track.isDownloaded ? [{ label: "Download", icon: "download", action: () => libraryState.download(track) }] : []),
        ...(isAndroid ? [{
            label: track.isDownloaded ? 'Share audio file…' : 'Share song…', icon: 'share-2',
            action: async () => {
                try { await (await import('$lib/android/share')).shareSong(track); }
                catch (error) { if (!/share cancel(?:led|ed)/i.test((error as Error).message)) toasts.error(error); }
            },
        }] : []),
        ...(url
            ? [
                  { separator: true },
                  { label: "Copy link", icon: "link", action: () => { navigator.clipboard.writeText(url); toasts.success("Link copied"); } },
              ]
            : []),
        ...(opts.extra?.length ? [{ separator: true }, ...opts.extra] : []),
    ];
}

export function openPlaylist(playlist: Playlist) {
    goto(`/music/playlist/${encodeURIComponent(playlist.id)}`);
}
