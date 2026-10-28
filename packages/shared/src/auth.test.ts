import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  changePasswordBodySchema,
  meResponseSchema,
  passwordProblem,
  readCsrfToken,
  signInBodySchema,
} from './index';

describe('readCsrfToken', () => {
  it('reads the __Host- cookie first, then the plain one', () => {
    expect(readCsrfToken('theme=dark; __Host-carehub_csrf=over-https; carehub_csrf=planted')).toBe(
      'over-https',
    );
    expect(readCsrfToken('carehub_csrf=local; theme=dark')).toBe('local');
    expect(readCsrfToken('theme=dark; carehub_csrf_old=x')).toBeNull();
    expect(readCsrfToken('')).toBeNull();
  });
});

describe('meResponseSchema', () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test.person@example.test',
    name: 'Test Person',
    avatarUrl: null,
    isSiteAdmin: false,
    timeZone: 'America/Denver',
    use24h: false,
    weekStart: 0,
    mustChangePassword: false,
  };
  const workspace = { id: '00000000-0000-4000-8000-000000000002', name: 'Care Hub' };
  const member = {
    workspaceId: workspace.id,
    kind: 'member',
    roleId: '00000000-0000-4000-8000-000000000003',
    roleName: 'Viewer',
    permissions: [],
    isAdmin: false,
  } as const;
  const guest = {
    workspaceId: workspace.id,
    kind: 'guest',
    roleId: null,
    roleName: null,
    permissions: [],
    isAdmin: false,
  } as const;

  it('describes GET /api/auth/me for members, guests and people outside the workspace', () => {
    for (const me of [
      { user, member, workspace },
      { user, member: guest, workspace },
      { user, member: null, workspace },
    ]) {
      expect(meResponseSchema.parse(me)).toEqual(me);
    }
  });

  it('rejects unknown permissions, guests with a role, permissions or admin, and odd week starts', () => {
    const bad = [
      { user, member: { ...member, permissions: ['pages.fly'] }, workspace },
      { user, member: { ...guest, permissions: ['pages.comment'] }, workspace },
      { user, member: { ...guest, roleId: member.roleId, roleName: 'Viewer' }, workspace },
      { user, member: { ...guest, isAdmin: true }, workspace },
      { user: { ...user, weekStart: 7 }, member: null, workspace },
    ];
    for (const me of bad) expect(meResponseSchema.safeParse(me).success).toBe(false);
  });
});

describe('signInBodySchema', () => {
  it('trims the email and needs both fields', () => {
    expect(signInBodySchema.parse({ email: ' Ana@Example.test ', password: 'x' }).email).toBe(
      'Ana@Example.test',
    );
    expect(signInBodySchema.safeParse({ email: ' ', password: 'x' }).success).toBe(false);
    expect(signInBodySchema.safeParse({ email: 'ana@example.test', password: '' }).success).toBe(
      false,
    );
  });
});

describe('password lengths', () => {
  const email = 'ana@example.test';
  // Different emoji, two UTF-16 units each: 256 characters, 512 units.
  const longest = Array.from({ length: PASSWORD_MAX_LENGTH }, (_, i) =>
    String.fromCodePoint(0x1f400 + i),
  ).join('');
  const tooLong = `${longest}x`;

  it('counts characters, not UTF-16 units, wherever a password is checked', () => {
    expect(longest).toHaveLength(2 * PASSWORD_MAX_LENGTH);
    expect(passwordProblem(longest, email)).toBeNull();
    expect(passwordProblem(tooLong, email)).toBe('Use at most 256 characters.');
    const signIn = (password: string) => signInBodySchema.safeParse({ email, password }).success;
    expect(signIn(longest)).toBe(true);
    expect(signIn(tooLong)).toBe(false);
    const change = (currentPassword: string) =>
      changePasswordBodySchema.safeParse({ currentPassword, newPassword: longest }).success;
    expect(change(longest)).toBe(true);
    expect(change(tooLong)).toBe(false);
  });
});

describe('passwordProblem', () => {
  const email = 'eli.editor@example.test';
  const TOO_EASY = /too easy to guess/;

  it('needs at least 12 characters, and at most 256', () => {
    expect(passwordProblem('tide pool b', email)).toBe('Use at least 12 characters.');
    expect(passwordProblem('x'.repeat(257), email)).toBe('Use at most 256 characters.');
  });

  it('refuses common passwords, with the usual changes', () => {
    // Separated by spaces, one string, so nothing here reads like a setting with a password.
    const common = `
      password1234 Password123! P@ssw0rd2024! pa55word1234 welcome12345 iloveyou2024 Summer2024!!
      carehub12345 qwerty123456 Qwertyuiop12 monkey123456 Letmein12345! passwordpassword
      aaaaaaaaaaaa 121212121212 abcabcabcabc abcdefghijkl zyxwvutsrqpo 123456789012 987654321098
      000000000000 1q2w3e4r5t6y ab1234567890 abc123456789 !@#$%^&*()_+
    `;
    for (const candidate of common.trim().split(/\s+/)) {
      expect(passwordProblem(candidate, email), candidate).toMatch(TOO_EASY);
    }
  });

  it('refuses the email, or its name with numbers or symbols added', () => {
    for (const candidate of [
      email,
      `${email}!`,
      'eli.editor2024',
      'Eli.Editor!!!',
      'elieditor1234',
    ]) {
      expect(passwordProblem(candidate, email), candidate).toBe(
        "Don't use your email in your password.",
      );
    }
  });

  it('accepts passphrases and random passwords', () => {
    const fine = [
      'tide pool sandwich lantern',
      'purple-otter-lamp-river',
      'Welcome2CareHub-blue',
      'correct horse battery staple',
      'k83920174659',
      '839201746592',
      'xK9#mQ2$vL5z',
      'x9#k2%q8^m3&',
      'q7#x9!k2@m4$',
    ];
    for (const candidate of fine) expect(passwordProblem(candidate, email), candidate).toBeNull();
  });
});
