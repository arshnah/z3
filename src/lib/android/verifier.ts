// Bundled separately for a verification WebView at the provider's origin.
import { BotGuardClient } from 'bgutils-js/botguard';
import { buildURL, parseLooseJSON, getHeaders } from 'bgutils-js/utils';
import { WebPoMinter } from 'bgutils-js/webpo';

interface VerificationWindow {
    ZetaVerification: { complete(id: string, token: string, error: string): void };
    zetaVerify: (id: string, options: { videoId: string; html: string; interpreter: string }) => Promise<void>;
}
const host = globalThis as unknown as VerificationWindow;
let pending: Promise<{ minter: WebPoMinter; expires: number }> | undefined;

async function createMinter(html: string, interpreter: string) {
    const config = html.match(/ytcfg\.set\(({.+?})\);/s)?.[1];
    const initial = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1];
    if (!config || !initial) throw new Error('YouTube verification data is missing.');
    Object.assign(globalThis, { yt: { config_: JSON.parse(config) } });
    const challenge = parseLooseJSON(initial).R?.bgChallenge;
    new Function(interpreter)();
    const botguard = await BotGuardClient.create({ program: challenge.program, globalName: challenge.globalName, globalObject: globalThis });
    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
    const snapshot = await botguard.snapshot({ webPoSignalOutput });
    const response = await fetch(buildURL('GenerateIT', true), {
        method: 'POST', headers: getHeaders(), body: JSON.stringify(['O43z0dpjhgX20SCx4KAo', snapshot]),
    });
    if (!response.ok) throw new Error('YouTube verification failed.');
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await response.json();
    const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput);
    return { minter, expires: Date.now() + Math.max(60, (estimatedTtlSecs || 3600) - 60) * 1000 };
}

host.zetaVerify = async (id, options) => {
    try {
        pending ??= createMinter(options.html, options.interpreter);
        let state = await pending;
        if (state.expires < Date.now()) state = await (pending = createMinter(options.html, options.interpreter));
        host.ZetaVerification.complete(id, await state.minter.mintAsWebsafeString(options.videoId), '');
    } catch (error) {
        pending = undefined;
        host.ZetaVerification.complete(id, '', `YouTube verification failed: ${(error as Error).message}`);
    }
};
