import { ErrorState, LoadingState } from '@carehub/ui';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { slots } from '../../slots';
import { startApp } from './app-start';
import { SIGN_IN_REQUIRED } from './config';
import { useMeQuery } from './me';
import { signInPath } from './next';

export interface RequireAuthProps {
  children: ReactNode;
  /** Sends signed-out people to the sign-in screen; config.ts decides, tests pass it. */
  required?: boolean;
}

/**
 * Around the app shell: loads the person signed in and runs the appStart items once for them.
 * When sign-in is required, someone signed out goes to the sign-in screen and comes back here.
 */
export function RequireAuth({ children, required = SIGN_IN_REQUIRED }: RequireAuthProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const me = useMeQuery();
  const user = me.data?.user;

  useEffect(() => {
    if (user) startApp(slots.appStart, { api, navigate: (to) => void navigate(to), user });
  }, [user, navigate]);

  if (!required || me.data) return <>{children}</>;
  if (me.data === null) {
    const here = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={signInPath(here)} replace />;
  }
  return (
    <main className="mx-auto w-full max-w-page px-6 py-16">
      {me.isError ? (
        <ErrorState
          message={me.error instanceof ApiError ? me.error.message : "Couldn't load Care Hub."}
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
      ) : (
        <LoadingState label="Loading Care Hub" />
      )}
    </main>
  );
}
