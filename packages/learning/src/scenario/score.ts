import type { Id, ScenarioBlock, ScenarioScene } from '../format/index';
import { findScene, replayScenario, type ScenarioState } from './play';

type Ending = NonNullable<ScenarioScene['ending']>;

/** How a scenario went. */
export type ScenarioResult = {
  /**
   * Sum of the points of every choice made, each time it was made, except that a "retry" choice
   * adds at most 0. An ended run never scores above `maxScore` (which only matters for a draft
   * whose scene links loop).
   */
  score: number;
  /** Best possible score from the start scene (`scenarioMaxScore`). */
  maxScore: number;
  /**
   * score ≥ passScore once the scenario has ended (false before then); null when there is no pass
   * score.
   */
  passed: boolean | null;
  /**
   * The ending reached, or null (not ended, a lesson jump, or an ending scene without an ending).
   */
  ending: Ending | null;
  /** The lesson a "lesson" choice sends the learner to; null otherwise. */
  lessonJump: Id | null;
  /** True once the scenario is over. */
  ended: boolean;
};

/**
 * Scores a scenario from its choice ids, replayed from the start scene, so an edited state can't
 * inflate the score; choices after the first invalid one are ignored. Only an ended run can pass.
 */
export function scenarioResult(
  block: ScenarioBlock,
  state: Pick<ScenarioState, 'choiceIds'>,
): ScenarioResult {
  const replay = replayScenario(block, state.choiceIds);
  const final = replay.state;
  const scene = findScene(block, final.sceneId);
  const ending =
    final.ended && scene !== undefined && scene.choices.length === 0
      ? (scene.ending ?? null)
      : null;
  const maxScore = scenarioMaxScore(block);
  // Without loops (publishing rejects them) an ended run can't beat the best path, so this cap
  // never binds.
  const score = final.ended ? Math.min(replay.score, maxScore) : replay.score;
  return {
    score,
    maxScore,
    passed: block.passScore === undefined ? null : final.ended && score >= block.passScore,
    ending,
    lessonJump: final.lessonJump,
    ended: final.ended,
  };
}

/**
 * The best score a learner can reach from the start scene: the highest total of choice points along
 * any path to an ending or a lesson jump ("retry" choices excluded). A memoized depth-first search;
 * links back into the current path are ignored, so a cyclic draft can't loop. Ending scenes, scenes
 * with only retry choices and missing scenes add 0.
 */
export function scenarioMaxScore(block: ScenarioBlock): number {
  const scenes = new Map<Id, ScenarioScene>();
  for (const scene of block.scenes) if (!scenes.has(scene.id)) scenes.set(scene.id, scene);
  const memo = new Map<Id, number>();
  const onPath = new Set<Id>();

  const best = (sceneId: Id): number => {
    const known = memo.get(sceneId);
    if (known !== undefined) return known;
    const scene = scenes.get(sceneId);
    if (!scene) return 0;
    onPath.add(sceneId);
    let top: number | null = null;
    for (const choice of scene.choices) {
      const { next } = choice;
      let value: number | null = null;
      if (next.kind === 'lesson') value = choice.points;
      else if (next.kind === 'scene' && !onPath.has(next.sceneId))
        value = choice.points + best(next.sceneId);
      if (value !== null && (top === null || value > top)) top = value;
    }
    onPath.delete(sceneId);
    const result = top ?? 0;
    memo.set(sceneId, result);
    return result;
  };

  return best(block.startSceneId);
}
