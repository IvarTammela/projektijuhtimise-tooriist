'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { createStore } = require('./store');
const service = require('./service');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

// Lae .env, kui see on olemas. Keskkonnamuutuja on alati tähtsam kui fail.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 200_000) {
        reject(new service.ValidationError('Päring on liiga suur.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new service.ValidationError('Päring ei ole korrektne JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Ei leitud');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

// Vastuse kuju vigade korral: arusaadav teade, mitte katkine vaade.
function handleError(res, err) {
  if (err instanceof service.ValidationError) {
    return send(res, 400, { error: err.message, missing: err.missing });
  }
  if (err instanceof service.AiInvalidResponseError) {
    return send(res, 502, { error: err.message });
  }
  if (err instanceof service.AiUnavailableError) {
    return send(res, 503, { error: err.message, aiUnavailable: true });
  }
  console.error(err);
  return send(res, 500, { error: 'Serveris tekkis viga.' });
}

function createApp({ dataFile }) {
  const store = createStore(dataFile);

  // Käivitab muudatuse projektis ja tagastab uue vaate. Vead lähevad handleError-ile.
  function withProject(id, fn) {
    const project = store.get(id);
    if (!project) {
      throw Object.assign(new service.ValidationError('Projekti ei leitud.'), { status: 404 });
    }
    const updated = store.update(id, (p) => {
      fn(p);
    });
    return service.view(updated);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method;

    if (parts[0] !== 'api') {
      return serveStatic(req, res, url.pathname);
    }

    if (parts[1] === 'projects' && parts.length === 2) {
      if (method === 'GET') {
        return send(res, 200, store.list().map((p) => ({ id: p.id, name: p.name, stage: p.stage, createdAt: p.createdAt })));
      }
      if (method === 'POST') {
        const body = await readBody(req);
        const project = service.createProject(body);
        store.insert(project);
        return send(res, 201, service.view(project));
      }
    }

    if (parts[1] !== 'projects' || !parts[2]) {
      return send(res, 404, { error: 'Ei leitud.' });
    }
    const pid = parts[2];
    const sub = parts[3];
    const sid = parts[4];

    if (!sub && method === 'GET') {
      const project = store.get(pid);
      if (!project) return send(res, 404, { error: 'Projekti ei leitud.' });
      return send(res, 200, service.view(project));
    }

    const body = method === 'GET' ? {} : await readBody(req);

    if (sub === 'ai' && method === 'POST') {
      const project = store.get(pid);
      if (!project) return send(res, 404, { error: 'Projekti ei leitud.' });
      const task = body.task || service.STAGE_TASK[project.stage];
      if (task !== 'chat' && !Object.values(service.STAGE_TASK).includes(task)) {
        throw new service.ValidationError('Tundmatu AI ülesanne.');
      }
      // AI päring on aeglane, seega muudame koopiat ja salvestame alles pärast vastust.
      const draft = clone(project);
      const proposal = await service.propose(draft, task, { storyId: body.storyId, text: body.text });
      const saved = store.update(pid, (p) => Object.assign(p, draft));
      return send(res, 200, { proposal, project: service.view(saved) });
    }

    if (sub === 'apply' && method === 'POST') {
      return send(res, 200, withProject(pid, (p) => service.apply(p, body.proposalId, body.edited || {})));
    }

    if (sub === 'reject' && method === 'POST') {
      return send(res, 200, withProject(pid, (p) => service.reject(p, body.proposalId)));
    }

    if (sub === 'undo' && method === 'POST') {
      return send(res, 200, withProject(pid, (p) => service.undo(p)));
    }

    if (sub === 'answer' && method === 'POST') {
      return send(res, 200, withProject(pid, (p) => {
        const entry = p.answers.find((a) => a.question === body.question);
        if (!entry) throw new service.ValidationError('Küsimust ei leitud.');
        entry.answer = String(body.answer || '(vahele jäetud)').slice(0, 500);
      }));
    }

    // Backlog’i eksport Markdowni või CSV-sse (lisavõimalus).
    if (sub === 'export' && method === 'GET') {
      const project = store.get(pid);
      if (!project) return send(res, 404, { error: 'Projekti ei leitud.' });
      const v = service.view(project);
      const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'md';
      const text = format === 'csv' ? exportCsv(v) : exportMarkdown(v);
      res.writeHead(200, {
        'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="backlog.${format}"`,
      });
      return res.end(`﻿${text}`);
    }

    if (sub === 'idea' && method === 'PUT') {
      return send(res, 200, withProject(pid, (p) => {
        const text = String(body.text || '').trim();
        if (!text) throw new service.ValidationError('Idee kirjeldus ei tohi olla tühi.');
        p.description = text.slice(0, 2000);
      }));
    }

    if (sub === 'messages' && method === 'POST') {
      return send(res, 200, withProject(pid, (p) => {
        const text = String(body.text || '').trim();
        if (!text) throw new service.ValidationError('Sõnum ei tohi olla tühi.');
        p.messages.push({ role: 'user', text: text.slice(0, 2000), ts: new Date().toISOString() });
      }));
    }

    if (sub === 'stage' && method === 'PUT') {
      const key = body.stage;
      if (!service.STAGES.some((s) => s.key === key)) throw new service.ValidationError('Tundmatu etapp.');
      return send(res, 200, withProject(pid, (p) => {
        service.snapshot(p);
        p.stage = key;
      }));
    }

    if (sub === 'roles' && method === 'PUT') {
      return send(res, 200, withProject(pid, (p) => {
        service.snapshot(p);
        const list = (body.roles || []).map((r) => String(r).trim()).filter(Boolean);
        if (list.length === 0) throw new service.ValidationError('Vaja on vähemalt üks roll.');
        p.roles = list.slice(0, 8);
      }));
    }

    if (sub === 'stories' && !sid && method === 'POST') {
      return send(res, 201, withProject(pid, (p) => service.addStoryManually(p, body)));
    }

    if (sub === 'stories' && sid && method === 'PATCH') {
      return send(res, 200, withProject(pid, (p) => service.updateStory(p, sid, body)));
    }

    if (sub === 'stories' && sid && method === 'DELETE') {
      return send(res, 200, withProject(pid, (p) => service.removeStory(p, sid)));
    }

    if (sub === 'mockups' && sid && parts[5] === 'restore' && method === 'POST') {
      return send(res, 200, withProject(pid, (p) => service.restoreMockupVersion(p, sid, body.versionId)));
    }

    if (sub === 'order' && method === 'PUT') {
      return send(res, 200, withProject(pid, (p) => service.setOrder(p, body.order)));
    }

    if (sub === 'mvp' && method === 'PUT') {
      return send(res, 200, withProject(pid, (p) => service.setMvp(p, body.storyId === undefined ? null : body.storyId)));
    }

    return send(res, 404, { error: 'Ei leitud.' });
  }

  return http.createServer((req, res) => {
    route(req, res).catch((err) => {
      if (err && err.status === 404) return send(res, 404, { error: err.message });
      handleError(res, err);
    });
  });
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function exportMarkdown(v) {
  const lines = [`# ${v.name}`, '', v.description, '', '## Backlog', ''];
  v.stories.forEach((s) => {
    lines.push(`### ${s.code}${s.mvp ? ' (MVP)' : ''}: ${s.title}`, `Staatus: ${s.status} · Suurus: ${s.size} · Päritolu: ${s.origin}`, '');
    s.criteria.forEach((c) => lines.push(`- ${c.text}`));
    lines.push('');
  });
  return lines.join('\n');
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function exportCsv(v) {
  const rows = [['Kood', 'MVP', 'Pealkiri', 'Staatus', 'Suurus', 'Päritolu', 'Kriteeriumid']];
  v.stories.forEach((s) => rows.push([s.code, s.mvp ? 'jah' : '', s.title, s.status, s.size, s.origin, s.criteria.map((c) => c.text).join(' | ')]));
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

if (require.main === module) {
  loadEnvFile(path.join(ROOT, '.env'));
  const port = Number(process.env.PORT) || 3000;
  const dataFile = path.join(ROOT, 'data', 'db.json');
  createApp({ dataFile }).listen(port, () => {
    console.log(`Projektijuhtimise tööriist: http://localhost:${port}`);
    console.log(`AI provider: ${process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none')}`);
  });
}

module.exports = { createApp, loadEnvFile };
