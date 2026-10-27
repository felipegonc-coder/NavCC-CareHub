import type { Id, RichText, ScenarioBlock, ScenarioChoice, ScenarioScene } from '../format/index';
import { firstWithText } from '../questions/helpers';

/** A learner's place in a branching scenario. */
export type ScenarioState = {
  /** The current scene; once ended, the scene where the scenario ended. */
  sceneId: Id;
  /** Every choice made, in order (what the `scenario_finished` progress event stores). */
  choiceIds: Id[];
  /** True once an ending scene (no choices) is reached or a choice jumps to a lesson. */
  ended: boolean;
  /** The lesson a "lesson" choice sends the learner to; null otherwise. */
  lessonJump: Id | null;
};

/**
 * The outcome of `chooseScenario`: the new state, or why the choice was refused (state unchanged).
 */
export type ScenarioStep =
  | {
      ok: true;
      state: ScenarioState;
      choice: ScenarioChoice;
      coaching: RichText | null;
      ended: boolean;
    }
  | { ok: false; state: ScenarioState; reason: 'ended' | 'not_in_scene' };

/** The result of replaying a list of choice ids from the start scene. */
export type ScenarioReplay = {
  /** The state after every valid choice up to the first refused one. */
  state: ScenarioState;
  /**
   * Sum of the points of the applied choices; a "retry" choice adds at most 0, so retrying can't
   * farm points.
   */
  score: number;
  /** Index of the first refused choice id, or null when all were applied. */
  invalidAt: number | null;
};

/**
 * Starts a scenario at its start scene (already ended if that scene is missing or has no choices).
 */
export function startScenario(block: ScenarioBlock): ScenarioState {
  return {
    sceneId: block.startSceneId,
    choiceIds: [],
    ended: isEnding(block, block.startSceneId),
    lessonJump: null,
  };
}

/**
 * Applies one choice. Refused (`ok: false`, state unchanged) when the scenario has ended or the
 * choice isn't in the current scene. "scene" moves on (ending when that scene has no choices or
 * doesn't exist), "retry" stays on the scene, and "lesson" ends the scenario with `lessonJump`.
 * Every applied choice is recorded.
 */
export function chooseScenario(
  block: ScenarioBlock,
  state: ScenarioState,
  choiceId: Id,
): ScenarioStep {
  if (state.ended) return { ok: false, state, reason: 'ended' };
  const choice = findScene(block, state.sceneId)?.choices.find((c) => c.id === choiceId);
  if (!choice) return { ok: false, state, reason: 'not_in_scene' };
  const choiceIds = [...state.choiceIds, choice.id];
  const { next } = choice;
  let nextState: ScenarioState;
  switch (next.kind) {
    case 'scene':
      nextState = {
        sceneId: next.sceneId,
        choiceIds,
        ended: isEnding(block, next.sceneId),
        lessonJump: null,
      };
      break;
    case 'retry':
      nextState = { sceneId: state.sceneId, choiceIds, ended: false, lessonJump: null };
      break;
    case 'lesson':
      nextState = { sceneId: state.sceneId, choiceIds, ended: true, lessonJump: next.lessonId };
      break;
  }
  return {
    ok: true,
    state: nextState,
    choice,
    coaching: firstWithText(choice.coaching),
    ended: nextState.ended,
  };
}

/**
 * Replays choice ids from the start scene with `chooseScenario`, stopping at the first refused one.
 * Use it to check a `scenario_finished` event: valid when `invalidAt` is null and `state.ended` is
 * true.
 */
export function replayScenario(block: ScenarioBlock, choiceIds: readonly Id[]): ScenarioReplay {
  let state = startScenario(block);
  let score = 0;
  for (const [index, choiceId] of choiceIds.entries()) {
    const step = chooseScenario(block, state, choiceId);
    if (!step.ok) return { state, score, invalidAt: index };
    state = step.state;
    score += choicePoints(step.choice);
  }
  return { state, score, invalidAt: null };
}

/** The points a choice adds to the score: its own points, but at most 0 for a "retry" choice. */
export function choicePoints(choice: ScenarioChoice): number {
  return choice.next.kind === 'retry' ? Math.min(0, choice.points) : choice.points;
}

/**
 * The first scene with this id (ids are unique within a scenario once it passes publish checks).
 */
export function findScene(block: ScenarioBlock, sceneId: Id): ScenarioScene | undefined {
  return block.scenes.find((scene) => scene.id === sceneId);
}

function isEnding(block: ScenarioBlock, sceneId: Id): boolean {
  const scene = findScene(block, sceneId);
  return scene === undefined || scene.choices.length === 0;
}
