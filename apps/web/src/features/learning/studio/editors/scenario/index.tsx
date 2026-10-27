import type { BlockEditors } from '../registry';
import { ScenarioEditor } from './ScenarioEditor';

/** The scenario block's editor (B2). */
export const scenarioEditors: BlockEditors = { scenario: ScenarioEditor };
