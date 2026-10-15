'use strict';

// Äriloogika: projekt, lood, ettepanekute rakendamine, tagasivõtmine ja järgmised sammud.
// AI ei muuda kunagi andmeid ise. Ta pakub ettepaneku, mille kasutaja peab kinnitama (apply).

const crypto = require('crypto');
const { askAI, AiUnavailableError, AiInvalidResponseError } = require('./ai');
const rules = require('./rules');
const v = require('./validate');

const STAGES = [
  { key: 'idea', label: 'Idee' },
  { key: 'roles', label: 'Rollid' },
  { key: 'stories', label: 'Lood' },
  { key: 'priorities', label: 'Prioriteedid' },
  { key: 'criteria', label: 'Kriteeriumid ja mockup' },
  { key: 'refinement', label: 'Täpsustused' },
  { key: 'grooming', label: 'Groomimine' },
];

// Iga etapi AI ülesanne. Etapp määrab, mida AI järgmisena teeb.
const STAGE_TASK = {
  idea: 'questions',
  roles: 'roles',
  stories: 'stories',
  priorities: 'priority',
  criteria: 'criteria',
  refinement: 'refine',
  grooming: 'groom',
};

const STATUSES = ['Idee', 'Vajab täpsustamist', 'Läbivaadatud', 'Valmis arenduseks'];
const HISTORY_LIMIT = 30;
const PROPOSAL_LIMIT = 20;

class ValidationError extends Error {}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function now() {
  return new Date().toISOString();
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function createProject({ name, description }) {
  if (!name || !String(name).trim()) {
    throw new ValidationError('Projekti nimi ei tohi olla tühi.');
  }
  return {
    id: id('p'),
    name: String(name).trim().slice(0, 120),
    description: String(description || '').trim().slice(0, 2000),
    createdAt: now(),
    stage: 'idea',
    answers: [],
    roles: [],
    stories: [],
    mockups: [],
    mvpStoryId: null,
    nextSeq: 0,
    proposals: [],
    history: [],
    messages: [],
  };
}

function storyTitle(s) {
  return rules.buildTitle(s);
}

function storyView(project, s) {
  const mvpIndex = project.mvpStoryId ? project.stories.findIndex((x) => x.id === project.mvpStoryId) : -1;
  const index = project.stories.indexOf(s);
  const hasMockup = Boolean(s.mockupId);
  return {
    ...s,
    title: storyTitle(s),
    code: `US-${s.seq || index + 1}`,
    hasMockup,
    mvp: mvpIndex !== -1 && index <= mvpIndex,
    ready: rules.checkReady(s, { hasMockup }),
  };
}

function view(project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    stage: project.stage,
    stages: STAGES,
    answers: project.answers,
    roles: project.roles,
    stories: project.stories.map((s) => storyView(project, s)),
    mockups: project.mockups,
    mvpStoryId: project.mvpStoryId,
    proposals: project.proposals.filter((p) => p.status === 'pending'),
    messages: project.messages.slice(-100),
    canUndo: project.history.length > 0,
    nextSteps: nextSteps(project),
  };
}

// Lühike kontekst, mida AI näeb. Vestluse ajalugu ei ole usaldusväärne, seega annab kontekst praeguse seisu.
function contextFor(project, extra = {}) {
  return {
    idea: project.description,
    answers: project.answers,
    roles: project.roles,
    stories: project.stories.map((s) => ({
      id: s.id, title: storyTitle(s), role: s.role, action: s.action, benefit: s.benefit,
      criteria: s.criteria.map((c) => c.text), status: s.status,
    })),
    mvpStoryId: project.mvpStoryId,
    ...extra,
  };
}

// Järgmised sammud, 1–4 valikut. Kasutaja ei jää kunagi ilma järgmise sammuta.
function nextSteps(project) {
  const steps = [];
  const hasStories = project.stories.length > 0;
  const hasRoles = project.roles.length > 0;
  const stage = project.stage;
  if (stage === 'idea') {
    steps.push({ label: 'Esita täpsustavad küsimused', action: { type: 'ai', task: 'questions' } });
    steps.push({ label: 'Paku rollid', action: { type: 'ai', task: 'roles' } });
  } else if (stage === 'roles') {
    steps.push({ label: hasRoles ? 'Paku rollid uuesti' : 'Paku rollid', action: { type: 'ai', task: 'roles' } });
    steps.push({ label: 'Liigu lugude juurde', action: { type: 'stage', stage: 'stories' } });
  } else if (stage === 'stories') {
    steps.push({ label: 'Paku kasutajalood happy path’i järjekorras', action: { type: 'ai', task: 'stories' } });
    if (hasStories) {
      steps.push({ label: 'Seab prioriteedid', action: { type: 'stage', stage: 'priorities' } });
    }
  } else if (stage === 'priorities') {
    steps.push({ label: 'Küsi, millisest loost alustada', action: { type: 'ai', task: 'priority' } });
    steps.push({ label: 'Liigu kriteeriumide juurde', action: { type: 'stage', stage: 'criteria' } });
  } else if (stage === 'criteria') {
    steps.push({ label: 'Paku kriteeriumid ja mockup valitud loole', action: { type: 'ai', task: 'criteria' } });
    steps.push({ label: 'Liigu täpsustuste juurde', action: { type: 'stage', stage: 'refinement' } });
  } else if (stage === 'refinement') {
    steps.push({ label: 'Rakenda kliendi täpsustus', action: { type: 'ai', task: 'refine' } });
    steps.push({ label: 'Liigu groomimise juurde', action: { type: 'stage', stage: 'grooming' } });
  } else if (stage === 'grooming') {
    steps.push({ label: 'Vaata backlog üle', action: { type: 'ai', task: 'groom' } });
  }
  if (steps.length < 4 && hasStories && stage !== 'grooming') {
    steps.push({ label: 'Vaata backlog üle', action: { type: 'ai', task: 'groom' } });
  }
  return steps.slice(0, 4);
}

// Salvestab hetkeseisu, et viimane muudatus saaks tagasi võtta.
function snapshot(project) {
  project.history.push(clone({
    roles: project.roles, stories: project.stories, mockups: project.mockups,
    mvpStoryId: project.mvpStoryId, stage: project.stage,
  }));
  if (project.history.length > HISTORY_LIMIT) {
    project.history.shift();
  }
}

function undo(project) {
  const prev = project.history.pop();
  if (!prev) {
    throw new ValidationError('Tagasivõetavat muudatust ei ole.');
  }
  Object.assign(project, prev);
}

function findStory(project, storyId) {
  const s = project.stories.find((x) => x.id === storyId);
  if (!s) {
    throw new ValidationError('Lugu ei leitud.');
  }
  return s;
}

function criteriaFrom(texts) {
  return texts.map((text) => ({ id: id('c'), text, status: 'Ootel' }));
}

// Teeb AI päringu ja salvestab tulemuse ettepanekuna. Midagi ei rakendata.
async function propose(project, task, input = {}) {
  const storyId = input.storyId;
  if (task === 'refine' || task === 'criteria') {
    findStory(project, storyId);
  }
  const extra = { userText: input.text || '' };
  if (storyId) {
    extra.storyId = storyId;
  }
  if (task === 'criteria' || task === 'refine') {
    const s = findStory(project, storyId);
    extra.story = { id: s.id, title: storyTitle(s), criteria: s.criteria.map((c) => c.text) };
    const mockup = project.mockups.find((m) => m.storyId === s.id);
    if (mockup) {
      extra.currentMockup = mockup.versions[mockup.versions.length - 1].root;
    }
  }
  const raw = await askAI(task, contextFor(project, extra));
  const payload = validatePayload(task, raw, project);
  const proposal = {
    id: id('x'), task, storyId: storyId || null, payload, status: 'pending', createdAt: now(),
  };
  project.proposals.push(proposal);
  if (project.proposals.length > PROPOSAL_LIMIT) {
    project.proposals.shift();
  }
  project.messages.push({ role: 'ai', text: payload.message || '', ts: now() });
  return proposal;
}

// Kontrollib AI vastuse kuju. Mitte ükski väli ei jõua kasutajani ilma kontrollita.
function validatePayload(task, raw, project) {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('AI vastus ei ole objekt.');
  }
  const message = typeof raw.message === 'string' ? raw.message.slice(0, 1000) : '';
  const fail = (r) => { throw new ValidationError(r.error); };
  switch (task) {
    case 'questions': {
      if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 3) {
        throw new ValidationError('Küsimusi peab olema 1–3.');
      }
      return { message, questions: raw.questions.map((q) => ({
        text: String(q.text || '').slice(0, 300),
        options: (q.options || []).slice(0, 4).map((o) => String(o).slice(0, 100)),
        answer: q.answer ? String(q.answer).slice(0, 300) : null,
      })) };
    }
    case 'roles': {
      const r = v.validateRoles(raw.roles);
      if (!r.ok) fail(r);
      return { message, roles: r.value };
    }
    case 'stories': {
      const r = v.validateStories(raw.stories);
      if (!r.ok) fail(r);
      return { message, stories: r.value };
    }
    case 'priority': {
      const ids = new Set(project.stories.map((s) => s.id));
      if (!Array.isArray(raw.order) || raw.order.some((x) => !ids.has(x)) || raw.order.length !== ids.size) {
        throw new ValidationError('Järjestuses peavad olema kõik olemasolevad lood, mitte midagi muud.');
      }
      return { message, order: raw.order, reason: String(raw.reason || '').slice(0, 500) };
    }
    case 'criteria': {
      findStory(project, raw.storyId);
      const c = v.validateCriteria(raw.criteria);
      if (!c.ok) fail(c);
      let mockup = null;
      if (raw.mockup) {
        const m = v.validateMockup(raw.mockup);
        if (!m.ok) fail(m);
        mockup = m.value;
      }
      return { message, storyId: raw.storyId, criteria: c.value, mockup };
    }
    case 'refine': {
      findStory(project, raw.storyId);
      const changes = raw.changes || {};
      if (changes.criteria) {
        const c = v.validateCriteria(changes.criteria);
        if (!c.ok) fail(c);
        changes.criteria = c.value;
      }
      let mockup = null;
      if (raw.mockup) {
        const m = v.validateMockup(raw.mockup);
        if (!m.ok) fail(m);
        mockup = m.value;
      }
      const others = Array.isArray(raw.otherStoryChanges) ? raw.otherStoryChanges : [];
      // Täpsustus ei tohi puudutada teisi lugusid. Need pakutakse eraldi ettepanekutena.
      return { message, storyId: raw.storyId, changes: pick(changes), mockup, otherStoryChanges: others.map((o) => ({
        storyId: String(o.storyId || ''), description: String(o.description || '').slice(0, 300),
      })) };
    }
    case 'groom': {
      if (!Array.isArray(raw.findings)) {
        throw new ValidationError('Leidude loend puudub.');
      }
      const ids = new Set(project.stories.map((s) => s.id));
      const findings = [];
      for (const f of raw.findings.slice(0, 10)) {
        if (!['split', 'merge'].includes(f.kind) || !Array.isArray(f.storyIds) || f.storyIds.some((x) => !ids.has(x))) {
          continue;
        }
        const r = v.validateStories(f.stories);
        if (!r.ok) continue;
        findings.push({ kind: f.kind, storyIds: f.storyIds, explanation: String(f.explanation || '').slice(0, 500), stories: r.value, applied: false });
      }
      // Reeglipõhised leiud: kriteeriumid ja Connextra kontroll, ilma AI-ta.
      for (const s of project.stories) {
        const ready = rules.checkReady(s, { hasMockup: Boolean(s.mockupId) });
        const ruleIssues = ready.missing.filter((m) => m.includes('ei ole kontrollitav') || m.includes('Connextra'));
        if (ruleIssues.length > 0) {
          findings.push({ kind: 'flag', storyIds: [s.id], explanation: ruleIssues.join(' '), stories: [], applied: false });
        }
      }
      return { message, findings };
    }
    default:
      throw new ValidationError(`Tundmatu ülesanne: ${task}`);
  }
}

function pick(changes) {
  const out = {};
  for (const key of ['role', 'action', 'benefit', 'criteria']) {
    if (changes[key] !== undefined) out[key] = changes[key];
  }
  return out;
}

// Rakendab kasutaja kinnitatud (ja vajadusel muudetud) ettepaneku.
// Kasutaja muudatused tulevad payloadis ja läbivad sama kontrolli kui AI vastus.
function apply(project, proposalId, edited = {}) {
  const proposal = project.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== 'pending') {
    throw new ValidationError('Ettepanekut ei leitud või see on juba rakendatud.');
  }
  // Groomimise leiud jäävad ettepaneku juurde (indeks peab klappima), neid ei arvutata uuesti.
  const payload = proposal.task === 'groom'
    ? proposal.payload
    : validatePayload(proposal.task, { ...proposal.payload, ...edited }, project);
  snapshot(project);

  switch (proposal.task) {
    case 'questions':
      project.answers.push(...payload.questions.map((q) => ({ question: q.text, answer: q.answer || null })));
      break;
    case 'roles':
      project.roles = payload.roles;
      break;
    case 'stories':
      payload.stories.forEach((s) => project.stories.push(newStory(s, 'AI ettepanek', project)));
      break;
    case 'priority': {
      const map = new Map(project.stories.map((s) => [s.id, s]));
      project.stories = payload.order.map((x) => map.get(x));
      break;
    }
    case 'criteria':
      applyMockupAndCriteria(project, payload.storyId, payload.criteria, payload.mockup);
      break;
    case 'refine': {
      if (payload.otherStoryChanges.length > 0) {
        throw new ValidationError('Täpsustus puudutab teisi lugusid. Rakenda need eraldi ettepanekutena.');
      }
      const s = findStory(project, payload.storyId);
      if (payload.changes.role) s.role = payload.changes.role;
      if (payload.changes.action) s.action = payload.changes.action;
      if (payload.changes.benefit) s.benefit = payload.changes.benefit;
      if (payload.changes.criteria) s.criteria = criteriaFrom(payload.changes.criteria);
      if (payload.mockup) applyMockupAndCriteria(project, s.id, null, payload.mockup);
      break;
    }
    case 'groom':
      applyGroomFinding(project, payload, edited.findingIndex, Boolean(edited.ignore));
      break;
    default:
      throw new ValidationError('Seda ettepanekut ei saa rakendada.');
  }
  // Kinnitatud samm viib projekti loomulikult järgmisse etappi (undo taastab etapi).
  const NEXT_STAGE = { questions: 'roles', roles: 'stories', stories: 'priorities', priority: 'criteria', criteria: 'refinement' };
  if (NEXT_STAGE[proposal.task]) {
    project.stage = NEXT_STAGE[proposal.task];
  }

  // Groomimisel jääb ettepanek lahtiseks, kuni kõik leiud on rakendatud või tehtud.
  const allDone = proposal.task !== 'groom' || payload.findings.every((f) => f.applied);
  if (allDone) {
    proposal.status = 'applied';
    proposal.appliedAt = now();
  }
  return project;
}

// Ettepaneku tagasilükkamine: midagi ei muutu, ettepanek lihtsalt peidetakse.
function reject(project, proposalId) {
  const proposal = project.proposals.find((p) => p.id === proposalId);
  if (!proposal || proposal.status !== 'pending') {
    throw new ValidationError('Ettepanekut ei leitud või see on juba töödeldud.');
  }
  proposal.status = 'rejected';
}

function newStory(s, origin, project) {
  project.nextSeq = (project.nextSeq || 0) + 1;
  return {
    id: id('s'),
    seq: project.nextSeq,
    role: s.role,
    action: s.action,
    benefit: s.benefit,
    criteria: criteriaFrom(s.criteria),
    status: 'Idee',
    size: s.size || 'M',
    viewStory: Boolean(s.viewStory),
    mockupId: null,
    openQuestions: [],
    origin,
  };
}

// Lisab mockup’i uue versioonina ja seob selle loosse. Vana versioon säilib.
function applyMockupAndCriteria(project, storyId, criteria, mockupRoot) {
  const s = findStory(project, storyId);
  if (criteria) {
    s.criteria = criteriaFrom(criteria);
  }
  if (mockupRoot) {
    let m = project.mockups.find((x) => x.storyId === s.id);
    if (!m) {
      m = { id: id('m'), storyId: s.id, versions: [] };
      project.mockups.push(m);
    }
    m.versions.push({ id: id('v'), createdAt: now(), root: mockupRoot });
    s.mockupId = m.id;
    s.viewStory = true;
  }
}

// Groomimise leid. Kasutaja kinnitab iga leidu eraldi.
function applyGroomFinding(project, payload, index, ignore) {
  const finding = payload.findings[Number(index)];
  if (!finding) {
    throw new ValidationError('Leidu ei leitud.');
  }
  if (finding.applied) {
    throw new ValidationError('See leid on juba rakendatud.');
  }
  if (ignore) {
    finding.applied = true;
    finding.ignored = true;
    return;
  }
  const pos = project.stories.findIndex((s) => s.id === finding.storyIds[0]);
  if (finding.kind === 'flag') {
    const s = findStory(project, finding.storyIds[0]);
    s.status = 'Vajab täpsustamist';
    s.openQuestions.push(finding.explanation);
  } else if (finding.kind === 'split' || finding.kind === 'merge') {
    const removeIds = new Set(finding.storyIds);
    const created = finding.stories.map((s) => newStory(s, 'Groomimine', project));
    const insertAt = pos === -1 ? project.stories.length : pos;
    project.stories = project.stories.filter((s) => !removeIds.has(s.id));
    project.stories.splice(insertAt, 0, ...created);
  }
  finding.applied = true;
}

// Käsitsi muudatused (lisamine, muutmine, järjestus, staatus) ilma AI-ta.
function addStoryManually(project, body) {
  const r = v.validateStory(body);
  if (!r.ok) throw new ValidationError(r.error);
  snapshot(project);
  const s = newStory(r.value, 'Käsitsi', project);
  project.stories.push(s);
  return s;
}

function updateStory(project, storyId, body) {
  const s = findStory(project, storyId);
  snapshot(project);
  for (const key of ['role', 'action', 'benefit']) {
    if (typeof body[key] === 'string' && body[key].trim()) s[key] = body[key].trim();
  }
  if (Array.isArray(body.criteria)) {
    const c = v.validateCriteria(body.criteria);
    if (!c.ok) throw new ValidationError(c.error);
    s.criteria = criteriaFrom(c.value);
  }
  if (typeof body.openQuestions !== 'undefined') {
    if (!Array.isArray(body.openQuestions)) throw new ValidationError('Avatud küsimused peavad olema loend.');
    s.openQuestions = body.openQuestions.map((q) => String(q).slice(0, 300)).filter(Boolean);
  }
  if (body.size && ['S', 'M', 'L'].includes(body.size)) s.size = body.size;
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new ValidationError('Tundmatu staatus.');
    if (body.status === 'Valmis arenduseks') {
      const ready = rules.checkReady(s, { hasMockup: Boolean(s.mockupId) });
      if (!ready.ok) {
        const err = new ValidationError('Lugu ei ole valmis arenduseks.');
        err.missing = ready.missing;
        throw err;
      }
    }
    s.status = body.status;
  }
  if (s.openQuestions.length > 0 && s.status === 'Valmis arenduseks') {
    throw new ValidationError('Avatud küsimustega lugu ei saa olla valmis arenduseks.');
  }
  return s;
}

function removeStory(project, storyId) {
  findStory(project, storyId);
  snapshot(project);
  project.stories = project.stories.filter((s) => s.id !== storyId);
  if (project.mvpStoryId === storyId) project.mvpStoryId = null;
}

function setOrder(project, order) {
  const ids = project.stories.map((s) => s.id);
  if (!Array.isArray(order) || order.length !== ids.length || order.some((x) => !ids.includes(x))) {
    throw new ValidationError('Järjestus peab sisaldama täpselt kõiki lugusid.');
  }
  snapshot(project);
  const map = new Map(project.stories.map((s) => [s.id, s]));
  project.stories = order.map((x) => map.get(x));
}

function setMvp(project, storyId) {
  if (storyId !== null) findStory(project, storyId);
  snapshot(project);
  project.mvpStoryId = storyId;
}

module.exports = {
  STAGES,
  STAGE_TASK,
  ValidationError,
  AiUnavailableError,
  AiInvalidResponseError,
  createProject,
  view,
  propose,
  apply,
  reject,
  undo,
  addStoryManually,
  updateStory,
  removeStory,
  setOrder,
  setMvp,
  nextSteps,
  snapshot,
  findStory,
};
