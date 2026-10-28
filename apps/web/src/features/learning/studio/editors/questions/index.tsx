import type { BlockEditors } from '../registry';
import { KnowledgeCheckEditor } from './KnowledgeCheckEditor';

// Question editors (B9). The registry mounts `questionEditors`; the quiz and bank screens use QuestionEditor.
export { KnowledgeCheckEditor, type KnowledgeCheckEditorProps } from './KnowledgeCheckEditor';
export { QuestionEditor, questionTypeLabel, type QuestionEditorProps } from './QuestionEditor';

/** Editors for knowledge check blocks. */
export const questionEditors: BlockEditors = { knowledge_check: KnowledgeCheckEditor };
