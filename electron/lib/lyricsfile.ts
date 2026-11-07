/**
 * Lyricsfile (https://github.com/tranxuanthang/lyricsfile) is the YAML format
 * LRCLIB uses internally. An lrclib record's `lyricsfile` is the source of
 * truth: its `syncedLyrics` field only ever carries *line* timings, even when
 * `hasWordSync` is true, so word timings exist only in here.
 *
 * Zeta renders enhanced LRC — `[line]<word>word<wordEnd>word` — so this module
 * reads just the parts of a Lyricsfile that hold timings and turns them into
 * that shape. Only a deliberately small subset of YAML is supported: the
 * structure the format specifies (a mapping at every level, sequences of
 * mappings, plain/quoted scalars). Anything else is ignored rather than
 * guessed at, and a broken document yields null.
 */

interface LyricsfileWord {
    text?: string;
    start?: number;
    end?: number;
}

interface LyricsfileLine {
    text?: string;
    start?: number;
    end?: number;
    words: LyricsfileWord[];
}

/** `[mm:ss.xxx]`-style timestamp body for enhanced LRC. */
function stamp(ms: number): string {
    const total = Math.max(0, ms) / 1000;
    const m = Math.floor(total / 60);
    const s = (total - m * 60).toFixed(3).padStart(6, '0');
    return `${String(m).padStart(2, '0')}:${s}`;
}

/** Index of a scalar's closing quote, respecting escapes and `''` in single quotes. */
function closingQuote(s: string, quote: string): number {
    for (let i = 1; i < s.length; i++) {
        if (quote === '"' && s[i] === '\\') {
            i++;
            continue;
        }
        if (s[i] === quote) {
            if (quote === "'" && s[i + 1] === "'") {
                i++;
                continue;
            }
            return i;
        }
    }
    return s.length;
}

const SIMPLE_ESCAPES: Record<string, string> = {
    '"': '"',
    '\\': '\\',
    '/': '/',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
};

/** An unquoted, double-quoted or single-quoted YAML scalar, without its quotes. */
function scalar(raw: string): string {
    const s = raw.trim();
    if (s.startsWith('"')) {
        const body = s.slice(1, closingQuote(s, '"'));
        try {
            return JSON.parse(`"${body}"`);
        } catch {
            // YAML allows escapes JSON doesn't; decode the common ones by hand.
            return body
                .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
                .replace(/\\(.)/g, (whole: string, ch: string) => SIMPLE_ESCAPES[ch] ?? whole);
        }
    }
    if (s.startsWith("'")) return s.slice(1, closingQuote(s, "'")).replace(/''/g, "'");
    // Plain scalar: a " # comment" tail isn't part of the value.
    return s.replace(/\s+#.*$/, '');
}

/** Assign `key: value` to a line or a word. Unknown keys are ignored. */
function assign(target: LyricsfileWord, source: string): void {
    const m = source.match(/^([\w-]+):\s*(.*)$/);
    if (!m) return;
    const [, key, raw] = m;
    if (key === 'text') target.text = scalar(raw);
    else if (key === 'start_ms' || key === 'end_ms') {
        const n = Number.parseInt(raw.trim(), 10);
        if (Number.isFinite(n)) target[key === 'start_ms' ? 'start' : 'end'] = n;
    }
}

/** Read the `lines:` sequence of a Lyricsfile document. */
function parseLines(yaml: string): LyricsfileLine[] {
    const lines: LyricsfileLine[] = [];
    let section = '';
    let line: LyricsfileLine | null = null;
    let lineIndent = -1;
    let word: LyricsfileWord | null = null;
    let wordIndent = -1;

    const closeWord = () => {
        if (word && word.text !== undefined && word.start !== undefined && line) line.words.push(word);
        word = null;
        wordIndent = -1;
    };
    const closeLine = () => {
        closeWord();
        if (line) lines.push(line);
        line = null;
        lineIndent = -1;
    };

    for (const raw of yaml.replace(/\r\n?/g, '\n').split('\n')) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const indent = raw.length - raw.trimStart().length;

        if (indent === 0) {
            // A top-level key ends whatever section came before it.
            closeLine();
            section = trimmed.match(/^([\w-]+):/)?.[1] ?? '';
            continue;
        }
        if (section !== 'lines') continue;

        if (trimmed.startsWith('- ')) {
            if (line && indent > lineIndent) {
                // Deeper than the line's keys: an item of its `words:` list.
                closeWord();
                word = {};
                wordIndent = indent;
                assign(word, trimmed.slice(2));
                continue;
            }
            closeLine();
            line = { words: [] };
            lineIndent = indent;
            assign(line, trimmed.slice(2));
            continue;
        }

        // Keys are indented deeper than the sequence dash that owns them.
        if (word && indent > wordIndent) {
            assign(word, trimmed);
            continue;
        }
        closeWord();
        if (!trimmed.startsWith('words:') && line) assign(line, trimmed);
    }
    closeLine();
    return lines;
}

/** One Lyricsfile line as enhanced LRC, or null when it has no usable timing. */
function lineToLrc(line: LyricsfileLine): string | null {
    const text = (line.text ?? '').trim();
    const words = line.words.filter((w) => w.text !== undefined && w.text.trim() !== '');
    const start = line.start ?? words[0]?.start;
    if (start === undefined) return null;
    if (!text && !words.length) return null;

    let out = `[${stamp(start)}]`;
    // Line-level timing only: keep the text and let the UI estimate the sweep.
    if (!words.length) return out + text;

    words.forEach((word, i) => {
        const next = words[i + 1];
        const at = word.start ?? start;
        const end = word.end ?? next?.start;
        out += `<${stamp(at)}>${word.text}`;
        // A bare tag (no text) says where the word stopped. It's only needed
        // when that's before the next word starts (a pause/long note), but for
        // the last word it says where the singing actually ends.
        if (end !== undefined && (next ? next.start !== undefined && next.start - end > 250 : end > at)) {
            out += `<${stamp(end)}>`;
        }
    });
    return out;
}

/**
 * Convert a Lyricsfile YAML document to enhanced LRC, or null when it has no
 * synchronized lines. Word timings are used as-is; lines without `words` keep
 * their line timing and the UI falls back to its usual estimated sweep.
 */
export function lyricsfileToLrc(yaml: string): string | null {
    if (!yaml || !yaml.includes('lines:')) return null;
    const lines = parseLines(yaml)
        .map(lineToLrc)
        .filter((line): line is string => line !== null);
    return lines.length >= 2 ? lines.join('\n') : null;
}

/** Lowercase letters/digits only, without "(feat. …)", "[Remix]" and the like. */
export function comparableText(s: string): string {
    return s
        .toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface LrclibRecord {
    id: number;
    trackName: string;
    artistName: string;
    duration: number;
    instrumental: boolean;
    hasWordSync?: boolean;
    plainLyrics: string | null;
    syncedLyrics: string | null;
    lyricsfile?: string | null;
}

export interface LrclibLyrics {
    wordSynced?: string;
    synced?: string;
    plain?: string;
}

/** Do a record's title, artist and duration describe this track? */
export function isLrclibMatch(
    record: LrclibRecord,
    track: { title: string; artists: { name: string }[]; duration: number },
): boolean {
    const title = comparableText(track.title);
    const theirTitle = comparableText(String(record.trackName ?? ''));
    if (!title || !theirTitle || (!theirTitle.includes(title) && !title.includes(theirTitle))) return false;

    const artists = track.artists.map((a) => comparableText(a.name)).filter(Boolean);
    const theirs = comparableText(String(record.artistName ?? ''));
    if (artists.length && !artists.some((a) => theirs.includes(a) || a.includes(theirs))) return false;

    if (track.duration && record.duration && Math.abs(record.duration - track.duration) > 5) return false;
    return true;
}

/**
 * Query lrclib for a track, preferring word-synced lyrics over line-synced over
 * plain. Shared by both the desktop backend and Android.
 */
export async function fetchLrclib(
    track: { title: string; artists: { name: string }[]; duration: number },
    headers?: Record<string, string>,
): Promise<LrclibLyrics | null> {
    const enc = encodeURIComponent;
    const artist = track.artists[0]?.name ?? '';
    const duration = track.duration ? `&duration=${Math.round(track.duration)}` : '';
    const records: LrclibRecord[] = [];
    const add = (record: LrclibRecord) => {
        if (isLrclibMatch(record, track) && !records.some((r) => r.id === record.id)) records.push(record);
    };

    const req = async (path: string): Promise<unknown> => {
        try {
            const res = await fetch(`https://lrclib.net/api/${path}`, {
                ...(headers ? { headers } : {}),
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    };

    if (artist) {
        const exact = (await req(`get?artist_name=${enc(artist)}&track_name=${enc(track.title)}${duration}`)) as LrclibRecord | null;
        if (exact) add(exact);
    }

    if (!records.length) {
        const byTitle = (await req(`search?track_name=${enc(track.title)}`)) as LrclibRecord[] | null;
        for (const record of Array.isArray(byTitle) ? byTitle : []) add(record);
        const byArtist = artist ? ((await req(`search?q=${enc(artist.toLowerCase())}`)) as LrclibRecord[] | null) : null;
        for (const record of Array.isArray(byArtist) ? byArtist : []) add(record);
    }

    if (!records.length) return null;

    const quality = (r: LrclibRecord) =>
        (r.hasWordSync && r.lyricsfile ? 4 : 0) + (r.syncedLyrics ? 2 : 0) + (r.plainLyrics ? 1 : 0);
    const distance = (r: LrclibRecord) => Math.abs((r.duration || track.duration) - track.duration);
    records.sort((a, b) => quality(b) - quality(a) || distance(a) - distance(b));
    const best = records[0];

    const wordSynced = best.hasWordSync && best.lyricsfile ? lyricsfileToLrc(best.lyricsfile) : null;
    const lyrics: LrclibLyrics = {};
    if (wordSynced) lyrics.wordSynced = wordSynced;
    if (best.syncedLyrics) lyrics.synced = best.syncedLyrics;
    if (best.plainLyrics) lyrics.plain = best.plainLyrics;
    return lyrics;
}
