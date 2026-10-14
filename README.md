# Projektijuhtimise tööriist

AI-põhine veebirakendus, mis aitab muuta kliendi umbmääral idee kasutajalugudeks, vastuvõtukriteeriumideks ja mockup’ideks.
AI juhib protsessi (küsib, pakub, soovitab), inimene otsustab. AI ettepanek ei jõua backlog’i enne kasutaja kinnitust.

Rakendus töötab ka ilma AI-ta: käsitsi lugude haldamine, järjestamine, valmisoleku kontroll ja tagasivõtmine on alati kättesaadav.

## Nõuded

- Node.js 18 või uuem (sõltuvusi ei ole, `npm install` pole vaja)

## Käivitamine

1. Kopeeri seadistusfail ja lisa oma AI võti:

   ```bash
   cp .env.example .env
   ```

   Ava `.env` ja täida `ANTHROPIC_API_KEY`. Võti jääb serveri poolele ega satu brauserisse ega repositooriumisse (`.env` on `.gitignore`-is).

2. Käivita server:

   ```bash
   npm start
   ```

3. Ava brauseris http://localhost:3000

Ilma AI võtmeta (või `AI_PROVIDER=none`) avaneb rakendus ikka, AI-nupud näitavad selget teadet.

Testimiseks ilma võtmeta (deterministlikud näidisvastused):

```bash
AI_PROVIDER=mock npm start
```

Testid:

```bash
npm test
```

## Seadistus

| Muutuja | Kirjeldus | Vaikimisi |
|---|---|---|
| `AI_PROVIDER` | `anthropic`, `mock` või `none` | `anthropic`, kui võti on olemas, muidu `none` |
| `ANTHROPIC_API_KEY` | AI teenuse võti (ainult serveris) | tühi |
| `AI_MODEL` | Mudeli nimi | `claude-sonnet-5-5` |
| `PORT` | Serveri port | `3000` |

Andmed salvestatakse faili `data/db.json`. Server ei kaota andmeid taaskäivitamisel.

## Kasutamine

1. **Loo projekt** vasakul ja kirjelda kliendi idee vabas vormis.
2. **Juhitud vestlus** (keskel) pakub järgmise sammu nupud. Iga AI ettepanek ilmub kaardina, mida saab muuta, kinnitada või tagasi lükata.
3. **Etapid** (ülal) näitavad, kus protsess on. Etappe saab vahele jätta ja tagasi minna.
4. **Backlog** (paremal) näitab lugusid järjekorras. Järjestust muudad ▲ ▼ nuppudega, MVP joone märgid nupuga.
   Lugu saab „Valmis arenduseks“ ainult siis, kui see läbib valmisoleku kontrolli. Puudu olev punkt on loetletud.
5. **Mockup ja täpsustus** (all): vali lugu, kirjuta kliendi täpsustus ja vaata muudatusettepanekut enne rakendamist.
   Teised lood ei muutu.
6. **Groomimine**: „Vaata backlog üle“ leiab liiga suured, kattuvad ja mittekontrollitavad lood. Iga leidu rakendatakse või ignoreeritakse eraldi.
7. **Võta tagasi** viimane muudatus.

## Põhimõtted

- AI väljund kontrollitakse serveris enne kasutajale näitamist (`src/validate.js`). Vigane vastus lükatakse tagasi teatega.
- Mockup’i komponendid kuvatakse tekstina ja lubatud tüüpide nimekirjal põhinevate komponentidena. Brauseris ei käivitu AI väljundist mingit koodi.
- Täpsustus puudutab ainult valitud lugu. Kui AI leiab, et teisi lugusid tuleb samuti muuta, tuleb see eraldi ettepanekuna.
- Kriteeriumide kontroll on reeglipõhine (`src/rules.js`): hinnangulised sõnad (kasutajasõbralik, kiire, lihtne jne) ja mitu tingimust ühes kriteeriumis märgitakse hoiatusena.

## Projekti struktuur

```
src/
  server.js     HTTP server ja API marsruudid
  service.js    äriloogika: ettepanekud, kinnitamine, tagasivõtmine, järgmised sammud
  ai.js         AI kiht: promptid, Anthropic ja mock provider
  rules.js      Connextra pealkiri, kriteeriumide kontroll, valmisoleku definitsioon
  validate.js   AI vastuste ja mockup’i struktuuri kontroll
  store.js      püsiv salvestus (JSON-fail)
public/         brauseri liides (HTML, CSS, JavaScript)
tests/          automaattestid (node:test)
```

## API (lühidalt)

| Meetod ja tee | Mida teeb |
|---|---|
| `GET/POST /api/projects` | projektide loend / uus projekt |
| `GET /api/projects/:id` | projekti täielik seis |
| `POST /api/projects/:id/ai` | küsib AI ettepaneku (ei rakenda midagi) |
| `POST /api/projects/:id/apply` | kinnitab ettepaneku (kasutaja muudatustega) |
| `POST /api/projects/:id/reject` | lükkab ettepaneku tagasi |
| `POST /api/projects/:id/undo` | võtab viimase muudatuse tagasi |
| `POST /api/projects/:id/stories`, `PATCH/DELETE .../stories/:sid` | käsitsi lugude haldus |
| `PUT /api/projects/:id/order`, `PUT .../mvp`, `PUT .../stage`, `PUT .../roles` | järjestus, MVP joon, etapp, rollid |

## Teadaolevad piirangud

- Reaalse AI teenusega testimine eeldab kehtivat võtit. Automaattestid kasutavad `mock` providerit.
- Lugude lohistamise asemel on järjestamine nuppudega.
- Ühe kasutaja jaoks mõeldud: serveris ei ole kasutajakontosid ega õiguste kontrolli.
- AI pakub mõnikord kriteeriume, mis on vaid osaliselt kontrollitavad. Reeglipõhine kontroll märgib need, kuid ei paranda neid automaatselt.
