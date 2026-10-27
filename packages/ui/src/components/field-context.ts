import { createContext, useContext, type AriaAttributes } from 'react';

export interface FieldContextValue {
  id: string;
  hintId: string | undefined;
  errorId: string | undefined;
  invalid: boolean;
  required: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

interface OwnControlProps {
  id?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  required?: boolean | undefined;
}

/** Id, hint, error and required state for a control inside <Field>. The control's own props win. */
export function useFieldControlProps(own: OwnControlProps) {
  const field = useContext(FieldContext);
  const describedBy = [own['aria-describedby'], field?.hintId, field?.errorId]
    .filter(Boolean)
    .join(' ');
  return {
    id: own.id ?? field?.id,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': own['aria-invalid'] ?? (field?.invalid ? true : undefined),
    required: own.required ?? (field?.required ? true : undefined),
  };
}
