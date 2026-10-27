import { Button, buttonClasses } from '@carehub/ui';
import { Link, useParams } from 'react-router';
import { LearningApiError } from '../data';
import { ScreenLoading, ScreenMessage } from '../player/ScreenMessage';
import { CertificatesPage } from './CertificateList';
import { CertificateView } from './CertificateView';
import { CERTIFICATES_HREF, useCertificate, useMyCertificates } from './data';

/** `/learning/certificates`: the person's certificates, and a check for any certificate's code. */
export function CertificatesScreen() {
  const certificates = useMyCertificates();
  if (!certificates.data) {
    if (!certificates.error) return <ScreenLoading label="Loading your certificates" />;
    return (
      <LoadFailed
        error={certificates.error}
        title="Your certificates didn't load"
        retry={() => void certificates.refetch()}
      />
    );
  }
  return <CertificatesPage certificates={certificates.data} />;
}

/** `/learning/certificates/:certificateId`: one certificate, ready to print or save as a PDF. */
export function CertificateScreen() {
  const { certificateId } = useParams();
  if (!certificateId) return <CertificateNotFound />;
  return <CertificateLoader certificateId={certificateId} />;
}

function CertificateLoader({ certificateId }: { certificateId: string }) {
  const certificate = useCertificate(certificateId);
  if (!certificate.data) {
    if (!certificate.error) return <ScreenLoading label="Loading the certificate" />;
    const status = certificate.error instanceof LearningApiError ? certificate.error.status : 0;
    if (status === 404) return <CertificateNotFound />;
    return (
      <LoadFailed
        error={certificate.error}
        title="This certificate didn't load"
        retry={() => void certificate.refetch()}
      />
    );
  }
  return <CertificateView certificate={certificate.data} />;
}

function CertificatesLink() {
  return (
    <Link
      to={CERTIFICATES_HREF}
      className={buttonClasses({ variant: 'secondary', className: 'max-md:h-11' })}
    >
      Go to certificates
    </Link>
  );
}

/** Someone else's certificate (without analytics), one that doesn't exist, or a bad link. */
function CertificateNotFound() {
  return (
    <ScreenMessage
      title="Certificate not found"
      text="Check the link, or open the certificate from your certificates."
    >
      <CertificatesLink />
    </ScreenMessage>
  );
}

type LoadFailedProps = { error: unknown; title: string; retry(): void };

/** Guests get a 403 from every Learning call; anything else can be tried again. */
function LoadFailed({ error, title, retry }: LoadFailedProps) {
  if (error instanceof LearningApiError && error.status === 403) {
    return (
      <ScreenMessage
        title="No access to certificates"
        text="Certificates aren't available for guest accounts yet."
      />
    );
  }
  return (
    <ScreenMessage
      title={title}
      text={error instanceof LearningApiError ? error.message : 'Reload the page, then try again.'}
    >
      <Button onClick={retry} className="max-md:h-11">
        Try again
      </Button>
    </ScreenMessage>
  );
}
