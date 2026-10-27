import { APP_NAME } from '@carehub/shared';
import { Button, Card, Field, Input, Logo } from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';
import { resetAppStart } from './app-start';
import { SIGN_IN_API } from './config';
import { useMeQuery } from './me';
import { safeNext } from './next';

export const WRONG_DETAILS = "That email and password don't match. Try again.";

const wrongDetails = (error: unknown) =>
  error instanceof ApiError && (error.status === 400 || error.status === 401);

/**
 * What a failed sign-in says. Wrong details always get the same sentence, so it never tells which
 * emails have an account; anything else (a wait after too many tries, offline) is the server's.
 */
export function signInErrorMessage(error: unknown): string {
  if (wrongDetails(error)) return WRONG_DETAILS;
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

interface FieldErrors {
  email?: string | undefined;
  password?: string | undefined;
}

/** `/sign-in?next=/p/…`: email and password, then back to `next` (Home if it isn't on this site). */
export function SignInScreen() {
  usePageTitle('Sign in');
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const me = useMeQuery();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (me.data) return <Navigate to={next} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const address = email.trim();
    const errors: FieldErrors = {
      email: address ? undefined : 'Enter your email.',
      password: password ? undefined : 'Enter your password.',
    };
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email || errors.password) {
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setPending(true);
    try {
      await api.post(SIGN_IN_API, { email: address, password });
    } catch (error) {
      setPending(false);
      setFormError(signInErrorMessage(error));
      if (wrongDetails(error)) {
        setPassword('');
        passwordRef.current?.focus();
      }
      return;
    }
    // Someone else may have used this device: nothing cached stays, and appStart runs again.
    resetAppStart();
    queryClient.clear();
    void navigate(next, { replace: true });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-sidebar px-4 py-12 text-fg">
      <div className="flex flex-col items-center gap-3 text-center">
        <Logo size={48} decorative />
        <h1 className="text-h2">Sign in to {APP_NAME}</h1>
      </div>
      <Card className="w-96 max-w-full p-6">
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Field label="Email" error={fieldErrors.email}>
            <Input
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Password" error={fieldErrors.password}>
            <Input
              ref={passwordRef}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          {formError && (
            <p role="alert" className="text-small text-danger">
              {formError}
            </p>
          )}
          <Button type="submit" loading={pending} className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
      <p className="text-center text-small text-muted">
        Forgot your password? Ask an Admin to reset it.
      </p>
    </main>
  );
}
