import test from 'node:test';
import assert from 'node:assert/strict';
import { Stichos } from '../src/stichos/session.ts';
import { notebookHtml, type NotebookView } from '../src/stichos/notebook.ts';
import { personalThread } from '../src/stichos/personal-story.ts';

const view: NotebookView = { section: 'threads', entry: 0, plant: 0, plain: true, open: true };
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

test('current threads lead with the same actionable next step as the first-life tracker', () => {
  let game = new Stichos(8, 4);
  assert.equal(game.acceptLife(3).ok, true);
  const assertCurrentStep = () => {
    const step = personalThread(game.personalStory!, game.inventory, game.freeLife.contract);
    const html = notebookHtml(game, view);
    assert.ok(html.includes('aria-label="Current objective"'));
    assert.ok(html.includes(escape(step.stage)));
    assert.ok(html.includes(escape(step.objective)));
    assert.ok(html.indexOf('aria-label="Current objective"') < html.indexOf('Threads to follow'));
  };
  assertCurrentStep();
  for (const stance of ['ally', 'witness']) {
    const person = game.personalStory!.relationships.find((p) => p.stance === stance)!;
    const point = [
      { x: person.target.x, y: person.target.y + 1 },
      { x: person.target.x + 1, y: person.target.y },
    ].find((p) => !game.world.blocked(p.x, p.y));
    assert.ok(point);
    Object.assign(game.player, point);
    game.dialogue = null;
    game = Stichos.restore(game.save());
    game.interact(person.npcId);
    assert.ok(game.dialogue);
    assertCurrentStep();
  }
  game.choose('personal:trust');
  assert.equal(game.personalStory!.obligations[1].complete, true);
  assertCurrentStep();
  assert.ok(notebookHtml(game, view).includes('Keep a promise'));
});

test('the classic campaign journal retains its own quest structure', () => {
  const game = new Stichos(0x53544943, 3);
  const html = notebookHtml(game, view);
  assert.ok(!html.includes('aria-label="Current objective"'));
  assert.ok(html.includes('Threads to follow'));
  assert.ok(html.includes('The six families'));
});

test('quest cards show repeated prose once while retaining counts, targets and differing instructions', () => {
  const game = new Stichos(0x53544943, 3);
  const description = 'Bring the medic four fresh cuttings.';
  const quest = {
    id: 'review-cuttings',
    title: 'A supply promise',
    description,
    objective: `2/4 · ${description}`,
    stage: 0,
    complete: false,
    target: { x: 17, y: -23 },
  };
  game.quests = [quest];
  let html = notebookHtml(game, view);
  assert.equal(html.split(description).length - 1, 1);
  assert.ok(html.includes('<b>2/4</b>'));
  assert.ok(html.includes('Near 17, -23'));
  assert.ok(html.includes('data-track-quest="review-cuttings"'));

  quest.objective = description;
  html = notebookHtml(game, view);
  assert.equal(html.split(description).length - 1, 1);
  assert.ok(!html.includes('<b></b>'));

  quest.objective = 'Ask the witness which cuttings are safe.';
  html = notebookHtml(game, view);
  assert.ok(html.includes(description));
  assert.ok(html.includes(quest.objective));

  quest.objective = `Wait until morning · ${description}`;
  quest.complete = true;
  html = notebookHtml(game, view);
  assert.ok(
    html.includes(quest.objective),
    'Only an exact repeat or numeric progress prefix is shortened.',
  );
  assert.ok(html.includes('Resolved'));
  assert.ok(!html.includes('data-track-quest="review-cuttings"'));
});
