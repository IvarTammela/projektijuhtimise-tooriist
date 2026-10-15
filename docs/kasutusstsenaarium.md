# Kasutusstsenaarium

## Avakohtumine kliendiga

Projektijuht loob tööriistas projekti ainult nimega (nt „Spordiklubi veeb“). Vestlus tervitab ja ootab kliendi mõtteid.
Kohtumisel kirjutab projektijuht kliendi umbmäärase idee („Tahame veebi, kus saab treeningutega tutvuda ja liikmeks astuda“).

AI hakkab intervjueerima. Ta esitab ühe täpsustava küsimuse korraga (kes on kasutajad, kas makstakse veebis, kas on vaja mobiili).
Projektijuht ei pea teadma, mida küsida: ta loeb küsimuse kliendile ette ja kirjutab vastuse. Kui klient ei tea, vajutab ta „Jäta vahele“.
Kui info on piisav, teatab AI sellest ise.

Seejärel pakub AI järjest rollid, kasutajalood happy path’i järjekorras ja soovituse, millest alustada. Projektijuht kinnitab, muudab või lükkab ettepaneku tagasi.
Iga loo kohta pakub AI kriteeriumid ja mockup’i, mida projektijuht näitab kliendile ekraanil. Klient näeb kohe, kas vaade vastab ootustele.

Kui klient täpsustab („hinnas peab olema näha käibemaks“), valib projektijuht lugu ja kirjutab täpsustuse. Tööriist näitab Enne/Pärast eelvaadet, ja muudab ainult valitud lugu.
Rakendamine toimub alles pärast kinnitust, ja viimase muudatuse saab tagasi võtta.

Kohtumise lõpuks on backlog koos kriteeriumide ja mockup’idega ning MVP joon on seatud. Backlog’i saab eksportida Markdowni või CSV-sse.

## Hilisem backlog’i ülevaatus

Projekt avatakse uuesti samast kohast. Backlog, mockup’id ja vestlus on alles.
Projektijuht vajutab „Vaata backlog üle“ ja AI otsib liiga suuri lugusid, kattuvaid lugusid ning mittekontrollitavaid kriteeriume (reeglipõhine kontroll leiab hinnangulised sõnad ja mitu tingimust ühes kriteeriumis).
Iga leiu kohta näeb projektijuht põhjendust ja otsustab: rakenda (jagamine või ühendamine) või ignoreeri.

Ebaselge loo märgib projektijuht „Täpsusta“ ja lisab sellele avatud küsimuse. Selline lugu ei saa staatust „Valmis arenduseks“, enne kui küsimus on lahendatud.
Lood, mis läbivad valmisoleku kontrolli (kolm kontrollitavat kriteeriumi, mockup vaatele, avatud küsimusi pole), saavad staatuse „Valmis arenduseks“ ja lähevad arendusmeeskonnale.
