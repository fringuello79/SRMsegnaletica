# Segnaletica SRM 2026

Strumento di campo per **verificare, posare e rimuovere** la segnaletica temporanea della Skyrace del Maglio (18 ottobre 2026), nel rispetto del disciplinare del Parco Sirente Velino, e per organizzare i **presidi** lungo il percorso.

- **Accesso staff dal sito ufficiale:** https://www.skyracedelmaglio.it/staff/ (voce «Accesso staff» nel menu, dopo Live)
- **Report per i volontari** (stampabile in PDF): https://www.skyracedelmaglio.it/staff/report.html
- Questo repository è l'originale: la cartella `staff/` del sito è una copia, da aggiornare con `tools/pubblica-sul-sito.sh` (il sito è pubblicato dal ramo `claude/affectionate-ptolemy-s07mf5` del repository `skyracedelmaglio`). Resta attivo anche https://fringuello79.github.io/SRMsegnaletica/, con gli stessi dati.

Funziona dal telefono, anche senza campo: le modifiche restano sul telefono e partono appena torna la rete.

## Cosa fa

- Mappa satellitare, topografica o OpenStreetMap, con la traccia ufficiale 2026, i sentieri segnati e su richiesta i sentieri e i bivi di OpenStreetMap.
- Ogni paletto è una freccia rossa che punta dove deve andare il corridore.
- Si sposta trascinandolo o con **«Metti qui»** stando sul bivio. Ogni spostamento registra la distanza dalla traccia e il nuovo chilometro.
- Ogni paletto passa per quattro stati, con nome, ora, GPS e foto: **da verificare → posizione confermata → posato → rimosso**.
- Mostra la posizione dei volontari sul percorso (ognuno può spegnerla) e la storia di tutte le azioni, che non si può cancellare.
- Esporta i segnali in **GPX** (per orologio o GPS) e l'inventario in **CSV**.
- Mostra il conto alla rovescia per la rimozione: entro **mercoledì 21 ottobre alle 16:00**, 72 ore dalla chiusura.
- **Presidi** (omino verde, pulsante verde sulla mappa): nome, funzione (ristoro, soccorso, controllo, cancello…), persone presenti con telefono e ruolo, note. Posizione da GPS, dal mirino o da coordinate precise. Nella scheda «Presidi» i numeri si chiamano con un tocco e l'elenco si può inviare su WhatsApp; i presidi compaiono anche nel report e nel GPX.

## Il piano iniziale

I 15 punti indicati da Ale sono diventati **14 paletti e 17 frecce**. Il tratto km 0–2,6 si corre di nuovo al ritorno (km 27,1–29,7), quindi lì ogni paletto porta due frecce: **A** per l'andata, **R** per il ritorno.

| Paletto | Frecce | Dal piano di Ale |
|---|---|---|
| S01 | S01-A sx (km 1), S01-R dx (km 28,7) | km 1 sx; la freccia R è **proposta** |
| S02 | S02-A dx (km 1,7), S02-R sx (km 28) | km 28 sx; la freccia A è **proposta** |
| S03 | S03-A sx (km 2,6), S03-R sx (km 27,1) | km 2,6 sx e km 27 sx: stesso bivio |
| S04 | sx | km 3,3 |
| S05 | sx | km 4 |
| S06 | sx | km 5,8 |
| S07 | sx | km 6,7 |
| S08 | dx | km 8 |
| S09 | dx | km 14,2 |
| S10 | dx | km 15,3 |
| S11 | sx | km 18,5 |
| S12 | sx | km 21 |
| S13 | dx | km 24,2 |
| S14 | dx | km 26 |

Le coordinate sono calcolate dalla traccia GPX: **vanno verificate sul posto** prima di piantare i paletti.

Ogni scheda riporta il confronto con la traccia, per esempio «la svolta a destra è 150 m più avanti». Quando la traccia mostra la svolta poco lontano, in mappa compare un cerchio arancione tratteggiato.

Per rigenerare i dati dalla traccia: `python3 tools/genera_piano.py`. Usa solo dopo aver cambiato la traccia: sovrascrive `data/`.

## Messa online (una volta sola)

1. Su GitHub apri **Settings → Pages**.
2. In *Build and deployment* scegli **Deploy from a branch**, ramo `main`, cartella `/ (root)`, e salva.
3. Dopo un paio di minuti la mappa è su https://fringuello79.github.io/SRMsegnaletica/

Se `firebase-config.js` contiene `null`, lo strumento gira in **modalità prova**: tutto funziona, ma i dati restano sul singolo telefono.

## Condivisione tra volontari con Firebase

**Già configurato** il 1° ottobre 2026 sul progetto Firebase `srm-segnaletica` dell'account del club (piano gratuito Spark):
- accesso anonimo attivo;
- database Firestore a Milano (`europe-west8`) con le regole di `firestore.rules`;
- dominio `fringuello79.github.io` autorizzato (l'accesso anonimo funziona anche da www.skyracedelmaglio.it);
- configurazione web in `firebase-config.js`.

Il **codice squadra non è scritto in questo repository**, perché il repository è pubblico: lo distribuisce Ale insieme al link `https://www.skyracedelmaglio.it/staff/#squadra=CODICE`. Chi apre il link entra direttamente nella squadra; chi non ha il codice non vede nulla. Il codice si scrive esattamente com'è (maiuscole e minuscole sono equivalenti, gli spazi vengono tolti).

Il 7 ottobre 2026 il codice è stato cambiato con uno più corto: paletti e storia sono stati copiati sotto il nuovo codice (i dati sotto il vecchio restano come copia di sicurezza). Chi aveva salvato il vecchio codice viene invitato a inserire il nuovo: l'app riconosce il vecchio dalla sua impronta SHA-256 (`CODICI_DISMESSI` in `js/app.js`), senza che il codice compaia nel sorgente.

Per cambiare le regole: Console Firebase → Firestore Database → Regole, incolla `firestore.rules` e premi **Pubblica**.

Per usare un nuovo codice squadra (per esempio nel 2027): inventane uno di almeno 4 caratteri; al primo accesso l'app dice che il codice non ha dati e, sotto «Squadra nuova davvero?», permette di caricare il piano dei segnali.

## Come si usa sul percorso

1. **Verifica** (nei giorni prima): vai al punto con «Naviga fin qui». Se il bivio è altrove, mettiti sul bivio vero e premi «Metti qui», oppure trascina la freccia con «Sposta sulla mappa». Se hai le coordinate esatte (da Google Maps, dal GPS, da un messaggio) usa «Inserisci coordinate» nel blocco Posizione della scheda: accetta 42.139664, 13.412430, i gradi-primi-secondi di Google Maps (42°08'22.8"N 13°24'44.7"E) e i link di Google Maps con le coordinate; mostra km, distanza dalla traccia e spostamento prima di salvare, e rifiuta i punti fuori percorso o su un altro tratto. Controlla il senso delle frecce (Sinistra / Dritto / Destra) e premi «Conferma posizione». La foto del bivio aiuta chi poserà il paletto.
2. **Posa** (sabato 17): pianta il paletto, premi «Segna come posato» e scatta una foto. Se il GPS dice che sei lontano dal punto segnato, puoi aggiornare la posizione nello stesso passaggio.
3. **Serve un paletto in più?** Usa il pulsante **+**. Se cade tra due paletti esistenti propone il numero del precedente con una lettera (dopo S16: S16A, poi S16B); in fondo al percorso propone il numero successivo. Il numero si può sempre cambiare. Nel tratto percorso due volte chiede anche la freccia del ritorno.
   **Cambiare il numero di un paletto:** nella sua scheda tocca il numero grande in alto (o «Cambia numero» in fondo). Si accetta un numero con una lettera facoltativa (16, 16A, 16B); cambia solo il numero e i codici delle frecce, la storia resta collegata. I numeri già usati vengono rifiutati.
4. **Rimozione** (dopo l'ultimo atleta, entro mercoledì 21 alle 16:00): «Segna come rimosso» con foto del punto ripulito.
5. Dal menu: **report**, **GPX** e **inventario CSV** da allegare al rendiconto per il Parco e alla richiesta di restituzione della cauzione.

Per la mappa senza campo: apri **Livelli → Scarica il satellite del percorso** quando sei col Wi‑Fi.

## Struttura

```
index.html            strumento di campo
report.html           report stampabile
firebase-config.js    configurazione Firebase (null = modalità prova)
firestore.rules       regole di sicurezza da incollare nella console
js/app.js             mappa, schede, azioni
js/store.js           archivio: Firestore con cache offline, oppure localStorage
js/geo.js             calcoli sulla traccia (km, proiezioni, direzioni)
js/frecce.js          disegno delle frecce SRM
data/                 traccia, piano dei segnali, punti gara, GPX del piano
tools/genera_piano.py rigenera data/ dalla traccia GPX
tools/pubblica-sul-sito.sh copia l'app nella cartella /staff/ del sito ufficiale
sw.js                 funzionamento senza rete
```

Dati in Firestore, sotto `squadre/{codice}/`:
- `segnali/{S01…}`: posizione, frecce, stato, chi e quando;
- `eventi/`: storia delle azioni, solo aggiunte, con foto ridotte;
- `presidi/{id}`: nome, funzione, persone (nome, telefono, ruolo), note, posizione e km;
- `volontari/{uid}`: ultima posizione condivisa.

Mappe: © Esri World Imagery, © OpenTopoMap, © OpenStreetMap, sentieri © waymarkedtrails.org.
