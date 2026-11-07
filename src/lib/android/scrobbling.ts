import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { ScrobblingService, scrobblingRoutes, type ScrobbleData } from '../scrobbling/service';

const PATH = 'zeta/scrobbling.json';
const service = new ScrobblingService({
    async read() {
        try {
            const { data } = await Filesystem.readFile({ directory: Directory.Data, path: PATH, encoding: Encoding.UTF8 });
            return JSON.parse(data as string) as ScrobbleData;
        } catch (error) {
            if ((error as { code?: string }).code === 'OS-PLUG-FILE-0008') return null;
            throw error;
        }
    },
    async write(data) {
        await Filesystem.writeFile({ directory: Directory.Data, path: `${PATH}.tmp`, encoding: Encoding.UTF8, data: JSON.stringify(data), recursive: true });
        await Filesystem.rename({ directory: Directory.Data, from: `${PATH}.tmp`, to: PATH });
    },
}, { apiKey: import.meta.env.VITE_LASTFM_API_KEY || '', apiSecret: import.meta.env.VITE_LASTFM_API_SECRET || '' });

export const androidScrobbling = scrobblingRoutes(service);
