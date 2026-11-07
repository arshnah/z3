import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ScrobblingService, scrobblingRoutes, type ScrobbleData } from '../../src/lib/scrobbling/service';

function path() {
    if (!process.env.ZETA_CONFIG_DIR) throw new Error('Application settings are unavailable.');
    return join(process.env.ZETA_CONFIG_DIR, 'scrobbling.json');
}

const service = new ScrobblingService({
    async read() {
        try { return JSON.parse(await readFile(path(), 'utf8')) as ScrobbleData; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async write(data) {
        await mkdir(process.env.ZETA_CONFIG_DIR!, { recursive: true });
        const destination = path();
        await writeFile(`${destination}.tmp`, JSON.stringify(data), { mode: 0o600 });
        await rename(`${destination}.tmp`, destination);
    },
}, {
    apiKey: import.meta.env.VITE_LASTFM_API_KEY || '',
    apiSecret: import.meta.env.VITE_LASTFM_API_SECRET || '',
});

export const routes = scrobblingRoutes(service);
