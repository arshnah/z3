import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import type { Routes } from '../../../electron/main';
import type { Library, Song, Stream } from '../schema';
import { androidStorage as storage, MUSIC_PATH, rememberSong, requirePlaylist, type StoredSong } from './storage';
import * as providers from './providers';
import { androidScrobbling } from './scrobbling';

type LocatedSong = StoredSong & { directory: Directory };
const downloads = new Map<string, Promise<LocatedSong>>();
const temporary = new Map<string, LocatedSong>();
const files = registerPlugin<{ importAudio(): Promise<{ songs: StoredSong[] }> }>('ZetaFiles');
const unsupported = async (): Promise<never> => { throw new Error('This feature is available in the desktop app.'); };
const noop = async () => {};

const songCache = new Map<string, Song>();
function cacheSongs(songs: Song[]) {
    for (const song of songs) songCache.set(song.id, song);
    return songs;
}

async function library(): Promise<Library> {
    const data = await storage.snapshot();
    // Imported files and explicit downloads also appear outside playlists.
    return {
        playlists: [...data.playlists, {
            id: 'downloads', name: 'Downloads', isProtected: true, createdAt: 0,
            tracks: Object.values(data.songs).filter((s) => s.file).map((s) => s.song),
        }],
        path: 'On this device',
    };
}

async function download(id: string, track?: Song, save = true): Promise<LocatedSong> {
    const requestKey = `${save ? 'saved' : 'cache'}:${id}`;
    const existing = downloads.get(requestKey);
    if (existing) return existing;
    const pending = (async () => {
        const data = await storage.snapshot();
        const stored = data.songs[id];
        if (stored?.file) {
            try {
                await Filesystem.stat({ directory: Directory.Data, path: stored.file });
                return { ...stored, directory: Directory.Data };
            } catch (error) {
                if ((error as { code?: string }).code !== 'OS-PLUG-FILE-0008') throw error;
            }
        }
        const cached = temporary.get(id);
        if (!save && cached?.file) {
            try {
                await Filesystem.stat({ directory: cached.directory, path: cached.file });
                return cached;
            } catch (error) {
                if ((error as { code?: string }).code !== 'OS-PLUG-FILE-0008') throw error;
                temporary.delete(id);
            }
        }
        const song = track ?? stored?.song ?? songCache.get(id);
        if (!song) throw new Error('Search for this song again before downloading it.');
        const audio = await providers.resolveAudio(id);
        const extension = audio.mimetype.includes('webm') ? 'webm' : 'm4a';
        const directory = save ? Directory.Data : Directory.Cache;
        if (!save) await Filesystem.mkdir({ directory, path: `${MUSIC_PATH}/audio`, recursive: true }).catch((error) => {
            if (error.code !== 'OS-PLUG-FILE-0010') throw error;
        });
        const path = `${MUSIC_PATH}/audio/${encodeURIComponent(id)}.${extension}`;
        const temp = `${path}.part`;
        const destination = await Filesystem.getUri({ directory, path: temp });
        try {
            await FileTransfer.downloadFile({
                url: audio.url, path: destination.uri,
                headers: { 'User-Agent': navigator.userAgent, Referer: 'https://www.youtube.com/' },
                connectTimeout: 20_000, readTimeout: 120_000,
            });
            const stat = await Filesystem.stat({ directory, path: temp });
            if (!stat.size) throw new Error('The provider returned an empty audio file.');
            await Filesystem.rename({ directory, from: temp, to: path });
            const result = { song: { ...song, isDownloaded: save }, file: path, mimetype: audio.mimetype, directory };
            if (save) await storage.edit((state) => rememberSong(state, result));
            else temporary.set(id, result);
            return result;
        } catch (error) {
            await Filesystem.deleteFile({ directory, path: temp }).catch(() => {});
            throw error;
        }
    })();
    downloads.set(requestKey, pending);
    try { return await pending; } finally { downloads.delete(requestKey); }
}

export async function importAudio(): Promise<void> {
    // Initialize directories/index before the native picker copies files.
    await storage.snapshot();
    const { songs } = await files.importAudio();
    for (const { song } of songs) {
        song.thumbnails = song.thumbnails.map((thumb) => ({ ...thumb, url: thumb.url ? Capacitor.convertFileSrc(thumb.url) : undefined }));
    }
    await storage.edit((state) => {
        for (const song of songs) rememberSong(state, song);
    });
}

export const androidClient: Routes = {
    ...androidScrobbling,
    async openScrobblingLink(url) {
        const target = new URL(url);
        if (target.protocol !== 'https:' || !['www.last.fm', 'last.fm', 'listenbrainz.org'].includes(target.hostname)) throw new Error('Invalid account connection link.');
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
    },
    async musicLoadLibrary() { return library(); },
    async musicSearch(query, provider) {
        const data = await storage.snapshot();
        return cacheSongs((await providers.search(query, provider)).map((song) => ({ ...song, isDownloaded: !!data.songs[song.id]?.file })));
    },
    musicSearchExtras: providers.searchExtras,
    async musicArtist(idOrQuery, nameHint) {
        const data = await storage.snapshot();
        const downloaded = new Set(Object.values(data.songs).filter((s) => s.file).map((s) => s.song.id));
        const res = await providers.artist(idOrQuery, nameHint, downloaded);
        cacheSongs(res.topSongs);
        return res;
    },
    async musicArtistSongs(artistId, nameHint) {
        const data = await storage.snapshot();
        const downloaded = new Set(Object.values(data.songs).filter((s) => s.file).map((s) => s.song.id));
        return cacheSongs(await providers.artistSongs(artistId, nameHint, downloaded));
    },
    async musicCollection(id) {
        const data = await storage.snapshot();
        const downloaded = new Set(Object.values(data.songs).filter((s) => s.file).map((s) => s.song.id));
        const res = await providers.collection(id, downloaded);
        cacheSongs(res.tracks);
        return res;
    },
    musicSearchSuggestions: providers.suggestions,
    musicLyrics: providers.lyrics,
    async musicStream(id, _encrypted, persist = true, track): Promise<Stream> {
        const state = await storage.snapshot();
        const save = !!state.songs[id]?.file || (persist && !!state.songs[id]);
        // Search-only/preloaded tracks use disposable cache storage, while
        // library tracks are kept offline just as they are on desktop.
        const stored = await download(id, track, save);
        const uri = await Filesystem.getUri({ directory: stored.directory, path: stored.file! });
        return { data: new Uint8Array(), url: Capacitor.convertFileSrc(uri.uri), nativeUri: uri.uri, mimetype: stored.mimetype!, savedToDisk: stored.directory === Directory.Data };
    },
    async musicDownloadSong(track, id) {
        if (!track && !id) throw new Error('Choose a song to download.');
        return (await download(track?.id ?? id!, track)).song;
    },
    async musicPlaylistCreate(name) {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Enter a playlist name.');
        return storage.edit((state) => {
            const playlist = { id: `${crypto.randomUUID()}.m3u8`, name: trimmed, tracks: [], createdAt: Date.now() };
            state.playlists.push(playlist);
            return playlist;
        });
    },
    async musicPlaylistRename(id, name) {
        if (!name.trim()) throw new Error('Enter a playlist name.');
        return storage.edit((state) => { const p = requirePlaylist(state, id, true); p.name = name.trim(); return p; });
    },
    async musicPlaylistDelete(id) {
        await storage.edit((state) => {
            requirePlaylist(state, id, true);
            state.playlists = state.playlists.filter((p) => p.id !== id);
        });
    },
    async musicPlaylistAddTrack(id, track, trackId) {
        const data = await storage.snapshot();
        const key = track?.id ?? trackId;
        const song = key ? data.songs[key]?.song ?? track ?? songCache.get(key) : undefined;
        if (!song) throw new Error('Choose a song to add.');
        return storage.edit((state) => {
            const playlist = requirePlaylist(state, id);
            state.songs[song.id] ??= { song };
            const canonical = state.songs[song.id].song;
            if (!playlist.tracks.some((t) => t.id === song.id)) playlist.tracks.push(canonical);
            return canonical;
        });
    },
    async musicPlaylistRemoveTrack(id, trackId) {
        await storage.edit((state) => { const p = requirePlaylist(state, id); p.tracks = p.tracks.filter((t) => t.id !== trackId); });
    },
    async musicPlaylistReorder(id, ids) {
        return storage.edit((state) => {
            const playlist = requirePlaylist(state, id);
            const tracks = new Map(playlist.tracks.map((song) => [song.id, song]));
            if (ids.length !== tracks.size || new Set(ids).size !== tracks.size || ids.some((key) => !tracks.has(key))) {
                throw new Error('The playlist changed. Refresh it before reordering.');
            }
            playlist.tracks = ids.map((key) => tracks.get(key)!);
            return playlist;
        });
    },
    async musicPlaylistUpdateThumbnail(id, thumbnail) {
        return storage.edit((state) => { const p = requirePlaylist(state, id); p.thumbnail = thumbnail; return p; });
    },
    async musicRadio(seed, exclude = []) {
        const provider = seed.id.startsWith('js:') ? 'js' : 'yt';
        const songs = await androidClient.musicSearch(`${seed.artists[0]?.name ?? ''} ${seed.title}`, provider);
        const omitted = new Set([seed.id, ...exclude]);
        return songs.filter((s) => !omitted.has(s.id)).slice(0, 20);
    },
    async musicRepairMetadata() { return { repaired: [], remaining: 0 }; },
    async musicCover() { return null; },
    async fetchImage(url) {
        const response = await fetch(url);
        if (!response.ok) return null;
        return { data: new Uint8Array(await response.arrayBuffer()), mimetype: response.headers.get('content-type') || 'image/jpeg' };
    },
    async getSettings() { return { musicDir: 'On this device', isRemote: false }; },
    setMusicDir: unsupported, pickMusicDirectory: unsupported,
    muzzaExport: unsupported, muzzaImport: unsupported, muzzaExportTo: unsupported, muzzaImportFrom: unsupported,
    async statsRecordEvent(songId, playTimeMs, timestamp = Date.now(), name) {
        if (!songId || !Number.isFinite(playTimeMs) || playTimeMs < 1000) return;
        await storage.edit((state) => {
            state.events.push({ songId, playTimeMs: Math.round(playTimeMs), timestamp });
            if (name) state.names[songId] = name;
        });
    },
    async statsSummary(limit = 30) {
        const { summarize } = await import('./stats');
        return summarize(await storage.snapshot(), limit);
    },
    mprisUpdate: noop, clearRPC: noop, async setRPC() { return null; }, async rpcArtwork() { return ''; },
    windowMinimize: noop, async windowMaximizeToggle() { return false; }, async windowIsMaximized() { return false; },
    windowClose: noop, windowResizeStart: noop, windowResizeMove: noop, windowResizeEnd: noop,
};
