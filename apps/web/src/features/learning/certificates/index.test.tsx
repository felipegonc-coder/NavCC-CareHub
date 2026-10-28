import { courseHref, createCertificateCode, type Certificate } from '@carehub/learning';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorReply, jsonReply, renderRoute } from '../player/test-utils';
import { certificateHref, formatCertificateDay, statusLine } from './data';
import { CertificateScreen, CertificatesScreen } from './index';

const FIRE_CODE = createCertificateCode(Uint8Array.from([7, 20, 23, 2, 19, 9, 13, 29, 4, 26, 11]));
const PHONE_CODE = createCertificateCode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
/** The code with its first symbol changed: a typo its check symbol catches. */
const withTypo = (code: string) => `${code.startsWith('A') ? 'B' : 'A'}${code.slice(1)}`;

const fire: Certificate = {
  id: 'cert-fire-safety',
  code: FIRE_CODE,
  learnerId: 'person-sam',
  learnerName: 'Sam Rivera',
  courseId: 'course-fire-safety',
  courseTitle: 'Fire safety basics',
  courseVersion: 2,
  completedAt: '2026-10-12T15:30:00.000Z',
  issuedOn: '2026-10-12',
  expiresOn: '2027-10-12',
  score: 92,
  status: 'valid',
};
const phones: Certificate = {
  ...fire,
  id: 'cert-phone-manner',
  code: PHONE_CODE,
  courseId: 'course-phone-manner',
  courseTitle: 'Phone manner',
  completedAt: '2025-10-20T09:00:00.000Z',
  issuedOn: '2025-10-20',
  expiresOn: '2026-10-20',
  score: null,
  status: 'expired',
};

/** A fake Learning API: a reply for each path (after /api/learning); anything else is a 404. */
function serve(replies: Record<string, () => Response>) {
  const paths: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input).replace('/api/learning', '');
    paths.push(path);
    return replies[path]?.() ?? errorReply(404);
  });
  return paths;
}

const showList = (path = '/learning/certificates') =>
  renderRoute(path, { '/learning/certificates': <CertificatesScreen /> });
const showCertificate = (id: string) =>
  renderRoute(certificateHref(id), {
    '/learning/certificates/:certificateId': <CertificateScreen />,
  });

/** The list item of the certificate for this course. */
function card(courseTitle: string): HTMLElement {
  const item = screen.getByRole('link', { name: courseTitle }).closest('li');
  if (!item) throw new Error(`No certificate for ${courseTitle}`);
  return item;
}

afterEach(() => vi.restoreAllMocks());

describe('Certificates', () => {
  it('lists the certificates, each opening its page', async () => {
    serve({ '/certificates': () => jsonReply(200, [fire, phones]) });
    showList();
    expect(await screen.findByRole('heading', { level: 1, name: 'Certificates' })).toBeVisible();
    expect(document.title).toBe('Care Hub · Certificates');
    const titles = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('h3')?.textContent);
    expect(titles).toEqual(['Fire safety basics', 'Phone manner']);

    const first = within(card('Fire safety basics'));
    expect(first.getByRole('link')).toHaveAttribute('href', certificateHref(fire.id));
    expect(first.getByText(`Issued on ${formatCertificateDay('2026-10-12')}`)).toBeVisible();
    expect(first.getByText(statusLine(fire))).toHaveClass('text-success');
    expect(first.getByText('Score 92% · Code')).toBeVisible();
    expect(first.getByText(FIRE_CODE)).toBeVisible();
    const second = within(card('Phone manner'));
    expect(second.getByText(`Expired on ${formatCertificateDay('2026-10-20')}`)).toHaveClass(
      'text-danger',
    );
    expect(second.queryByText(/Score/)).toBeNull();
  });

  it('says when there are none yet', async () => {
    serve({ '/certificates': () => jsonReply(200, []) });
    showList();
    expect(await screen.findByText('No certificates yet.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to My learning' })).toHaveAttribute(
      'href',
      '/learning',
    );
  });

  it('checks a code for typos, then looks it up', async () => {
    const paths = serve({
      '/certificates': () => jsonReply(200, []),
      [`/certificates?code=${FIRE_CODE}`]: () => jsonReply(200, [fire]),
    });
    showList();
    const field = await screen.findByLabelText('Certificate code');
    const check = screen.getByRole('button', { name: 'Check' });

    fireEvent.change(field, { target: { value: '7KQ2-M9XD' } });
    fireEvent.click(check);
    expect(
      screen.getByText('Use the 12-character code on the certificate, e.g. 7KQ2-M9XD-4TB8.'),
    ).toBeVisible();
    fireEvent.change(field, { target: { value: withTypo(FIRE_CODE) } });
    fireEvent.click(check);
    expect(screen.getByText('This code has a typo. Check it and try again.')).toBeVisible();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(paths).toEqual(['/certificates']);

    fireEvent.change(field, { target: { value: FIRE_CODE.toLowerCase().replaceAll('-', ' ') } });
    fireEvent.click(check);
    expect(await screen.findByText(`${FIRE_CODE} is a real certificate.`)).toBeVisible();
    const issued = formatCertificateDay('2026-10-12');
    expect(
      screen.getByText(`Care Hub issued it to Sam Rivera for Fire safety basics on ${issued}.`),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open certificate' })).toHaveAttribute(
      'href',
      certificateHref(fire.id),
    );
    expect(field).toHaveValue(FIRE_CODE);
    expect(paths).toEqual(['/certificates', `/certificates?code=${FIRE_CODE}`]);
  });

  it('checks the code in the address, and says when no certificate has it', async () => {
    serve({
      '/certificates': () => jsonReply(200, [fire]),
      [`/certificates?code=${PHONE_CODE}`]: () => jsonReply(200, []),
    });
    showList(`/learning/certificates?code=${PHONE_CODE}`);
    expect(await screen.findByText(`No certificate has the code ${PHONE_CODE}.`)).toBeVisible();
    expect(screen.getByLabelText('Certificate code')).toHaveValue(PHONE_CODE);
  });

  it('tells guests certificates are not for them', async () => {
    serve({ '/certificates': () => errorReply(403) });
    showList();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No access to certificates' }),
    ).toBeVisible();
  });
});

describe('A certificate', () => {
  it('shows the name, course, dates, score and code, and prints', async () => {
    serve({ [`/certificates/${fire.id}`]: () => jsonReply(200, fire) });
    showCertificate(fire.id);
    const certificate = await screen.findByRole('article', { name: 'Certificate of completion' });
    expect(document.title).toBe('Care Hub · Fire safety basics certificate');
    for (const text of [
      'Sam Rivera',
      'Fire safety basics',
      formatCertificateDay('2026-10-12'),
      formatCertificateDay('2027-10-12'),
      '92%',
      FIRE_CODE,
      `Check this certificate at ${window.location.origin}/learning/certificates?code=${FIRE_CODE}`,
    ])
      expect(within(certificate).getByText(text)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open course' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to certificates' })).toHaveAttribute(
      'href',
      '/learning/certificates',
    );

    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('points to the course when the certificate has expired', async () => {
    serve({ [`/certificates/${phones.id}`]: () => jsonReply(200, phones) });
    showCertificate(phones.id);
    expect(await screen.findByText(statusLine(phones))).toHaveClass('text-danger');
    expect(screen.getByRole('link', { name: 'Open course' })).toHaveAttribute(
      'href',
      courseHref(phones.courseId),
    );
    const certificate = screen.getByRole('article', { name: 'Certificate of completion' });
    expect(within(certificate).getByText('Expired')).toBeVisible();
    expect(within(certificate).queryByText('Score')).toBeNull();
  });

  it('says when the certificate is not there', async () => {
    serve({});
    showCertificate('cert-someone-else');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Certificate not found' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to certificates' })).toHaveAttribute(
      'href',
      '/learning/certificates',
    );
  });

  it('says a bad link is not a certificate, without asking the server', async () => {
    const paths = serve({});
    showCertificate('not a certificate');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Certificate not found' }),
    ).toBeVisible();
    expect(paths).toEqual([]);
  });

  it('tries again after a failed load', async () => {
    let calls = 0;
    serve({
      [`/certificates/${fire.id}`]: () => (++calls === 1 ? errorReply(400) : jsonReply(200, fire)),
    });
    showCertificate(fire.id);
    expect(
      await screen.findByRole('heading', { level: 1, name: "This certificate didn't load" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Certificate of completion' })).toBeVisible();
  });
});
