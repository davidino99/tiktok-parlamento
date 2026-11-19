#!/usr/bin/env node
// Stampa (in JSON) gli episodi da generare.
//   node src/elenca.mjs            → l'episodio di oggi (ora italiana); errore se manca
//   node src/elenca.mjs --tutti    → tutti gli episodi da oggi in poi
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oggi = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
const tutti = process.argv.includes("--tutti");

const file = (await readdir(path.join(RADICE, "episodi")))
  .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.json$/.test(f))
  .filter((f) => (tutti ? f.slice(0, 10) >= oggi : f.startsWith(oggi)))
  .sort()
  .map((f) => `episodi/${f}`);

if (!file.length) {
  console.error(tutti ? "Nessun episodio da oggi in poi." : `Nessun episodio per oggi (${oggi}): aggiungine uno in episodi/.`);
  process.exit(1);
}
console.log(JSON.stringify(file));
