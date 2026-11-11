import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { parseLooseJSON, USER_AGENT } from 'bgutils-js/utils';

const verifier = registerPlugin<{
    mint(options: { videoId: string; html: string; interpreter: string; userAgent: string }): Promise<{ token: string }>;
}>('ZetaVerification');

let challenge: Promise<{ html: string; interpreter: string; expires: number }> | undefined;

async function getText(url: string): Promise<string> {
    const result = await CapacitorHttp.get({
        url, headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.7' },
        responseType: 'text', connectTimeout: 8000, readTimeout: 8000,
    });
    if (result.status !== 200 || typeof result.data !== 'string') throw new Error('YouTube verification data was unavailable.');
    return result.data;
}

async function loadChallenge() {
    const html = await getText('https://www.youtube.com/');
    const initial = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1];
    const path = initial && parseLooseJSON(initial).R?.bgChallenge?.interpreterUrl
        ?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (typeof path !== 'string') throw new Error('YouTube did not provide a verification challenge.');
    const url = new URL(path, 'https://www.youtube.com/');
    const trusted = url.hostname === 'www.youtube.com' && url.pathname.startsWith('/s/player/') ||
        ['www.google.com', 'www.gstatic.com'].includes(url.hostname) && url.pathname.startsWith('/js/th/');
    if (url.protocol !== 'https:' || !trusted) {
        throw new Error('Unexpected verification host.');
    }
    return { html, interpreter: await getText(url.href), expires: Date.now() + 30 * 60_000 };
}

export async function mintPoToken(videoId: string): Promise<string> {
    try {
        let data = await (challenge ??= loadChallenge());
        if (data.expires < Date.now()) data = await (challenge = loadChallenge());
        const result = await verifier.mint({ videoId, html: data.html, interpreter: data.interpreter, userAgent: USER_AGENT });
        return result.token;
    } catch (error) {
        challenge = undefined;
        throw error;
    }
}
