import workletUrl from './capture-worklet.js?url';
import { SpeechFailure, type AudioSource } from './types';

/** What getUserMedia's error means for the person. */
export function micError(error: unknown): SpeechFailure {
  const name = error instanceof Error ? error.name : '';
  const blocked = name === 'NotAllowedError' || name === 'SecurityError';
  return new SpeechFailure(blocked ? 'mic-blocked' : 'no-mic');
}

/**
 * Opens the microphone. Call it straight from the click that starts the recording: the audio
 * context and the permission request are made before anything is awaited.
 */
export function openMicrophone(): Promise<AudioSource> {
  try {
    const context = new AudioContext();
    const stream = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return connect(context, stream);
  } catch (error) {
    return Promise.reject(micError(error));
  }
}

async function connect(context: AudioContext, opening: Promise<MediaStream>): Promise<AudioSource> {
  let stream: MediaStream;
  try {
    stream = await opening;
  } catch (error) {
    void context.close();
    throw micError(error);
  }
  try {
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, 'carehub-capture');
    context.createMediaStreamSource(stream).connect(node);
    node.connect(context.destination); // silent, but keeps the node running
    void context.resume();
    return {
      sampleRate: context.sampleRate,
      start(onSamples, onEnded) {
        node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
        stream.getAudioTracks()[0]?.addEventListener('ended', onEnded, { once: true });
      },
      pause: () => void context.suspend(),
      resume: () => void context.resume(),
      stop() {
        node.port.onmessage = null;
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      },
    };
  } catch {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw new SpeechFailure('no-mic');
  }
}
