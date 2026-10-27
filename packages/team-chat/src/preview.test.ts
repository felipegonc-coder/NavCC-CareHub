import { describe, expect, it } from 'vitest';
import { attachmentSummary, messagePreview, spokenMessage } from './preview';
import type { PreviewAttachment, PreviewSource } from './preview';
import type { PersonLabel } from './types';

const people: Record<string, PersonLabel> = {
  avery: { name: 'Avery Lin' },
  sam: { name: 'Sam Ortiz' },
  morgan: { name: 'Morgan Lee', removed: true },
};
const nameOf = (id: string) => people[id];
const message = (changes: Partial<Extract<PreviewSource, { kind: 'message' }>> = {}) => ({
  kind: 'message' as const,
  text: '',
  deleted: false,
  mentionedUserIds: [],
  ...changes,
});
const picture = (name: string): PreviewAttachment => ({ kind: 'picture', name });
const pdf: PreviewAttachment = { kind: 'pdf', name: 'Schedule.pdf' };

describe('messagePreview', () => {
  it('shows mentions as names and the text on one line', () => {
    const source = message({
      text: '<@sam> can you check\n\nthe QA form? cc <@morgan>',
      mentionedUserIds: ['sam', 'morgan'],
    });
    expect(messagePreview(source, nameOf)).toBe(
      '@Sam Ortiz can you check the QA form? cc @Morgan Lee (removed)',
    );
  });

  it('cuts long messages to 100 characters', () => {
    const preview = messagePreview(message({ text: 'word '.repeat(40) }), nameOf);
    expect(preview.endsWith('…')).toBe(true);
    expect([...preview].length).toBeLessThanOrEqual(101);
    expect(messagePreview(message({ text: 'word '.repeat(40) }), nameOf, 10)).toBe('word word…');
  });

  it('shows deleted messages as deleted', () => {
    expect(messagePreview(message({ text: '', deleted: true }), nameOf)).toBe(
      'This message was deleted',
    );
  });

  it('describes files and page cards when there is no text', () => {
    const files = (attachments: PreviewAttachment[]) =>
      messagePreview(message({ attachments }), nameOf);
    expect(files([picture('IMG_0001.jpg')])).toBe('Picture');
    expect(files([pdf])).toBe('Schedule.pdf');
    expect(files([picture('a.jpg'), picture('b.jpg'), picture('c.jpg'), pdf])).toBe(
      '3 pictures and 1 file',
    );
    expect(messagePreview(message({ pageCount: 1 }), nameOf)).toBe('Shared a page');
    expect(messagePreview(message({ pageCount: 3 }), nameOf)).toBe('Shared 3 pages');
    expect(messagePreview(message({ text: 'Here you go', attachments: [pdf] }), nameOf)).toBe(
      'Here you go',
    );
  });

  it('shows notices and small lines', () => {
    expect(
      messagePreview(
        { kind: 'notice', title: 'Weekly stand-up notes', text: 'Starts at 10:00' },
        nameOf,
      ),
    ).toBe('Weekly stand-up notes – Starts at 10:00');
    expect(messagePreview({ kind: 'notice', title: 'New response to QA form' }, nameOf)).toBe(
      'New response to QA form',
    );
    expect(messagePreview({ kind: 'system', event: { kind: 'left', userId: 'sam' } }, nameOf)).toBe(
      'Sam Ortiz left',
    );
  });
});

describe('attachmentSummary', () => {
  it('counts pictures and other files', () => {
    expect(attachmentSummary([])).toBe('');
    expect(attachmentSummary([picture('a.png'), picture('b.png')])).toBe('2 pictures');
    expect(attachmentSummary([pdf, { kind: 'audio', name: 'Voice note.m4a' }])).toBe('2 files');
    expect(attachmentSummary([picture('a.png'), pdf, pdf])).toBe('1 picture and 2 files');
  });
});

describe('spokenMessage', () => {
  it('reads new messages with the sender first', () => {
    const source = message({ text: 'Can you check the QA form?' });
    expect(spokenMessage('Avery Lin', source, nameOf)).toBe(
      'Avery Lin: Can you check the QA form?',
    );
    const left: PreviewSource = { kind: 'system', event: { kind: 'left', userId: 'sam' } };
    expect(spokenMessage(null, left, nameOf)).toBe('Sam Ortiz left');
  });
});
