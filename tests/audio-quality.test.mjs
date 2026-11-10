import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseAudioFormat } from '../src/lib/audio-quality.ts';

const formats = [96, 128, 160, 256, 320].map((bitrate) => ({ bitrate }));
const bitrate = (format) => format.bitrate;

test('quality tiers select the best available format at or below their bitrate target', () => {
    assert.equal(chooseAudioFormat([{ bitrate: 8 }, ...formats], 'skype-2008', bitrate).bitrate, 8);
    assert.equal(chooseAudioFormat(formats, 'low', bitrate).bitrate, 96);
    assert.equal(chooseAudioFormat(formats, 'medium', bitrate).bitrate, 160);
    assert.equal(chooseAudioFormat(formats, 'high', bitrate).bitrate, 256);
    assert.equal(chooseAudioFormat(formats, 'best', bitrate).bitrate, 320);
});

test('quality tiers fall back to the lowest available format when none meet the target', () => {
    assert.equal(chooseAudioFormat([{ bitrate: 320 }, { bitrate: 512 }], 'low', bitrate).bitrate, 320);
});
