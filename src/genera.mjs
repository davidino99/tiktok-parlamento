#!/usr/bin/env node
// Genera un video verticale 1080×1920 da un episodio JSON.
//
//   node src/genera.mjs episodi/2026-11-20-quiz-indovinelli.json
//   node src/genera.mjs --oggi            # l'episodio con la data di oggi (ora italiana)
//
// Uscita in uscita/: il video .mp4 e un .txt con descrizione e hashtag da incollare su TikTok.
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sintetizza, voceDisponibile } from "./voce.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 30;
const LAVORATORI = 4;
const PAUSA_DOPO_VOCE = 0.35;
const RITARDO_VOCE = 0.12;

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg non è riuscito: " + args.join(" "));
}

function oggiARoma() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date()); // AAAA-MM-GG
}

async function trovaEpisodio(argomenti) {
  if (argomenti.includes("--oggi")) {
    const oggi = oggiARoma();
    const file = (await readdir(path.join(RADICE, "episodi"))).filter((f) => f.startsWith(oggi) && f.endsWith(".json"));
    if (!file.length) throw new Error(`Nessun episodio per oggi (${oggi}) in episodi/.`);
    return file.map((f) => path.join(RADICE, "episodi", f));
  }
  const file = argomenti.filter((a) => a.endsWith(".json"));
  if (!file.length) throw new Error("Indica un episodio: node src/genera.mjs episodi/<file>.json oppure --oggi");
  return file.map((f) => path.resolve(f));
}

function controlla(ep, nome) {
  const generi = ["quiz", "curiosita", "mistero"];
  if (!generi.includes(ep.genere)) throw new Error(`${nome}: genere deve essere uno di ${generi.join(", ")}`);
  if (!Array.isArray(ep.scene) || !ep.scene.length) throw new Error(`${nome}: mancano le scene`);
  ep.scene.forEach((s, i) => {
    if (!s.tipo) throw new Error(`${nome}: la scena ${i + 1} non ha "tipo"`);
    if (s.tipo === "risposta" && ep.scene[i - 1]?.opzioni && typeof s.giusta !== "number")
      throw new Error(`${nome}: la scena ${i + 1} deve indicare "giusta" (0 = A, 1 = B, ...)`);
  });
}

/** Voce di ogni scena e linea del tempo complessiva. */
async function preparaLinea(ep, cartella) {
  const scene = [];
  let t = 0;
  for (const [i, dati] of ep.scene.entries()) {
    const testo = (dati.voce || "").trim();
    const v = testo ? await sintetizza(testo, path.join(cartella, `voce-${i}.mp3`)) : { file: null, durata: 0, parole: null };
    const inizio = t;
    const voce = { inizio: inizio + RITARDO_VOCE, fine: inizio + RITARDO_VOCE + v.durata };
    let fine = voce.fine + PAUSA_DOPO_VOCE;
    let timer = null;
    if (dati.tipo === "domanda" && dati.secondi) {
      timer = { inizio: voce.fine + 0.15, fine: voce.fine + 0.15 + dati.secondi };
      fine = timer.fine + 0.1;
    }
    if (dati.durataMinima) fine = Math.max(fine, inizio + dati.durataMinima);
    scene.push({ dati, inizio, fine, voce, timer, parole: v.parole, fileVoce: v.file });
    t = fine;
  }

  // Una tacca della barra per ogni parte del contenuto.
  const parti = scene.filter((s) => ["domanda", "fatto", "racconto"].includes(s.dati.tipo) && !s.dati.continua);
  const segmenti = parti.map((s, k) => ({ inizio: k === 0 ? 0 : s.inizio, fine: parti[k + 1] ? parti[k + 1].inizio : t }));
  return { scene, durata: t, segmenti: segmenti.length ? segmenti : null };
}

/** Effetti sonori generati al volo: nessun file audio di terzi, nessun problema di diritti. */
function creaEffetti(cartella) {
  const e = (nome, filtro, durata) => {
    const file = path.join(cartella, nome + ".wav");
    ffmpeg(["-f", "lavfi", "-i", filtro, "-t", String(durata), "-ar", "44100", "-ac", "2", file]);
    return file;
  };
  return {
    tic: e("tic", "sine=f=1250:d=0.07,afade=t=out:st=0.01:d=0.06,volume=0.35", 0.07),
    giusto: e("giusto", "aevalsrc='0.35*sin(2*PI*880*t)*exp(-6*t)+0.3*sin(2*PI*1320*t)*exp(-5*(t-0.09))*gte(t,0.09)':d=0.6", 0.6),
    passaggio: e("passaggio", "anoisesrc=d=0.35:c=pink:a=0.25,highpass=f=900,afade=t=in:d=0.12,afade=t=out:st=0.12:d=0.23", 0.35),
    colpo: e("colpo", "aevalsrc='0.8*sin(2*PI*(60-30*t)*t)*exp(-4*t)':d=1.2", 1.2),
  };
}

function montaAudio(linea, ep, cartella, uscitaAudio) {
  const fx = creaEffetti(cartella);
  const ingressi = [];
  const aggiungi = (file, t, volume = 1) => ingressi.push({ file, t, volume });

  linea.scene.forEach((s, i) => {
    if (s.fileVoce) aggiungi(s.fileVoce, s.voce.inizio, 1);
    if (i > 0 && ep.genere !== "mistero") aggiungi(fx.passaggio, s.inizio, 0.6);
    if (ep.genere === "mistero" && (s.dati.colpo || i === 0)) aggiungi(fx.colpo, s.inizio, 0.9);
    if (s.timer) for (let k = 0; k < s.timer.fine - s.timer.inizio - 0.01; k++) aggiungi(fx.tic, s.timer.inizio + k, 1);
    if (s.dati.tipo === "risposta") aggiungi(fx.giusto, s.inizio, 0.9);
  });

  const args = [];
  ingressi.forEach((x) => args.push("-i", x.file));
  let filtro = ingressi.map((x, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${x.volume},adelay=${Math.round(x.t * 1000)}:all=1[a${k}]`);
  const etichette = ingressi.map((_, k) => `[a${k}]`).join("");
  let fine = `${etichette}amix=inputs=${ingressi.length}:normalize=0:dropout_transition=0`;

  // Per i misteri: un tappeto sonoro basso e cupo, generato, sotto la voce.
  if (ep.genere === "mistero") {
    args.push("-f", "lavfi", "-t", String(linea.durata), "-i",
      "aevalsrc='0.06*sin(2*PI*55*t)+0.04*sin(2*PI*82.4*t)*(0.6+0.4*sin(2*PI*0.2*t))+0.02*sin(2*PI*110.3*t)':s=44100:c=stereo");
    filtro.push(`[${ingressi.length}:a]afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, linea.durata - 1.5)}:d=1.5[tappeto]`);
    fine = `${etichette}[tappeto]amix=inputs=${ingressi.length + 1}:normalize=0:dropout_transition=0`;
  }
  filtro.push(`${fine},alimiter=limit=0.95,apad=whole_dur=${linea.durata.toFixed(3)}[mix]`);
  ffmpeg([...args, "-filter_complex", filtro.join(";"), "-map", "[mix]", "-t", linea.durata.toFixed(3), "-c:a", "pcm_s16le", uscitaAudio]);
}

async function disegnaFotogrammi(ep, linea, cartella, soloIstanti = null) {
  const istanti = soloIstanti || Array.from({ length: Math.ceil(linea.durata * FPS) }, (_, f) => f / FPS);
  const totale = istanti.length;
  const browser = await chromium.launch();
  const urlModello = pathToFileURL(path.join(RADICE, "src", "modello.html")).href;
  const datiLinea = {
    durata: linea.durata,
    segmenti: linea.segmenti,
    scene: linea.scene.map(({ dati, inizio, fine, voce, timer, parole }) => ({ dati, inizio, fine, voce, timer, parole })),
  };

  let fatti = 0;
  const lavora = async (w) => {
    const pagina = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await pagina.goto(urlModello);
    await pagina.evaluate(() => document.fonts.ready);
    await pagina.evaluate(([e, l]) => window.prepara(e, l), [ep, datiLinea]);
    for (let f = w; f < totale; f += LAVORATORI) {
      await pagina.evaluate((t) => window.frame(t), istanti[f]);
      const nomeFile = soloIstanti ? `anteprima-${istanti[f]}s.png` : `f${String(f).padStart(5, "0")}.jpg`;
      await pagina.screenshot(soloIstanti ? { path: path.join(cartella, nomeFile) } : { path: path.join(cartella, nomeFile), type: "jpeg", quality: 92 });
      fatti++;
      if (fatti % 150 === 0) process.stdout.write(`  fotogrammi ${fatti}/${totale}\n`);
    }
    await pagina.close();
  };
  await Promise.all(Array.from({ length: LAVORATORI }, (_, w) => lavora(w)));
  await browser.close();
}

function testoDescrizione(ep) {
  const tag = (ep.hashtag || []).map((h) => "#" + h.replace(/^#/, "")).join(" ");
  const avvisi = voceDisponibile() ? "\n\n⚙️ Ricorda: attiva \"Contenuto generato dall'AI\" (voce sintetica)." : "";
  return `${ep.descrizione || ep.titolo || ""}\n\n${tag}\n\n💬 Commento da fissare:\n${ep.commentoFissato || ""}${avvisi}\n`;
}

async function generaUno(fileEpisodio) {
  const nome = path.basename(fileEpisodio, ".json");
  const ep = JSON.parse(await readFile(fileEpisodio, "utf8"));
  controlla(ep, nome);

  const lavoro = path.join(process.env.CARTELLA_LAVORO || tmpdir(), "video-" + nome);
  await rm(lavoro, { recursive: true, force: true });
  await mkdir(path.join(lavoro, "fotogrammi"), { recursive: true });
  const uscita = path.join(RADICE, "uscita");
  await mkdir(uscita, { recursive: true });

  console.log(`▶ ${nome} (${ep.genere}) — voce: ${voceDisponibile() ? "ElevenLabs" : "assente (stima dei tempi)"}`);
  const linea = await preparaLinea(ep, lavoro);
  console.log(`  durata ${linea.durata.toFixed(1)} s, ${linea.scene.length} scene`);

  // --anteprima: un fotogramma a metà di ogni scena (o agli istanti indicati), senza video.
  const anteprima = argomenti.find((a) => a.startsWith("--anteprima"));
  if (anteprima) {
    const valori = anteprima.split("=")[1];
    const istanti = valori ? valori.split(",").map(Number)
      : linea.scene.map((s) => +(s.timer ? s.timer.inizio + 0.6 : Math.min(s.inizio + 1.2, (s.inizio + s.fine) / 2)).toFixed(2));
    const cartella = path.join(uscita, "anteprime", nome);
    await rm(cartella, { recursive: true, force: true });
    await mkdir(cartella, { recursive: true });
    await disegnaFotogrammi(ep, linea, cartella, istanti);
    console.log(`✔ anteprime in ${path.relative(RADICE, cartella)}`);
    return null;
  }

  const audio = path.join(lavoro, "audio.wav");
  montaAudio(linea, ep, lavoro, audio);
  await disegnaFotogrammi(ep, linea, path.join(lavoro, "fotogrammi"));

  const video = path.join(uscita, nome + ".mp4");
  ffmpeg([
    "-framerate", String(FPS), "-i", path.join(lavoro, "fotogrammi", "f%05d.jpg"), "-i", audio,
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", video,
  ]);
  await writeFile(path.join(uscita, nome + ".txt"), testoDescrizione(ep));
  if (!process.env.TIENI_LAVORO) await rm(lavoro, { recursive: true, force: true });
  console.log(`✔ ${path.relative(RADICE, video)}`);
  return video;
}

const argomenti = process.argv.slice(2);
try {
  for (const f of await trovaEpisodio(argomenti)) {
    if (!existsSync(f)) throw new Error("File non trovato: " + f);
    await generaUno(f);
  }
} catch (err) {
  console.error("✖ " + err.message);
  process.exit(1);
}
