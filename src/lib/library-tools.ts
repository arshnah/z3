import type { Song } from './schema';

export interface StoredAudio {
    id: string;
    title: string;
    bytes: number;
    removable: boolean;
}

export interface StorageSummary {
    audio: StoredAudio[];
    cacheBytes: number;
}

function normalized(value: string) {
    return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function duplicateSongs(songs: Iterable<Song>) {
    const groups = new Map<string, Song[]>();
    const ids = new Set<string>();
    for (const song of songs) {
        if (ids.has(song.id)) continue;
        ids.add(song.id);
        const title = normalized(song.title);
        const artist = normalized(song.artists[0]?.name ?? '');
        if (!title || !artist || artist === 'unknown artist') continue;
        const key = JSON.stringify([title, artist]);
        const group = groups.get(key) ?? [];
        group.push(song);
        groups.set(key, group);
    }
    return [...groups.values()].filter((group) => group.length > 1);
}

export function formatStorage(bytes: number): string {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
