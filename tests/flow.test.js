'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AI_PROVIDER = 'mock';

const rules = require('../src/rules');
const service = require('../src/service');
const { createStore } = require('../src/store');
const { createApp } = require('../src/server');

test('kriteeriumi kontroll märgib hinnangulised sõnad ja mitu tingimust', () => {
  assert.equal(rules.checkCriterion('Treeningute leht on kasutajasõbralik.').length, 1);
  assert.equal(rules.checkCriterion('Vorm kontrollib andmeid ja saadab meili.').length, 1);
  assert.equal(rules.checkCriterion('Pärast registreerumist kuvatakse kinnitusteade.').length, 0);
});

test('Connextra pealkiri tuletatakse osadest', () => {
  assert.equal(
    rules.buildTitle({ role: 'külastajana', action: 'näha hindu', benefit: 'valida pakett' }),
    'Külastajana soovin näha hindu, et valida pakett',
  );
});

test('valmisoleku kontroll nõuab kolme kontrollitavat kriteeriumi ja mockup’i vaatele', () => {
  const story = {
    role: 'külastajana', action: 'x', benefit: 'y', viewStory: true,
    criteria: [{ text: 'a on nähtav.' }, { text: 'b on nähtav.' }],
  };
  const r = rules.checkReady(story, { hasMockup: false });
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => m.includes('vähemalt 3')));
  assert.ok(r.missing.some((m) => m.includes('mockup')));
});

function tempApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjt-'));
  return { dir, store: createStore(path.join(dir, 'db.json')) };
}

test('AI ettepanek ei muuda backlog’i enne kinnitamist', async () => {
  const { store } = tempApp();
  const project = service.createProject({ name: 'Klubi', description: 'Spordiklubi veeb' });
  store.insert(project);

  const draft = JSON.parse(JSON.stringify(project));
  const proposal = await service.propose(draft, 'stories', {});
  store.update(project.id, (p) => Object.assign(p, draft));

  const saved = store.get(project.id);
  assert.equal(saved.stories.length, 0, 'backlog peab olema tühi enne kinnitamist');
  assert.equal(saved.proposals.length, 1);

  service.apply(saved, proposal.id, {});
  assert.equal(saved.stories.length, 4);
  assert.equal(saved.stories[0].status, 'Idee');
});

test('täpsustus muudab ainult valitud lugu ja tagasivõtmine taastab', async () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  const s1 = service.addStoryManually(project, { role: 'külastajana', action: 'a', benefit: 'b', criteria: ['c1 on nähtav.'] });
  const s2 = service.addStoryManually(project, { role: 'administraatorina', action: 'c', benefit: 'd', criteria: ['c2 on nähtav.'] });
  const before = JSON.stringify(project.stories.find((s) => s.id === s2.id));

  const proposal = await service.propose(project, 'refine', { storyId: s1.id, text: 'lisa käibemaks' });
  service.apply(project, proposal.id, {});

  assert.equal(JSON.stringify(project.stories.find((s) => s.id === s2.id)), before, 'teine lugu ei tohi muutuda');
  assert.ok(project.stories.find((s) => s.id === s1.id).mockupId);

  service.undo(project);
  assert.equal(project.stories.find((s) => s.id === s1.id).mockupId, null);
});

test('lugu, mis pole valmis, ei saa staatust Valmis arenduseks', () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  const s = service.addStoryManually(project, { role: 'külastajana', action: 'a', benefit: 'b', criteria: ['c1 on nähtav.'] });
  assert.throws(() => service.updateStory(project, s.id, { status: 'Valmis arenduseks' }), /ei ole valmis/);
});

test('ettepanek, mis viitab olematule loole, lükatakse tagasi', async () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  await assert.rejects(service.propose(project, 'refine', { storyId: 's_puudub' }), /Lugu ei leitud/);
});

test('AI puudumisel ütleb süsteem selgelt, et käsitsi haldus töötab', async () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  process.env.AI_PROVIDER = 'none';
  try {
    await assert.rejects(service.propose(project, 'roles', {}), (err) => err instanceof service.AiUnavailableError);
  } finally {
    process.env.AI_PROVIDER = 'mock';
  }
});

test('API: projekti loomine, ettepanek ja kinnitamine HTTP kaudu', async () => {
  const { dir } = tempApp();
  const server = createApp({ dataFile: path.join(dir, 'db.json') }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    const created = await call('POST', '/api/projects', { name: 'Klubi', description: 'Spordiklubi' });
    assert.equal(created.status, 201);
    const pid = created.body.id;

    const ai = await call('POST', `/api/projects/${pid}/ai`, { task: 'stories' });
    assert.equal(ai.status, 200);
    assert.equal(ai.body.project.stories.length, 0);
    const proposalId = ai.body.proposal.id;

    const applied = await call('POST', `/api/projects/${pid}/apply`, { proposalId, edited: {} });
    assert.equal(applied.body.stories.length, 4);

    const bad = await call('PATCH', `/api/projects/${pid}/stories/${applied.body.stories[0].id}`, { status: 'Valmis arenduseks' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.missing.length > 0);

    const missing = await call('GET', '/api/projects/p_nope');
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('groomimine: ühendamine ja ignoreerimine rakenduvad eraldi, tagasivõtmine taastab', async () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  service.addStoryManually(project, { role: 'külastajana', action: 'näha pakette', benefit: 'valida', criteria: ['a on nähtav.', 'b on nähtav.', 'c on nähtav.'] });
  service.addStoryManually(project, { role: 'külastajana', action: 'näha hindu', benefit: 'valida', criteria: ['d on nähtav.', 'e on nähtav.', 'f on nähtav.'] });
  const before = project.stories.length;

  const proposal = await service.propose(project, 'groom', {});
  const mergeIndex = proposal.payload.findings.findIndex((f) => f.kind === 'merge');
  assert.ok(mergeIndex >= 0, 'AI leidis kattuvuse');

  service.apply(project, proposal.id, { findingIndex: mergeIndex });
  assert.equal(project.stories.length, before - 1, 'kaks lugu on ühendatud üheks');
  const allDone = proposal.payload.findings.every((f) => f.applied);
  assert.equal(proposal.status, allDone ? 'applied' : 'pending', 'ettepanek on lahti, kuni kõik leiud on tehtud');

  const flagIndex = proposal.payload.findings.findIndex((f) => f.kind === 'flag');
  if (flagIndex >= 0) {
    service.apply(project, proposal.id, { findingIndex: flagIndex, ignore: true });
  }
  service.undo(project);
  assert.equal(project.stories.length, before, 'tagasivõtmine taastab loendi');
});

test('intervjuu: AI küsib ühe küsimuse korraga ja ütleb lõpuks, et info on piisav', async () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  let rounds = 0;
  for (; rounds < 10; rounds += 1) {
    const proposal = await service.propose(project, 'questions', {});
    if (proposal.payload.done) {
      service.apply(project, proposal.id, {});
      break;
    }
    assert.equal(proposal.payload.questions.length, 1, 'üks küsimus korraga');
    service.apply(project, proposal.id, { questions: [{ ...proposal.payload.questions[0], answer: 'vastus' }] });
  }
  assert.equal(project.answers.length, 3);
  assert.equal(project.stage, 'roles', 'valmis intervjuu viib rollide etappi');
});

test('vaba vestlus ei muuda backlog’i ega loo ettepanekut', async () => {
  const project = service.createProject({ name: 'Klubi', description: 'x' });
  service.addStoryManually(project, { role: 'külastajana', action: 'a', benefit: 'b', criteria: ['c on nähtav.'] });
  const before = JSON.stringify(project.stories);
  const reply = await service.propose(project, 'chat', { text: 'Mida teha?' });
  assert.equal(reply.status, 'done');
  assert.equal(project.proposals.length, 0);
  assert.equal(JSON.stringify(project.stories), before);
  assert.ok(project.messages.length >= 1);
});
