import type { BlockViews } from '../registry';
import { KnowledgeCheckView } from './KnowledgeCheckView';
import { ScenarioView } from './ScenarioView';

// Knowledge check and scenario block views (B2). Created empty by B5 (decision 0308); B2 fills it,
// and blocks/registry.tsx spreads it into `blockViews`.
export const questionViews: BlockViews = {
  knowledge_check: KnowledgeCheckView,
  scenario: ScenarioView,
};
