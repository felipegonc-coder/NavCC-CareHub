import { createCourse, type Block, type Course, type ScenarioBlock } from '@carehub/learning';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BlockEditorFor, blockEditors } from '../registry';

// Fictional data only.
const course: Course = {
  ...createCourse({ type: 'scenario_lab', title: 'Customer calls' }),
  lessons: [
    { id: 'lesson-1', kind: 'content', title: 'Late parcels', blocks: [] },
    { id: 'lesson-2', kind: 'content', title: 'Passing a call on', blocks: [] },
  ],
};

const twoScenes: ScenarioBlock = {
  id: 'b1',
  type: 'scenario',
  title: 'A late parcel',
  characters: [{ id: 'maya', name: 'Maya Lind', role: 'Customer' }],
  startSceneId: 'start',
  scenes: [
    {
      id: 'start',
      speakerId: 'maya',
      text: 'My parcel is late.',
      choices: [],
      ending: { outcome: 'poor', title: 'Maya hangs up' },
    },
    { id: 'depot', text: 'You find the parcel at the depot.', choices: [] },
  ],
};

/** Shows the editor for `initial` and keeps every change, like the canvas does. */
function edit(initial: ScenarioBlock) {
  const seen: Block[] = [];
  function Harness() {
    const [block, setBlock] = useState<Block>(initial);
    return (
      <BlockEditorFor
        block={block}
        course={course}
        lessonId="lesson-1"
        onChange={(next) => {
          seen.push(next);
          setBlock(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { latest: () => seen.at(-1) as ScenarioBlock };
}

const type = (name: string, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByRole('textbox', { name }), { target: { value } });
const pick = (name: string, value: string, root: HTMLElement = document.body) =>
  fireEvent.change(within(root).getByRole('combobox', { name }), { target: { value } });
const number = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value } });
const press = (name: string, root: HTMLElement = document.body) =>
  fireEvent.click(within(root).getByRole('button', { name }));
const scene = (name: string) => screen.getByRole('group', { name });

describe('ScenarioEditor', () => {
  it('edits the title and the optional introduction', () => {
    expect(blockEditors.scenario).toBeDefined();
    const { latest } = edit(twoScenes);
    type('Scenario title', 'A parcel three days late');
    type('Introduction', 'Maya calls about her parcel.');
    expect(latest()).toMatchObject({
      title: 'A parcel three days late',
      intro: [{ runs: [{ text: 'Maya calls about her parcel.' }] }],
    });
    type('Introduction', '');
    expect(latest()).not.toHaveProperty('intro');
  });

  it('keeps the pass score optional, whole and in range, and shows the best possible score', () => {
    const { latest } = edit(twoScenes);
    expect(screen.getByText(/The best possible score is 0\./)).toBeInTheDocument();
    number('Pass score', '8');
    expect(latest().passScore).toBe(8);
    number('Pass score', '5000');
    expect(latest().passScore).toBe(1000);
    number('Pass score', '');
    expect(latest()).not.toHaveProperty('passScore');
  });

  it('adds, names and removes characters; their scenes lose the speaker', () => {
    const { latest } = edit(twoScenes);
    press('Add character');
    type('Character 2 name', 'Sam Okafor');
    type('Character 2 role', 'Team lead');
    expect(latest().characters[1]).toMatchObject({ name: 'Sam Okafor', role: 'Team lead' });
    press('Remove character 1');
    expect(latest().characters.map((c) => c.name)).toEqual(['Sam Okafor']);
    expect(latest().scenes[0]).not.toHaveProperty('speakerId');
    pick('Who speaks in scene 1', latest().characters[0]!.id);
    expect(latest().scenes[0]?.speakerId).toBe(latest().characters[0]!.id);
  });

  it('adds the first scene as the start, and edits an ending', () => {
    const { latest } = edit({ ...twoScenes, scenes: [], startSceneId: 'gone' });
    expect(screen.getByText('No scenes yet. Add the first one.')).toBeInTheDocument();
    press('Add scene');
    const first = latest().scenes[0]!;
    expect(latest().startSceneId).toBe(first.id);
    const root = scene('Scene 1 (the scenario starts here)');
    type('What happens in scene 1', 'Maya thanks you.', root);
    type('Ending title', 'Maya is happy', root);
    press('Great', root);
    expect(latest().scenes[0]).toMatchObject({
      text: 'Maya thanks you.',
      choices: [],
      ending: { outcome: 'great', title: 'Maya is happy' },
    });
  });

  it('adds choices that lead on, with points, coaching and where they lead', () => {
    const { latest } = edit(twoScenes);
    const root = scene('Scene 1 (the scenario starts here)');
    press('Add choice', root);
    // The new choice leads to the next scene, and the scene is no longer an ending.
    expect(latest().scenes[0]).not.toHaveProperty('ending');
    expect(latest().scenes[0]?.choices[0]).toMatchObject({
      text: '',
      points: 0,
      next: { kind: 'scene', sceneId: 'depot' },
    });
    type('Choice 1', 'Let me check where it is.', root);
    number('Points for choice 1', '15');
    type('Coaching for choice 1', 'Good: you take charge.', root);
    expect(latest().scenes[0]?.choices[0]).toMatchObject({
      text: 'Let me check where it is.',
      points: 10,
      coaching: [{ runs: [{ text: 'Good: you take charge.' }] }],
    });
    // Trying again can't give points.
    pick('Where choice 1 leads', 'retry', root);
    expect(latest().scenes[0]?.choices[0]).toMatchObject({ points: 0, next: { kind: 'retry' } });
    pick('Where choice 1 leads', 'lesson:lesson-2', root);
    expect(latest().scenes[0]?.choices[0]?.next).toEqual({ kind: 'lesson', lessonId: 'lesson-2' });
    const options = within(within(root).getByRole('combobox', { name: 'Where choice 1 leads' }))
      .getAllByRole('option')
      .map((option: HTMLElement) => option.textContent);
    expect(options).toEqual([
      'Scene 2: You find the parcel at the depot.',
      "Try again: back to this scene's choices",
      'Passing a call on',
    ]);
    press('Remove choice 1', root);
    expect(latest().scenes[0]?.choices).toEqual([]);
  });

  it('changes the first scene, and moves it when that scene is removed', () => {
    const { latest } = edit(twoScenes);
    pick('The scenario starts at', 'depot');
    expect(latest().startSceneId).toBe('depot');
    expect(scene('Scene 2 (the scenario starts here)')).toBeInTheDocument();
    pick('The scenario starts at', 'start');
    press('Remove scene 1', scene('Scene 1 (the scenario starts here)'));
    expect(latest().scenes.map((s) => s.id)).toEqual(['depot']);
    expect(latest().startSceneId).toBe('depot');
  });
});
