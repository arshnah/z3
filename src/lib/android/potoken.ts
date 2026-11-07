import { registerPlugin } from '@capacitor/core';
import { parseLooseJSON, USER_AGENT } from 'bgutils-js/utils';

const verifier = registerPlugin<{
    mint(options: { videoId: string; html: string; interpreter: string; userAgent: string }): Promise<{ token: string }>;
}>('ZetaVerification');
let challenge: Promise<{ html: string; interpreter: string }> | undefined;
let expires = 0;

async function loadChallenge() {
    const page = await fetch('https://www.youtube.com', { headers: { 'User-Agent': USER_AGENT } });
    if (!page.ok) throw new Error(`YouTube returned ${page.status}.`);
    const html = await page.text();
    const initial = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1];
    if (!initial) throw new Error('YouTube verification is unavailable. Try another source or an imported song.');
    const bg = parseLooseJSON(initial).R?.bgChallenge;
    const url = bg?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (!url) throw new Error('YouTube did not return a verification challenge.');
    const response = await fetch(new URL(url, 'https://www.youtube.com').href);
    if (!response.ok) throw new Error('Could not load YouTube verification.');
    return { html, interpreter: await response.text() };
}

export async function mintPoToken(videoId: string): Promise<string> {
    try {
        if (Date.now() > expires) { challenge = undefined; expires = Date.now() + 10 * 60_000; }
        challenge ??= loadChallenge();
        return (await verifier.mint({ videoId, ...await challenge, userAgent: USER_AGENT })).token;
    } catch (error) { challenge = undefined; throw error; }
}
