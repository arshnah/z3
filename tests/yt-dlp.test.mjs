import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

test('a desktop launch with a minimal PATH finds yt-dlp and passes the selected profile', {
    skip: process.platform === 'win32',
}, async () => {
    const home = await mkdtemp(join(tmpdir(), 'zeta-yt-dlp-test-'));
    try {
        const bin = join(home, '.local', 'bin');
        const profile = 'firefox:' + join(home, 'browser profile');
        await mkdir(bin, { recursive: true });
        await writeFile(join(bin, 'yt-dlp'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
        const module = new URL('../electron/lib/yt-dlp.ts', import.meta.url).href;
        const { stdout } = await promisify(execFile)(process.execPath, [
            '--experimental-strip-types', '--input-type=module', '-e', `
            import { downloadWithYtDlp } from ${JSON.stringify(module)};
            process.stdout.write(await downloadWithYtDlp('ujUUZpognrY', 'best', {
                cookiesFile: null, browserProfile: ${JSON.stringify(profile)},
            }));
        `,
        ], { env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin' } });
        const args = stdout.trimEnd().split('\n');
        assert.ok(args.includes('--ignore-config'));
        assert.equal(args[args.indexOf('--cookies-from-browser') + 1], profile);
        assert.equal(args.includes('--cookies'), false);
    } finally {
        await rm(home, { recursive: true, force: true });
    }
});
