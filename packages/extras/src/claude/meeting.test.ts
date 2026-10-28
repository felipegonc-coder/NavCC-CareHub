import { describe, expect, it } from 'vitest';
import { MEETING_SUMMARY_LIMITS, meetingSummarySchema } from './meeting';

describe('meetingSummarySchema', () => {
  it('keeps a well-formed summary as it is', () => {
    const summary = {
      summary: 'The fictional huddle moves to Tuesdays.',
      decisions: ['Huddle on Tuesdays.'],
      actionItems: [{ text: 'Update the invite.', owner: 'Sam Rivera', due: '2026-11-03' }],
    };
    expect(meetingSummarySchema.parse(summary)).toEqual(summary);
  });

  it('drops owners and due dates it cannot use instead of failing', () => {
    const parsed = meetingSummarySchema.parse({
      summary: '  Short.  ',
      decisions: [],
      actionItems: [
        { text: 'Call the family.', owner: null, due: 'next Friday' },
        { text: 'Book the room.', owner: '  ', due: ' 2026-11-04 ' },
      ],
    });
    expect(parsed).toEqual({
      summary: 'Short.',
      decisions: [],
      actionItems: [{ text: 'Call the family.' }, { text: 'Book the room.', due: '2026-11-04' }],
    });
  });

  it('cuts long text and long lists', () => {
    const parsed = meetingSummarySchema.parse({
      summary: 'x'.repeat(5000),
      decisions: Array.from({ length: 40 }, (_, i) => `Decision ${i}`),
      actionItems: [],
    });
    expect(parsed.summary).toHaveLength(MEETING_SUMMARY_LIMITS.summary);
    expect(parsed.decisions).toHaveLength(MEETING_SUMMARY_LIMITS.items);
  });

  it('refuses answers without a summary or with the wrong shape', () => {
    expect(
      meetingSummarySchema.safeParse({ summary: ' ', decisions: [], actionItems: [] }).success,
    ).toBe(false);
    expect(meetingSummarySchema.safeParse({ summary: 'Hi.', decisions: 'none' }).success).toBe(
      false,
    );
    expect(
      meetingSummarySchema.safeParse({
        summary: 'Hi.',
        decisions: [],
        actionItems: [{ owner: 'Sam' }],
      }).success,
    ).toBe(false);
  });
});
