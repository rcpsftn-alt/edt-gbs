// Rappels Discord quotidiens :
//  - 7h : programme du jour (sans ping) + compte à rebours des partiels J-7 / J-3 / J-1 (avec ping)
//  - 1h avant le 1er cours de la journée, 15 min avant les suivants (avec ping)
// Chaque lancement gère ce qui tombe dans son créneau UTC [SLOT_START, SLOT_END).
// MODE (lancement manuel) : test | demo | programme | partiels
import { loadEvents, post, courseEmbed, hm, dayLabel, sameDay, sleep, freeSlots, examBlocks, daysUntil, CAMPUS, campusOf, SITE } from "./lib.mjs";

const { SLOT_START = "00:00", SLOT_END = "00:00", MODE = "", TEST_MESSAGE = "", DEMO_CAMPUS = "les deux" } = process.env;
const PING = process.env.PING === "true";
const events = await loadEvents();
const now = new Date();

/* ---------- Programme du jour ---------- */
async function programme(day = now, { manual = false } = {}) {
  const list = events.filter(e => sameDay(e.start, day));
  const wd = day.getDay();
  if (!list.length) {
    if (wd >= 1 && wd <= 5 || manual) await post({ content: (TEST_MESSAGE ? TEST_MESSAGE + "\n" : "") + `☀️ **${dayLabel(day)}** — pas cours aujourd'hui 😴`, ping: manual && PING });
    return;
  }
  const tot = list.reduce((s, e) => s + (e.end - e.start), 0) / 36e5;
  const lines = list.map(e => {
    const c = CAMPUS[campusOf(e.loc)];
    return `\`${hm(e.start)}–${hm(e.end)}\` **${e.title}**\n${c.color === 0x3d8bff ? "🟦" : c.color === 0xff8c1a ? "🟧" : "⬜"} ${e.loc || "Salle non précisée"}${e.loc ? ` · ${c.maps ? `[${c.name}](${c.maps})` : c.name}` : ""}${e.prof ? ` · \`${e.prof}\`` : ""}${e.note ? `\n> ${e.note.split("\n")[0].slice(0, 120)}` : ""}`;
  });
  const free = freeSlots(list).map(([a, b]) => `${hm(a)}–${hm(b)}`);
  const first = list[0];
  await post({
    content: (TEST_MESSAGE ? TEST_MESSAGE + "\n" : "") + `☀️ **Programme du ${dayLabel(day)}** — ${list.length} cours · ${Math.round(tot * 10) / 10} h`,
    embeds: [{
      color: CAMPUS[campusOf(first.loc)].color,
      description: lines.join("\n\n").slice(0, 3800) + (free.length ? `\n\n🟩 **Créneaux libres** : ${free.join(" · ")}` : "") + `\n\n[Ouvrir mon EDT](${SITE})`,
    }],
    ping: manual && PING,
  });
}

/* ---------- Compte à rebours des partiels ---------- */
async function partiels({ force = false } = {}) {
  for (const block of examBlocks(events)) {
    const j = daysUntil(block[0].start, now);
    if (!force && ![7, 3, 1].includes(j)) continue;
    if (force && j < 0) continue;
    const lines = block.map(e => `**${dayLabel(e.start)}** · \`${hm(e.start)}–${hm(e.end)}\`\n${e.title.replace(/^Partiels S\d\s*[–-]\s*/, "")}${e.loc ? ` · 📍 ${e.loc} (${CAMPUS[campusOf(e.loc)].name})` : ""}${e.note ? `\n> ⚠️ ${e.note.replace(/\n+/g, " ").trim()}` : ""}`);
    await post({
      content: (TEST_MESSAGE ? TEST_MESSAGE + "\n" : "") + `📚 **Partiels dans ${j} jour${j > 1 ? "s" : ""}** (J-${j}) — ${block.length} épreuve${block.length > 1 ? "s" : ""}`,
      embeds: [{ color: 0xff5c7a, title: `Partiels du ${block[0].start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}${block.length > 1 ? ` au ${block[block.length - 1].start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}`, url: SITE, description: lines.join("\n\n").slice(0, 4000) }],
      ping: force ? PING : true,
    });
    if (force) break; // en manuel : seulement le prochain bloc
  }
}

/* ---------- Lancements manuels ---------- */
if (MODE === "demo") {
  const d = (h, m) => { const x = new Date(); x.setHours(h, m, 0, 0); return x; };
  const quais = { start: d(9, 0), end: d(12, 0), title: "Cours fictif – Campus des quais", prof: "DUPONT Jean", loc: "H2 - Tanjiro", note: "" };
  const lucien = { start: d(14, 0), end: d(17, 0), title: "Cours fictif – Campus Lucien Faure", prof: "MARTIN Claire", loc: "105", note: "Lien : meet.google.com/abc-defg-hij" };
  const list = DEMO_CAMPUS === "Campus des quais" ? [quais] : DEMO_CAMPUS === "Campus Lucien Faure" ? [lucien] : [quais, lucien];
  await post({ content: TEST_MESSAGE || `Démo — ${DEMO_CAMPUS}`, embeds: list.map(e => courseEmbed(e)), ping: PING });
  process.exit(0);
}
if (MODE === "test") {
  const next = events.find(e => e.start > now);
  if (next) await post({ content: TEST_MESSAGE || "🧪 Test du bot — prochain cours :", embeds: [courseEmbed(next)], ping: PING });
  process.exit(0);
}
if (MODE === "programme") {
  // aujourd'hui, ou le prochain jour de cours s'il n'y a plus rien aujourd'hui
  const left = events.filter(e => sameDay(e.start, now) && e.end > now);
  const day = left.length ? now : (events.find(e => e.start > now)?.start || now);
  await programme(day, { manual: true });
  process.exit(0);
}
if (MODE === "partiels") { await partiels({ force: true }); process.exit(0); }

/* ---------- Lancement planifié ---------- */
const utc = s => { const [h, m] = s.split(":").map(Number); const d = new Date(now); d.setUTCHours(h, m, 0, 0); return d; };
const slotStart = utc(SLOT_START), slotEnd = utc(SLOT_END);
const at7 = new Date(now); at7.setHours(7, 0, 0, 0);

const today = events.filter(e => sameDay(e.start, now));
const jobs = today.map((e, i) => ({
  at: new Date(e.start - (i === 0 ? 60 : 15) * 60000),
  run: () => post({ content: i === 0 ? "⏰ Premier cours dans **1h** !" : "⏰ Cours dans **15 min** !", embeds: [courseEmbed(e)], ping: true }),
  valid: () => e.start > new Date(),
  label: e.title,
}));
jobs.push({ at: at7, run: () => programme(now), valid: () => new Date() - at7 < 3 * 36e5, label: "programme du jour", prio: -2 });
jobs.push({ at: at7, run: () => partiels(), valid: () => new Date() - at7 < 4 * 36e5, label: "compte à rebours partiels", prio: 1 });
jobs.sort((a, b) => a.at - b.at || (a.prio || 0) - (b.prio || 0));
// Deux messages prévus au même moment : le suivant est décalé de 15 min
const GAP = 15 * 60000;
let prevAt = null;
for (const j of jobs) {
  if (prevAt && j.at <= prevAt) { j.at = new Date(+prevAt + GAP); console.log(`Collision : « ${j.label} » décalé à ${hm(j.at)}`); }
  prevAt = j.at;
}

const mine = jobs.filter(j => j.at >= slotStart && j.at < slotEnd);
console.log(`${today.length} cours aujourd'hui, ${mine.length} envoi(s) dans ce créneau ${SLOT_START}-${SLOT_END} UTC.`);
if (process.env.DRY_RUN === "true") { mine.forEach(j => console.log(`${hm(j.at)}  ${j.label}`)); process.exit(0); }
for (const j of mine) {
  const wait = j.at - Date.now();
  if (wait > 0) { console.log(`Attente jusqu'à ${hm(j.at)} : ${j.label}`); await sleep(wait); }
  if (j.valid()) await j.run(); else console.log("Trop tard, ignoré :", j.label);
}
