import type { ImportQuestionsReply } from '@carehub/learning';
import { useState } from 'react';
import { useParams } from 'react-router';
import { StudioRoot } from '../context';
import { ErrorState, LoadingState } from '../states';
import { BankEditor } from './BankEditor';
import { BankList } from './BankList';
import { useBank } from './data';

/** `/learning/studio/banks`: question banks. */
export function BanksScreen() {
  return (
    <StudioRoot>
      <BankList />
    </StudioRoot>
  );
}

function LoadBank({ bankId }: { bankId: string }) {
  const bank = useBank(bankId);
  // The editor starts again with the bank as loaded after an import, so what the import added is kept here.
  const [imported, setImported] = useState<ImportQuestionsReply | null>(null);
  if (bank.isPending || (bank.isFetching && !bank.isError)) {
    return (
      <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
        <title>Care Hub · Question bank</title>
        <h1 className="text-title text-fg">Question bank</h1>
        <LoadingState label="Loading the bank" />
      </main>
    );
  }
  if (bank.isError) {
    return (
      <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
        <title>Care Hub · Question bank</title>
        <h1 className="text-title text-fg">Question bank</h1>
        <ErrorState error={bank.error} onRetry={() => void bank.refetch()} />
      </main>
    );
  }
  // A reload remounts the editor, so it starts again from the version just loaded.
  return (
    <BankEditor
      key={bank.dataUpdatedAt}
      reply={bank.data}
      imported={imported}
      onImported={setImported}
      onReload={() => {
        setImported(null);
        void bank.refetch();
      }}
    />
  );
}

/** `/learning/studio/banks/:bankId`: one question bank. */
export function BankEditorScreen() {
  const { bankId = '' } = useParams();
  return (
    <StudioRoot>
      <LoadBank key={bankId} bankId={bankId} />
    </StudioRoot>
  );
}
