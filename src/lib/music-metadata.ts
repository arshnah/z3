import type { Artist } from './schema';

/** Providers sometimes return HTML entities in otherwise plain-text metadata. */
export function musicText(value: string): string {
    const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (full, entity: string) => {
        if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? full;
        const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : full;
    });
}

type YtArtistLike = {
    name: string;
    channel_id?: string;
    endpoint?: { payload?: { browseId?: string } };
};

export function youtubeArtists(item: {
    artists?: YtArtistLike[];
    authors?: YtArtistLike[];
    author?: YtArtistLike | string;
    flex_columns?: ArrayLike<{
        title: {
            toString(): string;
            runs?: { text: string; endpoint?: { payload?: { browseId?: string } } }[];
        };
    }>;
}): Artist[] {
    const named = item.artists?.length ? item.artists : item.authors;
    if (named?.length) {
        return named
            .map((a) => {
                const name = musicText(a.name || '').trim();
                const browseId = a.channel_id || a.endpoint?.payload?.browseId;
                return {
                    name,
                    ...(browseId && browseId.startsWith('UC') ? { id: `yt:${browseId}` } : {}),
                    thumbnails: [],
                };
            })
            .filter((a) => !!a.name);
    }
    if (item.author && typeof item.author === 'object' && item.author.name) {
        const browseId = item.author.channel_id || item.author.endpoint?.payload?.browseId;
        return [{
            name: musicText(item.author.name).trim(),
            ...(browseId && browseId.startsWith('UC') ? { id: `yt:${browseId}` } : {}),
            thumbnails: [],
        }];
    }
    // Check runs in flex_columns[1] for artist browse endpoints before falling back to text.
    const col1 = item.flex_columns?.[1]?.title;
    if (col1?.runs?.length) {
        const fromRuns: Artist[] = [];
        for (const run of col1.runs) {
            const text = musicText(run.text || '').trim();
            if (!text || /^[•·,&]+$/.test(text)) continue;
            if (/^[•·]/.test(run.text || '')) break;
            const browseId = run.endpoint?.payload?.browseId;
            if (browseId?.startsWith('UC')) {
                fromRuns.push({ id: `yt:${browseId}`, name: text, thumbnails: [] });
            }
        }
        if (fromRuns.length) return fromRuns;
    }
    const first = col1?.toString().split(/\s*[•·]\s*/)[0]?.trim();
    if (first && !/^(?:\d[\d,.]*\s*(?:plays|views)|\d+:\d+|album|single|ep|song|video|playlist)$/i.test(first)) {
        return [{ name: musicText(first), thumbnails: [] }];
    }
    return [];
}

export function youtubeArtistNames(item: {
    artists?: { name: string }[]; authors?: { name: string }[];
    flex_columns?: ArrayLike<{ title: { toString(): string } }>;
}): string[] {
    return youtubeArtists(item).map((a) => a.name);
}

/**
 * Break an artist list into individual clickable credits, splitting combined
 * strings like "K-391, Alan Walker, & Ahrix" or "DJ Snake & Bipolar Sunshine"
 * while preserving the original separators between them.
 */
export function splitArtistCredits(
    artists: readonly { id?: string; name: string; thumbnails?: Artist['thumbnails'] }[] | null | undefined,
): { id?: string; name: string; sep: string; thumbnails: Artist['thumbnails'] }[] {
    if (!artists?.length) return [];
    const out: { id?: string; name: string; sep: string; thumbnails: Artist['thumbnails'] }[] = [];
    const SEP_RE = /(\s*,\s*(?:&\s*)?|\s+(?:feat\.?|ft\.?)\s+|\s+&\s+)/gi;

    artists.forEach((artist, idx) => {
        const raw = (artist.name ?? '').trim();
        if (!raw) return;
        const trailingSep = idx < artists.length - 1 ? ', ' : '';
        if (artist.id || !SEP_RE.test(raw)) {
            SEP_RE.lastIndex = 0;
            out.push({ id: artist.id, name: raw, sep: trailingSep, thumbnails: artist.thumbnails ?? [] });
            return;
        }
        SEP_RE.lastIndex = 0;
        const parts = raw.split(SEP_RE);
        for (let i = 0; i < parts.length; i += 2) {
            const name = parts[i]?.trim();
            if (!name) continue;
            const sep = i + 1 < parts.length ? parts[i + 1] : trailingSep;
            out.push({ name, sep, thumbnails: [] });
        }
    });
    return out;
}
