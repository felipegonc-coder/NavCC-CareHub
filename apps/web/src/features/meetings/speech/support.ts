/** 'phone' covers tablets ("Transcription works on a computer."); 'browser': this one can't. */
export type SpeechSupport = 'ok' | 'phone' | 'browser';

type Agent = Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & {
  userAgentData?: { mobile: boolean };
  locks?: unknown;
  mediaDevices?: { getUserMedia?: unknown };
};

export function speechSupport(
  agent: Agent = navigator,
  scope: Partial<typeof globalThis> = globalThis,
): SpeechSupport {
  const ua = agent.userAgent;
  const iPad = /Macintosh/.test(ua) && agent.maxTouchPoints > 1; // iPadOS says it's a Mac
  if (agent.userAgentData?.mobile || iPad || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
    return 'phone';
  }
  const needs = [scope.AudioWorkletNode, scope.WebAssembly, scope.Worker, scope.indexedDB];
  const able = needs.every(Boolean) && agent.locks && agent.mediaDevices?.getUserMedia;
  return scope.isSecureContext && able ? 'ok' : 'browser';
}
