import { createCertificateCode, type PersonTranscriptResponse } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorReply, jsonReply, renderRoute } from '../../player/test-utils';
import { formatCalendarDay, formatDay, NOT_FOUND, personReportHref } from './data';
import { PersonReportScreen } from './index';

// A fictional learner and her courses, as GET /reports/people/:personId sends them.
const ADA = '0b6c1f2e-5d4a-4c3b-9a8f-7e6d5c4b3a21';
const CODE = createCertificateCode(new Uint8Array([7, 23, 3, 12, 3, 26, 2, 9, 5, 13, 1]));
const API = `/api/learning/reports/people/${ADA}`;

type Row = PersonTranscriptResponse['rows'][number];
const row = (courseId: string, courseTitle: string, more: Partial<Row> = {}): Row => ({
  learnerId: ADA,
  learnerName: 'Ada Example',
  groupIds: [],
  courseId,
  courseTitle,
  status: 'not_started',
  score: null,
  activeSeconds: 0,
  attempts: 0,
  required: false,
  certificate: null,
  ...more,
});

const RECORD: PersonTranscriptResponse = {
  person: { id: ADA, name: 'Ada Example' },
  rows: [
    row('course-privacy-basics', 'Privacy basics', {
      status: 'in_progress',
      activeSeconds: 600,
      startedAt: '2026-10-20T09:00:00.000Z',
      lastActivityAt: '2026-10-21T09:00:00.000Z',
      dueDate: '2026-01-15',
      required: true,
    }),
    row('course-calls-with-care', 'Handling calls with care', {
      status: 'passed',
      score: 92.4,
      activeSeconds: 3_900,
      attempts: 2,
      startedAt: '2026-10-01T09:00:00.000Z',
      completedAt: '2026-10-03T16:00:00.000Z',
      lastActivityAt: '2026-10-03T16:00:00.000Z',
      certificate: {
        id: 'cert-calls-ada',
        code: CODE,
        issuedOn: '2026-10-03',
        expiresOn: '2099-12-31',
        status: 'valid',
      },
    }),
    row('course-escalations-cert', 'Escalations certification'),
  ],
};

/** Shows Ada's learning record, with the server's answers in `replies`, one per call. */
function showRecord(...replies: (() => Response)[]) {
  const fetch = vi.spyOn(globalThis, 'fetch');
  fetch.mockImplementation(async (input) => {
    if (String(input) !== API) return errorReply(404);
    const reply = replies.length > 1 ? replies.shift() : replies[0];
    return reply ? reply() : errorReply(404);
  });
  renderRoute(personReportHref(ADA), {
    '/learning/reports/people/:personId': <PersonReportScreen />,
  });
  return fetch;
}

const serverError = () =>
  jsonReply(500, { error: { code: 'server_error', message: 'Care Hub had a problem.' } });

afterEach(() => vi.restoreAllMocks());

describe('Learning record', () => {
  it('shows each course with its status, score, time, dates and certificate', async () => {
    showRecord(() => jsonReply(200, RECORD));
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Example' })).toBeVisible();
    expect(document.title).toBe('Care Hub · Ada Example · Learning record');
    expect(screen.getByText('3 courses · 1 finished · 1 overdue')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      `${API}?format=csv`,
    );

    const [, privacy, calls, escalations] = screen.getAllByRole('row').map((line) => within(line));
    expect(privacy?.getByText('Required')).toBeVisible();
    expect(privacy?.getByText('In progress')).toBeVisible();
    expect(privacy?.getByText(/^\d+ days overdue$/)).toHaveClass('text-danger');
    expect(privacy?.getByText('10 min')).toBeVisible();
    expect(privacy?.getByText(formatDay('2026-10-20T09:00:00.000Z') ?? '')).toBeVisible();
    expect(privacy?.getByText(formatCalendarDay('2026-01-15') ?? '')).toBeVisible();

    expect(calls?.getByText('Passed')).toHaveClass('text-success');
    expect(calls?.getByText('92%')).toBeVisible();
    expect(calls?.getByText('1 h 5 min')).toBeVisible();
    expect(calls?.getByText('2')).toBeVisible();
    expect(calls?.getByText(formatDay('2026-10-03T16:00:00.000Z') ?? '')).toBeVisible();
    expect(calls?.getByRole('link', { name: CODE })).toHaveAttribute(
      'href',
      '/learning/certificates/cert-calls-ada',
    );
    expect(calls?.getByText(`Valid until ${formatCalendarDay('2099-12-31')}`)).toBeVisible();

    expect(escalations?.getByText('Not started')).toBeVisible();
    expect(escalations?.getAllByText('None')).toHaveLength(7);
  });

  it('says when the person has no courses yet', async () => {
    showRecord(() => jsonReply(200, { ...RECORD, rows: [] }));
    expect(await screen.findByText('No courses yet: nothing assigned or started.')).toBeVisible();
    expect(screen.getByText('0 courses · 0 finished')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says a bad link leads nowhere, without asking the server', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    renderRoute('/learning/reports/people/not%20a%20person', {
      '/learning/reports/people/:personId': <PersonReportScreen />,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Learning record' })).toBeVisible();
    expect(screen.getByText(NOT_FOUND)).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('explains a refusal, with no Try again', async () => {
    showRecord(() => errorReply(403));
    expect(
      await screen.findByText("You don't have access to this report. Ask an admin if you need it."),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says when the record is not there', async () => {
    showRecord(() => errorReply(404));
    expect(await screen.findByText(NOT_FOUND)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('tries again after a server problem', async () => {
    // The first call and its one automatic retry fail; Try again then loads the record.
    const fetch = showRecord(serverError, serverError, () => jsonReply(200, RECORD));
    const again = await screen.findByRole('button', { name: 'Try again' }, { timeout: 4000 });
    fireEvent.click(again);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Example' })).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
