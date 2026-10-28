import { describe, expect, it } from 'vitest';
import { speechSupport } from './support';

const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const able = {
  isSecureContext: true,
  AudioWorkletNode: class {},
  WebAssembly: {},
  Worker: class {},
  indexedDB: {},
} as unknown as Partial<typeof globalThis>;

const agent = (userAgent: string, more: object = {}) => ({
  userAgent,
  maxTouchPoints: 0,
  locks: {},
  mediaDevices: { getUserMedia: () => {} },
  ...more,
});

describe('speechSupport', () => {
  it('is ok in a computer browser that has everything', () => {
    expect(speechSupport(agent(WINDOWS), able)).toBe('ok');
    expect(speechSupport(agent(MAC), able)).toBe('ok');
  });

  it('says phone for phones and tablets, iPads that say they are Macs too', () => {
    expect(speechSupport(agent(IPHONE), able)).toBe('phone');
    expect(speechSupport(agent(ANDROID_TABLET), able)).toBe('phone');
    expect(speechSupport(agent(MAC, { maxTouchPoints: 5 }), able)).toBe('phone');
    expect(speechSupport(agent(WINDOWS, { userAgentData: { mobile: true } }), able)).toBe('phone');
  });

  it('says browser when something it needs is missing', () => {
    expect(speechSupport(agent(WINDOWS), { ...able, isSecureContext: false })).toBe('browser');
    expect(speechSupport(agent(WINDOWS), { ...able, AudioWorkletNode: undefined })).toBe('browser');
    expect(speechSupport(agent(WINDOWS, { locks: undefined }), able)).toBe('browser');
    expect(speechSupport(agent(WINDOWS, { mediaDevices: undefined }), able)).toBe('browser');
  });
});
