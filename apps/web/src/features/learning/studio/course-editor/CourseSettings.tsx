import {
  COURSE_TYPES,
  HttpsUrlSchema,
  LIMITS,
  changeCourseType,
  setCourseCover,
  setCourseDescription,
  setCourseSummary,
  setEstimatedMinutes,
  updateCourseSettings,
} from '@carehub/learning';
import type { Course, CourseSettingsPatch } from '@carehub/learning';
import { Checkbox, Field, Input, Textarea } from '@carehub/ui';
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { RichTextInput } from '../editors/text/RichTextInput';
import { ChoiceButtons } from '../fields';
import { COURSE_TYPE_INFO } from '../labels';
import type { EditorActions } from './types';

/** A whole number box that can be cleared while typing; blank means "not set" (null). */
function NumberField(props: {
  label: string;
  hint?: string | undefined;
  value: number | undefined;
  min: number;
  max: number;
  onChange(next: number | null): void;
}): JSX.Element {
  const show = (value: number | undefined) => (value === undefined ? '' : String(value));
  const [text, setText] = useState(show(props.value));
  const [shown, setShown] = useState(props.value);
  if (props.value !== shown) {
    setShown(props.value);
    setText(show(props.value));
  }
  const valid = (raw: string) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= props.min && n <= props.max;
  };
  const typed = text.trim();
  return (
    <Field
      label={props.label}
      hint={props.hint}
      error={
        typed === '' || valid(typed)
          ? undefined
          : `Use a whole number from ${props.min} to ${props.max}.`
      }
    >
      <Input
        inputMode="numeric"
        className="max-w-32"
        value={text}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          setText(raw);
          if (raw.trim() === '') props.onChange(null);
          else if (valid(raw.trim())) props.onChange(Number(raw.trim()));
        }}
      />
    </Field>
  );
}

/** Cover picture by web address, with its description, until the media picker lands. */
function CoverFields({
  course,
  edit,
}: {
  course: Course;
  edit: EditorActions['edit'];
}): JSX.Element {
  const cover = course.cover;
  const saved = cover?.media.kind === 'url' ? cover.media.url : '';
  const [url, setUrl] = useState(saved);
  const [shown, setShown] = useState(saved);
  if (saved !== shown) {
    setShown(saved);
    setUrl(saved);
  }
  const typed = url.trim();
  const ok = typed === '' || HttpsUrlSchema.safeParse(typed).success;
  return (
    <>
      <Field
        label="Cover picture address"
        hint="Optional. Starts with https://"
        error={ok ? undefined : 'Use a full https:// address.'}
      >
        <Input
          type="url"
          value={url}
          onChange={(e) => {
            const next = e.currentTarget.value;
            setUrl(next);
            const address = next.trim();
            if (address === '') edit((c) => setCourseCover(c, null));
            else if (HttpsUrlSchema.safeParse(address).success)
              edit(
                (c) =>
                  setCourseCover(c, { alt: '', ...c.cover, media: { kind: 'url', url: address } }),
                {
                  group: 'cover',
                },
              );
          }}
        />
      </Field>
      {cover && (
        <Field label="Describe the cover picture" hint="For people who can't see it.">
          <Input
            value={cover.alt}
            maxLength={LIMITS.shortText}
            onChange={(e) => {
              const alt = e.currentTarget.value;
              edit((c) => (c.cover ? setCourseCover(c, { ...c.cover, alt }) : c), {
                group: 'cover-alt',
              });
            }}
          />
        </Field>
      )}
    </>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-body font-semibold text-fg">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Toggle(props: {
  label: string;
  hint?: string | undefined;
  checked: boolean;
  onChange(next: boolean): void;
}) {
  return (
    <Field label={props.label} hint={props.hint} layout="inline">
      <Checkbox
        checked={props.checked}
        onCheckedChange={(checked) => props.onChange(checked === true)}
      />
    </Field>
  );
}

/** Course settings: about the course, its type and preset, completion rules, catalog and certificate. */
export function CourseSettings({
  course,
  edit,
}: {
  course: Course;
  edit: EditorActions['edit'];
}): JSX.Element {
  const headingId = useId();
  const panel = useRef<HTMLElement>(null);
  // Opening the settings moves focus here, so keyboard and screen reader users land on them.
  useEffect(() => panel.current?.focus(), []);
  const { settings } = course;
  const { completion, certificate } = settings;
  const patch = (change: CourseSettingsPatch, group?: string) =>
    edit((c) => updateCourseSettings(c, change), group ? { group } : {});
  const hasQuiz = course.lessons.some((lesson) => lesson.kind === 'quiz');
  const minutes = settings.minimumCourseSeconds;

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-1 flex-col gap-8 p-4 md:p-6"
    >
      <h2 id={headingId} className="text-title text-fg">
        Course settings
      </h2>
      <Group title="About the course">
        <Field label="Summary" hint="Shown on the course card. Optional.">
          <Textarea
            rows={2}
            value={course.summary ?? ''}
            maxLength={LIMITS.shortText}
            onChange={(e) => {
              const text = e.currentTarget.value;
              edit((c) => setCourseSummary(c, text), { group: 'summary' });
            }}
          />
        </Field>
        <Field label="Description" hint="Shown on the course start page. Optional.">
          <RichTextInput
            ariaLabel="Description"
            value={course.description ?? []}
            course={course}
            onChange={(text) =>
              edit((c) => setCourseDescription(c, text), { group: 'description' })
            }
          />
        </Field>
        <NumberField
          label="Estimated time in minutes"
          hint="Optional."
          value={course.estimatedMinutes}
          min={1}
          max={LIMITS.estimatedMinutes}
          onChange={(n) => edit((c) => setEstimatedMinutes(c, n), { group: 'estimated' })}
        />
        <CoverFields course={course} edit={edit} />
      </Group>

      <Group title="Course type">
        <ChoiceButtons
          label="Type"
          value={course.type}
          options={COURSE_TYPES.map((type) => ({
            value: type,
            label: COURSE_TYPE_INFO[type].label,
          }))}
          onChange={(type) => edit((c) => changeCourseType(c, type))}
        />
        <p className="text-small text-muted">
          {COURSE_TYPE_INFO[course.type].description} Changing the type applies its settings; Undo
          puts yours back.
        </p>
      </Group>

      <Group title="Progress and completion">
        <Toggle
          label="Lessons are taken in order"
          checked={settings.lessonOrder === 'sequential'}
          onChange={(on) => patch({ lessonOrder: on ? 'sequential' : 'free' })}
        />
        <Toggle
          label="Finish every lesson to complete the course"
          checked={completion.requireAllLessons}
          onChange={(on) => patch({ completion: { requireAllLessons: on } })}
        />
        <Toggle
          label="Pass the quiz to complete the course"
          hint={hasQuiz ? undefined : 'Add a quiz to the course for this to count.'}
          checked={completion.requireQuizPass}
          onChange={(on) => patch({ completion: { requireQuizPass: on } })}
        />
        <Toggle
          label="Sign an acknowledgement to complete the course"
          checked={completion.requireAcknowledgement}
          onChange={(on) => patch({ completion: { requireAcknowledgement: on } })}
        />
        {completion.requireAcknowledgement && (
          <Field
            label="Acknowledgement statement"
            hint="What people agree to, for example “I have read and understood this policy.”"
          >
            <Textarea
              rows={2}
              value={settings.acknowledgement?.statement ?? ''}
              maxLength={LIMITS.shortText}
              onChange={(e) => patch({ acknowledgement: e.currentTarget.value }, 'acknowledgement')}
            />
          </Field>
        )}
        <NumberField
          label="Minimum time in the course, in minutes"
          hint="Optional. People can't complete the course sooner."
          value={minutes === undefined ? undefined : Math.ceil(minutes / 60)}
          min={1}
          max={LIMITS.minimumCourseSeconds / 60}
          onChange={(n) => patch({ minimumCourseSeconds: n === null ? null : n * 60 }, 'minimum')}
        />
      </Group>

      <Group title="Catalog and certificate">
        <Toggle
          label="Show in the catalog"
          hint="People can find and start it themselves. Assigned people get it either way."
          checked={settings.catalog.listed}
          onChange={(listed) => patch({ listed })}
        />
        <Toggle
          label="Give a certificate"
          checked={certificate.enabled}
          onChange={(enabled) => patch({ certificate: { enabled } })}
        />
        {certificate.enabled && (
          <NumberField
            label="Certificate valid for, in months"
            hint="Leave empty if it doesn't expire."
            value={certificate.validForMonths}
            min={1}
            max={LIMITS.certificateMonths}
            onChange={(months) =>
              patch({ certificate: { validForMonths: months } }, 'certificate-months')
            }
          />
        )}
      </Group>
    </section>
  );
}
