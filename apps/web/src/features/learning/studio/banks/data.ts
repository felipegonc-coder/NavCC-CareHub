import {
  BankListSchema,
  BankReplySchema,
  ImportQuestionsReplySchema,
  SaveBankReplySchema,
} from '@carehub/learning';
import type { CreateBankRequest, Id, QuestionBank } from '@carehub/learning';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, LearningApiError, noContent } from '../../data';
import { StudioError } from '../data/client';
import type { StudioErrorCode } from '../data/client';

/** TanStack Query keys for question banks, so a save can refresh the lists that show it. */
export const bankKeys = {
  all: ['learning', 'banks'] as const,
  list: ['learning', 'banks', 'list'] as const,
  bank: (bankId: Id) => ['learning', 'banks', 'bank', bankId] as const,
};

/** The bank list's address in the Studio. */
export const BANKS_PATH = '/learning/studio/banks';

/** A bank editor's address in the Studio. */
export const bankEditorPath = (bankId: Id): string => `${BANKS_PATH}/${encodeURIComponent(bankId)}`;

const apiPath = (bankId: Id) => `/studio/banks/${encodeURIComponent(bankId)}`;

const CODES: Partial<Record<number, StudioErrorCode>> = {
  400: 'invalid',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'cannot_publish',
};

/** Turns a failed API call into the StudioError that the Studio's states and autosave understand. */
export function toStudioError(error: unknown): unknown {
  if (!(error instanceof LearningApiError)) return error;
  return new StudioError(
    error.offline ? 'offline' : (CODES[error.status] ?? 'failed'),
    error.message,
  );
}

async function call<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw toStudioError(error);
  }
}

/** The workspace's question banks, without their questions (`GET /studio/banks`). */
export function useBankList() {
  return useQuery({
    queryKey: bankKeys.list,
    queryFn: ({ signal }) => call(api('GET', '/studio/banks', BankListSchema, { signal })),
  });
}

/**
 * One bank with the revision to save against. Loaded once per visit to the editor: it never refetches while the
 * editor is open (that holds the latest copy) and is dropped when the editor closes, so the next visit is fresh.
 */
export function useBank(bankId: Id) {
  return useQuery({
    queryKey: bankKeys.bank(bankId),
    queryFn: ({ signal }) => call(api('GET', apiPath(bankId), BankReplySchema, { signal })),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** Saves a whole bank against `revision`; fails with `conflict` when someone saved first (decision 0304). */
export function saveBank(bank: QuestionBank, revision: number): Promise<{ revision: number }> {
  return call(api('PUT', apiPath(bank.id), { bank, revision }, SaveBankReplySchema));
}

/** Starts an empty bank. */
export function useCreateBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBankRequest) =>
      call(api('POST', '/studio/banks', input, BankReplySchema)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankKeys.list }),
  });
}

/** Deletes a bank. Published courses keep the questions they copied from it. */
export function useDeleteBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bankId: Id) => call(api('DELETE', apiPath(bankId), noContent)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankKeys.list }),
  });
}

/**
 * Adds the questions in spreadsheet text (CSV) to a bank on the server; the reply says how many were added and
 * which rows were left out. Settles once the bank is loaded again, so use `mutateAsync` and show the reply then.
 */
export function useImportQuestions(bankId: Id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) =>
      call(api('POST', `${apiPath(bankId)}/import`, { csv }, ImportQuestionsReplySchema)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankKeys.all }),
  });
}
