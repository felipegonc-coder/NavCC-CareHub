import { useId, useMemo, useState } from 'react';
import { Button } from '@carehub/ui';
import { defaultConfig, type FormDefinition, type Id, type Property } from '@carehub/databases';
import { can } from '@carehub/databases/access';
import {
  canMoveQuestion,
  formChangeNeedsFullAccess,
  moveQuestion,
  validateFormDefinition,
} from '@carehub/databases/forms';
import type { LayoutProps } from '../databases/contract';
import { useSettingsChange } from '../databases/hooks';
import type { FillForm } from './api';
import { FormBuilder } from './builder';
import { addQuestion, viewForm, type NewQuestionType } from './definition';
import { FormFill } from './form-fill';
import { FormByCode } from './form-page';
import { FormSettings, FULL_ACCESS_HINT, ShareForm } from './settings';

/**
 * The Form view (the database shell draws it for views with the form layout). People who can
 * build forms (Can edit on the database, Lock structure off) get the builder, with Preview, Share
 * form and Settings; everyone else gets the fill screen, as the form link shows it.
 */
export default function FormLayout(props: LayoutProps) {
  const { meta, view } = props;
  if (can('edit_forms', meta.viewerAccess, { locked: meta.locked })) {
    return <FormEditor {...props} />;
  }
  return (
    <div className="px-4 py-8">
      {view.form ? (
        <FormByCode code={view.form.linkCode} />
      ) : (
        <p className="mx-auto max-w-2xl text-body text-fg">
          This form isn&apos;t accepting responses.
        </p>
      )}
    </div>
  );
}

function FormEditor({ meta, view, viewer, actions }: LayoutProps) {
  const settingsId = useId();
  const def = useMemo(() => viewForm(view, meta), [view, meta]);
  const [previewing, setPreviewing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fullAccess = can('manage_form_access', meta.viewerAccess, { locked: meta.locked });
  const canCreate = can('edit_properties', meta.viewerAccess, { locked: meta.locked });
  const settings = useSettingsChange(meta.id);

  /**
   * Checks the form, then saves it for everyone; what's wrong shows above the form. False when it
   * can't be saved.
   */
  function save(next: FormDefinition, properties: readonly Property[] = meta.properties): boolean {
    const invalid = validateFormDefinition(next, properties);
    if (invalid) {
      setProblem(invalid);
      return false;
    }
    if (!fullAccess && formChangeNeedsFullAccess(def, next)) {
      setProblem(FULL_ACCESS_HINT);
      return false;
    }
    setProblem(null);
    // If the server refuses, the shell rolls back and says why in a toast.
    actions.updateView({ form: next }).catch(() => undefined);
    return true;
  }

  function move(from: number, to: number): boolean {
    const blocked = canMoveQuestion(def, from, to, meta.properties);
    if (blocked) {
      setProblem(blocked);
      return false;
    }
    return save(moveQuestion(def, from, to));
  }

  /** "New question": a new property, then its question. The new property's id, once asked. */
  async function create(name: string, type: NewQuestionType): Promise<Id | null> {
    const known = new Set(meta.properties.map((p) => p.id));
    const answer = await settings.mutateAsync((client) =>
      client.createProperty(meta.id, { name, config: defaultConfig(type) }),
    );
    const prop = answer.properties.find((p) => !known.has(p.id));
    return prop && save(addQuestion(def, prop), answer.properties) ? prop.id : null;
  }

  const preview: FillForm = {
    formId: view.id,
    databaseId: meta.id,
    form: def,
    properties: meta.properties,
    gate: { state: 'open', message: null },
    respondent: { userId: viewer.userId, timeZone: viewer.timeZone },
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPreviewing((on) => !on)}>
          {previewing ? 'Edit form' : 'Preview'}
        </Button>
        <ShareForm
          def={def}
          databaseId={meta.id}
          viewId={view.id}
          fullAccess={fullAccess}
          onSave={save}
        />
        <Button
          variant={settingsOpen ? 'secondary' : 'ghost'}
          size="sm"
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          Settings
        </Button>
      </div>
      {problem && (
        <p
          role="alert"
          className="mx-auto w-full max-w-2xl rounded border border-danger px-3 py-2 text-small text-danger"
        >
          {problem}
        </p>
      )}
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          {previewing ? (
            <FormFill data={preview} code={def.linkCode} />
          ) : (
            <FormBuilder
              def={def}
              properties={meta.properties}
              databaseTitle={meta.title}
              onSave={save}
              onMove={move}
              onCreate={canCreate ? create : null}
            />
          )}
        </div>
        {settingsOpen && (
          <FormSettings
            id={settingsId}
            def={def}
            formId={view.id}
            viewer={viewer}
            properties={meta.properties}
            fullAccess={fullAccess}
            onSave={save}
          />
        )}
      </div>
    </div>
  );
}
