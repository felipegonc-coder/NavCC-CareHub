import type { KnowledgeCheckBlock } from '@carehub/learning';
import { Field, Switch } from '@carehub/ui';
import type { BlockEditorProps } from '../registry';
import { QuestionEditor } from './QuestionEditor';

/** Props for {@link KnowledgeCheckEditor}: the registry's block editor props. */
export type KnowledgeCheckEditorProps = BlockEditorProps<KnowledgeCheckBlock>;

/** Edits a knowledge check block: its question (without points, as it never counts) and whether people can retry. */
export function KnowledgeCheckEditor({ block, onChange, course }: KnowledgeCheckEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <QuestionEditor
        question={block.question}
        onChange={(question) => onChange({ ...block, question })}
        showPoints={false}
        course={course}
      />
      <Field layout="inline" label="Let people try again">
        <Switch
          checked={block.allowRetry}
          onCheckedChange={(allowRetry) => onChange({ ...block, allowRetry })}
        />
      </Field>
    </div>
  );
}
