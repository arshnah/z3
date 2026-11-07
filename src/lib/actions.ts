import { goto } from "$app/navigation";
import type { Playlist, Song } from "$lib/schema";
import { libraryState, FAVOURITES_ID } from "$lib/state/library.svelte";
import { addToQueue, playNext, playTrack, startRadio } from "$lib/state/player.svelte";
import { toasts } from "$lib/state/toast.svelte";
import { ui, type MenuItem } from "$lib/state/ui.svelte";
import { isAndroid } from '$lib/platform';

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

    return [
        { label: "Play", icon: "play", action: () => playTrack(track) },
        { label: "Play next", icon: "list-start", action: () => { playNext(track); toasts.success("Playing next"); } },
        { label: "Add to queue", icon: "list-end", action: () => { addToQueue(track); toasts.success("Added to queue"); } },
        { label: "Start song radio", icon: "radio", action: () => radioFrom(track) },
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
