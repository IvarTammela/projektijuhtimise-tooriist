# Ülevaade: mis töötab, mis jäi pooleli ja AI piirangud

## Mis töötab (kontrollitud)

- Projektid ja püsivus: projektid salvestuvad faili `data/db.json` ja säilivad serveri taaskäivitamisel.
- Juhitud vestlus: tervitus, kliendi idee, AI intervjuu ühe küsimusega korraga, rollid, lood, prioriteedi soovitus, kriteeriumid ja mockup lugu haaval, kliendi täpsustus Enne/Pärast eelvaatega.
- Backlog: käsitsi lisamine, muutmine, kustutamine ja järjestamine, MVP joon, staatused, valmisoleku definitsioon (näitab, mis puudu on), tagasivõtmine, Markdown ja CSV eksport.
- Inimese kontroll: ükski AI ettepanek ei jõua backlog’i ilma kinnituseta ja täpsustus muudab ainult valitud lugu (server kontrollib).
- Turvalisus: AI võti on serveris, AI päringud käivad läbi serveri, vastuse kuju kontrollitakse, mockup kuvatakse tekstina lubatud komponentide nimekirjast.
- Testid: 14 automaattesti (mock-provideriga), lisaks kontrollisin päris AI-ga intervjuud, rolle, lugusid, kriteeriume ja mockup’i.

## Mis jäi pooleli või on piiratud

- Kliendi täpsustust ja groomimise ülevaatust olen päris AI-ga kontrollinud API kaudu (täpsustus rakendub valitud lool, teiste lugude muudatused jäävad soovitusteks, ülevaade leidis ühendamise ja jagamise). Brauseris olen neid läbi klõpsanud ainult mock-provideriga, nii et päris AI-ga kuvamist ei ole ma silmaga kontrollinud.
- **Intervjuu küsimustel ei ole vastusevariante.** Projektijuht kirjutab ise, mida klient vastas (otsus on tehtud kasutuskogemuse põhjal). Ülesande kirjeldus nõudis variante nuppudena, see on tahtlik erinevus.
- Järjestamine on ▲ ▼ nuppudega, mitte lohistades.
- Mockup’i versioone saab valikust vaadata ja varasema võib taastada uue versioonina. Taastamist ei ole ma päris AI-ga brauseris käsitsi katsetanud, ainult automaattestiga.
- GitHub Issues’i või Jira eksporti ei ole.
- Lisavõimalustest on olemas Markdown ja CSV eksport. Story map, jagatav vaatamislink ja kõnesisend puuduvad.
- Ühe kasutaja jaoks: kasutajakontosid ei ole.

## Teadaolevad AI piirangud

- AI pakub vahel kriteeriume, mis on hinnangulised või ühendavad mitu tingimust. Reeglipõhine kontroll märgib need, aga ei paranda automaatselt.
- AI lisas vahel tegevuse ette „soovin“ ja kasu ette „et“. Server eemaldab need ise.
- AI vastus võib olla vigase JSON-iga. Server proovib ühe korra uuesti ja näitab seejärel selget veateadet.
- Päris AI-ga võtab iga samm 10–40 sekundit. Vestluses on selle ajal märge „AI mõtleb…“.
- `claude-cli` provider kasutab kasutaja enda Claude Code’i sessiooni ja limiiti. Vaikimisi on `anthropic` provider API võtmega.
- AI vastused ei ole alati täpsed või järjepidevad, seetõttu peab projektijuht iga ettepaneku üle vaatama.
