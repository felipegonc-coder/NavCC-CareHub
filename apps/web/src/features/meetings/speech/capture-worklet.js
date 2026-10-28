/* global AudioWorkletProcessor, registerProcessor */
// Runs on the audio thread: mixes the microphone down to mono and posts it in blocks.
const SIZE = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(SIZE);
    this.length = 0;
  }

  process(inputs) {
    const channels = inputs[0] ?? [];
    const frames = channels[0]?.length ?? 0;
    for (let i = 0; i < frames; i += 1) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      this.block[this.length] = sum / channels.length;
      this.length += 1;
      if (this.length === SIZE) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(SIZE);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('carehub-capture', CaptureProcessor);
