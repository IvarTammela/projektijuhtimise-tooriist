'use strict';

const fs = require('fs');
const path = require('path');

// Lihtne püsiv salvestus: kõik projektid ühes JSON-failis.
// Kirjutamine käib ajutise faili kaudu, et katkestus ei rikuks olemasolevat andmefaili.
function createStore(filePath) {
  const dir = path.dirname(filePath);

  function readAll() {
    if (!fs.existsSync(filePath)) {
      return { projects: [] };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : { projects: [] };
  }

  function writeAll(data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    list() {
      return readAll().projects;
    },
    get(id) {
      return readAll().projects.find((p) => p.id === id) || null;
    },
    // Uuendab projekti funktsiooniga. Funktsioon saab projekti muuta ja tagastada (või mitte).
    update(id, mutate) {
      const data = readAll();
      const project = data.projects.find((p) => p.id === id);
      if (!project) {
        return null;
      }
      mutate(project);
      writeAll(data);
      return project;
    },
    insert(project) {
      const data = readAll();
      data.projects.push(project);
      writeAll(data);
      return project;
    },
  };
}

module.exports = { createStore };
