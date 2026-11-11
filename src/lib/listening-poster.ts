import { client } from '$lib/ephaptic';
import { isCoverUrl, coverIdFromUrl } from '$lib/covers';
import { isAndroid } from '$lib/platform';

type Summary = Awaited<ReturnType<typeof client.statsSummary>>;

async function cover(url?: string) {
    if (!url) return null;
    try {
        const asset = isCoverUrl(url) ? await client.musicCover(coverIdFromUrl(url)) : await client.fetchImage(url);
        if (!asset?.data.length) return null;
        return await createImageBitmap(new Blob([new Uint8Array(asset.data)], { type: asset.mimetype }));
    } catch { return null; }
}

export async function shareListeningPoster(month: string, summary: Summary) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1320;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create the listening poster.');
    const songs = summary.topSongs.slice(0, 9);
    const covers = await Promise.all(songs.map(({ thumbnailUrl }) => cover(thumbnailUrl)));
    ctx.fillStyle = '#141021';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f6edff';
    ctx.font = 'bold 66px sans-serif';
    ctx.fillText('My month in Zeta', 64, 112);
    ctx.font = '30px sans-serif';
    ctx.fillText(month, 65, 167);
    songs.forEach((song, i) => {
        const x = 64 + (i % 3) * 318;
        const y = 222 + Math.floor(i / 3) * 314;
        const image = covers[i];
        ctx.fillStyle = '#2f2148';
        ctx.fillRect(x, y, 295, 266);
        if (image) {
            const size = Math.min(image.width, image.height);
            ctx.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, x, y, 295, 266);
            image.close();
        }
        ctx.fillStyle = '#f6edff';
        ctx.font = 'bold 21px sans-serif';
        ctx.fillText(song.title, x, y + 293, 292);
    });
    ctx.font = 'bold 31px sans-serif';
    ctx.fillStyle = '#d8b7ff';
    ctx.fillText(`${Math.round(summary.totals.totalPlayTimeMs / 60_000)} minutes · ${summary.totals.uniqueSongs} songs`, 64, 1230);
    const filename = `Zeta-${month}.png`;
    if (isAndroid) {
        const [{ Directory, Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
        const { uri } = await Filesystem.writeFile({
            directory: Directory.Cache, path: `share/${filename}`,
            data: canvas.toDataURL('image/png').split(',')[1], recursive: true,
        });
        await Share.share({ title: 'My month in Zeta', files: [uri] });
        return;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not save the poster.');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
