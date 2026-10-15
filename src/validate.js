'use strict';

// AI vastuste ja mockup’i struktuuri kontroll. Server ei usalda AI väljundit enne kontrolli.
// Iga funktsioon tagastab {ok: true, value} või {ok: false, error}.

const MAX_TEXT = 500;
const MAX_STORIES = 30;
const MAX_CRITERIA = 12;

const MOCKUP_TYPES = new Set([
  'page', 'heading', 'text', 'button', 'input', 'card', 'price', 'list', 'checkbox', 'nav', 'image',
]);
const MAX_MOCKUP_DEPTH = 6;
const MAX_MOCKUP_NODES = 150;

function fail(error) {
  return { ok: false, error };
}

function isString(v, max = MAX_TEXT) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function validateCriteria(list) {
  if (!Array.isArray(list) || list.length > MAX_CRITERIA) {
    return fail('Kriteeriumid peavad olema loend (kuni 12).');
  }
  for (const c of list) {
    if (!isString(typeof c === 'string' ? c : c && c.text)) {
      return fail('Iga kriteerium peab olema tekst.');
    }
  }
  return { ok: true, value: list.map((c) => (typeof c === 'string' ? c.trim() : c.text.trim())) };
}

// AI lisab vahel tegevuse ette "soovin"/"tahan" ja kasu ette "et", aga pealkiri lisab need ise.
function cleanAction(text) {
  return text.trim().replace(/^(soovin|tahan)\s+/i, '');
}

function cleanBenefit(text) {
  return text.trim().replace(/^et\s+/i, '');
}

function validateStory(s) {
  if (!s || typeof s !== 'object') {
    return fail('Lugu peab olema objekt.');
  }
  if (!isString(s.role, 60) || !isString(s.action) || !isString(s.benefit)) {
    return fail('Lool peavad olema role, action ja benefit tekstina.');
  }
  const criteria = validateCriteria(s.criteria || []);
  if (!criteria.ok) {
    return criteria;
  }
  return {
    ok: true,
    value: {
      role: s.role.trim(),
      action: cleanAction(s.action),
      benefit: cleanBenefit(s.benefit),
      criteria: criteria.value,
      viewStory: Boolean(s.viewStory),
      size: ['S', 'M', 'L'].includes(s.size) ? s.size : 'M',
    },
  };
}

function validateStories(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_STORIES) {
    return fail(`Lugude loend peab olema 1–${MAX_STORIES} elemendi pikkune.`);
  }
  const out = [];
  for (const s of list) {
    const v = validateStory(s);
    if (!v.ok) {
      return v;
    }
    out.push(v.value);
  }
  return { ok: true, value: out };
}

function validateRoles(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > 8) {
    return fail('Rolle peab olema 1–8.');
  }
  for (const r of list) {
    if (!isString(r, 60)) {
      return fail('Roll peab olema lühike tekst.');
    }
  }
  return { ok: true, value: list.map((r) => r.trim()) };
}

// Mockup: puu komponentidest. Tüübid on valge nimekiri, mitte suvaline HTML.
function validateMockupNode(node, depth, counter) {
  counter.n += 1;
  if (counter.n > MAX_MOCKUP_NODES) {
    return fail('Mockup on liiga suur.');
  }
  if (depth > MAX_MOCKUP_DEPTH) {
    return fail('Mockup on liiga sügav.');
  }
  if (!node || typeof node !== 'object' || !MOCKUP_TYPES.has(node.type)) {
    return fail(`Tundmatu mockup’i komponent: ${node && node.type}`);
  }
  const label = node.label === undefined ? '' : String(node.label).slice(0, MAX_TEXT);
  const children = [];
  for (const child of node.children || []) {
    const v = validateMockupNode(child, depth + 1, counter);
    if (!v.ok) {
      return v;
    }
    children.push(v.value);
  }
  return { ok: true, value: { type: node.type, label, children } };
}

function validateMockup(root) {
  return validateMockupNode(root, 0, { n: 0 });
}

module.exports = {
  validateStories,
  validateStory,
  validateRoles,
  validateCriteria,
  validateMockup,
  MOCKUP_TYPES,
};
