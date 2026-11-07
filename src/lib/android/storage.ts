import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Playlist, Song } from '../schema';
import { musicText } from '../music-metadata.ts';

export const FAVOURITES_ID = 'favourites.m3u8';
export const MUSIC_PATH = 'zeta';
const INDEX = `${MUSIC_PATH}/library.json`;

export interface StoredSong {
    song: Song;
    file?: string;
    mimetype?: string;
}

export interface PlayEvent {
    songId: string;
    playTimeMs: number;
    timestamp: number;
}

export interface SongName {
    title: string;
    artists: string[];
    thumbnailUrl?: string;
}

export interface MobileLibrary {
    version: 1;
    playlists: Playlist[];
    songs: Record<string, StoredSong>;
    events: PlayEvent[];
    names: Record<string, SongName>;
}

export function emptyLibrary(): MobileLibrary {
    return {
        version: 1,
        playlists: [{ id: FAVOURITES_ID, name: 'Favourites', tracks: [], createdAt: Date.now(), isProtected: true }],
        songs: {}, events: [], names: {},
    };
}

/** Serialize edits and commit via rename; failed writes leave the last good index intact. */
export class AndroidStorage {
    private filesystem: Pick<typeof Filesystem, 'mkdir' | 'readFile' | 'writeFile' | 'rename'>;
    private loading?: Promise<MobileLibrary>;
    private writing: Promise<unknown> = Promise.resolve();

    constructor(filesystem: Pick<typeof Filesystem, 'mkdir' | 'readFile' | 'writeFile' | 'rename'> = Filesystem) {
        this.filesystem = filesystem;
    }

    private load(): Promise<MobileLibrary> {
        return this.loading ??= this.read().catch((error) => {
            this.loading = undefined;
            throw error;
        });
    }

    private async read(): Promise<MobileLibrary> {
        await this.filesystem.mkdir({ directory: Directory.Data, path: `${MUSIC_PATH}/audio`, recursive: true }).catch((error) => {
            if (error.code !== 'OS-PLUG-FILE-0010') throw error;
        });
        let raw: string;
        try {
            raw = (await this.filesystem.readFile({ directory: Directory.Data, path: INDEX, encoding: Encoding.UTF8 })).data as string;
        } catch (error) {
            // Do not overwrite an unreadable/corrupt index with an empty library.
            if ((error as { code?: string }).code === 'OS-PLUG-FILE-0008') return emptyLibrary();
            throw error;
        }
        const data = JSON.parse(raw) as MobileLibrary;
        if (data.version !== 1 || !Array.isArray(data.playlists) || !data.songs || !Array.isArray(data.events) || !data.names) {
            throw new Error('The Android library index is invalid. Your music files have been preserved.');
        }
        const clean = (song: Song) => {
            song.title = musicText(song.title);
            song.artists = song.artists.map((artist) => ({ ...artist, name: musicText(artist.name) }));
            if (song.album) song.album.title = musicText(song.album.title);
        };
        for (const stored of Object.values(data.songs)) clean(stored.song);
        for (const playlist of data.playlists) for (const song of playlist.tracks) clean(song);
        return data;
    }

    async snapshot(): Promise<MobileLibrary> {
        await this.writing;
        return structuredClone(await this.load());
    }

    edit<T>(update: (library: MobileLibrary) => T): Promise<T> {
        const run = async () => {
            const library = structuredClone(await this.load());
            const result = update(library);
            await this.filesystem.writeFile({
                directory: Directory.Data, path: `${INDEX}.tmp`,
                data: JSON.stringify(library), encoding: Encoding.UTF8,
            });
            await this.filesystem.rename({ directory: Directory.Data, from: `${INDEX}.tmp`, to: INDEX });
            this.loading = Promise.resolve(library);
            return structuredClone(result);
        };
        const next = this.writing.then(run, run);
        this.writing = next.catch(() => {});
        return next;
    }
}

export function requirePlaylist(library: MobileLibrary, id: string, editable = false): Playlist {
    const playlist = library.playlists.find((p) => p.id === id);
    if (!playlist) throw new Error('Playlist not found.');
    if (editable && playlist.isProtected) throw new Error('Favourites cannot be renamed or deleted.');
    return playlist;
}

export function rememberSong(library: MobileLibrary, stored: StoredSong): Song {
    library.songs[stored.song.id] = stored;
    for (const playlist of library.playlists) {
        playlist.tracks = playlist.tracks.map((song) => song.id === stored.song.id ? stored.song : song);
    }
    return stored.song;
}
