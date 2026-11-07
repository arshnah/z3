import { CapacitorHttp } from '@capacitor/core';
import { Song as Saavn } from '@saavn-labs/sdk';
import { Innertube, Parser, Platform } from 'youtubei.js/web';
import type { MusicProvider, Song } from '../schema';
import { musicText, youtubeArtistNames } from '../music-metadata';

// Use the native HTTP API explicitly for YouTube: Request/Headers in a WebView
// otherwise discard the Origin/User-Agent headers the service expects.
const nativeFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers = Object.fromEntries(new Headers(init?.headers ?? request.headers));
    headers.Origin = 'https://www.youtube.com';
    headers['User-Agent'] ??= navigator.userAgent;
    const method = init?.method ?? request.method;
    const body = init?.body ?? (method !== 'GET' && method !== 'HEAD' ? await request.clone().text() : undefined);
    const response = await CapacitorHttp.request({
        url: request.url, method, headers, data: body,
        responseType: 'arraybuffer', connectTimeout: 20_000, readTimeout: 30_000,
    });
    // Capacitor returns parsed objects for application/json even when an
    // arraybuffer was requested; other successful responses are base64.
    const contentType = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
    const bodyData = contentType.includes('application/json') || response.status >= 400
        ? (typeof response.data === 'string' ? response.data : JSON.stringify(response.data))
        : Uint8Array.from(atob(response.data as string), (c) => c.charCodeAt(0));
    return new Response([204, 205, 304].includes(response.status) ? null : bodyData, {
        status: response.status, headers: response.headers,
    });
};

// youtubei's web entry has no Node imports and uses the real WebView for its
// player interpreter. No desktop utility process is needed on the phone.
Platform.shim.eval = async (data) => new Function(data.output)();
Parser.setParserErrorHandler(() => {});
let youtube: Promise<Innertube> | undefined;
function yt() {
    return youtube ??= Innertube.create({ fetch: nativeFetch }).catch((error) => {
        youtube = undefined;
        throw error;
    });
}

function saavnSong(s: Awaited<ReturnType<typeof Saavn.search>>['results'][number]): Song {
    const images = (list: { url: string; resolution: string }[] = []) => list.map((image) => ({
        url: image.url, width: parseInt(image.resolution), height: parseInt(image.resolution),
    }));
    return {
        id: `js:${s.id}`, title: musicText(s.title || 'Untitled'), thumbnails: images(s.images),
        artists: (s.artists?.all ?? []).slice(0, 3).map((a) => ({ name: musicText(a.name), thumbnails: images(a.images) })),
        album: s.album ? { title: musicText(s.album.title || 'Untitled Album'), thumbnails: [], artists: [] } : null,
        duration: s.duration || 0, isDownloaded: false,
    };
}

export async function search(query: string, provider: MusicProvider): Promise<Song[]> {
    if (provider === 'js') return (await Saavn.search({ query, limit: 30 })).results.map(saavnSong);
    if (provider !== 'yt') throw new Error('Choose YouTube Music or JioSaavn to search.');
    const results = await (await yt()).music.search(query, { type: 'song' });
    return (results.songs?.contents ?? []).map((s) => ({
        id: `yt:${s.id}`, title: s.title || 'Untitled',
        thumbnails: s.thumbnails.map((t) => ({ url: t.url, width: t.width, height: t.height })),
        artists: youtubeArtistNames(s).map((name) => ({ name, thumbnails: [] })),
        album: s.album ? { title: s.album.name, artists: [], thumbnails: [] } : null,
        duration: s.duration?.seconds || 0, isDownloaded: false,
    }));
}

export async function suggestions(query: string): Promise<string[]> {
    const sections = await (await yt()).music.getSearchSuggestions(query);
    return (sections?.[0]?.contents ?? []).flatMap((s) => {
        const suggestion = (s as { suggestion?: { text?: string } }).suggestion?.text;
        return suggestion ? [suggestion] : [];
    });
}

export async function resolveAudio(id: string): Promise<{ url: string; mimetype: string }> {
    if (id.startsWith('js:')) {
        const song = (await Saavn.getById({ songIds: id.slice(3) })).songs?.[0];
        const encrypted = song?.media?.encryptedUrl;
        if (!encrypted) throw new Error('JioSaavn did not return audio for this song.');
        const formats = await Saavn.experimental.fetchStreamUrls(encrypted, 'edge', true);
        const best = formats.toSorted((a, b) => parseInt(b.bitrate) - parseInt(a.bitrate))[0];
        if (!best) throw new Error('No playable JioSaavn audio was found.');
        return { url: best.url, mimetype: 'audio/mp4' };
    }
    if (!id.startsWith('yt:')) throw new Error('This song is not available on the phone. Import its audio file first.');
    const tube = await yt();
    const { mintPoToken } = await import('./potoken');
    const token = await mintPoToken(id.slice(3));
    const info = await tube.getBasicInfo(id.slice(3), { client: 'YTMUSIC' });
    const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'mp4' });
    const url = new URL(await format.decipher(tube.session.player));
    url.searchParams.set('pot', token);
    if (format.content_length) url.searchParams.set('range', `0-${Number(format.content_length) - 1}`);
    return { url: url.href, mimetype: format.mime_type || 'audio/mp4' };
}

export async function lyrics(track: Song): Promise<string | null> {
    if (track.lyrics) return track.lyrics;
    const query = new URLSearchParams({ track_name: track.title, artist_name: track.artists[0]?.name ?? '' });
    if (track.duration) query.set('duration', String(Math.round(track.duration)));
    const response = await fetch(`https://lrclib.net/api/get?${query}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.syncedLyrics || data.plainLyrics || null;
}
