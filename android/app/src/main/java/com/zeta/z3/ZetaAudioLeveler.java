package com.zeta.z3;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;

@OptIn(markerClass = UnstableApi.class)
final class ZetaAudioLeveler extends BaseAudioProcessor {
    volatile boolean enabled;
    private double energy;
    private double gain = 1;

    @Override protected AudioFormat onConfigure(AudioFormat input) {
        return input.encoding == C.ENCODING_PCM_16BIT ? input : AudioFormat.NOT_SET;
    }

    @Override public void queueInput(ByteBuffer input) {
        if (!input.hasRemaining()) return;
        int length = input.remaining();
        ByteBuffer output = replaceOutputBuffer(length);
        if (!enabled || length < 2) {
            output.put(input).flip();
            energy = 0;
            gain = 1;
            return;
        }
        ByteBuffer samples = input.duplicate().order(input.order());
        double sum = 0;
        while (samples.remaining() >= 2) {
            double value = samples.getShort() / 32768.0;
            sum += value * value;
        }
        double seconds = length / (2.0 * inputAudioFormat.sampleRate * inputAudioFormat.channelCount);
        double blend = 1 - Math.exp(-seconds / 0.45);
        energy += (sum / (length / 2) - energy) * blend;
        double target = Math.max(0.25, Math.min(1, 0.12 / Math.sqrt(Math.max(0.0001, energy))));
        double step = (target - gain) * blend / (length / 2);
        while (input.remaining() >= 2) {
            gain += step;
            output.putShort((short) Math.round(input.getShort() * gain));
        }
        if (input.hasRemaining()) output.put(input.get());
        output.flip();
    }
}
