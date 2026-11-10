/** Deterministic procedural-art contact sheets and raster-edge checks.
 * Run from the repo root with Node 24+ and the optional @napi-rs/canvas package
 * resolvable through Node (the game itself has no native canvas dependency).
 * Outputs stay in .dream-loop/art-audit; a clipped sprite returns exit code 1.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { createCanvas } = createRequire(import.meta.url)('@napi-rs/canvas');
globalThis.document = { createElement: () => createCanvas(1, 1) };
const root = '../src/stichos/';
const { StichosArt, drawHumanoid, makeCivilBuilding } = await import(root + 'art.ts');
const { makeRegionalBuilding } = await import(root + 'architecture.ts');
const { makeRegionalTree, makeRegionalRock, makeRegionalGround } = await import(
  root + 'biome-art.ts'
);
const { appearance, InfiniteWorld } = await import(root + 'world.ts');
const { technologyWeaponSeed } = await import(root + 'equipment.ts');
const { drawProduction } = await import(root + 'production-art.ts');
const { drawEstateStation } = await import(root + 'estate-art.ts');
const { ESTATE_STATIONS } = await import(root + 'property-world.ts');
const { drawFauna } = await import(root + 'fauna-art.ts');
const { drawHomeDecoration } = await import(root + 'progression-art.ts');
const { FURNITURE } = await import(root + 'progression.ts');
const art = new StichosArt(),
  rows = {},
  clipping = [],
  counts = {};
const dirs = ['north', 'east', 'south', 'west'];
const terrain = [
  'snow',
  'grass',
  'sand',
  'mud',
  'basalt',
  'road',
  'floor',
  'wall',
  'bridge',
  'ice',
  'water',
];
const forms = ['conifer', 'broadleaf', 'willow', 'acacia', 'palm', 'cactus', 'snag'];
const rocks = ['granite', 'slate', 'sandstone', 'basalt', 'limestone'];
const props = [
  'pine',
  'rock',
  'cequin',
  'heartleaf',
  'emberroot',
  'lamp',
  'bench',
  'chest',
  'notice',
  'radio',
  'workbench',
  'shrine',
  'door',
  'grave',
  'mushroom',
  'banner',
  'crate',
];
const kinds = ['church', 'house', 'inn', 'workshop', 'greenhouse', 'storehouse', 'hall'];
const cultures = [];
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
  const world = new InfiniteWorld(seed, 4),
    settlement = world.settlementsAround(0, 0, 10)[0];
  if (settlement?.architecture) cultures.push(settlement.architecture);
}
cultures.push(new InfiniteWorld(1, 4).settlementsAround(0, -3840, 10)[0].architecture);
const record = (family, label, sprite, { edgeCheck = true, show = true } = {}) => {
  counts[family] = (counts[family] ?? 0) + 1;
  if (!Number.isFinite(sprite.x) || !Number.isFinite(sprite.y))
    throw Error('Nonfinite anchor ' + label);
  if (edgeCheck) {
    const { width: w, height: h } = sprite.image,
      d = sprite.image.getContext('2d').getImageData(0, 0, w, h).data;
    const edge = { left: 0, right: 0, top: 0, bottom: 0 };
    for (let y = 0; y < h; y++) {
      if (d[y * w * 4 + 3] > 150) edge.left++;
      if (d[(y * w + w - 1) * 4 + 3] > 150) edge.right++;
    }
    for (let x = 0; x < w; x++) {
      if (d[x * 4 + 3] > 150) edge.top++;
      if (d[((h - 1) * w + x) * 4 + 3] > 150) edge.bottom++;
    }
    if (Object.values(edge).some((v) => v > 0)) clipping.push({ family, label, ...edge });
  }
  if (show) (rows[family] ??= []).push({ label, sprite });
};
for (const form of forms)
  for (let seed = 0; seed < 48; seed++)
    record('trees', form + '/' + seed, makeRegionalTree(form, seed), { show: seed < 3 });
for (const material of rocks)
  for (let seed = 0; seed < 48; seed++)
    record('rocks', material + '/' + seed, makeRegionalRock(material, seed), { show: seed < 3 });
for (const kind of props)
  for (let seed = 0; seed < 12; seed++)
    record('props', kind + '/' + seed, art.prop(kind, seed, false), { show: seed === 0 });
for (const kind of ['door', 'chest', 'radio'])
  for (const open of [false, true]) record('props', kind + '/' + open, art.prop(kind, 1, open), {});
for (let i = 0; i < cultures.length; i++)
  for (const opened of [false, true])
    record(
      'doors',
      'culture' + i + '/' + opened,
      art.prop('door', 1, opened, '#687e80', 'house', false, undefined, undefined, {
        ...cultures[i],
        technology: 0.9,
      }),
      {},
    );
for (const kind of kinds)
  for (let i = 0; i < cultures.length; i++)
    for (const [w, h] of [
      [5, 5],
      [8, 8],
      [12, 10],
    ])
      record(
        'buildings',
        kind + '/' + i + '/' + w,
        makeRegionalBuilding(kind, i, w, h, cultures[i]),
        { show: w === 8 },
      );
for (const kind of kinds.filter((k) => k !== 'church'))
  record('legacy-buildings', kind, makeCivilBuilding(kind, 703, 8, 8), {});
for (let tier = 0; tier < 4; tier++)
  for (const weapon of ['none', 'staff', 'sword', 'bow'])
    for (let dir = 0; dir < 4; dir++)
      for (const phase of [0, 0.5, 1]) {
        const c = createCanvas(96, 80),
          look = {
            ...appearance(703 + tier),
            weapon,
            weaponSeed: technologyWeaponSeed(703 + tier, tier),
          };
        drawHumanoid(
          c.getContext('2d'),
          look,
          48,
          68,
          1,
          dir,
          phase * Math.PI * 2,
          true,
          phase,
          false,
          dir === 0,
          null,
        );
        record(
          'humanoids',
          tier + '/' + weapon + '/' + dirs[dir] + '/' + phase,
          { image: c, x: 48, y: 68 },
          { show: phase === 0.5 },
        );
      }
for (const tool of ['axe', 'pickaxe', 'sickle'])
  for (let dir = 0; dir < 4; dir++)
    for (const progress of [0.2, 0.5, 0.8]) {
      const c = createCanvas(96, 80);
      drawHumanoid(
        c.getContext('2d'),
        { ...appearance(733), weapon: 'sword', artifactDesign: 'winter copper coil' },
        48,
        68,
        1,
        dir,
        0,
        false,
        0,
        false,
        dir === 0,
        { kind: 'gather', progress, tool: { kind: tool, seed: 734 } },
      );
      record('tools', tool + '/' + dirs[dir] + '/' + progress, { image: c, x: 48, y: 68 }, {});
    }
for (const kind of ['garden', 'sawmill', 'ore-sorter'])
  for (const progress of [0, 0.5, 1]) {
    const c = createCanvas(100, 100);
    drawProduction(c.getContext('2d'), kind, 50, 75, 1, progress, true, 3);
    record('production', kind + '/' + progress, { image: c, x: 50, y: 75 }, {});
  }
for (const kind of Object.keys(ESTATE_STATIONS))
  for (const working of [false, true]) {
    const c = createCanvas(100, 100);
    drawEstateStation(c.getContext('2d'), kind, 50, 75, 1, 3, working);
    record('estates', kind + '/' + working, { image: c, x: 50, y: 75 }, {});
  }
for (const f of FURNITURE) {
  const c = createCanvas(160, 140);
  drawHomeDecoration(
    c.getContext('2d'),
    {
      id: 'a',
      homeId: 'h',
      buildingId: 'b',
      seed: 733,
      kind: 'furniture',
      furnitureId: f.id,
      x: 0,
      y: 0,
    },
    80,
    115,
    1,
    3,
  );
  record('furniture', f.id, { image: c, x: 80, y: 115 }, {});
}
for (const crop of ['cequin', 'heartleaf', 'emberroot'])
  for (const stage of ['empty', 'seedling', 'growing', 'ready']) {
    const c = createCanvas(120, 140);
    drawHomeDecoration(
      c.getContext('2d'),
      {
        id: 'a',
        homeId: 'h',
        buildingId: 'b',
        seed: 733,
        kind: 'crop',
        crop:
          stage === 'empty'
            ? null
            : { plant: crop, seed: 733, plantedAt: 0, readyAt: 80, yield: 3 },
        stage,
        plot: 0,
        x: 0,
        y: 0,
      },
      60,
      115,
      1,
      3,
    );
    record('crops', crop + '/' + stage, { image: c, x: 60, y: 115 }, {});
  }
for (const kind of ['bird', 'grazer', 'boar', 'wolf'])
  for (const activity of ['sleep', 'forage', 'fly', 'flee', 'stalk', 'lunge']) {
    const c = createCanvas(96, 96),
      animal = {
        id: 'a',
        seed: 733,
        kind,
        name: kind,
        group: 'a',
        home: { x: 0, y: 0 },
        x: 0,
        y: 0,
        heading: 0,
        activity,
        phase: 1.6,
        scale: 1,
        color: '#889981',
        dangerous: false,
        call: null,
      };
    drawFauna(c.getContext('2d'), animal, 48, 70, 32);
    record('fauna', kind + '/' + activity, { image: c, x: 48, y: 70 }, {});
  }
const climateWorld = new InfiniteWorld(71, 4),
  biomes = new Map();
for (let i = 0; i < 1800; i++) {
  const x = ((i * 137) % 16001) - 8000,
    y = ((i * 293) % 16007) - 8000;
  const biome = climateWorld.climate(x, y).biome;
  if (!biomes.has(biome)) biomes.set(biome, { x, y });
}
for (const [biome, point] of biomes) {
  const c = createCanvas(160, 160),
    ctx = c.getContext('2d');
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 5; x++)
      ctx.drawImage(
        makeRegionalGround(climateWorld.tile(point.x + x, point.y + y)).image,
        x * 32,
        y * 32,
      );
  record('biomes', biome, { image: c, x: 80, y: 80 }, { edgeCheck: false });
}
for (const t of terrain) {
  const world = new InfiniteWorld(71, 4),
    tile = { ...world.tile(40, 40), terrain: t };
  record('ground', t, makeRegionalGround(tile), { edgeCheck: false });
}
fs.mkdirSync('.dream-loop/art-audit', { recursive: true });
for (const [family, sprites] of Object.entries(rows)) {
  const cw = family.includes('buildings') ? 260 : 140,
    ch = family.includes('buildings') ? 280 : 180,
    columns = family.includes('buildings') ? 7 : 8;
  const c = createCanvas(cw * columns, ch * Math.ceil(sprites.length / columns)),
    ctx = c.getContext('2d');
  ctx.fillStyle = '#14212a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < sprites.length; i++) {
    const {
        label,
        sprite: { image: im },
      } = sprites[i],
      x = (i % columns) * cw,
      y = Math.floor(i / columns) * ch;
    const scale = Math.min((cw - 16) / im.width, (ch - 34) / im.height, 2);
    ctx.drawImage(im, x + (cw - im.width * scale) / 2, y + 12, im.width * scale, im.height * scale);
    ctx.fillStyle = '#d3dfdc';
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x + 8, y + ch - 8);
  }
  fs.writeFileSync('.dream-loop/art-audit/' + family + '.png', c.toBuffer('image/png'));
}
fs.writeFileSync(
  '.dream-loop/art-audit/report.json',
  JSON.stringify(
    {
      counts,
      cultures: cultures.map((c) => ({
        style: c.style,
        wallMaterial: c.wallMaterial,
        roof: c.roof,
        technology: c.technology,
      })),
      clipping,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ counts, clipping }, null, 2));
if (clipping.length) process.exitCode = 1;
