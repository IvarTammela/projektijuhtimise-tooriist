'use strict';

// AI kiht. Kõik välise AI teenuse päringud käivad siit ja ainult serveri poolelt.
// Provider valitakse keskkonnamuutujaga AI_PROVIDER: "anthropic" (vaikimisi, kui võti on olemas),
// "mock" (deterministlikud vastused testimiseks) või "none" (AI pole seadistatud).

const PROMPTS = {
  questions: 'Oled projektijuht. Kliendi idee on umbmäärane. Esita 1–3 täpsustavat küsimust, igaühele 2–4 vastusevarianti. Vasta ainult JSON-iga: {"message": string, "questions": [{"text": string, "options": [string]}]}.',
  roles: 'Pakkusid kasutajarollid projektile. Roll on translatiivis (nt "külastajana", "klubi liikmena"). Vasta ainult JSON-iga: {"message": string, "roles": [string]}.',
  stories: 'Kirjuta kasutajalood Connextra vormis happy path’i järjekorras. Igal loal on role (translatiivis, nt "külastajana"), action (tegevus), benefit (kasu), criteria (vastuvõtukriteeriumid, igaüks jah/ei kontrollitav üks tingimus) ja viewStory (true, kui lugu puudutab vaadet). Vasta ainult JSON-iga: {"message": string, "stories": [{"role": string, "action": string, "benefit": string, "criteria": [string], "viewStory": boolean}]}.',
  priority: 'Sea lood järjekorda ja soovita, millisest alustada. Vasta ainult JSON-iga: {"message": string, "order": [storyId], "recommendedStoryId": storyId, "reason": string}.',
  criteria: 'Kirjuta valitud loole 3–5 vastuvõtukriteeriumit (igaüks üks jah/ei tingimus, ei tohi sisaldada hinnangulisi sõnu) ja lihtne mockup komponentide puuna. Lubatud tüübid: page, heading, text, button, input, card, price, list, checkbox, nav, image. Vasta ainult JSON-iga: {"message": string, "storyId": storyId, "criteria": [string], "mockup": {"type": string, "label": string, "children": []}}.',
  refine: 'Klient täpsustas ühte lugu. Muuda ainult seda lugu. Kui muudatus mõjutab ka teisi lugusid, pane need eraldi otherStoryChanges-i. Vasta ainult JSON-iga: {"message": string, "storyId": storyId, "changes": {"role"?: string, "action"?: string, "benefit"?: string, "criteria"?: [string]}, "mockup"?: object, "otherStoryChanges": [{"storyId": storyId, "description": string}]}.',
  groom: 'Analüüsi backlog’i. Leia liiga suured lood (mitu rolli või tegevust) ja kattuvad lood. Iga leidu kohta paku split (jaga kaheks, anna kummagi lugu) või merge (ühenda, anna ühendatud lugu). Vasta ainult JSON-iga: {"message": string, "findings": [{"kind": "split"|"merge", "storyIds": [storyId], "explanation": string, "stories": [{"role": string, "action": string, "benefit": string, "criteria": [string], "viewStory": boolean}]}]}.',
};

class AiUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

// Võtab mudeli vastusest esimese JSON-objekti. Ei usalda, et vastus on puhas JSON.
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Vastuses ei ole JSON-objekti.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function callAnthropic(system, userText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AiUnavailableError('ANTHROPIC_API_KEY pole seadistatud.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'claude-sonnet-5-5',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) {
    throw new AiUnavailableError(`AI teenus vastas veaga ${res.status}.`);
  }
  const body = await res.json();
  return body.content.map((block) => block.text || '').join('');
}

// Mock-vastused: fikseeritud näited, et saaks rakendust testida ilma võtmeta.
const MOCK = {
  questions: () => ({
    message: 'Enne lugude pakkumist täpsustan paari asja.',
    questions: [{ text: 'Kes on rakenduse kasutajad?', options: ['Külastaja', 'Klubi liige', 'Administraator'] }],
  }),
  roles: () => ({ message: 'Pakun kolm rolli.', roles: ['külastajana', 'klubi liikmena', 'administraatorina'] }),
  stories: () => ({
    message: 'Pakun külastaja põhitöövoo põhjal lood.',
    stories: [
      { role: 'külastajana', action: 'näha treeningute kirjeldust', benefit: 'tutvuda klubi pakkumisega', criteria: ['Treeningu juures on kirjeldus.', 'Treeningu juures on kestus minutites.', 'Treeningute loend on kättesaadav avalehelt.'], viewStory: true },
      { role: 'külastajana', action: 'näha liikmepakette ja hindu', benefit: 'valida endale sobiv pakett', criteria: ['Paketi hinna juures on märge, kas hind sisaldab käibemaksu.', 'Iga pakett kuvab kestuse kuudes.', 'Pakettide loend sisaldab vähemalt kolme pakketti.'], viewStory: true },
      { role: 'külastajana', action: 'registreerida end liikmeks', benefit: 'alustada treeninguid', criteria: ['Registreerumisvormis on nõutud e-posti väli.', 'Registreerumisvorm ei saada tühja e-posti väljaga.', 'Pärast registreerumist kuvatakse kinnitusteade.'], viewStory: true },
      { role: 'külastajana', action: 'maksta liikmetasu veebis', benefit: 'saada liikmelisus kohe kinnitatud', criteria: ['Makselehel on valitud paketi summa.', 'Edukal maksmisel kuvatakse kinnitus.', 'Ebaõnnestunud makse korral kuvatakse veateade.'], viewStory: true },
    ],
  }),
  priority: (ctx) => {
    const order = ctx.stories.map((s) => s.id);
    return { message: 'Soovitan alustada paketi loost, sest ilma selleta ei ole töövoogu mõtet kasutada.', order, recommendedStoryId: order[0] || null, reason: 'Paketi hind on eeldus registreerumiseks ja maksmiseks.' };
  },
  criteria: (ctx) => ({
    message: 'Pakun sellele loole kriteeriumid ja mockup’i.',
    storyId: ctx.storyId,
    criteria: ['Paketi hinna juures on märge, kas hind sisaldab käibemaksu.', 'Iga pakett kuvab kestuse kuudes.', 'Pakettide loend sisaldab vähemalt kolme pakketti.'],
    mockup: {
      type: 'page', label: 'Liikmepaketid', children: [
        { type: 'heading', label: 'Vali oma pakett', children: [] },
        { type: 'card', label: 'Põhipakett', children: [
          { type: 'price', label: '30 € / kuu (sh km)', children: [] },
          { type: 'text', label: 'Kestus: 1 kuu', children: [] },
        ] },
        { type: 'card', label: 'Aastapakett', children: [
          { type: 'price', label: '250 € / aasta (sh km)', children: [] },
          { type: 'text', label: 'Kestus: 12 kuud', children: [] },
        ] },
        { type: 'button', label: 'Vali pakett', children: [] },
      ],
    },
  }),
  refine: (ctx) => ({
    message: 'Lisasin hinna juurde käibemaksu märke ja vastava kriteeriumi.',
    storyId: ctx.storyId,
    changes: { criteria: ['Paketi hinna juures on märge, kas hind sisaldab käibemaksu.', 'Iga pakett kuvab kestuse kuudes.', 'Pakettide loend sisaldab vähemalt kolme pakketti.'] },
    mockup: {
      type: 'page', label: 'Liikmepaketid', children: [
        { type: 'card', label: 'Põhipakett', children: [{ type: 'price', label: '30 € / kuu (sh km)', children: [] }] },
        { type: 'button', label: 'Vali pakett', children: [] },
      ],
    },
    otherStoryChanges: [],
  }),
  groom: (ctx) => {
    const findings = [];
    if (ctx.stories.length >= 2) {
      const [a, b] = ctx.stories;
      findings.push({
        kind: 'merge',
        storyIds: [a.id, b.id],
        explanation: 'Need kaks lugu kattuvad sisuliselt (mõlemad puudutavad pakette).',
        stories: [{ role: a.role, action: a.action, benefit: a.benefit, criteria: a.criteria, viewStory: a.viewStory }],
      });
    }
    return { message: 'Leidsin backlog’ist kattuvuse.', findings };
  },
};

async function askAI(task, context) {
  const provider = (process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none')).toLowerCase();
  const system = PROMPTS[task];
  if (!system) {
    throw new Error(`Tundmatu AI ülesanne: ${task}`);
  }
  if (provider === 'none') {
    throw new AiUnavailableError('AI teenus ei ole seadistatud. Käsitsi haldus töötab edasi.');
  }
  if (provider === 'mock') {
    return MOCK[task](context);
  }
  if (provider === 'anthropic') {
    const userText = JSON.stringify(context, null, 2);
    const text = await callAnthropic(system, `Kontekst (JSON):\n${userText}`);
    return extractJson(text);
  }
  throw new Error(`Tundmatu AI_PROVIDER: ${provider}`);
}

module.exports = { askAI, extractJson, AiUnavailableError, PROMPTS };
