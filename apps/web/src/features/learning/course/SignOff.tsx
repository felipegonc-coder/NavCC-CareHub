import type { IsoDateTime, NewProgressEvent } from '@carehub/learning';
import { Button, Checkbox, Field } from '@carehub/ui';
import { CircleCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { SignOff } from './start';

type SignOffSectionProps = { signOff: SignOff; emit(event: NewProgressEvent): void };

const signedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** When the learner signed, in the browser's time zone and language. */
export const formatSignedAt = (at: IsoDateTime): string => signedFormat.format(new Date(at));

/**
 * The course's "I have read and understood" sign-off: its statement and, once every lesson is read,
 * a box to tick and a button to sign. After that, when it was signed.
 */
export function SignOffSection({ signOff, emit }: SignOffSectionProps) {
  const headingId = useId();
  const [ticked, setTicked] = useState(false);
  const signedRef = useRef<HTMLParagraphElement>(null);
  const signing = useRef(false);
  // The box and button go once signed, so the note that replaces them takes the focus.
  useEffect(() => {
    if (!signOff.signedAt || !signing.current) return;
    signing.current = false;
    signedRef.current?.focus();
  }, [signOff.signedAt]);

  const sign = () => {
    if (!ticked) return;
    signing.current = true;
    emit({ type: 'acknowledged', statement: signOff.statement });
  };
  const statement = <p className="break-words text-body">{signOff.statement}</p>;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded border border-border p-4"
    >
      <h2 id={headingId} className="text-h3">
        Sign-off
      </h2>
      {signOff.signedAt ? (
        <>
          {statement}
          <p
            ref={signedRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-small text-success focus:outline-none"
          >
            <CircleCheck aria-hidden className="size-4 shrink-0" />
            Signed on {formatSignedAt(signOff.signedAt)}
          </p>
        </>
      ) : signOff.ready ? (
        <div className="flex flex-col gap-3">
          <Field label={signOff.statement} layout="inline">
            <Checkbox checked={ticked} onCheckedChange={(value) => setTicked(value === true)} />
          </Field>
          <Button onClick={sign} disabled={!ticked} className="self-start">
            Sign
          </Button>
        </div>
      ) : (
        <>
          {statement}
          <p className="text-small text-muted">Read every lesson first, then sign here.</p>
        </>
      )}
    </section>
  );
}
