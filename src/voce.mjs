// Voce narrante. Con ELEVENLABS_API_KEY usa ElevenLabs (con i tempi di ogni parola,
// così i sottotitoli sono perfettamente a tempo); senza chiave stima la durata e il
// video esce muto, con sottotitoli ed effetti sonori: utile per le prove.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

// Memoria della voce: ogni frase già sintetizzata viene riusata, così rigenerare un video
// (per cambiare grafica o immagini) non consuma di nuovo i crediti di ElevenLabs.
const CACHE = process.env.CACHE_VOCI || path.resolve("cache-voci");
const IMPOSTAZIONI = { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.08 };

const CARATTERI_AL_SECONDO = 15; // ritmo veloce da TikTok, usato solo per la stima

export function voceDisponibile() {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export function durataAudio(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(String(out).trim());
}

/** Restituisce { file, durata, parole: [{testo, inizio, fine}] } con tempi relativi all'inizio della frase. */
export async function sintetizza(testo, fileUscita) {
  if (!voceDisponibile()) {
    const durata = Math.max(1.2, testo.length / CARATTERI_AL_SECONDO);
    return { file: null, durata, parole: null };
  }

  const voce = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const modello = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

  const chiave = createHash("sha256").update(JSON.stringify({ testo, voce, modello, IMPOSTAZIONI })).digest("hex").slice(0, 24);
  const audioSalvato = path.join(CACHE, chiave + ".mp3");
  const datiSalvati = path.join(CACHE, chiave + ".json");
  if (existsSync(audioSalvato) && existsSync(datiSalvati)) {
    await copyFile(audioSalvato, fileUscita);
    const { parole } = JSON.parse(await readFile(datiSalvati, "utf8"));
    return { file: fileUscita, durata: durataAudio(fileUscita), parole, riusata: true };
  }
  const richiesta = () => fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voce}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        text: testo,
        model_id: modello,
        language_code: "it",
        voice_settings: IMPOSTAZIONI,
      }),
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

  await mkdir(CACHE, { recursive: true });
  await copyFile(fileUscita, audioSalvato);
  await writeFile(datiSalvati, JSON.stringify({ testo, parole }));
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
