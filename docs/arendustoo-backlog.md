# Arendustöö backlog

Backlog on koostatud tööriista enda käsitsi lugude haldusega (`POST /api/projects/:id/stories`). AI-põhised sammud (küsimused, pakutud lood, mockup, täpsustus, groomimine) vajavad AI võtit, seega need pole selles backlog’is veel kasutatud.

| # | MVP | Lugu | Kriteeriumid |
|---|---|---|---|
| 1 | ✓ | Projektijuhina soovin luua projekti nimega ja kirjeldusega, et hoida kliendid omaette | Projekti loomisel on nime väli kohustuslik. Projektide loendis kuvatakse kõigi projektide nimed. Pärast serveri taaskäivitamist on projekt endiselt alles. |
| 2 | ✓ | Projektijuhina soovin kirjeldada kliendi ideed vabas vormis, et AI saaks protsessi alustada | Projekti loomisel salvestatakse kirjeldus projekti juurde. Projekti avamisel kuvatakse kirjeldus päises. Kirjelduse väli lubab vähemalt 2000 märki. |
| 3 | ✓ | Projektijuhina soovin vastata AI täpsustavatele küsimustele valikutega, et kliendi vastused jõuaksid protsessi | Iga küsimuse juures on vähemalt kaks vastusevarianti. Küsimuse juures on nupp Jäta vahele. Vastus salvestatakse projekti vastuste loendisse. |
| 4 | ✓ | Projektijuhina soovin kinnitada või tagasi lükata AI rollide ettepanek, et roll jõuaks backlog’i ainult minu otsusega | Rollide ettepaneku juures on nupp Kinnita. Rollide ettepaneku juures on nupp Loobu. Enne kinnitamist ei muutu rollide loend. |
| 5 | ✓ | Projektijuhina soovin näha AI pakutud kasutajalood happy path’i järjekorras, et tellida lood kiiresti | Pakutud lood on järjestatud happy path’i järgi. Iga loo juures on kriteeriumide arv. Loo pealkiri on Connextra vormis. |
| 6 | ✓ | Projektijuhina soovin valida, milline lugu backlog’i lisada, et lisada ainult soovitud lood | Iga pakutud loo juures on märkeruut. Lisa valitud nupu vajutamisel lisatakse ainult märgitud lood. Märkimata lugu ei ilmu backlog’i. |
| 7 |  | Projektijuhina soovin muuta lugude järjekorda nuppudega, et seada esimesena oluline lugu | Loo juures on liikumisnupp ülespoole. Loo juures on liikumisnupp allapoole. Järjekorra muutmine salvestub kohe. |
| 8 |  | Projektijuhina soovin märkida MVP joon, et näha esimese versiooni piiri | MVP joone juures kuvatakse märge MVP. MVP joonest ülalpool olevad lood on märgitud MVP-na. MVP joone saab eemaldada. |
| 9 |  | Projektijuhina soovin näha loo valmisolekut, et teada, mis veel puudu on | Puuduvad nõuded on loetletud loo juures. Staatus Valmis arenduseks ei rakendu enne kõigi nõuete täitmist. Valmisoleku põhjused kuvatakse loetelu punktidena. |
| 10 |  | Projektijuhina soovin saada hoiatus hinnangulise sõna eest kriteeriumis, et kriteeriumid jääksid kontrollitavaks | Hinnanguline sõna kriteeriumis tekitab hoiatuse. Hoiatus näitab leitud sõna. Mitut tingimust ühendav kriteerium märgitakse hoiatusega. |
| 11 |  | Projektijuhina soovin anda kliendi täpsustus ainult ühele loole, et teised lood ei muutuks | Täpsustuse rakendamisel muutub ainult valitud lugu. Muudatusettepanekut näidatakse enne rakendamist. Mockup’i eelmine versioon säilib. |
| 12 |  | Projektijuhina soovin käivitada groomimise ülevaade, et leida liiga suured ja kattuvad lood | Ülevaade näitab iga leiu juures põhjendust. Iga leidu saab rakendada või ignoreerida eraldi. Ühendamise tulemuseks on üks lugu. |
| 13 |  | Projektijuhina soovin võtta viimane muudatus tagasi, et vale muudatus ei jääks backlog’i | Tagasivõtmise nupp on lubatud, kui muudatus on tehtud. Tagasivõtmine taastab lugude loendi. Tagasivõtmise ajalugu on piiratud 30 muudatusega. |

## Järjestuse põhjendus

Järjestus järgib happy path’i: projekt → kliendi idee → täpsustavad küsimused → rollid → lood → lugude valik. MVP joon on pärast lugude valimist (lugu 6), sest ilma selleta ei saa esimest töötavat voogu läbida. Lood 7–13 on järjekorras, mis kasutab juba olemasolevat tööriista: järjestus ja MVP → valmisolek → kriteeriumide hoiatused → täpsustus → groomimine → tagasivõtmine. Viimasena on tagasivõtmine, sest see tugineb kõigile eelmistele muudatustele.

## Staatus

Kõik lood on staatuses Idee. Ükski lugu ei läbi veel valmisoleku kontrolli, sest mockup’e pole lisatud (AI teenus pole seadistatud).
