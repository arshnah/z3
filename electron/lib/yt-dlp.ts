import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { MAX_BITRATE_KBPS, type AudioQuality } from '../../src/lib/audio-quality.ts';

const execFileAsync = promisify(execFile);
const MAX_COOKIE_FILE_BYTES = 1024 * 1024;

export async function readYoutubeCookies(path: string): Promise<string> {
    let contents: string;
    try {
        if (!isAbsolute(path)) throw new Error();
        const info = await stat(path);
        if (!info.isFile() || info.size > MAX_COOKIE_FILE_BYTES) throw new Error();
        contents = await readFile(path, 'utf8');
    } catch {
        throw new Error('Could not read the YouTube cookies file. Choose it again in Settings.');
    }

    const [header, ...lines] = contents.split(/\r?\n/);
    if (header !== '# Netscape HTTP Cookie File' && header !== '# HTTP Cookie File') {
        throw new Error('Choose a Netscape-format cookies.txt file.');
    }
    const cookies = lines.filter((line) => {
        const fields = line.replace(/^#HttpOnly_/, '').split('\t');
        return fields.length === 7 && /^(?:\.?youtube\.com|\.?[\w.-]+\.youtube\.com)$/i.test(fields[0]);
    });
    if (!cookies.length) throw new Error('The selected file contains no YouTube cookies.');
    return [header, ...cookies, ''].join('\n');
}

export async function downloadWithYtDlp(
    videoId: string,
    quality: AudioQuality,
    source: { cookiesFile: string | null; browserProfile?: string },
): Promise<Buffer> {
    const { cookiesFile, browserProfile } = source;
    if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');

    const temp = await mkdtemp(join(tmpdir(), 'zeta-youtube-'));
    try {
        const args = [
            '--ignore-config', '--no-playlist', '--no-progress', '--js-runtimes', 'node',
            '--format', 'bestaudio[ext=m4a][protocol=https]',
            '--format-sort-force',
            '--format-sort', quality === 'best' ? 'abr' : `abr:${MAX_BITRATE_KBPS[quality]}`,
            '--output', '-',
        ];

        if (browserProfile) {
            args.push('--cookies-from-browser', browserProfile, '--no-plugin-dirs');
        } else if (cookiesFile) {
            // yt-dlp can write refreshed cookies back to its input. Give each
            // download its own copy and keep unrelated browser cookies out.
            const cookies = await readYoutubeCookies(cookiesFile);
            const privateCopy = join(temp, 'cookies.txt');
            await writeFile(privateCopy, cookies, { mode: 0o600 });
            args.push('--cookies', privateCopy);
        }

        args.push('--', `https://www.youtube.com/watch?v=${videoId}`);
        const { stdout } = await execFileAsync('yt-dlp', args, {
            cwd: temp,
            encoding: 'buffer',
            maxBuffer: 128 * 1024 * 1024,
            timeout: 90_000,
            windowsHide: true,
        }).catch((error: NodeJS.ErrnoException & { stderr?: Buffer; killed?: boolean }) => {
            if (error.code === 'ENOENT') {
                throw new Error('YouTube playback failed. Install yt-dlp on PATH to enable the desktop fallback.');
            }
            if (error.killed) throw new Error('The YouTube download via yt-dlp timed out.');
            const stderr = error.stderr?.toString() ?? '';
            if (browserProfile && /decrypt|could not copy|cookie database|file is not a database|failed to load (?:browser )?cookies|failed to extract|keychain|keyring/i.test(stderr)) {
                throw new Error('yt-dlp could not read cookies from this browser profile. Close the browser and retry, or choose Firefox or a cookies file in Settings.');
            }
            if (/sign in|log in|cookies.*(?:expired|invalid)/i.test(stderr)) {
                if (browserProfile) throw new Error('YouTube requested sign-in. Sign in to YouTube in the selected browser profile and retry.');
                throw new Error(cookiesFile
                    ? 'YouTube rejected the session. Choose a fresh cookies.txt file in Settings.'
                    : 'YouTube requested sign-in. Choose a signed-in browser profile or a YouTube cookies file in Settings.');
            }
            // CLI errors may include signed media URLs or local file paths.
            throw new Error('yt-dlp could not download YouTube audio. Check that yt-dlp and Node.js 22+ or Deno are up to date.');
        });
        if (!stdout.length) throw new Error('yt-dlp returned empty YouTube audio.');
        return stdout;
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
}
