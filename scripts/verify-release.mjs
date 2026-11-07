import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${version}`) throw new Error('Release tag does not match package.json.');
const { assets } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const expected = [
    'latest-linux.yml', 'latest-mac.yml', 'latest.yml',
    `Zeta-${version}-linux-amd64.deb`, `Zeta-${version}-linux-x86_64.AppImage`,
    ...['arm64', 'x64'].flatMap((arch) => ['dmg', 'zip'].flatMap((ext) => [
        `Zeta-${version}-mac-${arch}.${ext}`, `Zeta-${version}-mac-${arch}.${ext}.blockmap`,
    ])),
    `Zeta-${version}-win-x64.exe`, `Zeta-${version}-win-x64.msi`,
    `Zeta-Setup-${version}.exe`, `Zeta-Setup-${version}.exe.blockmap`,
    `Zeta-${version}-android.apk`,
];
for (const name of expected) {
    const asset = assets.find((entry) => entry.name === name);
    if (!asset || asset.state !== 'uploaded' || asset.size <= 0) throw new Error(`Release asset is missing, empty, or incomplete: ${name}`);
}
const unexpected = assets.filter((entry) => !expected.includes(entry.name));
if (unexpected.length) throw new Error(`Unexpected release assets: ${unexpected.map((entry) => entry.name).join(', ')}`);
if (assets.length !== expected.length) throw new Error('Release asset count does not match the expected package set.');
console.log(`Verified all ${expected.length} assets for v${version}, including the signed Android APK.`);
