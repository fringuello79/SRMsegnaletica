# Segnaletica SRM 2026

Strumento di campo per **verificare, posare e rimuovere** la segnaletica temporanea della Skyrace del Maglio (18 ottobre 2026), nel rispetto del disciplinare del Parco Sirente Velino.

- **Mappa:** https://fringuello79.github.io/SRMsegnaletica/
- **Report per i volontari** (stampabile in PDF): https://fringuello79.github.io/SRMsegnaletica/report.html

Funziona dal telefono, anche senza campo: le modifiche restano sul telefono e partono appena torna la rete.

## Cosa fa

- Mappa satellitare, topografica o OpenStreetMap, con la traccia ufficiale 2026, i sentieri segnati e su richiesta i sentieri e i bivi di OpenStreetMap.
- Ogni paletto è una freccia rossa che punta dove deve andare il corridore.
- Si sposta trascinandolo o con **«Metti qui»** stando sul bivio. Ogni spostamento registra la distanza dalla traccia e il nuovo chilometro.
- Ogni paletto passa per quattro stati, con nome, ora, GPS e foto: **da verificare → posizione confermata → posato → rimosso**.
- Mostra la posizione dei volontari sul percorso (ognuno può spegnerla) e la storia di tutte le azioni, che non si può cancellare.
- Esporta i segnali in **GPX** (per orologio o GPS) e l'inventario in **CSV**.
- Mostra il conto alla rovescia per la rimozione: entro **mercoledì 21 ottobre alle 16:00**, 72 ore dalla chiusura.

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
- dominio `fringuello79.github.io` autorizzato;
- configurazione web in `firebase-config.js`.

Il **codice squadra non è scritto in questo repository**, perché il repository è pubblico: lo distribuisce Ale insieme al link `https://fringuello79.github.io/SRMsegnaletica/#squadra=CODICE`. Chi apre il link entra direttamente nella squadra; chi non ha il codice non vede nulla.

Per cambiare le regole: Console Firebase → Firestore Database → Regole, incolla `firestore.rules` e premi **Pubblica**.

Per usare un nuovo codice squadra (per esempio nel 2027): basta inventarne uno di almeno 10 caratteri e premere **Carica il piano dei segnali** al primo accesso.

## Come si usa sul percorso

1. **Verifica** (nei giorni prima): vai al punto con «Naviga fin qui». Se il bivio è altrove, mettiti sul bivio vero e premi «Metti qui», oppure trascina la freccia con «Sposta sulla mappa». Controlla il senso delle frecce (Sinistra / Dritto / Destra) e premi «Conferma posizione». La foto del bivio aiuta chi poserà il paletto.
2. **Posa** (sabato 17): pianta il paletto, premi «Segna come posato» e scatta una foto. Se il GPS dice che sei lontano dal punto segnato, puoi aggiornare la posizione nello stesso passaggio.
3. **Serve un paletto in più?** Usa il pulsante **+**: riceve il numero successivo (S15, S16…). Nel tratto percorso due volte chiede anche la freccia del ritorno.
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
sw.js                 funzionamento senza rete
```

Dati in Firestore, sotto `squadre/{codice}/`:
- `segnali/{S01…}`: posizione, frecce, stato, chi e quando;
- `eventi/`: storia delle azioni, solo aggiunte, con foto ridotte;
- `volontari/{uid}`: ultima posizione condivisa.

Mappe: © Esri World Imagery, © OpenTopoMap, © OpenStreetMap, sentieri © waymarkedtrails.org.
