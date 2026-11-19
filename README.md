# Video TikTok automatici

Genera ogni giorno un video verticale (1080×1920) con voce narrante, foto, sottotitoli animati ed effetti sonori.
Due serie a giorni alterni, ognuna con il suo stile riconoscibile:

| Serie | Stile | Cosa fa scattare l'algoritmo |
|---|---|---|
| 💡 **Lo sapevi che?** (`curiosita`) | verde acqua | si salva e si condivide ("guarda questa") |
| 🏔️ **Misteri** (`mistero`) | nero e rosso, foto desaturate, grana, tappeto sonoro | si guarda fino alla fine, si discute la propria teoria |

Rotazione: curiosità → mistero → curiosità → …

## Come funziona

1. Ogni episodio è un file in `episodi/` che si chiama `AAAA-MM-GG-genere-titolo.json`.
2. Ogni mattina il workflow **Video del giorno** (GitHub Actions) prende l'episodio con la data di oggi,
   crea la voce con ElevenLabs, disegna i fotogrammi e monta il video.
3. Il video compare tra le **Releases** del repository, insieme a un `.txt` con descrizione, hashtag e
   commento da fissare. Dal telefono: apri GitHub → repository → Releases → scarica l'mp4.

Il workflow si può anche lanciare a mano da **Actions → Video del giorno → Run workflow**:

- spunta **tutti** per generare subito, in parallelo, tutti gli episodi da oggi in poi;
- oppure scrivi un file nel campo **episodio** per rigenerare solo quello.

Un video già pubblicato in Releases non viene rigenerato la mattina, e ogni frase letta da ElevenLabs resta salvata nella
release **memoria-voce** (non eliminarla): rigenerare un video, per esempio per cambiare le foto, non consuma altri crediti.
Le release di episodi rimossi o spostati di data vengono eliminate da sole.

## Attivare la voce narrante

1. Crea un account su [elevenlabs.io](https://elevenlabs.io) (il piano Starter basta: un video usa circa 600 caratteri).
2. Prendi la chiave API dal profilo ElevenLabs.
3. Su GitHub: **Settings → Secrets and variables → Actions → New repository secret**, nome `ELEVENLABS_API_KEY`.
4. Facoltativo: scegli una voce italiana dalla Voice Library di ElevenLabs e salva il suo ID come **variabile**
   (scheda *Variables*) `ELEVENLABS_VOICE_ID`. Usa sempre la stessa: la voce diventa il marchio del canale.

Senza chiave il video esce comunque, con sottotitoli ed effetti ma senza voce (utile per le prove).

## Prima di pubblicare (ogni volta)

- [ ] Attiva **"Contenuto generato dall'AI"** nelle impostazioni del post (la voce è sintetica).
- [ ] Aggiungi un **suono di tendenza** dall'app a volume basso (5–10%): TikTok spinge i suoni del momento.
- [ ] Incolla descrizione e hashtag dal file `.txt`.
- [ ] Appena pubblicato, scrivi e **fissa** il commento indicato nel `.txt`.
- [ ] Pubblica alla stessa ora ogni giorno: in Italia di solito funzionano 12–14 e 19–22.
- [ ] Nella prima ora rispondi ai commenti: è il momento in cui TikTok decide se allargare il pubblico.

## Generare un video sul computer

Servono Node 22+, ffmpeg e un font per le emoji (Noto Color Emoji).

```bash
npm ci
npx playwright install chromium
node src/genera.mjs episodi/2026-11-20-quiz-tre-indovinelli.json
node src/genera.mjs episodi/2026-11-20-quiz-tre-indovinelli.json --anteprima   # solo alcuni fotogrammi, in pochi secondi
```

Con la voce: `ELEVENLABS_API_KEY=... node src/genera.mjs episodi/<file>.json`.

## Scrivere un episodio

```jsonc
{
  "genere": "curiosita",             // curiosita | mistero
  "titolo": "…",                     // solo per te
  "descrizione": "…",                // testo del post
  "hashtag": ["losapevi", "curiosità"],
  "commentoFissato": "…",
  "fonti": ["…"],                    // per curiosità e misteri: da dove vengono i fatti
  "scene": [ /* vedi sotto */ ]
}
```

Ogni scena ha un `tipo` e una `voce` (il testo letto dal narratore, che diventa anche i sottotitoli):

| tipo | campi | uso |
|---|---|---|
| `apertura` | `emoji`, `testo`, `sotto` | i primi 2 secondi: la frase che blocca lo scroll |
| `fatto` | `etichetta`, `emoji`, `grande`, `testo` | curiosità |
| `racconto` | `etichetta`, `emoji`, `grande`, `testo`, `colpo` | misteri (`colpo: true` = suono cupo) |
| `chiusura` | `emoji`, `testo`, `sotto` | la domanda per far commentare |

Ogni scena può avere una foto: `immagine` (es. `assets/immagini/squalo.jpg`), `credito` (es. `Foto: Terry Goss · CC BY 2.5`)
e, se serve, `posizione` per il ritaglio (es. `50% 15%`). Nell'apertura la foto va a tutto schermo, nelle altre scene in un
riquadro, sempre con un lento zoom. Al posto della foto si può usare `emoji`.

### Trovare le foto

Si usano solo immagini libere: NASA (pubblico dominio) e Wikimedia Commons (pubblico dominio, CC0, CC BY, CC BY-SA).
Per cercarle su Commons: scrivi le ricerche in `immagini/richieste.json` (`{"nome": "termini di ricerca"}`) e caricale su un
branch `claude/…`. Il workflow **Cerca immagini** scarica i candidati con autore e licenza in `immagini/candidati/`.
L'elenco completo dei crediti è in [`assets/immagini/CREDITI.md`](assets/immagini/CREDITI.md).

### Regole per un episodio che funziona

- **Durata 25–45 secondi.** Meglio corto e guardato fino in fondo che lungo e abbandonato.
- **Una foto vera per scena** quando c'è: ferma lo scroll più di qualsiasi grafica.
- **Apertura:** un numero, un paradosso o una promessa ("Il terzo è una trappola").
- **Un cambio di immagine ogni 2–4 secondi:** scene brevi, una sola idea per scena.
- **Chiusura con una domanda a cui si risponde con una parola o un numero** ("0, 1, 2 o 3?").
- **Solo fatti verificati**, con la fonte in `fonti`. Un errore nei commenti costa credibilità.
- Niente volti o voci di persone reali generati con l'AI.
