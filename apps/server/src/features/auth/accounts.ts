import type { CurrentUser } from '@carehub/shared';
import { eq } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import { isUniqueViolation, type Db, type Tx } from '../../db';
import { hashPassword } from './passwords';
import { users } from './schema';

/** Someone's account, without their settings. */
export type Account = Pick<CurrentUser, 'id' | 'email' | 'name'>;

const accountColumns = { id: users.id, email: users.email, name: users.name };

/** Sign-in names are stored trimmed and in lower case (the users_email_lower_case constraint). */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface NewAccount {
  email: string;
  name: string;
  /** Stored as an Argon2id hash. Leave it out for an account that sets its password later. */
  password?: string;
  isSiteAdmin?: boolean;
  /** The person chooses their own password at their next sign-in. */
  mustChangePassword?: boolean;
}

/**
 * Adds an account on this server. It isn't in any workspace until `addMember`. 409 when the email
 * already has an account.
 */
export async function createAccount(db: Db | Tx, input: NewAccount): Promise<Account> {
  const passwordHash = input.password === undefined ? null : await hashPassword(input.password);
  try {
    const [account] = await db
      .insert(users)
      .values({
        email: normalizeEmail(input.email),
        name: input.name,
        passwordHash,
        isSiteAdmin: input.isSiteAdmin ?? false,
        mustChangePassword: input.mustChangePassword ?? false,
      })
      .returning(accountColumns);
    if (!account) throw new Error('The account was not saved.');
    return account;
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) {
      throw httpError(409, 'conflict', 'There is already an account with this email.');
    }
    throw error;
  }
}

/** The account with this sign-in name, or null. */
export async function findAccountByEmail(db: Db | Tx, email: string): Promise<Account | null> {
  const [account] = await db
    .select(accountColumns)
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return account ?? null;
}
