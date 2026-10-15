'use strict';

// Brauseri pool. Kõik andmed tulevad serverist. Mockup’i komponendid kuvatakse ainult tekstina
// (textContent), mitte HTML-ina, seega ei saa AI väljund brauseris koodi käivitada.

const state = {
  projects: [],
  view: null,
  selectedStoryId: null,
  // Kasutaja muudatused ettepanekutes, enne kinnitamist. Võti on ettepaneku id.
  drafts: {},
  error: null,
  busy: false,
};

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else if (key === 'onchange') node.addEventListener('change', value);
    else if (key === 'oninput') node.addEventListener('input', value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'disabled') node.disabled = Boolean(value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Viga (${res.status})`);
    err.missing = data.missing;
    err.aiUnavailable = data.aiUnavailable;
    throw err;
  }
  return data;
}

// Käivitab tegevuse: näitab kõikide tegevuste ajal laadimist ja vigu.
async function run(fn) {
  state.busy = true;
  state.error = null;
  render();
  try {
    await fn();
  } catch (err) {
    state.error = err.message + (err.missing ? ' ' + err.missing.join(' ') : '');
  } finally {
    state.busy = false;
    render();
  }
}

async function loadProjects() {
  state.projects = await api('GET', '/api/projects');
}

async function openProject(id) {
  state.view = await api('GET', `/api/projects/${id}`);
  state.selectedStoryId = null;
  state.drafts = {};
  renderSidebar();
  render();
}

function setView(view) {
  state.view = view;
  renderSidebar();
  render();
}

// ---- Külgriba ----

function renderSidebar() {
  const list = $('#project-list');
  list.replaceChildren(...state.projects.map((p) => el('li', {}, [
    el('button', {
      class: state.view && state.view.id === p.id ? 'primary' : '',
      onclick: () => run(async () => { await openProject(p.id); }),
    }, p.name),
  ])));
}

$('#new-project').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const body = { name: form.name.value, description: form.description.value };
  run(async () => {
    const view = await api('POST', '/api/projects', body);
    form.reset();
    await loadProjects();
    setView(view);
    // Vestlus algab ise: AI esitab kohe täpsustavad küsimused.
    const res = await api('POST', `/api/projects/${view.id}/ai`, { task: 'questions' });
    setView(res.project);
  });
});

// ---- Pealvaade ----

function render() {
  const main = $('#main');
  if (!state.view) {
    main.replaceChildren(el('p', { class: 'muted' }, 'Vali projekt või loo uus.'));
    return;
  }
  const v = state.view;
  // replaceChildren kirjutaks null-i tekstina "null", seega filtreerime tühjad lapsed välja.
  main.replaceChildren(...[
    el('h2', {}, v.name),
    v.description ? el('p', { class: 'muted' }, v.description) : null,
    renderStageBar(v),
    state.error ? el('p', { class: 'error' }, state.error) : null,
    el('div', { class: 'layout' }, [
      renderChat(v),
      renderBacklog(v),
    ]),
    renderMockupPanel(v),
  ].filter(Boolean));
}

function renderStageBar(v) {
  const currentIndex = v.stages.findIndex((s) => s.key === v.stage);
  return el('div', { class: 'stagebar' }, v.stages.map((s, i) => el('button', {
    class: [i === currentIndex ? 'current' : '', i < currentIndex ? 'done' : ''].join(' ').trim(),
    disabled: state.busy,
    onclick: () => run(async () => setView(await api('PUT', `/api/projects/${v.id}/stage`, { stage: s.key }))),
  }, s.label)));
}

// ---- Vestlus ----

function renderChat(v) {
  // Juba kinnitatud küsimustiku vastused jäävad vestlusesse nähtavale.
  const answered = v.answers.filter((a) => a.answer).flatMap((a) => [
    el('div', { class: 'msg ai' }, a.question),
    el('div', { class: 'msg user' }, a.answer),
  ]);
  const messages = [
    ...v.messages.map((m) => el('div', { class: `msg ${m.role}` }, m.text || '(tühi)')),
    ...answered,
  ];
  const proposals = v.proposals.map((p) => renderProposal(v, p));
  const next = el('div', { class: 'next' }, v.nextSteps.map((step) => el('button', {
    disabled: state.busy,
    onclick: () => run(async () => runStep(v, step)),
  }, step.label)));

  const textarea = el('textarea', { id: 'chat-input', rows: 2, placeholder: 'Kirjuta vabalt (kliendi vastus, täpsustus, küsimus)' });
  const sendBtn = el('button', {
    class: 'primary',
    disabled: state.busy,
    onclick: () => {
      const text = textarea.value.trim();
      if (!text) return;
      // Kui küsimustik on pooleli, on vabatekst vastus jooksvale küsimusele.
      const open = pendingQuestionnaire(v);
      if (open) {
        answerQuestion(v, open.p, open.d, open.idx, text);
        return;
      }
      run(async () => {
        await api('POST', `/api/projects/${v.id}/messages`, { text });
        setView(await api('POST', `/api/projects/${v.id}/ai`, { text }));
      });
    },
  }, 'Saada');

  return el('div', { class: 'panel' }, [
    el('h3', {}, 'Juhitud vestlus'),
    el('div', {}, messages.length ? messages : [el('p', { class: 'muted' }, 'Alusta järgmise sammuga.')]),
    ...proposals,
    el('h3', {}, 'Järgmine samm'),
    next,
    el('div', { class: 'row' }, [textarea, sendBtn]),
  ]);
}

async function runStep(v, step) {
  if (step.action.type === 'stage') {
    return setView(await api('PUT', `/api/projects/${v.id}/stage`, { stage: step.action.stage }));
  }
  // Loo-põhised sammud vajavad valitud lugu; kui kasutaja ei valinud, võtame backlog’i esimese.
  const needsStory = ['criteria', 'refine'].includes(step.action.task);
  if (needsStory && !state.selectedStoryId && v.stories.length) {
    state.selectedStoryId = v.stories[0].id;
  }
  const storyId = needsStory ? state.selectedStoryId || undefined : undefined;
  const res = await api('POST', `/api/projects/${v.id}/ai`, { task: step.action.task, storyId });
  setView(res.project);
}

// Vastab ühele küsimustiku küsimusele. Kui kõik küsimused on vastatud, kinnitatakse vastused
// ja vestlus pakub järgmise sammu.
function answerQuestion(v, p, d, idx, answer) {
  d.questions[idx].answer = answer;
  if (d.questions.some((q) => !q.answer)) {
    render();
    return;
  }
  run(async () => {
    setView(await api('POST', `/api/projects/${v.id}/apply`, { proposalId: p.id, edited: { questions: d.questions } }));
    delete state.drafts[p.id];
  });
}

// Leiab ootel küsimustiku, kus on vastamata küsimus. Vabatekst vestluskastist vastab sellele.
function pendingQuestionnaire(v) {
  const p = v.proposals.find((x) => x.task === 'questions');
  if (!p) return null;
  const d = draftOf(p);
  const idx = d.questions.findIndex((q) => !q.answer);
  return idx === -1 ? null : { p, d, idx };
}

// Ettepanekud. Kasutaja muudab koopiat (drafts), kinnitab või loobub.
function draftOf(p) {
  if (!state.drafts[p.id]) state.drafts[p.id] = JSON.parse(JSON.stringify(p.payload));
  return state.drafts[p.id];
}

function proposalActions(v, p, edited) {
  return el('div', { class: 'row' }, [
    el('button', {
      class: 'primary',
      disabled: state.busy,
      onclick: () => run(async () => {
        setView(await api('POST', `/api/projects/${v.id}/apply`, { proposalId: p.id, edited }));
        delete state.drafts[p.id];
      }),
    }, 'Kinnita'),
    el('button', {
      disabled: state.busy,
      onclick: () => run(async () => {
        setView(await api('POST', `/api/projects/${v.id}/reject`, { proposalId: p.id }));
        delete state.drafts[p.id];
      }),
    }, 'Loobu'),
  ]);
}

function renderProposal(v, p) {
  const d = draftOf(p);
  const title = { questions: 'Täpsustavad küsimused', roles: 'Rollid', stories: 'Kasutajalood', priority: 'Prioriteedid', criteria: 'Kriteeriumid ja mockup', refine: 'Kliendi täpsustus', groom: 'Groomimine' }[p.task] || p.task;
  const body = [];

  if (p.task === 'questions') {
    // Chati-põhine küsimustik: küsimused tulevad ükshaaval, vastus läheb vestlusesse.
    d.questions.forEach((q) => {
      if (q.answer) {
        body.push(el('div', { class: 'msg ai' }, q.text));
        body.push(el('div', { class: 'msg user' }, q.answer));
      }
    });
    const idx = d.questions.findIndex((q) => !q.answer);
    if (idx !== -1) {
      const q = d.questions[idx];
      body.push(el('div', { class: 'msg ai' }, q.text));
      body.push(el('div', { class: 'chips' }, [
        ...q.options.map((o) => el('button', { disabled: state.busy, onclick: () => answerQuestion(v, p, d, idx, o) }, o)),
        el('button', { disabled: state.busy, onclick: () => {
          const box = document.querySelector('#chat-input');
          if (box) { box.placeholder = 'Kirjuta oma vastus ja vajuta Saada'; box.focus(); }
        } }, 'Muu (kirjutan ise)'),
        el('button', { disabled: state.busy, onclick: () => answerQuestion(v, p, d, idx, '(vahele jäetud)') }, 'Jäta vahele'),
      ]));
    }
  }

  if (p.task === 'roles') {
    const input = el('input', { type: 'text', placeholder: 'Lisa roll (nt külastajana)' });
    body.push(el('div', { class: 'chips' }, d.roles.map((r, i) => el('button', {
      onclick: () => { d.roles.splice(i, 1); render(); },
      title: 'Eemalda',
    }, `${r} ×`))));
    body.push(el('div', { class: 'row' }, [input, el('button', {
      onclick: () => {
        const val = input.value.trim();
        if (val) { d.roles.push(val); render(); }
      },
    }, 'Lisa')]));
    body.push(proposalActions(v, p, { roles: d.roles }));
  }

  if (p.task === 'stories') {
    d.stories.forEach((s, i) => {
      const include = d.included ? d.included[i] !== false : true;
      const cb = el('input', { type: 'checkbox', checked: include, onchange: (e) => {
        d.included = d.included || d.stories.map(() => true);
        d.included[i] = e.target.checked;
      } });
      body.push(el('div', { class: 'card-item' }, [
        el('label', {}, [cb, ' ', `${s.role} soovin ${s.action}, et ${s.benefit}`]),
        el('ul', {}, s.criteria.map((c) => el('li', {}, c))),
      ]));
    });
    body.push(el('div', { class: 'row' }, [
      el('button', { class: 'primary', disabled: state.busy, onclick: () => run(async () => {
        const chosen = d.stories.filter((_, i) => !d.included || d.included[i] !== false);
        setView(await api('POST', `/api/projects/${v.id}/apply`, { proposalId: p.id, edited: { stories: chosen } }));
        delete state.drafts[p.id];
      }) }, 'Lisa valitud backlog’i'),
      el('button', { disabled: state.busy, onclick: () => run(async () => {
        setView(await api('POST', `/api/projects/${v.id}/apply`, { proposalId: p.id, edited: {} }));
        delete state.drafts[p.id];
      }) }, 'Lisa kõik'),
      el('button', { disabled: state.busy, onclick: () => run(async () => {
        await api('POST', `/api/projects/${v.id}/reject`, { proposalId: p.id });
        const res = await api('POST', `/api/projects/${v.id}/ai`, { task: 'stories' });
        setView(res.project);
      }) }, 'Paku teistsuguseid'),
    ]));
  }

  if (p.task === 'priority') {
    body.push(el('p', {}, d.reason));
    const ordered = d.order.map((id) => v.stories.find((s) => s.id === id)).filter(Boolean);
    body.push(el('ol', {}, ordered.map((s) => el('li', {}, s.title))));
    // Kasutaja saab valida teise loo alustamiseks; valik tõstab loo järjestuses esimeseks.
    body.push(el('div', { class: 'row' }, [
      el('label', {}, 'Alusta loost:'),
      el('select', { onchange: (e) => {
        d.order = [e.target.value, ...d.order.filter((id) => id !== e.target.value)];
        render();
      } }, ordered.map((s) => el('option', { value: s.id, selected: d.order[0] === s.id }, s.title))),
    ]));
    body.push(proposalActions(v, p, { order: d.order }));
  }

  if (p.task === 'criteria' || p.task === 'refine') {
    const story = v.stories.find((s) => s.id === d.storyId);
    if (story) body.push(el('p', {}, `Lugu: ${story.title}`));
    const crit = d.criteria || (d.changes && d.changes.criteria) || [];
    const list = d.criteria ? d : d.changes;
    // Kriteeriume saab muuta, eemaldada ja lisada enne kinnitamist.
    body.push(el('div', { class: 'card-item' }, [
      el('strong', {}, 'Kriteeriumid (muuda vajadusel)'),
      ...crit.map((c, i) => el('div', { class: 'row' }, [
        el('input', { type: 'text', value: c, oninput: (e) => { list.criteria ? list.criteria[i] = e.target.value : null; } }),
        el('button', { onclick: () => { list.criteria.splice(i, 1); render(); } }, '✗'),
      ])),
      el('button', { onclick: () => {
        if (!list.criteria) list.criteria = [];
        list.criteria.push('Uus kriteerium');
        render();
      } }, 'Lisa kriteerium'),
    ]));
    if (d.mockup) {
      body.push(el('div', { class: 'mock' }, [el('strong', {}, 'Mockup (eelvaade)'), renderMockupTree(d.mockup)]));
    }
    if (d.otherStoryChanges && d.otherStoryChanges.length) {
      body.push(el('p', { class: 'muted' }, 'Teisi lugusid mõjutavad muudatused on eraldi ettepanekutena: ' + d.otherStoryChanges.map((o) => o.description).join('; ')));
    }
    body.push(proposalActions(v, p, p.task === 'criteria' ? { criteria: d.criteria, mockup: d.mockup } : { changes: d.changes, mockup: d.mockup }));
  }

  if (p.task === 'groom') {
    d.findings.forEach((f, i) => {
      if (f.applied) {
        body.push(el('p', { class: 'muted' }, `✓ ${f.kind}: ${f.explanation} (${f.ignored ? 'ignoreeritud' : 'rakendatud'})`));
        return;
      }
      body.push(el('div', { class: 'card-item' }, [
        el('strong', {}, `${f.kind === 'split' ? 'Jaga' : f.kind === 'merge' ? 'Ühenda' : 'Märgi'}`),
        el('p', {}, f.explanation),
        f.stories.length ? el('ul', {}, f.stories.map((s) => el('li', {}, `${s.role} soovin ${s.action}, et ${s.benefit}`))) : null,
        el('div', { class: 'row' }, [
          el('button', { class: 'primary', disabled: state.busy, onclick: () => run(async () => {
            setView(await api('POST', `/api/projects/${v.id}/apply`, { proposalId: p.id, edited: { findingIndex: i } }));
          }) }, 'Rakenda'),
          el('button', { disabled: state.busy, onclick: () => run(async () => {
            setView(await api('POST', `/api/projects/${v.id}/apply`, { proposalId: p.id, edited: { findingIndex: i, ignore: true } }));
          }) }, 'Ignoreeri'),
        ]),
      ]));
    });
    body.push(el('div', { class: 'row' }, [
      el('button', { disabled: state.busy, onclick: () => run(async () => {
        await api('POST', `/api/projects/${v.id}/reject`, { proposalId: p.id });
        setView(await api('GET', `/api/projects/${v.id}`));
      }) }, 'Sulge leiud'),
    ]));
  }

  return el('div', { class: 'proposal' }, [el('strong', {}, title), el('p', {}, p.payload.message || ''), ...body]);
}

// ---- Backlog ----

function renderBacklog(v) {
  const rows = v.stories.map((s, i) => el('tr', {
    class: s.id === state.selectedStoryId ? 'selected' : '',
  }, [
    el('td', {}, [
      el('button', { onclick: () => run(async () => setView(await api('PUT', `/api/projects/${v.id}/order`, {
        order: moved(v.stories, i, -1).map((x) => x.id),
      }))), disabled: i === 0 || state.busy }, '▲'),
      el('button', { onclick: () => run(async () => setView(await api('PUT', `/api/projects/${v.id}/order`, {
        order: moved(v.stories, i, 1).map((x) => x.id),
      }))), disabled: i === v.stories.length - 1 || state.busy }, '▼'),
    ]),
    el('td', {}, [
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); state.selectedStoryId = s.id; render(); } }, s.title),
      s.mvp ? el('span', { class: 'mvp' }, ' · MVP') : null,
      s.openQuestions.length ? el('p', { class: 'missing' }, 'Avatud: ' + s.openQuestions.join('; ')) : null,
      el('div', { class: 'muted' }, `${s.criteria.length} kriteeriumi · ${s.origin}`),
    ]),
    el('td', {}, [
      el('select', { onchange: (e) => run(async () => setView(await api('PATCH', `/api/projects/${v.id}/stories/${s.id}`, { status: e.target.value }))) },
        ['Idee', 'Vajab täpsustamist', 'Läbivaadatud', 'Valmis arenduseks'].map((st) => el('option', { value: st, selected: st === s.status }, st))),
      s.ready.ok ? el('span', { class: 'badge ok' }, 'Valmis') : el('span', { class: 'badge warn' }, 'Puudu'),
      s.ready.ok ? null : el('ul', { class: 'missing' }, s.ready.missing.map((m) => el('li', {}, m))),
    ]),
    el('td', {}, [
      el('button', { onclick: () => run(async () => setView(await api('PUT', `/api/projects/${v.id}/mvp`, { storyId: s.mvp && v.mvpStoryId === s.id ? null : s.id }))), disabled: state.busy }, v.mvpStoryId === s.id ? 'Eemalda MVP' : 'MVP joon siia'),
      el('button', { onclick: () => {
        const q = prompt('Avatud küsimus (tühi = tühista):');
        if (q === null) return;
        run(async () => setView(await api('PATCH', `/api/projects/${v.id}/stories/${s.id}`, { openQuestions: q.trim() ? [...s.openQuestions, q.trim()] : s.openQuestions, status: q.trim() ? 'Vajab täpsustamist' : undefined })));
      } }, 'Täpsusta'),
      el('button', { onclick: () => {
        if (!confirm('Kustutada lugu?')) return;
        run(async () => setView(await api('DELETE', `/api/projects/${v.id}/stories/${s.id}`)));
      } }, 'Kustuta'),
    ]),
  ]));

  return el('div', { class: 'panel' }, [
    el('h3', {}, 'Rollid'),
    el('p', { class: 'muted' }, v.roles.length ? v.roles.join(', ') : 'Rolle pole veel määratud.'),
    el('h3', {}, 'Backlog'),
    v.stories.length ? el('table', {}, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Järjekord'), el('th', {}, 'Lugu'), el('th', {}, 'Staatus'), el('th', {}, 'Tegevused')])),
      el('tbody', {}, rows),
    ]) : el('p', { class: 'muted' }, 'Backlog on tühi.'),
    renderManualStory(v),
    el('div', { class: 'row' }, [
      el('button', { disabled: !v.canUndo || state.busy, onclick: () => run(async () => setView(await api('POST', `/api/projects/${v.id}/undo`))) }, 'Võta viimane muudatus tagasi'),
    ]),
  ]);
}

function moved(list, i, delta) {
  const copy = [...list];
  const j = i + delta;
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function renderManualStory(v) {
  const role = el('input', { type: 'text', placeholder: 'roll (nt külastajana)' });
  const action = el('input', { type: 'text', placeholder: 'tegevus (soovin …)' });
  const benefit = el('input', { type: 'text', placeholder: 'kasu (et …)' });
  const crit = el('textarea', { rows: 3, placeholder: 'Kriteeriumid, üks rea kohta' });
  return el('details', {}, [
    el('summary', {}, 'Lisa lugu käsitsi'),
    role, action, benefit, crit,
    el('button', { disabled: state.busy, onclick: () => run(async () => {
      const criteria = crit.value.split('\n').map((c) => c.trim()).filter(Boolean);
      setView(await api('POST', `/api/projects/${v.id}/stories`, { role: role.value, action: action.value, benefit: benefit.value, criteria, viewStory: false, size: 'M' }));
    }) }, 'Lisa'),
  ]);
}

// ---- Mockup ----

function renderMockupPanel(v) {
  const story = v.stories.find((s) => s.id === state.selectedStoryId);
  if (!story) {
    return el('div', { class: 'panel', style: 'margin-top:16px' }, el('p', { class: 'muted' }, 'Vali backlog’ist lugu, et näha mockup’i ja anda kliendi täpsustus.'));
  }
  const mockup = v.mockups.find((m) => m.storyId === story.id);
  const latest = mockup ? mockup.versions[mockup.versions.length - 1] : null;
  const input = el('textarea', { rows: 2, placeholder: 'Kliendi täpsustus selle loo kohta' });
  return el('div', { class: 'panel', style: 'margin-top:16px' }, [
    el('h3', {}, story.title),
    latest ? el('div', {}, [
      el('p', { class: 'muted' }, `Versioon ${mockup.versions.length} (${new Date(latest.createdAt).toLocaleString('et-EE')})`),
      renderMockupTree(latest.root),
    ]) : el('p', { class: 'muted' }, 'Mockup’i pole veel.'),
    el('div', { class: 'row' }, [input, el('button', {
      class: 'primary',
      disabled: state.busy,
      onclick: () => {
        const text = input.value.trim();
        if (!text) return;
        run(async () => {
          const res = await api('POST', `/api/projects/${v.id}/ai`, { task: 'refine', storyId: story.id, text });
          setView(res.project);
        });
      },
    }, 'Küsi muudatusettepanekut')]),
  ]);
}

// Komponendid tekstina ja kindla märgendiga. Ei kasutata innerHTML-i.
function renderMockupTree(node) {
  const children = (node.children || []).map(renderMockupTree);
  switch (node.type) {
    case 'page': return el('div', { class: 'mock-page' }, [el('strong', {}, node.label), ...children]);
    case 'heading': return el('h3', {}, node.label);
    case 'text': return el('p', {}, node.label);
    case 'button': return el('button', { class: 'mock-button', disabled: true }, node.label);
    case 'input': return el('input', { placeholder: node.label, disabled: true });
    case 'card': return el('div', { class: 'mock-card' }, [el('strong', {}, node.label), ...children]);
    case 'price': return el('div', { class: 'mock-price' }, node.label);
    case 'list': return el('ul', {}, [el('li', {}, node.label), ...children.map((c) => el('li', {}, c))]);
    case 'checkbox': return el('label', {}, [el('input', { type: 'checkbox', disabled: true }), ' ', node.label]);
    case 'nav': return el('nav', {}, node.label);
    case 'image': return el('div', { class: 'muted' }, `[pilt: ${node.label}]`);
    default: return el('span', {}, node.label);
  }
}

// ---- Algseis ----

run(async () => {
  await loadProjects();
  renderSidebar();
});
