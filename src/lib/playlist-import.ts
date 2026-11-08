export interface ExportifyTrack {
    title: string;
    artists: string[];
    album: string;
    uri: string;
    durationSeconds: number;
}

function parseCsvRows(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    const text = content.replace(/^\uFEFF/, '');

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            if (field) throw new Error('Invalid CSV: unexpected quote in an unquoted field.');
            quoted = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            if (row.some((value) => value.trim())) rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (quoted) throw new Error('Invalid CSV: an unterminated quoted field was found.');
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
    return rows;
}

export function parseExportifyCsv(content: string): ExportifyTrack[] {
    const [headers, ...rows] = parseCsvRows(content);
    if (!headers) throw new Error('The CSV file is empty.');

    const columns = new Map(headers.map((header, index) => [header.trim().toLowerCase(), index]));
    const titleIndex = columns.get('track name');
    const artistsIndex = columns.get('artist name(s)');
    if (titleIndex === undefined || artistsIndex === undefined) {
        throw new Error('This CSV is missing the Track Name or Artist Name(s) column. Export the playlist with Exportify.');
    }

    const value = (row: string[], name: string) => {
        const index = columns.get(name.toLowerCase());
        return index === undefined ? '' : (row[index] ?? '').trim();
    };

    return rows.flatMap((row) => {
        const title = row[titleIndex]?.trim() ?? '';
        const artists = (row[artistsIndex] ?? '')
            .split(/\s*;\s*/)
            .map((artist) => artist.trim())
            .filter(Boolean);
        if (!title || !artists.length) return [];

        const durationMs = Number(value(row, 'duration (ms)'));
        return [{
            title,
            artists,
            album: value(row, 'album name'),
            uri: value(row, 'track uri'),
            durationSeconds: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0,
        }];
    });
}
