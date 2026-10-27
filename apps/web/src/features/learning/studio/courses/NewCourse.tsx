import { LIMITS } from '@carehub/learning';
import type { CourseType } from '@carehub/learning';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
} from '@carehub/ui';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { RadioChoices } from '../choices';
import { useCreateCourse, useStudioExamples } from '../data/queries';
import type { NewCourseInput } from '../data/queries';
import { COURSE_TYPE_CHOICES, editorPath } from '../labels';

function NewCourseForm() {
  const id = useId();
  const navigate = useNavigate();
  const create = useCreateCourse();
  const examples = useStudioExamples();
  const [type, setType] = useState<CourseType>('standard');
  const [title, setTitle] = useState('');
  const start = (input: NewCourseInput) =>
    create.mutate(input, { onSuccess: (draft) => void navigate(editorPath(draft.course.id)) });
  const typed = title.trim();

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          start({ type, ...(typed ? { title: typed } : {}) });
        }}
      >
        <RadioChoices<CourseType>
          legend="Course type"
          value={type}
          options={COURSE_TYPE_CHOICES}
          onChange={setType}
        />
        <Field label="Title" hint="Optional. You can change it in the editor.">
          <Input
            value={title}
            maxLength={LIMITS.title}
            placeholder="Untitled course"
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Field>
        {create.isError && (
          <p role="alert" className="text-small text-danger">
            The course couldn't be created. Try again.
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button type="submit" loading={create.isPending}>
            Create course
          </Button>
        </DialogFooter>
      </form>
      {examples.data && examples.data.length > 0 && (
        <section aria-labelledby={`${id}-examples`} className="flex flex-col gap-2">
          <h3 id={`${id}-examples`} className="text-small font-medium text-fg">
            Or copy an example course
          </h3>
          <ul className="flex flex-col gap-2">
            {examples.data.map((example) => (
              <li key={example.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-small font-semibold text-fg">{example.title}</p>
                  <p className="text-small text-muted">{example.summary}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Copy ${example.title}`}
                  disabled={create.isPending}
                  onClick={() => start({ type: example.type, exampleId: example.id })}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** New course: a dialog to pick a course type (with its preset settings) and a title, or copy an example. */
export function NewCourseButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New course
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New course</DialogTitle>
          <DialogDescription>
            The type sets up the course's settings. You can change both later.
          </DialogDescription>
        </DialogHeader>
        <NewCourseForm />
      </DialogContent>
    </Dialog>
  );
}
