import { describe, expect, it } from 'vitest';
import { encodeEvent, MAX_EVENT_BYTES, sseFrame, topicPrefix } from './frames';

describe('sseFrame', () => {
  it('writes the event name, a retry hint and one data line per line', () => {
    expect(sseFrame('hello', '{"a":1}', 3000)).toBe('retry: 3000\nevent: hello\ndata: {"a":1}\n\n');
    expect(sseFrame(null, 'one\ntwo')).toBe('data: one\ndata: two\n\n');
  });
});

describe('encodeEvent', () => {
  it('encodes user and topic events as default messages', () => {
    expect(encodeEvent({ type: 'job-updated', data: { jobId: 'j1' } })).toEqual({
      frame: 'data: {"type":"job-updated","data":{"jobId":"j1"}}\n\n',
    });
    expect(encodeEvent({ type: 'message-created' }, 'chat:c1')).toEqual({
      frame: 'data: {"topic":"chat:c1","type":"message-created"}\n\n',
    });
  });

  it('refuses bad types, non-object data, unserializable data and events over 2 KB', () => {
    expect(encodeEvent({ type: '' })).toEqual({ error: 'invalid event type' });
    expect(encodeEvent({ type: 'live-reconnected' })).toEqual({ error: 'invalid event type' });
    expect(encodeEvent({ type: 'has space' })).toEqual({ error: 'invalid event type' });
    expect(encodeEvent({ type: 'x', data: [] as unknown as Record<string, unknown> })).toEqual({
      error: 'data must be an object',
    });
    expect(encodeEvent({ type: 'x', data: { n: 1n } })).toEqual({ error: 'data is not JSON' });
    const big = { type: 'x', data: { text: 'é'.repeat(MAX_EVENT_BYTES / 2) } };
    expect(encodeEvent(big)).toEqual({ error: `over ${MAX_EVENT_BYTES} bytes` });
  });
});

describe('topicPrefix', () => {
  it('returns the owner prefix of well-formed topics only', () => {
    expect(topicPrefix('chat:c1')).toBe('chat');
    expect(topicPrefix('db:p1:view:v2')).toBe('db');
    expect(topicPrefix('chat:')).toBeNull();
    expect(topicPrefix('Chat:c1')).toBeNull();
    expect(topicPrefix('chat:has space')).toBeNull();
  });
});
