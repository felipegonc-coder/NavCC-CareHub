import type { Certificate } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { CourseCard } from '../catalog/CourseCard';
import { MyLearningLink } from '../player/ScreenMessage';
import { CodeCheck } from './CodeCheck';
import {
  certificateHref,
  formatCertificateDay,
  formatScore,
  PAGE_CLASSES,
  STATUS_TONES,
  statusLine,
} from './data';

/** `/learning/certificates`: the person's certificates, newest first, and the code check. */
export function CertificatesPage({ certificates }: { certificates: readonly Certificate[] }) {
  return (
    <main className={PAGE_CLASSES}>
      <title>Care Hub · Certificates</title>
      <div className="flex flex-col gap-2">
        <h1 className="text-title">Certificates</h1>
        <p className="text-body text-muted">
          Passing or completing a course that gives a certificate adds it here. Open one to print it
          or save it as a PDF.
        </p>
      </div>
      <section aria-labelledby="certificates-mine" className="flex flex-col gap-3">
        <h2 id="certificates-mine" className="text-h2">
          Your certificates
        </h2>
        {certificates.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-muted">No certificates yet.</p>
            <MyLearningLink />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {certificates.map((certificate) => (
              <li key={certificate.id}>
                <CertificateCard certificate={certificate} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <CodeCheck />
    </main>
  );
}

/** A certificate in the list: the course title opens its page. */
function CertificateCard({ certificate }: { certificate: Certificate }) {
  const score = formatScore(certificate.score);
  return (
    <CourseCard
      title={certificate.courseTitle}
      href={certificateHref(certificate.id)}
      facts={`Issued on ${formatCertificateDay(certificate.issuedOn)}`}
    >
      <p className={cn('text-small font-medium', STATUS_TONES[certificate.status])}>
        {statusLine(certificate)}
      </p>
      <p className="text-small text-muted">
        {score && `Score ${score} · `}
        Code <span className="font-mono">{certificate.code}</span>
      </p>
    </CourseCard>
  );
}
