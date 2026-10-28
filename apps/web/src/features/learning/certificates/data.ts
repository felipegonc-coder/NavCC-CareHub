import {
  CertificateCodeSchema,
  CertificateListResponseSchema,
  CertificateSchema,
  normalizeCertificateCode,
  type Certificate,
  type CertificateStatus,
  type Id,
  type IsoDate,
} from '@carehub/learning';
import { useQuery } from '@tanstack/react-query';
import { api, apiPath, withQuery } from '../data';
import { retryOnce } from '../player/data';

// GET /certificates and GET /certificates/:id (docs/learning/api.md): the person's certificates,
// one certificate, and the code lookup that checks a certificate is real.

/** The cache key of every certificate call. */
export const certificatesKey = ['learning', 'certificates'] as const;

/** The list of certificates, where the code check also lives. */
export const CERTIFICATES_HREF = '/learning/certificates';

/** A certificate's printable page: "/learning/certificates/<certificateId>". */
export const certificateHref = (certificateId: Id): string =>
  `${CERTIFICATES_HREF}/${encodeURIComponent(certificateId)}`;

/** The code check for one code: "/learning/certificates?code=7KQ2-M9XD-4TB8". */
export const codeCheckHref = (code: string): string => withQuery(CERTIFICATES_HREF, { code });

/** The layout of the certificate pages, as on the other Learning pages. */
export const PAGE_CLASSES =
  'mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg md:px-6 md:py-10';

/** The signed-in person's certificates, newest first. */
export function useMyCertificates() {
  return useQuery({
    queryKey: certificatesKey,
    queryFn: ({ signal }) => api('GET', '/certificates', CertificateListResponseSchema, { signal }),
    retry: retryOnce,
  });
}

/** One certificate: the person's own, or anyone's in the workspace with learning.analytics. */
export function useCertificate(certificateId: Id) {
  return useQuery({
    queryKey: [...certificatesKey, 'one', certificateId],
    queryFn: ({ signal }) =>
      api('GET', apiPath('certificates', certificateId), CertificateSchema, { signal }),
    retry: retryOnce,
  });
}

/**
 * The certificate with this code ("XXXX-XXXX-XXXX"), or null when there's none the person may
 * see: their own, or anyone's in the workspace with learning.analytics. Asks nothing while
 * `code` is null.
 */
export function useCodeCheck(code: string | null) {
  return useQuery({
    queryKey: [...certificatesKey, 'code', code],
    queryFn: async ({ signal }) => {
      const path = withQuery('/certificates', { code });
      const found = await api('GET', path, CertificateListResponseSchema, { signal });
      return found[0] ?? null;
    },
    enabled: code !== null,
    retry: retryOnce,
  });
}

/**
 * What someone typed as a code: the code as issued ("7KQ2-M9XD-4TB8", from any spelling
 * `normalizeCertificateCode` reads), or what's wrong with it in plain words.
 */
export function readCertificateCode(input: string): { code: string } | { problem: string } {
  const checked = CertificateCodeSchema.safeParse(normalizeCertificateCode(input) ?? input.trim());
  if (checked.success) return { code: checked.data };
  return { problem: checked.error.issues[0]?.message ?? 'Check the code, then try again.' };
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar day, the same everywhere: "12 Oct 2026" in the browser's language. */
export const formatCertificateDay = (day: IsoDate): string =>
  dayFormat.format(new Date(`${day}T00:00:00Z`));

/** The course score as a whole percentage ("92%"), or null when the course has none. */
export const formatScore = (score: number | null): string | null =>
  score === null ? null : `${Math.round(score)}%`;

/** The colour of each status's words. */
export const STATUS_TONES: Record<CertificateStatus, string> = {
  valid: 'text-success',
  expiring_soon: 'text-warning',
  expired: 'text-danger',
};

/** Where a certificate stands: "Valid · Expires on 12 Oct 2027", "Expired on 12 Oct 2026". */
export function statusLine(certificate: Pick<Certificate, 'status' | 'expiresOn'>): string {
  const day = certificate.expiresOn ? formatCertificateDay(certificate.expiresOn) : null;
  switch (certificate.status) {
    case 'valid':
      return day ? `Valid · Expires on ${day}` : "Valid · Doesn't expire";
    case 'expiring_soon':
      return day ? `Expires soon, on ${day}` : 'Expires soon';
    case 'expired':
      return day ? `Expired on ${day}` : 'Expired';
  }
}
