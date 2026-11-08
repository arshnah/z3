import { Share } from '@capacitor/share';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { Song } from '../schema';
import { androidStorage } from './storage';

export async function shareSong(song: Song) {
    const text = `${song.title} — ${song.artists.map((a) => a.name).join(', ')}`;
    const stored = (await androidStorage.snapshot()).songs[song.id];
    if (stored?.file) {
        const extensions: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/x-wav': 'wav', 'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg', 'audio/webm': 'webm' };
        const extension = extensions[stored.mimetype ?? ''] ?? 'm4a';
        const name = song.title.replace(/\.(mp3|m4a|mp4|aac|wav|flac|ogg|opus|webm)$/i, '')
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'Zeta song';
        const path = `share/${name}.${extension}`;
        await Filesystem.mkdir({ directory: Directory.Cache, path: 'share', recursive: true }).catch((error) => {
            if (error.code !== 'OS-PLUG-FILE-0010') throw error;
        });
        await Filesystem.copy({ directory: Directory.Data, from: stored.file, toDirectory: Directory.Cache, to: path });
        const uri = await Filesystem.getUri({ directory: Directory.Cache, path });
        await Share.share({ title: song.title, text, files: [uri.uri], dialogTitle: 'Share audio' });
    } else {
        const url = song.id.startsWith('yt:') ? `https://music.youtube.com/watch?v=${encodeURIComponent(song.id.slice(3))}` : undefined;
        await Share.share({ title: song.title, text, url, dialogTitle: 'Share song' });
    }
}
