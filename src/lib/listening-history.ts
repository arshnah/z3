export interface ListeningFilter { query?: string; from?: number; until?: number }

export function matchesListeningFilter(
    event: { timestamp: number },
    name: { title: string; artists: string[] },
    filter?: ListeningFilter,
) {
    if (filter?.from !== undefined && event.timestamp < filter.from) return false;
    if (filter?.until !== undefined && event.timestamp >= filter.until) return false;
    const query = filter?.query?.trim().toLowerCase();
    return !query || `${name.title} ${name.artists.join(' ')}`.toLowerCase().includes(query);
}
