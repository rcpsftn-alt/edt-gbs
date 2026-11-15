// Planificateur continu : tourne ~5h45, envoie chaque message à l'heure exacte,
// puis relance le run suivant (les tâches planifiées de GitHub arrivent avec des heures de retard).
// Gère : MAJ de l'EDT 6h/12h/18h (+ alerte de changement), programme du jour 7h, partiels J-7/3/1,
// rappels 1h / 15 min avant les cours, récap du dimanche 20h. Deux messages au même moment → +15 min.
import { parse, post, courseEmbed, hm, sameDay, sleep, programme, partiels } from "./lib.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";

const RUN_MS = 5 * 3600e3 + 45 * 60e3;
const start = new Date();
const FROM = process.env.FROM ? new Date(process.env.FROM) : start;
const UNTIL = new Date(+start + RUN_MS);
const DRY = process.env.DRY_RUN === "true";
const GAP = 15 * 60e3;
console.log(`Fenêtre : ${FROM.toISOString()} → ${UNTIL.toISOString()}`);

const sh = cmd => { console.log("$", cmd); return execSync(cmd, { stdio: "inherit", env: process.env }); };
const at = (day, h, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
const readEvents = () => parse(fs.readFileSync("edt.ics", "utf8"));

/* ---------- Mise à jour de l'EDT ---------- */
async function updateEdt() {
  const r = await fetch(process.env.ICAL);
  if (!r.ok) throw new Error("iCal HTTP " + r.status);
  const txt = await r.text();
  if (!txt.includes("BEGIN:VCALENDAR")) throw new Error("iCal invalide");
  const had = fs.existsSync("edt.ics");
  if (had) fs.copyFileSync("edt.ics", "old.ics");
  fs.writeFileSync("edt.ics", txt);
  fs.writeFileSync("updated.txt", new Date().toISOString().replace(/\.\d+Z$/, "Z") + "\n");
  if (had && !DRY) { try { sh("node scripts/changes.mjs old.ics edt.ics"); } catch (e) { console.log("Alerte changement : erreur", e.message); } }
  fs.rmSync("old.ics", { force: true });
  if (DRY) return;
  sh(`git config user.name "edt-bot" && git config user.email "edt-bot@users.noreply.github.com"`);
  sh(`git add edt.ics updated.txt && (git commit -qm "EDT mis à jour $(TZ=Europe/Paris date '+%d/%m/%Y %H:%M')" || true)`);
  sh(`git pull -q --rebase -X ours origin main || true`);
  sh(`git push -q origin HEAD:main || true`);
}

/* ---------- Récap du dimanche ---------- */
function recap() {
  if (DRY) return;
  sh("npm i --no-save --silent playwright@1 && npx playwright install --with-deps chromium >/dev/null");
  sh("node scripts/recap.mjs");
}

/* ---------- Construire le planning d'une journée ---------- */
function plan(day, events) {
  const today = events.filter(e => sameDay(e.start, day));
  const jobs = [];
  for (const h of [6, 12, 18]) jobs.push({ at: at(day, h), label: `MAJ EDT ${h}h`, run: updateEdt, msg: false });
  jobs.push({ at: at(day, 7), label: "programme du jour", run: ev => programme(ev, day), prio: -2, msg: true });
  jobs.push({ at: at(day, 7), label: "partiels J-7/3/1", run: ev => partiels(ev, day), prio: 1, msg: true });
  today.forEach((e, i) => jobs.push({
    at: new Date(e.start - (i === 0 ? 60 : 15) * 60e3), label: `rappel ${hm(e.start)} ${e.title}`, msg: true,
    run: () => post({ content: i === 0 ? "⏰ Premier cours dans **1h** !" : "⏰ Cours dans **15 min** !", embeds: [courseEmbed(e)], ping: true }),
  }));
  if (day.getDay() === 0) jobs.push({ at: at(day, 20), label: "récap de la semaine", run: recap, msg: true });
  jobs.sort((a, b) => a.at - b.at || (a.prio || 0) - (b.prio || 0));
  // messages au même moment : le suivant est décalé de 15 min
  let prev = null;
  for (const j of jobs.filter(j => j.msg)) { if (prev && j.at <= prev) j.at = new Date(+prev + GAP); prev = j.at; }
  return jobs.sort((a, b) => a.at - b.at);
}

/* ---------- Boucle ---------- */
const done = new Set();
while (Date.now() < +UNTIL) {
  const now = new Date();
  const events = readEvents();
  const jobs = [...plan(at(now, 0), events), ...plan(at(new Date(+now + 864e5), 0), events)]
    .filter(j => j.at >= FROM && j.at < UNTIL && !done.has(j.label + +j.at));
  if (DRY) { jobs.forEach(j => console.log(`${j.at.toLocaleString("fr-FR")}  ${j.label}`)); break; }
  for (const j of jobs.filter(j => j.at <= now)) {
    done.add(j.label + +j.at);
    console.log(`▶ ${hm(j.at)} ${j.label}`);
    try { await j.run(readEvents()); } catch (e) { console.log("Erreur :", e.message); }
  }
  const next = jobs.find(j => j.at > now);
  const wait = Math.min(next ? next.at - Date.now() : 60e3, 60e3, UNTIL - Date.now());
  if (wait > 0) await sleep(wait);
}

/* ---------- Relancer le run suivant ---------- */
if (!DRY && process.env.GITHUB_TOKEN) {
  const r = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/scheduler.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs: { from: UNTIL.toISOString() } }),
  });
  console.log("Relance du planificateur :", r.status);
}
