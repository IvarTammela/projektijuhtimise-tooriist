'use strict';

// Reeglipõhised kontrollid. Need ei vaja AI-d, seega töötavad ka siis, kui AI teenus pole kättesaadav.

// Hinnangulised sõnad: kriteerium, mis sisaldab neist ühte, ei ole jah/ei kontrollitav.
// Võrdlus käib tüvede järgi, et "kasutajasõbralik" ja "kasutajasõbralikult" mõlemad tabaksid.
const VAGUE_STEMS = [
  'kasutajasõbr', 'kiire', 'kiiresti', 'lihtne', 'lihtsalt', 'lihtsa',
  'mugav', 'intuitiiv', 'selge', 'selgelt', 'selgel', 'ilus',
  'meeldiv', 'sujuv', 'mõistlik', 'piisav',
];

// Sõnad, mis ühendavad kaks tingimust ühte kriteeriumi.
const MULTI_CONDITION_PATTERN = /\s(ja|ning)\s|;/i;

function cap(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Connextra pealkiri: "Külastajana soovin ..., et ...".
// Rolli, tegevust ja kasu hoitakse eraldi väljadena, pealkiri tuletatakse neist.
function buildTitle({ role, action, benefit }) {
  return `${cap(role)} soovin ${action}, et ${benefit}`;
}

function isConnextraComplete(story) {
  return Boolean(story.role && story.action && story.benefit);
}

// Kontrollib ühte kriteeriumi. Tagastab listi probleemidest; tühi list = kriteerium on korras.
function checkCriterion(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) {
    return ['Kriteerium on tühi.'];
  }
  const problems = [];
  const vague = VAGUE_STEMS.filter((stem) => lower.includes(stem));
  if (vague.length > 0) {
    problems.push(`Hinnanguline sõna (${vague.join(', ')}), mida ei saa jah/ei kontrollida.`);
  }
  if (MULTI_CONDITION_PATTERN.test(` ${lower} `)) {
    problems.push('Kriteerium ühendab mitu tingimust. Jaga need eraldi kriteeriumideks.');
  }
  return problems;
}

// Valmisoleku definitsioon (Definition of Ready). Tagastab {ok, missing}.
function checkReady(story, { hasMockup }) {
  const missing = [];
  if (!isConnextraComplete(story)) {
    missing.push('Pealkiri ei ole Connextra vormis (roll, tegevus ja kasu on kõik vaja).');
  }
  const criteria = story.criteria || [];
  if (criteria.length < 3) {
    missing.push(`Kriteeriume on ${criteria.length}, vaja on vähemalt 3.`);
  }
  criteria.forEach((c, i) => {
    const problems = checkCriterion(c.text);
    if (problems.length > 0) {
      missing.push(`Kriteerium ${i + 1} ei ole kontrollitav: ${problems[0]}`);
    }
  });
  if (story.viewStory && !hasMockup) {
    missing.push('Vaadet puudutav lugu vajab mockup’i.');
  }
  if ((story.openQuestions || []).length > 0) {
    missing.push(`Avatud küsimusi on ${story.openQuestions.length}.`);
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  buildTitle,
  isConnextraComplete,
  checkCriterion,
  checkReady,
  VAGUE_STEMS,
};
