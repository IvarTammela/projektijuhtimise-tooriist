'use strict';

// AI kiht. Kõik välise AI teenuse päringud käivad siit ja ainult serveri poolelt.
// Provider valitakse keskkonnamuutujaga AI_PROVIDER: "anthropic" (vaikimisi, kui võti on olemas),
// "mock" (deterministlikud vastused testimiseks) või "none" (AI pole seadistatud).

const { spawn } = require("child_process");
const os = require("os");

const PROMPTS = {
  questions: 'Oled projektijuht. Kliendi idee on umbmäärane. Esita 1–3 täpsustavat küsimust, igaühele 2–4 vastusevarianti. Vasta ainult JSON-iga: {"message": string, "questions": [{"text": string, "options": [string]}]}.',
  roles: 'Pakkusid kasutajarollid projektile. Roll on translatiivis (nt "külastajana", "klubi liikmena"). Vasta ainult JSON-iga: {"message": string, "roles": [string]}.',
  stories: 'Kirjuta kasutajalood Connextra vormis happy path’i järjekorras. Igal loal on role (translatiivis, nt "külastajana"), action (tegevus ilma sõnata soovin, nt näha liikmepakette), benefit (kasu ilma sõnata et, nt valida endale sobiv pakett), criteria (vastuvõtukriteeriumid, igaüks jah/ei kontrollitav üks tingimus) ja viewStory (true, kui lugu puudutab vaadet). Vasta ainult JSON-iga: {"message": string, "stories": [{"role": string, "action": string, "benefit": string, "criteria": [string], "viewStory": boolean}]}.',
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

// AI vastus ei olnud kasutatav JSON. Server näitab selle kohta arusaadavat teadet, mitte tehnilist viga.
class AiInvalidResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiInvalidResponseError';
  }
}

const JSON_RULES = ' Vasta ainult ühe kehtiva JSON-objektiga, ilma selgituste ja koodiplokita. Ära kasuta tekstides tavalisi jutumärke ("), kasuta vajadusel ’ või „ ”.';

// Võtab mudeli vastusest esimese JSON-objekti. Ei usalda, et vastus on puhas JSON.
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AiInvalidResponseError('Vastuses ei ole JSON-objekti.');
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new AiInvalidResponseError(`Vastus ei ole korrektne JSON: ${err.message}`);
  }
}

// Päris teenuse kutse: kui vastus pole korrektne JSON, proovime ühe korra uuesti vea teatega.
async function callWithRetry(call, system, userText) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const hint = attempt === 0 ? '' : `\n\nEelmine vastus ei kõlvanud (${lastError.message}). Vasta uuesti ainult kehtiva JSON-iga.`;
    try {
      return extractJson(await call(system + JSON_RULES, userText + hint));
    } catch (err) {
      if (!(err instanceof AiInvalidResponseError)) throw err;
      lastError = err;
    }
  }
  throw new AiInvalidResponseError('AI vastus ei olnud korrektse kujuga. Proovi uuesti.');
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

// Claude Code käsurea provider: kasutab kasutaja enda sisselogitud Claude Code’i, API võtit pole vaja.
// Töötab tühjas ajutises kaustas ja ilma tööriistadeta, mudelile antakse ainult tekst.
function callClaudeCli(system, userText) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--no-session-persistence", "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch"];
    if (process.env.AI_MODEL) args.push("--model", process.env.AI_MODEL);
    const child = spawn("claude", args, { cwd: os.tmpdir(), shell: process.platform === "win32", windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill(); reject(new AiUnavailableError("Claude Code ei vastanud 2 minuti jooksul.")); }, 120000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", () => { clearTimeout(timer); reject(new AiUnavailableError("Claude Code käsurida ei leitud.")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new AiUnavailableError("Claude Code vastas veaga: " + err.slice(0, 200)));
      resolve(out);
    });
    child.stdin.end(`${system}\n\n${userText}`);
  });
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
  const userText = `Kontekst (JSON):\n${JSON.stringify(context, null, 2)}`;
  if (provider === 'claude-cli') {
    return callWithRetry(callClaudeCli, system, userText);
  }
  if (provider === 'anthropic') {
    return callWithRetry(callAnthropic, system, userText);
  }
  throw new Error(`Tundmatu AI_PROVIDER: ${provider}`);
}

module.exports = { askAI, extractJson, AiUnavailableError, AiInvalidResponseError, PROMPTS };
