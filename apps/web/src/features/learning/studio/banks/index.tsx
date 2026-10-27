// Stub screens from the Learning base PR. B9 replaces them; the routes in ../../routes.tsx stay as they are.

/** `/learning/studio/banks`: question banks. */
export function BanksScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Question banks</title>
      <h1 className="text-title text-fg">Question banks</h1>
    </main>
  );
}

/** `/learning/studio/banks/:bankId`: one question bank. */
export function BankEditorScreen() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Edit question bank</title>
      <h1 className="text-title text-fg">Edit question bank</h1>
    </main>
  );
}
