// Voce narrante. Motori disponibili (variabile VOCE_MOTORE):
//   kokoro      gratis, open source (Apache 2.0), gira sulla macchina: voci it "im_nicola" (predefinita), "if_sara"
//   piper       gratis, open source, gira sulla macchina: voci "it_IT-paola-medium", "it_IT-riccardo-x_low"
//   elevenlabs  a pagamento oltre la quota gratuita, serve ELEVENLABS_API_KEY; dà i tempi esatti di ogni parola
//   nessuna     video senza voce (stima dei tempi): utile per le prove
// Senza VOCE_MOTORE: elevenlabs se c'è la chiave, altrimenti nessuna.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Memoria della voce: ogni frase già sintetizzata viene riusata, così rigenerare un video
// (per cambiare grafica o immagini) non rifà il lavoro e non consuma crediti.
const CACHE = process.env.CACHE_VOCI || path.resolve("cache-voci");
const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPOSTAZIONI_11LABS = { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.08 };
const CARATTERI_AL_SECONDO = 15; // ritmo veloce da TikTok, usato solo per la stima

export function motore() {
  return process.env.VOCE_MOTORE || (process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "nessuna");
}

export function voceDisponibile() {
  return motore() !== "nessuna";
}

function voce() {
  if (process.env.VOCE) return process.env.VOCE;
  return { kokoro: "im_nicola", piper: "it_IT-paola-medium", elevenlabs: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb" }[motore()];
}

function velocita() {
  return parseFloat(process.env.VOCE_VELOCITA || ({ elevenlabs: "1.08", piper: "1.1" }[motore()] || "1.0"));
}

export function durataAudio(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(String(out).trim());
}

function chiave(testo) {
  const id = { testo, motore: motore(), voce: voce(), velocita: velocita(),
    ...(motore() === "elevenlabs" ? { modello: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2", IMPOSTAZIONI_11LABS } : {}) };
  // Stessa chiave di prima per ElevenLabs, così le voci già salvate restano valide.
  const vecchia = motore() === "elevenlabs" && !process.env.VOCE_VELOCITA
    ? { testo, voce: voce(), modello: id.modello, IMPOSTAZIONI: IMPOSTAZIONI_11LABS } : id;
  return createHash("sha256").update(JSON.stringify(vecchia)).digest("hex").slice(0, 24);
}

async function dallaMemoria(testo, fileUscita) {
  const k = chiave(testo);
  const audio = path.join(CACHE, k + ".mp3"), dati = path.join(CACHE, k + ".json");
  if (!existsSync(audio) || !existsSync(dati)) return null;
  await copyFile(audio, fileUscita);
  const { parole } = JSON.parse(await readFile(dati, "utf8"));
  return { file: fileUscita, durata: durataAudio(fileUscita), parole, riusata: true };
}

async function inMemoria(testo, fileMp3, parole) {
  const k = chiave(testo);
  await mkdir(CACHE, { recursive: true });
  await copyFile(fileMp3, path.join(CACHE, k + ".mp3"));
  await writeFile(path.join(CACHE, k + ".json"), JSON.stringify({ testo, parole }));
}

/**
 * Sintetizza tutte le frasi di un episodio. Restituisce, nello stesso ordine,
 * { file, durata, parole: [{testo, inizio, fine}] | null, riusata }.
 */
export async function sintetizzaTutte(testi, cartella) {
  const m = motore();
  const risultati = new Array(testi.length).fill(null);
  const daFare = [];
  for (const [i, testo] of testi.entries()) {
    if (!testo) { risultati[i] = { file: null, durata: 0, parole: null }; continue; }
    if (m === "nessuna") { risultati[i] = { file: null, durata: Math.max(1.2, testo.length / CARATTERI_AL_SECONDO), parole: null }; continue; }
    const file = path.join(cartella, `voce-${i}.mp3`);
    risultati[i] = await dallaMemoria(testo, file);
    if (!risultati[i]) daFare.push({ i, testo, file });
  }
  if (!daFare.length) return risultati;

  if (m === "elevenlabs") {
    for (const f of daFare) risultati[f.i] = await elevenlabs(f.testo, f.file);
  } else if (m === "kokoro" || m === "piper") {
    const richiesta = path.join(cartella, "richiesta-voce.json");
    await writeFile(richiesta, JSON.stringify({ motore: m, voce: voce(), velocita: velocita(),
      frasi: daFare.map((f) => ({ testo: f.testo, file: f.file.replace(/\.mp3$/, ".wav") })) }));
    execFileSync(process.env.PYTHON || "python3", [path.join(RADICE, "scripts", "voce-locale.py"), richiesta], { stdio: "inherit" });
    for (const f of daFare) {
      const wav = f.file.replace(/\.mp3$/, ".wav");
      // Toglie il silenzio iniziale e finale e normalizza il volume.
      execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", wav, "-af",
        "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5",
        "-ar", "44100", "-b:a", "160k", f.file]);
      await inMemoria(f.testo, f.file, null);
      risultati[f.i] = { file: f.file, durata: durataAudio(f.file), parole: null, riusata: false };
    }
  } else {
    throw new Error(`VOCE_MOTORE sconosciuto: ${m} (usa kokoro, piper, elevenlabs o nessuna)`);
  }
  return risultati;
}

async function elevenlabs(testo, fileUscita) {
  const richiesta = () => fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voce()}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ text: testo, model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
        language_code: "it", voice_settings: IMPOSTAZIONI_11LABS }),
    },
  );
  // Troppe richieste insieme (429) o errore temporaneo (5xx): aspetta e riprova.
  let risposta;
  for (let tentativo = 1; ; tentativo++) {
    risposta = await richiesta();
    if (risposta.ok || tentativo >= 6 || !(risposta.status === 429 || risposta.status >= 500)) break;
    const attesa = Math.min(60, 4 * 2 ** (tentativo - 1)) + Math.random() * 3;
    console.log(`  ElevenLabs ${risposta.status}, riprovo tra ${attesa.toFixed(0)} s (tentativo ${tentativo})`);
    await new Promise((r) => setTimeout(r, attesa * 1000));
  }
  if (!risposta.ok) throw new Error(`ElevenLabs ${risposta.status}: ${await risposta.text()}`);
  const dati = await risposta.json();
  await writeFile(fileUscita, Buffer.from(dati.audio_base64, "base64"));
  const parole = paroleDaAllineamento(dati.alignment);
  await inMemoria(testo, fileUscita, parole);
  return { file: fileUscita, durata: durataAudio(fileUscita), parole, riusata: false };
}

/** Converte l'allineamento per carattere di ElevenLabs in tempi per parola. */
function paroleDaAllineamento(a) {
  if (!a || !a.characters) return null;
  const parole = [];
  let attuale = null;
  a.characters.forEach((c, i) => {
    if (/\s/.test(c)) {
      if (attuale) parole.push(attuale);
      attuale = null;
      return;
    }
    if (!attuale) attuale = { testo: "", inizio: a.character_start_times_seconds[i], fine: 0 };
    attuale.testo += c;
    attuale.fine = a.character_end_times_seconds[i];
  });
  if (attuale) parole.push(attuale);
  return parole;
}
