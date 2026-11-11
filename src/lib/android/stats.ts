import { matchesListeningFilter, type ListeningFilter } from '../listening-history.ts';
import type { MobileLibrary, SongName } from './storage';

export function summarize(state: MobileLibrary, limit = 30, filter?: ListeningFilter) {
    const nameFor = (id: string): SongName => {
        const song = state.songs[id]?.song;
        return song ? { title: song.title, artists: song.artists.map((a) => a.name), thumbnailUrl: song.thumbnails.find((t) => t.url)?.url }
            : state.names[id] ?? { title: id, artists: [] };
    };
    const events = filter ? state.events.filter((event) => matchesListeningFilter(event, nameFor(event.songId), filter)) : state.events;
    const songs = new Map<string, { playTimeMs: number; plays: number; lastPlayed: number }>();
    for (const e of events) {
        const song = songs.get(e.songId) ?? { playTimeMs: 0, plays: 0, lastPlayed: 0 };
        song.playTimeMs += e.playTimeMs;
        song.plays++;
        song.lastPlayed = Math.max(song.lastPlayed, e.timestamp);
        songs.set(e.songId, song);
    }
    const artists = new Map<string, { name: string; playTimeMs: number; plays: number; thumbnailUrl?: string }>();
    const ranked = [...songs].map(([id, stats]) => ({ id, ...nameFor(id), ...stats })).sort((a, b) => b.playTimeMs - a.playTimeMs);
    for (const song of ranked) {
        for (const name of new Set(song.artists)) {
            const artist = artists.get(name) ?? { name, playTimeMs: 0, plays: 0, thumbnailUrl: song.thumbnailUrl };
            artist.playTimeMs += song.playTimeMs;
            artist.plays += song.plays;
            artists.set(name, artist);
        }
    }
    return {
        topSongs: ranked.slice(0, limit),
        topArtists: [...artists.values()].sort((a, b) => b.playTimeMs - a.playTimeMs).slice(0, limit),
        history: [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit).map((e) => ({ id: e.songId, ...nameFor(e.songId), timestamp: e.timestamp, playTimeMs: e.playTimeMs })),
        totals: { totalPlayTimeMs: events.reduce((sum, e) => sum + e.playTimeMs, 0), totalPlays: events.length, uniqueSongs: songs.size },
    };
}
