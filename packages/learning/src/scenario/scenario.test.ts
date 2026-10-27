import { describe, expect, it } from 'vitest';
import type { RichText, ScenarioBlock, ScenarioChoice } from '../format/index';
import { mulberry32, randomInt } from '../util/index';
import {
  choicePoints,
  chooseScenario,
  replayScenario,
  scenarioMaxScore,
  scenarioResult,
  startScenario,
  type ScenarioResult,
  type ScenarioState,
} from './index';

// Fictional content only.
const rt = (text: string): RichText => [{ runs: [{ text }] }];
const LISTEN = rt('Good: let them explain.');
const TOO_SOON = rt('Too soon. Hear them out first.');
const GREAT = { outcome: 'great', title: 'Charges reversed' } as const;
const OKAY = { outcome: 'okay', title: 'Partly sorted' } as const;
const POOR = { outcome: 'poor', title: 'Call lost' } as const;

const block: ScenarioBlock = {
  id: 'sc-bill',
  type: 'scenario',
  title: 'A surprise on the bill',
  intro: rt('A Pinecrest Wireless customer calls about a high bill.'),
  characters: [{ id: 'dana', name: 'Dana Reyes', role: 'Customer' }],
  startSceneId: 'greet',
  passScore: 4,
  scenes: [
    {
      id: 'greet',
      speakerId: 'dana',
      text: 'My bill doubled this month!',
      choices: [
        {
          id: 'listen',
          text: 'Ask what changed',
          points: 2,
          coaching: LISTEN,
          next: { kind: 'scene', sceneId: 'listen' },
        },
        {
          id: 'interrupt',
          text: 'Read out the plan terms',
          points: -1,
          next: { kind: 'scene', sceneId: 'upset' },
        },
        {
          id: 'rush',
          text: 'Offer a payment plan',
          points: 0,
          coaching: TOO_SOON,
          next: { kind: 'retry' },
        },
      ],
    },
    {
      id: 'listen',
      speakerId: 'dana',
      text: 'I never turned on international roaming.',
      choices: [
        {
          id: 'explain',
          text: 'Check the roaming charges together',
          points: 3,
          next: { kind: 'scene', sceneId: 'resolved' },
        },
        {
          id: 'transfer',
          text: 'Transfer to billing',
          points: 0,
          coaching: rt('   '),
          next: { kind: 'scene', sceneId: 'okay-end' },
        },
        {
          id: 'study',
          text: 'Review the roaming lesson first',
          points: 1,
          next: { kind: 'lesson', lessonId: 'lesson-roaming' },
        },
      ],
    },
    {
      id: 'upset',
      speakerId: 'dana',
      text: 'Are you even listening?',
      choices: [
        {
          id: 'apologize',
          text: 'Apologize and ask what changed',
          points: 1,
          next: { kind: 'scene', sceneId: 'okay-end' },
        },
        {
          id: 'argue',
          text: 'Insist the bill is right',
          points: -2,
          next: { kind: 'scene', sceneId: 'poor-end' },
        },
      ],
    },
    { id: 'resolved', text: 'Dana thanks you.', choices: [], ending: GREAT },
    { id: 'okay-end', text: 'Dana is calmer.', choices: [], ending: OKAY },
    { id: 'poor-end', text: 'Dana hangs up.', choices: [], ending: POOR },
  ],
};

const at = (sceneId: string, choiceIds: string[] = []): ScenarioState => ({
  sceneId,
  choiceIds,
  ended: false,
  lessonJump: null,
});

describe('startScenario', () => {
  it('starts at the start scene with no choices made', () => {
    expect(startScenario(block)).toEqual(at('greet'));
  });

  it("is already ended when the start scene is an ending or doesn't exist", () => {
    expect(startScenario({ ...block, startSceneId: 'resolved' })).toMatchObject({
      sceneId: 'resolved',
      ended: true,
    });
    expect(startScenario({ ...block, startSceneId: 'ghost' })).toMatchObject({
      sceneId: 'ghost',
      ended: true,
    });
  });
});

describe('chooseScenario', () => {
  it("moves to the next scene and returns the choice's coaching", () => {
    const step = chooseScenario(block, startScenario(block), 'listen');
    expect(step).toMatchObject({
      ok: true,
      state: at('listen', ['listen']),
      coaching: LISTEN,
      ended: false,
    });
    expect(step.ok && step.choice.points).toBe(2);
  });

  it('has no coaching when a choice has none or it is blank', () => {
    expect(chooseScenario(block, startScenario(block), 'interrupt')).toMatchObject({
      ok: true,
      coaching: null,
    });
    expect(chooseScenario(block, at('listen', ['listen']), 'transfer')).toMatchObject({
      ok: true,
      coaching: null,
    });
  });

  it('stays on the scene for a retry choice and records it', () => {
    const step = chooseScenario(block, startScenario(block), 'rush');
    expect(step).toMatchObject({
      ok: true,
      state: at('greet', ['rush']),
      coaching: TOO_SOON,
      ended: false,
    });
  });

  it('ends on a scene without choices', () => {
    const step = chooseScenario(block, at('listen', ['listen']), 'explain');
    expect(step).toMatchObject({ ok: true, ended: true });
    expect(step.state).toEqual({
      sceneId: 'resolved',
      choiceIds: ['listen', 'explain'],
      ended: true,
      lessonJump: null,
    });
  });

  it('ends with a lesson jump for a lesson choice, staying on the scene', () => {
    const step = chooseScenario(block, at('listen', ['listen']), 'study');
    expect(step.state).toEqual({
      sceneId: 'listen',
      choiceIds: ['listen', 'study'],
      ended: true,
      lessonJump: 'lesson-roaming',
    });
  });

  it("ends when a choice links to a scene that doesn't exist (a draft)", () => {
    const draft: ScenarioBlock = {
      ...block,
      scenes: [
        {
          id: 'greet',
          text: 'Hello',
          choices: [{ id: 'go', text: 'Go', points: 1, next: { kind: 'scene', sceneId: 'ghost' } }],
        },
      ],
    };
    expect(chooseScenario(draft, startScenario(draft), 'go').state).toEqual({
      sceneId: 'ghost',
      choiceIds: ['go'],
      ended: true,
      lessonJump: null,
    });
  });

  it("refuses a choice that isn't in the current scene, leaving the state alone", () => {
    const state = startScenario(block);
    for (const choiceId of ['explain', 'ghost', '']) {
      const step = chooseScenario(block, state, choiceId);
      expect(step).toEqual({ ok: false, state, reason: 'not_in_scene' });
    }
  });

  it('refuses any choice once the scenario has ended', () => {
    const ended = chooseScenario(block, at('listen', ['listen']), 'study').state;
    expect(chooseScenario(block, ended, 'explain')).toEqual({
      ok: false,
      state: ended,
      reason: 'ended',
    });
  });

  it("doesn't change the state it is given", () => {
    const state = startScenario(block);
    chooseScenario(block, state, 'listen');
    expect(state).toEqual(at('greet'));
  });
});

describe('replayScenario', () => {
  it('replays every choice and adds up their points', () => {
    expect(replayScenario(block, ['rush', 'listen', 'explain'])).toEqual({
      state: {
        sceneId: 'resolved',
        choiceIds: ['rush', 'listen', 'explain'],
        ended: true,
        lessonJump: null,
      },
      score: 5,
      invalidAt: null,
    });
  });

  it('stops at the first refused choice', () => {
    const replay = replayScenario(block, ['interrupt', 'explain', 'apologize']);
    expect(replay).toEqual({ state: at('upset', ['interrupt']), score: -1, invalidAt: 1 });
  });

  it('refuses choices after the end', () => {
    const replay = replayScenario(block, ['listen', 'explain', 'listen']);
    expect(replay.invalidAt).toBe(2);
    expect(replay.score).toBe(5);
    expect(replay.state.ended).toBe(true);
  });

  it('is at the start for no choices', () => {
    expect(replayScenario(block, [])).toEqual({ state: at('greet'), score: 0, invalidAt: null });
  });
});

describe('scenarioResult', () => {
  const cases: [string, string[], Partial<ScenarioResult>][] = [
    ['the best path', ['listen', 'explain'], { score: 5, passed: true, ending: GREAT }],
    [
      'a retry on the way',
      ['rush', 'listen', 'explain'],
      { score: 5, passed: true, ending: GREAT },
    ],
    ['a transfer', ['listen', 'transfer'], { score: 2, passed: false, ending: OKAY }],
    [
      'a lesson jump',
      ['listen', 'study'],
      { score: 3, passed: false, lessonJump: 'lesson-roaming' },
    ],
    ['a recovery', ['interrupt', 'apologize'], { score: 0, passed: false, ending: OKAY }],
    ['an argument', ['interrupt', 'argue'], { score: -3, passed: false, ending: POOR }],
    ['no choices yet', [], { score: 0, passed: false, ended: false }],
    ['an unfinished run', ['listen'], { score: 2, passed: false, ended: false }],
  ];
  for (const [name, choiceIds, expected] of cases) {
    it(`scores ${name}`, () => {
      expect(scenarioResult(block, { choiceIds })).toEqual({
        maxScore: 5,
        ending: null,
        lessonJump: null,
        ended: true,
        ...expected,
      });
    });
  }

  it('replays from the start scene, so made-up or out-of-place choices add nothing', () => {
    expect(scenarioResult(block, { choiceIds: ['explain', 'explain'] })).toMatchObject({
      score: 0,
      ended: false,
    });
    expect(scenarioResult(block, { choiceIds: ['listen', 'listen', 'explain'] })).toMatchObject({
      score: 2,
      ended: false,
    });
    expect(
      scenarioResult(block, { choiceIds: ['listen', 'explain', 'listen', 'explain'] }),
    ).toMatchObject({ score: 5, ended: true });
  });

  it('takes a whole scenario state', () => {
    const state = chooseScenario(block, at('listen', ['listen']), 'explain').state;
    expect(scenarioResult(block, state)).toMatchObject({ score: 5, ending: GREAT, ended: true });
  });

  const withRushPoints = (points: number): ScenarioBlock => ({
    ...block,
    scenes: block.scenes.map((scene) => ({
      ...scene,
      choices: scene.choices.map((choice) =>
        choice.id === 'rush' ? { ...choice, points } : choice,
      ),
    })),
  });

  it("counts a retry choice's lost points each time it is chosen", () => {
    expect(
      scenarioResult(withRushPoints(-1), { choiceIds: ['rush', 'rush', 'listen', 'explain'] }),
    ).toMatchObject({
      score: 3,
      passed: false,
    });
  });

  it('never lets a retry choice add points, even in an unpublished draft', () => {
    const farmable = withRushPoints(3);
    expect(replayScenario(farmable, ['rush', 'rush', 'rush']).score).toBe(0);
    expect(
      scenarioResult(farmable, { choiceIds: ['rush', 'rush', 'listen', 'explain'] }),
    ).toMatchObject({ score: 5, maxScore: 5 });
  });

  it("doesn't pass a run that hasn't ended, whatever its score", () => {
    const lowBar: ScenarioBlock = { ...block, passScore: 2 };
    expect(scenarioResult(lowBar, { choiceIds: ['listen'] })).toMatchObject({
      score: 2,
      ended: false,
      passed: false,
    });
    expect(scenarioResult(lowBar, { choiceIds: ['listen', 'transfer'] })).toMatchObject({
      score: 2,
      ended: true,
      passed: true,
    });
  });

  it('compares the score with the pass score, which may be negative, or gives null without one', () => {
    expect(
      scenarioResult({ ...block, passScore: -3 }, { choiceIds: ['interrupt', 'argue'] }).passed,
    ).toBe(true);
    expect(
      scenarioResult({ ...block, passScore: -2 }, { choiceIds: ['interrupt', 'argue'] }).passed,
    ).toBe(false);
    const noPassScore: ScenarioBlock = { ...block };
    delete noPassScore.passScore;
    expect(scenarioResult(noPassScore, { choiceIds: ['listen', 'explain'] }).passed).toBeNull();
  });

  it('has no ending for an ending scene without ending details', () => {
    const plain: ScenarioBlock = {
      ...block,
      scenes: block.scenes.map((scene) =>
        scene.id === 'resolved' ? { id: 'resolved', text: 'Done.', choices: [] } : scene,
      ),
    };
    expect(scenarioResult(plain, { choiceIds: ['listen', 'explain'] })).toMatchObject({
      ending: null,
      ended: true,
      score: 5,
    });
  });
});

type Next = ScenarioChoice['next'];
const to = (sceneId: string): Next => ({ kind: 'scene', sceneId });
const retry: Next = { kind: 'retry' };
const lesson = (lessonId: string): Next => ({ kind: 'lesson', lessonId });

/** A scenario from scene id → [points, next] choices; the first scene listed is the start. */
function graph(
  scenes: [string, [number, Next][]][],
  startSceneId = scenes[0]?.[0] ?? 'start',
): ScenarioBlock {
  return {
    id: 'sc-graph',
    type: 'scenario',
    title: 'Fictional practice call',
    characters: [],
    startSceneId,
    scenes: scenes.map(([id, choices]) => ({
      id,
      text: `Scene ${id}`,
      choices: choices.map(([points, next], i) => ({
        id: `${id}-${i}`,
        text: `Choice ${i}`,
        points,
        next,
      })),
    })),
  };
}

/**
 * Every path through the play API (retry choices left out), for cross-checking scenarioMaxScore.
 */
function bruteForceMax(scenario: ScenarioBlock): number {
  let best = Number.NEGATIVE_INFINITY;
  const walk = (state: ScenarioState, score: number): void => {
    const scene = scenario.scenes.find((s) => s.id === state.sceneId);
    const choices = state.ended
      ? []
      : (scene?.choices ?? []).filter((c) => c.next.kind !== 'retry');
    if (choices.length === 0) best = Math.max(best, score);
    for (const choice of choices) {
      const step = chooseScenario(scenario, state, choice.id);
      if (step.ok) walk(step.state, score + choice.points);
    }
  };
  walk(startScenario(scenario), 0);
  return best;
}

describe('scenarioMaxScore', () => {
  it('is the best path score of the sample scenario', () => {
    expect(scenarioMaxScore(block)).toBe(5);
  });

  const cases: [string, ScenarioBlock, number][] = [
    [
      'takes the best branch',
      graph([
        [
          'a',
          [
            [1, to('b')],
            [4, to('end')],
          ],
        ],
        ['b', [[2, to('end')]]],
        ['end', []],
      ]),
      4,
    ],
    [
      'adds up points along a path',
      graph([
        [
          'a',
          [
            [1, to('b')],
            [2, to('end')],
          ],
        ],
        ['b', [[5, to('end')]]],
        ['end', []],
      ]),
      6,
    ],
    [
      "counts a lesson jump's points",
      graph([
        [
          'a',
          [
            [4, lesson('lesson-2')],
            [1, to('end')],
          ],
        ],
        ['end', []],
      ]),
      4,
    ],
    [
      'leaves out retry choices',
      graph([
        [
          'a',
          [
            [9, retry],
            [1, to('end')],
          ],
        ],
        ['end', []],
      ]),
      1,
    ],
    [
      'is the least bad path when every choice costs points',
      graph([
        [
          'a',
          [
            [-2, to('end')],
            [-1, to('b')],
          ],
        ],
        ['b', [[-3, to('end')]]],
        ['end', []],
      ]),
      -2,
    ],
    ['is 0 when the start scene is an ending', graph([['end', []]]), 0],
    ["is 0 when the start scene doesn't exist", graph([['end', []]], 'ghost'), 0],
    ['is 0 for a scene with only retry choices', graph([['a', [[5, retry]]]]), 0],
    [
      'adds 0 for a link to a missing scene',
      graph([
        [
          'a',
          [
            [3, to('ghost')],
            [1, to('end')],
          ],
        ],
        ['end', []],
      ]),
      3,
    ],
    [
      'ignores links back into the current path (a draft with a cycle)',
      graph([
        ['a', [[2, to('b')]]],
        [
          'b',
          [
            [3, to('a')],
            [1, to('end')],
          ],
        ],
        ['end', []],
      ]),
      3,
    ],
    [
      'ignores a scene linking to itself',
      graph([
        [
          'a',
          [
            [5, to('a')],
            [1, to('end')],
          ],
        ],
        ['end', []],
      ]),
      1,
    ],
    [
      'uses the first of two scenes with the same id, like play does',
      graph([
        ['a', [[1, to('end')]]],
        ['a', [[9, to('end')]]],
        ['end', []],
      ]),
      1,
    ],
  ];
  for (const [name, scenario, expected] of cases) {
    it(name, () => {
      expect(scenarioMaxScore(scenario)).toBe(expected);
    });
  }

  it('handles 100 scenes with far more paths than could be listed', () => {
    // Scene i links to i + 1 for 1 point and to i + 2 for 3 points: about 10^20 paths, best 49 × 3
    // + 1.
    const scenes: [string, [number, Next][]][] = Array.from({ length: 100 }, (_, i) => {
      const choices: [number, Next][] = i < 99 ? [[1, to(`s${i + 1}`)]] : [];
      if (i < 98) choices.push([3, to(`s${i + 2}`)]);
      return [`s${i}`, choices];
    });
    expect(scenarioMaxScore(graph(scenes))).toBe(148);
  });

  it('matches a search over every path in random scene graphs', () => {
    const random = mulberry32(2026);
    for (let round = 0; round < 300; round++) {
      const count = 1 + randomInt(random, 7);
      const scenes: [string, [number, Next][]][] = [];
      for (let i = 0; i < count; i++) {
        const choices: [number, Next][] = [];
        const choiceCount = i === count - 1 ? 0 : randomInt(random, 4);
        for (let c = 0; c < choiceCount; c++) {
          const roll = random();
          const next =
            roll < 0.1
              ? retry
              : roll < 0.2
                ? lesson('lesson-2')
                : roll < 0.25
                  ? to('ghost')
                  : to(`s${i + 1 + randomInt(random, count - i - 1)}`);
          choices.push([randomInt(random, 21) - 10, next]);
        }
        scenes.push([`s${i}`, choices]);
      }
      const scenario = graph(scenes);
      expect(scenarioMaxScore(scenario)).toBe(bruteForceMax(scenario));
    }
  });
});

describe('choicePoints', () => {
  const choice = (points: number, next: Next): ScenarioChoice => ({
    id: 'c',
    text: 'Choice',
    points,
    next,
  });

  it("is a choice's own points, but at most 0 for a retry", () => {
    expect(choicePoints(choice(3, to('b')))).toBe(3);
    expect(choicePoints(choice(-2, lesson('lesson-2')))).toBe(-2);
    expect(choicePoints(choice(3, retry))).toBe(0);
    expect(choicePoints(choice(-2, retry))).toBe(-2);
  });
});

describe('scenarioResult on drafts and random runs', () => {
  it("caps an ended run at maxScore when a draft's scene links loop", () => {
    // a → b (2), b → a (3), b → end (1): looping once scores 8 raw, but the best path is 3.
    const looping = {
      ...graph([
        ['a', [[2, to('b')]]],
        [
          'b',
          [
            [3, to('a')],
            [1, to('end')],
          ],
        ],
        ['end', []],
      ]),
      passScore: 4,
    };
    expect(scenarioResult(looping, { choiceIds: ['a-0', 'b-0', 'a-0', 'b-1'] })).toMatchObject({
      score: 3,
      maxScore: 3,
      ended: true,
      passed: false,
    });
    expect(scenarioResult(looping, { choiceIds: ['a-0', 'b-0', 'a-0'] })).toMatchObject({
      score: 7,
      ended: false,
      passed: false,
    });
  });

  it('scores random runs through random scene graphs as the replayed points, never above maxScore once ended', () => {
    const random = mulberry32(7);
    for (let round = 0; round < 300; round++) {
      const count = 1 + randomInt(random, 6);
      const scenes: [string, [number, Next][]][] = [];
      for (let i = 0; i < count; i++) {
        const choices: [number, Next][] = [];
        const choiceCount = i === count - 1 ? 0 : 1 + randomInt(random, 3);
        for (let c = 0; c < choiceCount; c++) {
          const roll = random();
          const next =
            roll < 0.25
              ? retry
              : roll < 0.35
                ? lesson('lesson-2')
                : to(`s${i + 1 + randomInt(random, count - i - 1)}`);
          choices.push([randomInt(random, 21) - 10, next]);
        }
        scenes.push([`s${i}`, choices]);
      }
      const scenario = graph(scenes);
      let state = startScenario(scenario);
      let points = 0;
      for (let step = 0; step < 20 && !state.ended; step++) {
        const choices = scenario.scenes.find((s) => s.id === state.sceneId)?.choices ?? [];
        const choice = choices[randomInt(random, choices.length)];
        if (choice === undefined) break;
        const next = chooseScenario(scenario, state, choice.id);
        if (!next.ok) break;
        state = next.state;
        points += choicePoints(choice);
      }
      const result = scenarioResult(scenario, state);
      expect(result.score).toBe(points);
      if (result.ended) expect(result.score).toBeLessThanOrEqual(result.maxScore);
    }
  });
});
