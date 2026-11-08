import type { Song } from './schema';

function normalize(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function artistKeys(song: Song): Set<string> {
    return new Set(
        song.artists
            .flatMap((artist) => artist.name.split(/\s*,\s*(?:&\s*)?|\s+(?:feat\.?|ft\.?)\s+|\s+&\s+/i))
            .map(normalize)
            .filter((artist) => artist && !['unknownartist', 'unknown'].includes(artist)),
    );
}

function isSameSong(left: Song, right: Song): boolean {
    if (left.id === right.id) return true;

    const title = normalize(left.title);
    if (!title || title !== normalize(right.title)) return false;

    const rightArtists = artistKeys(right);
    return [...artistKeys(left)].some((artist) => rightArtists.has(artist));
}

export function filterPlaylistRecommendations(
    recommendations: Song[],
    playlistTracks: Song[],
    limit = 8,
): Song[] {
    const known = [...playlistTracks];
    const filtered: Song[] = [];

    for (const recommendation of recommendations) {
        if (known.some((track) => isSameSong(recommendation, track))) continue;
        if (filtered.some((track) => isSameSong(recommendation, track))) continue;
        filtered.push(recommendation);
        known.push(recommendation);
        if (filtered.length >= limit) break;
    }

    return filtered;
}
