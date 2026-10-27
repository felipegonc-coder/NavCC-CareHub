import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useParams } from 'react-router';
import { Button, Skeleton } from '@carehub/ui';
import { formKeys, loadFillForm, problemText, useFormsClient } from './api';
import { FormFill } from './form-fill';

/**
 * Where someone goes to sign in before a form that needs it, coming straight back after. The one
 * place to change when the sign-in screens land.
 */
export const SIGN_IN_PATH = '/sign-in';

export function signInHref(back: string): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(back)}`;
}

/** Title and three question cards, after 300 ms (no flash for fast answers). */
function FormSkeleton() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return null;
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-4" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function usePageTitle(title: string | null, enabled: boolean) {
  useEffect(() => {
    if (enabled) document.title = title ? `Care Hub · ${title}` : 'Care Hub';
  }, [title, enabled]);
}

/**
 * The form behind a link, for the person signed in. With nobody signed in, a form anyone can fill
 * in opens as it is; any other sends them to sign in and straight back. A skeleton while it loads,
 * the form or the message that replaces it, or what went wrong with Retry. Used by the form link
 * and by the Form view for people who can't edit it.
 */
export function FormByCode({ code, setsTitle = false }: { code: string; setsTitle?: boolean }) {
  const client = useFormsClient();
  const location = useLocation();
  const query = useQuery({
    queryKey: formKeys.link(code),
    queryFn: () => loadFillForm(client, code),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const loaded = query.data;
  usePageTitle(
    loaded?.kind === 'form' ? loaded.data.form.title.trim() || 'Untitled' : null,
    setsTitle,
  );

  if (loaded?.kind === 'sign_in') {
    return <Navigate to={signInHref(`${location.pathname}${location.search}`)} replace />;
  }
  if (loaded?.kind === 'form') {
    return (
      <FormFill
        key={loaded.data.formId}
        data={loaded.data}
        code={code}
        signedOut={loaded.signedOut}
        onReload={() => void query.refetch()}
      />
    );
  }
  if (query.isError) {
    return (
      <div className="mx-auto flex w-full max-w-page flex-col items-start gap-3 rounded border border-border bg-bg p-6">
        <p role="alert" className="text-body text-fg">
          {problemText(query.error)}
        </p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return <FormSkeleton />;
}

/**
 * The form link `/forms/:code`: the form for the person signed in; signed out, the form when
 * anyone can fill it in, else the sign-in screen first, then straight back. Works without the app
 * shell.
 */
export function FormPage() {
  const { code = '' } = useParams();
  return (
    <main className="min-h-screen bg-sidebar px-4 py-8">
      <FormByCode code={code} setsTitle />
    </main>
  );
}
