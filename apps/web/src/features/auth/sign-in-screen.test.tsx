import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { routes } from './routes';
import { SignInScreen, WRONG_DETAILS } from './sign-in-screen';
import {
  changes,
  createTestQueryClient,
  fakeAuthServer,
  json,
  meFor,
  renderRoutes,
  restoreFetch,
  type FakeAuthServer,
} from './test-utils';

const SIGN_IN = 'POST /api/auth/sign-in';
const PASSWORD = 'fictional-test-password';

afterEach(restoreFetch);

function renderSignIn(path = '/sign-in', queryClient = createTestQueryClient()) {
  return renderRoutes(
    <>
      <Route path="/sign-in" element={<SignInScreen />} />
      <Route path="*" element={<p>Signed-in screen</p>} />
    </>,
    { path, queryClient },
  );
}

const email = () => screen.getByLabelText('Email');
const password = () => screen.getByLabelText('Password');

function signIn(address: string, secret: string) {
  fireEvent.change(email(), { target: { value: address } });
  fireEvent.change(password(), { target: { value: secret } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

/** Answers the sign-in request; correct details sign Eli in. */
function acceptSignIn(server: FakeAuthServer) {
  server.routes[SIGN_IN] = () => {
    server.me = meFor();
    return json(200, { ok: true });
  };
}

describe('SignInScreen', () => {
  it('is one titled screen, loaded lazily at /sign-in', async () => {
    fakeAuthServer(null);
    renderSignIn();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to Care Hub' })).toBeVisible();
    expect(screen.getByText('Forgot your password? Ask an Admin to reset it.')).toBeVisible();
    expect(document.title).toBe('Care Hub · Sign in');
    expect(email()).toHaveAttribute('autocomplete', 'username');
    expect(password()).toHaveAttribute('type', 'password');

    expect(routes).toEqual([{ path: 'sign-in', lazy: expect.any(Function) }]);
    expect((await import('./sign-in-route')).Component).toBe(SignInScreen);
  });

  it('asks for the email and the password before sending anything', async () => {
    const server = fakeAuthServer(null);
    renderSignIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email.')).toBeVisible();
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveFocus();

    fireEvent.change(email(), { target: { value: 'eli.editor@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.queryByText('Enter your email.')).not.toBeInTheDocument();
    expect(password()).toHaveFocus();
    await waitFor(() => expect(server.requests).toHaveLength(1)); // GET /api/auth/me only
    expect(changes(server)).toEqual([]);
  });

  it('says when the email and password do not match, and empties the password', async () => {
    const server = fakeAuthServer(null, {
      [SIGN_IN]: () =>
        json(401, { error: { code: 'invalid_credentials', message: 'Wrong email or password.' } }),
    });
    renderSignIn();
    signIn('eli.editor@example.test', PASSWORD);
    expect(await screen.findByRole('alert')).toHaveTextContent(WRONG_DETAILS);
    expect(password()).toHaveValue('');
    expect(password()).toHaveFocus();
    expect(email()).toHaveValue('eli.editor@example.test');
    expect(server.requests.at(-1)?.body).toEqual({
      email: 'eli.editor@example.test',
      password: PASSWORD,
    });
  });

  it('passes on the wait after too many tries, as the server words it', async () => {
    fakeAuthServer(null, {
      [SIGN_IN]: () =>
        json(429, {
          error: {
            code: 'rate_limited',
            message: 'Too many wrong passwords. Try again in 15 minutes.',
          },
        }),
    });
    renderSignIn();
    signIn('eli.editor@example.test', PASSWORD);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many wrong passwords. Try again in 15 minutes.',
    );
    expect(password()).toHaveValue(PASSWORD);
  });

  it('signs in, forgets everything cached, and goes on to next', async () => {
    const server = fakeAuthServer(null);
    acceptSignIn(server);
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['comments', 'viewer'], { id: 'someone-before' });
    renderSignIn('/sign-in?next=%2Fp%2Fpage-1%3Fview%3Dtable', queryClient);

    signIn('  eli.editor@example.test ', PASSWORD);
    expect(await screen.findByText('Signed-in screen')).toBeVisible();
    expect(screen.getByTestId('address')).toHaveTextContent('/p/page-1?view=table');
    expect(changes(server)).toEqual([SIGN_IN]);
    expect(server.requests.at(-1)?.body).toEqual({
      email: 'eli.editor@example.test',
      password: PASSWORD,
    });
    expect(queryClient.getQueryData(['comments', 'viewer'])).toBeUndefined();
  });

  it('goes Home when next points somewhere else', async () => {
    const server = fakeAuthServer(null);
    acceptSignIn(server);
    renderSignIn('/sign-in?next=%2F%2Felsewhere.example%2Fp%2F1');
    signIn('eli.editor@example.test', PASSWORD);
    expect(await screen.findByText('Signed-in screen')).toBeVisible();
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/$/);
  });

  it('sends someone already signed in straight on', async () => {
    fakeAuthServer(meFor());
    renderSignIn('/sign-in?next=%2Fsettings');
    expect(await screen.findByText('Signed-in screen')).toBeVisible();
    expect(screen.getByTestId('address')).toHaveTextContent('/settings');
  });
});
