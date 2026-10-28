import type { Image, Link, PlayerCourse } from '@carehub/learning';
import { useId, type ReactNode } from 'react';
import { RichTextView } from '../blocks/text';
import { useMediaUrl } from '../media';
import { AnswerInput } from './AnswerInput';
import type { AnswerInputProps } from './answer';

export type QuestionViewProps = Omit<AnswerInputProps, 'labelledBy'> & {
  /** For links in the prompt. */
  course: Pick<PlayerCourse, 'id' | 'lessons'>;
  go(link: Link): void;
  /** Shown above the prompt, such as "Question 2 of 10". */
  label?: ReactNode;
};

/** A question's prompt and picture, then its answer input, which the prompt names. */
export function QuestionView({ course, go, label, ...input }: QuestionViewProps) {
  const promptId = useId();
  const { question } = input;
  return (
    <div className="flex flex-col gap-4">
      <div id={promptId} className="flex flex-col gap-1 text-body font-medium text-fg">
        {label && <p className="text-small font-normal text-muted">{label}</p>}
        <RichTextView value={question.prompt} course={course} go={go} />
      </div>
      {question.image && question.type !== 'hotspot' && <QuestionImage image={question.image} />}
      <AnswerInput key={question.id} {...input} labelledBy={promptId} />
    </div>
  );
}

function QuestionImage({ image }: { image: Image }) {
  const src = useMediaUrl(image.media);
  return (
    <figure className="flex flex-col gap-1">
      <img
        src={src}
        alt={image.decorative ? '' : image.alt}
        className="max-h-96 max-w-full self-start rounded"
      />
      {image.caption && <figcaption className="text-small text-muted">{image.caption}</figcaption>}
    </figure>
  );
}
