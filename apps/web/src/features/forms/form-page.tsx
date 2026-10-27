import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation, useParams } from 'react-router';
import { Button, Skeleton } from '@carehub/ui';
import { isApiError, OFFLINE_MESSAGE, UNKNOWN_ERROR_MESSAGE } from '../databases/api';
import { formKeys, loadFillForm, useFormsClient } from './api';
import { FormFill } from './form-fill';

/**
 * Where someone goes to sign in before a form that needs it, coming straight back after. The one
 * place to change when the sign-in screens land.
 */
export const SIGN_IN_PATH = '/sign-in';

export function signInHref(back: string): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(back)}`;
}

function loadProblem(error: unknown): string {
  if (!isApiError(error)) return UNKNOWN_ERROR_MESSAGE;
  return error.status === 0 ? OFFLINE_MESSAGE : error.message;
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" aria-busy="true">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

function usePageTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `Care Hub · ${title}` : 'Care Hub';
  }, [title]);
}

/**
 * The form link `/forms/:code`: the form for the person signed in, or signed out for a form
 * anyone can fill in; otherwise the sign-in screen first. Works without the app shell.
 */
export function FormPage() {
  const { code = '' } = useParams();
  const client = useFormsClient();
  const location = useLocation();
  const query = useQuery({
    queryKey: formKeys.link(code),
    queryFn: () => loadFillForm(client, code),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const loaded = query.data;
  usePageTitle(loaded?.kind === 'form' ? loaded.data.form.title.trim() || 'Untitled' : null);

  if (loaded?.kind === 'sign_in') {
    return <Navigate to={signInHref(`${location.pathname}${location.search}`)} replace />;
  }

  let body: ReactNode;
  if (loaded?.kind === 'form') {
    body = (
      <FormFill
        key={loaded.data.formId}
        data={loaded.data}
        access={loaded.access}
        code={code}
        onReload={() => void query.refetch()}
      />
    );
  } else if (query.isError) {
    body = (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-3 rounded border border-border bg-bg p-6">
        <p role="alert" className="text-body text-fg">
          {loadProblem(query.error)}
        </p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
      </div>
    );
  } else {
    body = <FormSkeleton />;
  }

  return <main className="min-h-screen bg-sidebar px-4 py-8">{body}</main>;
}
