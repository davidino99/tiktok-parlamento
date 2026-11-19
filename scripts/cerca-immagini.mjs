#!/usr/bin/env node
// Cerca immagini con licenza libera su Wikimedia Commons e scarica i candidati.
//   node scripts/cerca-immagini.mjs immagini/richieste.json
// richieste.json: { "id": "termini di ricerca", ... }
// Uscita: immagini/candidati/<id>-<n>.jpg e immagini/candidati/metadati.json
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const UA = "TikTokVideoGenerator/0.1 (educational short videos; https://github.com/davidino99/tiktok-parlamento)";
const LICENZE_OK = /^(public domain|pd|cc0|cc by(-sa)? ?[\d.]*|cc-by(-sa)?-[\d.]+|attribution|no restrictions)/i;
const PER_ARGOMENTO = 4;
const CARTELLA = "immagini/candidati";
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function prendi(url, tentativi = 6) {
  for (let t = 1; ; t++) {
    const r = await fetch(url, { headers: { "user-agent": UA } });
    if (r.ok) return r;
    if (t >= tentativi || ![429, 500, 502, 503, 504].includes(r.status)) throw new Error(`${r.status} ${url}`);
    await pausa(2000 * 2 ** t);
  }
}

const testo = (html) => String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const richieste = JSON.parse(await readFile(process.argv[2] || "immagini/richieste.json", "utf8"));
await mkdir(CARTELLA, { recursive: true });
const fileMeta = path.join(CARTELLA, "metadati.json");
const metadati = existsSync(fileMeta) ? JSON.parse(await readFile(fileMeta, "utf8")) : {};

for (const [id, ricerca] of Object.entries(richieste)) {
  if (metadati[id]?.length) continue; // già cercato
  const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "15",
    gsrsearch: ricerca + " filetype:bitmap", prop: "imageinfo", iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1280", iiextmetadatafilter: "LicenseShortName|Artist|ImageDescription",
  });
  let pagine = [];
  try {
    const dati = await (await prendi(url)).json();
    pagine = Object.values(dati.query?.pages || {}).sort((a, b) => a.index - b.index);
  } catch (e) {
    console.log(`✖ ${id}: ${e.message}`);
    continue;
  }
  const scelti = [];
  for (const p of pagine) {
    const info = p.imageinfo?.[0];
    if (!info || !/jpe?g|png/.test(info.mime) || info.width < 800) continue;
    const licenza = info.extmetadata?.LicenseShortName?.value || "";
    if (!LICENZE_OK.test(licenza)) continue;
    const n = scelti.length;
    const file = path.join(CARTELLA, `${id}-${n}.jpg`);
    try {
      const img = Buffer.from(await (await prendi(info.thumburl || info.url)).arrayBuffer());
      await writeFile(file, img);
    } catch (e) {
      console.log(`  salto ${p.title}: ${e.message}`);
      continue;
    }
    scelti.push({
      file, titolo: p.title, licenza, autore: testo(info.extmetadata?.Artist?.value).slice(0, 80),
      descrizione: testo(info.extmetadata?.ImageDescription?.value).slice(0, 160), pagina: info.descriptionurl,
      larghezza: info.width, altezza: info.height,
    });
    if (scelti.length >= PER_ARGOMENTO) break;
    await pausa(700);
  }
  metadati[id] = scelti;
  console.log(`${scelti.length ? "✔" : "–"} ${id}: ${scelti.length} immagini`);
  await writeFile(fileMeta, JSON.stringify(metadati, null, 1));
  await pausa(1200);
}
