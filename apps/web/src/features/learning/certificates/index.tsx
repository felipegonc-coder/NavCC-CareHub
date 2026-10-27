// Stub screens from the Learning base PR. B3 replaces them; the routes in ../routes.tsx stay as they are.

/** `/learning/certificates`: the person's certificates. */
export function CertificatesScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Certificates</title>
      <h1 className="text-title text-fg">Certificates</h1>
    </main>
  );
}

/** `/learning/certificates/:certificateId`: one certificate. */
export function CertificateScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Certificate</title>
      <h1 className="text-title text-fg">Certificate</h1>
    </main>
  );
}
