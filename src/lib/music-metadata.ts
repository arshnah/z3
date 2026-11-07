/** Providers sometimes return HTML entities in otherwise plain-text metadata. */
export function musicText(value: string): string {
    const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (full, entity: string) => {
        if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? full;
        const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : full;
    });
}

export function youtubeArtistNames(item: {
    artists?: { name: string }[]; authors?: { name: string }[];
    flex_columns?: ArrayLike<{ title: { toString(): string } }>;
}): string[] {
    const named = item.artists?.length ? item.artists : item.authors;
    if (named?.length) return named.map((artist) => musicText(artist.name));
    // Logged-out results can omit artist endpoints while retaining their text.
    const first = item.flex_columns?.[1]?.title.toString().split(/\s*[•·]\s*/)[0]?.trim();
    return first && !/^(?:\d[\d,.]*\s*(?:plays|views)|\d+:\d+)/i.test(first) ? [musicText(first)] : [];
}
