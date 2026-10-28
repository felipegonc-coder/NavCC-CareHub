import { courseHref, type Certificate } from '@carehub/learning';
import { Button, buttonClasses, cn, cssVariables, lightTokens, Logo } from '@carehub/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  CERTIFICATES_HREF,
  codeCheckHref,
  PAGE_CLASSES,
  formatCertificateDay,
  formatScore,
  STATUS_TONES,
  statusLine,
} from './data';

const CERTIFICATE_ID = 'learning-certificate';
const ID = `#${CERTIFICATE_ID}`;
const LIGHT_THEME = Object.entries(cssVariables(lightTokens))
  .map(([name, value]) => `${name}: ${value};`)
  .join(' ');

// Printing shows the certificate alone, in the light theme: everything that doesn't hold it is
// hidden, and what holds it loses its spacing, so the certificate starts at the top of the page.
const PRINT_STYLES = `@media print {
  body *:not(:has(${ID}), ${ID}, ${ID} *) { display: none !important; }
  body *:has(${ID}) {
    display: block !important; margin: 0 !important; padding: 0 !important;
    border: 0 !important; max-width: none !important; min-height: 0 !important;
    height: auto !important; overflow: visible !important;
  }
  ${ID} { ${LIGHT_THEME} break-inside: avoid; }
}`;

/**
 * A certificate as a page to print or save as a PDF: the person's name, the course, the dates,
 * the score and the code, with a link to the code check so anyone can see it's real.
 */
export function CertificateView({ certificate }: { certificate: Certificate }) {
  const score = formatScore(certificate.score);
  const checkUrl = `${window.location.origin}${codeCheckHref(certificate.code)}`;
  return (
    <main className={PAGE_CLASSES}>
      <title>{`Care Hub · ${certificate.courseTitle} certificate`}</title>
      <style>{PRINT_STYLES}</style>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={CERTIFICATES_HREF}
          className={buttonClasses({ variant: 'ghost', className: 'max-md:h-11' })}
        >
          Back to certificates
        </Link>
        <Button onClick={() => window.print()} className="max-md:h-11">
          Print or save as PDF
        </Button>
      </div>
      <RenewalNote certificate={certificate} />
      <article
        id={CERTIFICATE_ID}
        aria-labelledby={`${CERTIFICATE_ID}-title`}
        className={cn(
          'flex flex-col items-center gap-6 rounded border-2 border-border bg-bg p-6 text-center',
          'text-fg md:p-12',
        )}
      >
        <Logo size={48} />
        <h1 id={`${CERTIFICATE_ID}-title`} className="text-title">
          Certificate of completion
        </h1>
        <div className="flex flex-col items-center gap-2">
          <p className="text-body text-muted">This certifies that</p>
          <p className="break-words text-h1">{certificate.learnerName}</p>
          <p className="text-body text-muted">completed the course</p>
          <p className="break-words text-h2">{certificate.courseTitle}</p>
        </div>
        <dl className="flex flex-wrap justify-center gap-x-10 gap-y-4">
          <Fact label="Issued">{formatCertificateDay(certificate.issuedOn)}</Fact>
          <Fact label={certificate.status === 'expired' ? 'Expired' : 'Expires'}>
            {certificate.expiresOn ? formatCertificateDay(certificate.expiresOn) : 'Never'}
          </Fact>
          {score && <Fact label="Score">{score}</Fact>}
          <Fact label="Certificate code">
            <span className="font-mono">{certificate.code}</span>
          </Fact>
        </dl>
        <p className="break-all text-small text-muted">{`Check this certificate at ${checkUrl}`}</p>
      </article>
    </main>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="text-body font-medium">{children}</dd>
    </div>
  );
}

/** For a certificate that expired or soon will: the way to a new one. Not printed. */
function RenewalNote({ certificate }: { certificate: Certificate }) {
  if (certificate.status === 'valid') return null;
  return (
    <div className="flex flex-col items-start gap-3 rounded border border-border bg-fill p-4">
      <p className={cn('text-body font-medium', STATUS_TONES[certificate.status])}>
        {statusLine(certificate)}
      </p>
      <p className="text-body">Taking the course again gives a new certificate.</p>
      <Link
        to={courseHref(certificate.courseId)}
        className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'max-md:h-11' })}
      >
        Open course
      </Link>
    </div>
  );
}
