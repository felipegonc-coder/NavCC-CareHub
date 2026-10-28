/** Download progress of the speech model, in bytes. */
export type Progress = { loaded: number; total: number };

/** Why a transcription couldn't start. Only 'storage' can also stop one: no room for more sound. */
export type SpeechError =
  | 'mic-blocked' // the browser or the person said no to the microphone
  | 'no-mic' // no microphone, or another app has it
  | 'busy' // another transcription is running, in another tab or on another computer
  | 'storage' // the browser can't keep the sound
  | 'offline'; // Care Hub couldn't be reached

/**
 * 'waiting': lines aren't saved yet because Care Hub or the model isn't answering. The sound is
 * kept, and it keeps trying.
 */
export type Saving = 'ok' | 'waiting';

export type SpeechState =
  | { status: 'checking' }
  | { status: 'not-set-up' }
  | { status: 'idle'; modelBytes: number; modelCached: boolean }
  | { status: 'starting'; notesId: string }
  | {
      status: 'recording' | 'paused';
      notesId: string;
      transcriptId: string;
      /** Recorded time in whole seconds, pauses left out. */
      elapsedMs: number;
      /** From 2:55:00. The recording stops and saves by itself at 3:00:00. */
      nearLimit: boolean;
      /** While the model downloads for the first time. */
      download: Progress | null;
      saving: Saving;
    }
  | {
      status: 'finishing';
      notesId: string;
      transcriptId: string;
      /** 'limit': it stopped by itself at 3:00:00. */
      reason: 'stop' | 'limit';
      /** Estimated time left; null until a piece has been transcribed. */
      remainingMs: number | null;
      download: Progress | null;
      saving: Saving;
    }
  | { status: 'error'; notesId: string | null; error: SpeechError };

/** One transcript line: up to 30 s of sound, cut at a pause. */
export type SpeechLine = {
  id: string;
  /** From the start of the transcript, pauses left out. */
  startMs: number;
  endMs: number;
  /** 1: the microphone. 2: a shared tab. */
  speaker: 1 | 2;
  text: string;
};

/** A recording whose tab closed before its transcript was finished (MT-09). */
export type Unfinished = { id: string; notesId: string; startedAt: string; pendingMs: number };

export type LinesEvent = { transcriptId: string; lines: SpeechLine[] };

export interface SpeechEngine {
  getState(): SpeechState;
  subscribe(listener: () => void): () => void;
  /** Checks whether transcription is set up and the model is downloaded. */
  refresh(): Promise<void>;
  /** Call it first thing in the click that confirms consent, so the browser allows the mic. */
  start(input: { notesId: string; userId: string }): Promise<void>;
  pause(): void;
  resume(): void;
  /** Stops the microphone, then transcribes what's left and finishes the transcript. */
  stop(): Promise<void>;
  /** From an error back to idle. */
  dismiss(): void;
  listUnfinished(input: { userId: string; notesId?: string }): Promise<Unfinished[]>;
  finishUnfinished(id: string): Promise<void>;
  deleteUnfinished(id: string): Promise<void>;
  /** Called after lines are saved on Care Hub. */
  onLines(listener: (event: LinesEvent) => void): () => void;
}

/** Turns up to 30 s of 16 kHz mono sound into text. */
export interface Recognizer {
  /** Sent when a transcript is created, such as 'whisper-base.en-1'. */
  readonly model: string;
  isCached(): Promise<boolean>;
  load(onProgress: (progress: Progress) => void): Promise<void>;
  /** '' when nothing was said. */
  transcribe(samples: Float32Array): Promise<string>;
}

/** Mono sound at the source's own sample rate. */
export interface AudioSource {
  readonly sampleRate: number;
  /** `onEnded` runs when the device goes away or the browser takes the permission back. */
  start(onSamples: (samples: Float32Array) => void, onEnded: () => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

/** The transcript routes of the meetings API. Errors are SpeechFailure. */
export interface TranscriptApi {
  availability(): Promise<{ available: boolean; bytes: number }>;
  /** Returns the new transcript's id. */
  create(notesId: string, model: string): Promise<string>;
  saveLines(transcriptId: string, lines: SpeechLine[]): Promise<void>;
  stop(transcriptId: string): Promise<void>;
  finish(transcriptId: string): Promise<void>;
}

/** 'gone': the transcript was deleted. 'failed': Care Hub refused the request. */
export class SpeechFailure extends Error {
  override name = 'SpeechFailure';
  constructor(readonly kind: SpeechError | 'gone' | 'failed') {
    super(kind);
  }
}

export type StoredRecording = {
  /** The transcript's id. */
  id: string;
  notesId: string;
  userId: string;
  startedAt: string;
  /** Care Hub knows the recording ended. */
  stopped: boolean;
};

export type StoredPiece = {
  id: string;
  recordingId: string;
  speaker: 1 | 2;
  startMs: number;
  endMs: number;
  /** Set once transcribed (null: nothing said), so a retry sends the same line. */
  line?: SpeechLine | null;
};

/** Where the sound waits until its text is saved. */
export interface SpeechStore {
  recordings(): Promise<StoredRecording[]>;
  saveRecording(recording: StoredRecording): Promise<void>;
  /** With its pieces and their sound. */
  deleteRecording(id: string): Promise<void>;
  /** Oldest first. */
  pieces(recordingId: string): Promise<StoredPiece[]>;
  /** Saves the piece, and its sound when given. */
  savePiece(piece: StoredPiece, sound?: Int16Array): Promise<void>;
  sound(pieceId: string): Promise<Int16Array | undefined>;
  /** With its sound. */
  deletePiece(id: string): Promise<void>;
}

export interface Locks {
  /** Takes the lock when no tab holds it, and returns the function that lets go. */
  tryAcquire(name: string): Promise<(() => void) | null>;
}
