import type { Certificate } from '@carehub/learning';
import { Button, buttonClasses, cn, Field, Input } from '@carehub/ui';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { LearningApiError } from '../data';
import {
  certificateHref,
  formatCertificateDay,
  readCertificateCode,
  STATUS_TONES,
  statusLine,
  useCodeCheck,
} from './data';

/**
 * "Check a certificate code": the code is checked for typos here, then looked up. The code lives
 * in the address (`?code=7KQ2-M9XD-4TB8`), so the link printed on a certificate opens its check.
 */
export function CodeCheck() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('code') ?? '';
  const read = asked ? readCertificateCode(asked) : null;
  const code = read && 'code' in read ? read.code : null;
  const [input, setInput] = useState(code ?? asked);
  const [problem, setProblem] = useState(read && 'problem' in read ? read.problem : null);
  const check = useCodeCheck(code);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = readCertificateCode(input);
    if ('problem' in typed) {
      setProblem(typed.problem);
      return;
    }
    setProblem(null);
    setInput(typed.code);
    const next = new URLSearchParams(params);
    next.set('code', typed.code);
    setParams(next, { replace: true });
  };

  let result: ReactNode = null;
  if (code !== null && !problem) {
    if (check.data !== undefined) {
      result = check.data ? <CodeFound certificate={check.data} /> : <CodeNotFound code={code} />;
    } else if (check.error) {
      result = (
        <div className="flex flex-col items-start gap-2">
          <p className="text-body text-danger">
            {check.error instanceof LearningApiError
              ? check.error.message
              : "The code couldn't be checked. Try again."}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void check.refetch()}>
            Try again
          </Button>
        </div>
      );
    } else {
      result = <p className="text-body text-muted">Checking {code}…</p>;
    }
  }

  return (
    <section aria-labelledby="certificate-code-check" className="flex flex-col gap-3">
      <h2 id="certificate-code-check" className="text-h2">
        Check a certificate code
      </h2>
      <p className="text-body text-muted">
        Every certificate has a code. Type it to see who the certificate is for and whether it's
        still valid.
      </p>
      <form noValidate onSubmit={submit} className="flex flex-col items-start gap-3">
        <Field label="Certificate code" error={problem} className="w-full">
          <Input
            value={input}
            placeholder="7KQ2-M9XD-4TB8"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono"
            onChange={(event) => {
              setInput(event.target.value);
              setProblem(null);
            }}
          />
        </Field>
        <Button type="submit" loading={check.isFetching} className="max-md:h-11">
          Check
        </Button>
      </form>
      <div aria-live="polite">{result}</div>
    </section>
  );
}

/** A code that checks out: whose certificate it is, for which course, and where it stands. */
function CodeFound({ certificate }: { certificate: Certificate }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded border border-border bg-bg p-4">
      <p className="text-body font-medium">{`${certificate.code} is a real certificate.`}</p>
      <p className="text-body">
        {`Care Hub issued it to ${certificate.learnerName} for ${certificate.courseTitle} on `}
        {`${formatCertificateDay(certificate.issuedOn)}.`}
      </p>
      <p className={cn('text-small font-medium', STATUS_TONES[certificate.status])}>
        {statusLine(certificate)}
      </p>
      <Link
        to={certificateHref(certificate.id)}
        className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'max-md:h-11' })}
      >
        Open certificate
      </Link>
    </div>
  );
}

function CodeNotFound({ code }: { code: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body font-medium">{`No certificate has the code ${code}.`}</p>
      <p className="text-body text-muted">
        Check the code on the certificate. You can check your own certificates; checking someone
        else's needs access to Learning reports.
      </p>
    </div>
  );
}
