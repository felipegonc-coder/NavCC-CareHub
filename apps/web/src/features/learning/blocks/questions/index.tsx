import type { BlockViews } from '../registry';
import { KnowledgeCheckView } from './KnowledgeCheckView';
import { ScenarioView } from './ScenarioView';

// Knowledge check and scenario block views; blocks/registry.tsx spreads them into `blockViews`.
export const questionViews: BlockViews = {
  knowledge_check: KnowledgeCheckView,
  scenario: ScenarioView,
};
