import type { JSX } from 'react';
import type { AnswerInputProps } from './answer';
import { MultipleChoiceInput, SingleChoiceInput, TrueFalseInput } from './ChoiceInputs';
import { FillBlankInput } from './FillBlankInput';
import { HotspotInput } from './HotspotInput';
import { DragMatchingInput, MatchingInput } from './MatchingInputs';
import { OrderingInput } from './OrderingInput';

/** The answer input for the question's type. */
export function AnswerInput(props: AnswerInputProps): JSX.Element {
  const { question } = props;
  switch (question.type) {
    case 'single_choice':
      return <SingleChoiceInput {...props} question={question} />;
    case 'multiple_choice':
      return <MultipleChoiceInput {...props} question={question} />;
    case 'true_false':
      return <TrueFalseInput {...props} question={question} />;
    case 'matching':
      return <MatchingInput {...props} question={question} />;
    case 'drag_matching':
      return <DragMatchingInput {...props} question={question} />;
    case 'fill_blank':
      return <FillBlankInput {...props} question={question} />;
    case 'ordering':
      return <OrderingInput {...props} question={question} />;
    case 'hotspot':
      return <HotspotInput {...props} question={question} />;
  }
}
