import test from 'node:test';
import assert from 'node:assert/strict';
import { CivicWorld, type CivicAction, type CivicDebit } from '../src/stichos/civic-world.ts';
import { civilizationFor } from '../src/stichos/civilization.ts';
import { FieldEconomy } from '../src/stichos/field-loot.ts';
import { renderLivingSystemsPanel } from '../src/stichos/living-systems-ui.ts';
import type { LivingSystemsFrame } from '../src/stichos/living-systems.ts';
import type { Settlement } from '../src/stichos/types.ts';

const town: Settlement = {
  id: 'town:0:0',
  seed: 43,
  name: 'Ilex Reach',
  x: 0,
  y: 0,
  radius: 18,
  clan: 1,
  kind: 'village',
  rank: 'city',
};
const position = { spaceId: 'surface', x: 0, y: 0 };
function fixture() {
  let civic = new CivicWorld(43, civilizationFor(43));
  const guild = civic.factionsFor(town)[0];
  civic.setGuildContact(guild.id, 'registrar');
  const economy = new FieldEconomy(43);
  economy.ensure('player');
  assert.equal(
    economy.transact(
      'player',
      { coins: 0, items: {} },
      {
        coins: 200,
        items: { wood: 20, stone: 20, ration: 10, bandage: 10 },
      },
      'fixture-supplies',
    ).ok,
    true,
  );
  const debit: CivicDebit = (cost, receipt) =>
    economy.transact('player', cost, { coins: 0, items: {} }, receipt).ok;
  const panel = (reachable = true) =>
    renderLivingSystemsPanel(
      {
        version: 1,
        elapsed: 30,
        location: position,
        economy: economy.frame({ id: 'player', ...position }, 30),
        factions: [guild],
        memberships: civic.memberships('player'),
        duties: [],
        actors: [],
        signs: [],
        town,
        laws: civic.lawsFor(town),
        reputation: null,
        guards: [],
        offers: [],
        contacts: [
          {
            factionId: guild.id,
            npcId: 'registrar',
            name: 'Iven',
            ...position,
            x: reachable ? 0 : 10,
          },
        ],
        property: { version: 1, estates: [], workers: [], saturated: false },
        diagnostics: {},
      } as unknown as LivingSystemsFrame,
      {
        section: 'charters',
        detail: guild.id,
        page: 0,
        busy: false,
        message: '',
      },
    );
  const available = () =>
    [...panel().actions.values()].flatMap((action) =>
      action.kind === 'command' && action.command.kind === 'guild' ? [action.command.action] : [],
    );
  return {
    guild,
    economy,
    debit,
    panel,
    available,
    get civic() {
      return civic;
    },
    reload() {
      civic = new CivicWorld(43, civilizationFor(43), civic.save());
    },
  };
}

test('the actual leave and reload lifecycle offers rejoining instead of an impossible reconciliation', () => {
  const f = fixture();
  assert.deepEqual(f.available(), ['discover']);
  assert.equal(f.civic.discover('player', f.guild.id).ok, true);
  assert.deepEqual(f.available(), ['join']);
  assert.equal(f.civic.join('player', f.guild.id, 1, f.debit).ok, true);
  assert.ok(f.available().includes('dues'));
  assert.equal(f.civic.leave('player', f.guild.id, 2).ok, true);
  f.reload();
  assert.deepEqual(f.available(), ['join']);
  assert.match(f.panel().html, /Rejoin this guild/);
  assert.equal(f.civic.reconcile('player', f.guild.id, 3, f.debit).ok, false);
  const distant = f.panel(false);
  const join = [...distant.actions].find(
    ([, action]) =>
      action.kind === 'command' &&
      action.command.kind === 'guild' &&
      action.command.action === 'join',
  )![0];
  assert.match(distant.html, new RegExp(`data-living-action="${join}"[^>]*disabled`));
  const coins = f.economy.satchel('player')!.coins;
  assert.equal(f.civic.join('player', f.guild.id, 4, f.debit).ok, true);
  assert.equal(f.economy.satchel('player')!.coins, coins - f.guild.entryCost.coins);
  assert.ok(f.available().includes('dues'));
});

test('expulsion requires actual restitution, then the UI exposes the separate paid rejoin transition', () => {
  const f = fixture();
  f.civic.discover('player', f.guild.id);
  assert.equal(f.civic.join('player', f.guild.id, 1, f.debit).ok, true);
  const witnessed = (kind: CivicAction['kind'], sourceId: string, at: number) => {
    assert.equal(
      f.civic.recordAction(
        {
          ...position,
          actorId: 'player',
          kind,
          sourceId,
          at,
          settlementId: town.id,
        },
        [{ ...position, id: 'registrar', alive: true }],
        () => true,
      ).ok,
      true,
    );
  };
  witnessed('betrayal', 'broken-oath', 10);
  assert.deepEqual(f.available(), ['reconcile']);
  assert.equal(f.civic.reconcile('player', f.guild.id, 11, f.debit).ok, false);
  for (let i = 0; i < 4; i++) witnessed('rescue', `rescue:${i}`, 12 + i);
  assert.equal(f.civic.reconcile('player', f.guild.id, 20, f.debit).ok, true);
  f.reload();
  assert.deepEqual(f.available(), ['join']);
  assert.equal(f.civic.join('player', f.guild.id, 21, f.debit).ok, true);
  assert.equal(f.civic.factionReputation(f.guild.id, 'player').traits.oathbreaker, 5);
  assert.equal(f.civic.save().events.length, 5, 'Rejoining retains the actual remembered history.');
});
