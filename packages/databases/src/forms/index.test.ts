import { describe, expect, it } from 'vitest';
import * as forms from './index';

describe('@carehub/databases/forms', () => {
  it('exports the form rules', () => {
    for (const fn of [
      forms.questionKind,
      forms.addableProperties,
      forms.conditionOps,
      forms.conditionOpLabel,
      forms.validateFormDefinition,
      forms.visibleQuestions,
      forms.canMoveQuestion,
      forms.moveQuestion,
      forms.pruneLogic,
      forms.checkSubmission,
      forms.draftKey,
      forms.formAudience,
      forms.isAnonymousForm,
      forms.anonymityWarning,
      forms.formGate,
      forms.responseRateLimit,
      forms.formChangeNeedsFullAccess,
      forms.anonymousLine,
      forms.responseNotice,
    ]) {
      expect(typeof fn).toBe('function');
    }
    expect(forms.FORM_CHOICE_LIMIT).toBe(7);
  });
});
