// Compare l'ancien et le nouvel iCal et poste les changements à venir sur Discord.
// Usage : node scripts/changes.mjs old.ics new.ics   (DEMO=true : changements fictifs)
import { parse, post, hm, dayLabel, CAMPUS, campusOf, SITE } from "./lib.mjs";
import fs from "node:fs";

const now = new Date();
const fmt = e => `${dayLabel(e.start)} · ${hm(e.start)}–${hm(e.end)}${e.loc ? " · " + e.loc : ""}`;
const key = e => e.uid || `${e.title}|${+e.start}`;

function diff(oldEv, newEv) {
  const O = new Map(oldEv.map(e => [key(e), e])), N = new Map(newEv.map(e => [key(e), e]));
  const added = [], removed = [], changed = [];
  for (const [k, e] of N) {
    if (e.end < now) continue;
    const o = O.get(k);
    if (!o) { added.push(e); continue; }
    const what = [];
    if (+o.start !== +e.start || +o.end !== +e.end) {
      const sameDate = o.start.toDateString() === e.start.toDateString();
      what.push(`🕒 ${sameDate ? "" : dayLabel(o.start) + " "}${hm(o.start)}–${hm(o.end)} → ${sameDate ? "" : dayLabel(e.start) + " "}${hm(e.start)}–${hm(e.end)}`);
    }
    if (o.loc !== e.loc) what.push(`📍 ${o.loc || "?"} → ${e.loc || "?"}${campusOf(o.loc) !== campusOf(e.loc) ? ` (**${CAMPUS[campusOf(e.loc)].name}**)` : ""}`);
    if (o.prof !== e.prof) what.push(`👤 ${o.prof || "?"} → ${e.prof || "?"}`);
    if (o.title !== e.title) what.push(`📘 ${o.title} → ${e.title}`);
    if (what.length) changed.push({ e, what });
  }
  for (const [k, o] of O) if (!N.has(k) && o.end > now) removed.push(o);
  return { added, removed, changed };
}

let oldEv, newEv;
if (process.env.DEMO === "true") {
  const d = (dd, h) => { const x = new Date(); x.setDate(x.getDate() + dd); x.setHours(h, 0, 0, 0); return x; };
  const base = { uid: "1", start: d(2, 9), end: d(2, 12), title: "Cours fictif déplacé", prof: "DUPONT Jean", loc: "H2 - Tanjiro" };
  oldEv = [base, { uid: "2", start: d(3, 14), end: d(3, 17), title: "Cours fictif annulé", prof: "MARTIN Claire", loc: "105" }];
  newEv = [{ ...base, start: d(2, 14), end: d(2, 17), loc: "105" }, { uid: "3", start: d(4, 9), end: d(4, 12), title: "Cours fictif ajouté", prof: "DURAND Paul", loc: "Amphi Kim Swift" }];
} else {
  const [a, b] = process.argv.slice(2);
  if (!a || !fs.existsSync(a)) { console.log("Pas d'ancien EDT, rien à comparer."); process.exit(0); }
  oldEv = parse(fs.readFileSync(a, "utf8")); newEv = parse(fs.readFileSync(b, "utf8"));
}

const { added, removed, changed } = diff(oldEv, newEv);
const total = added.length + removed.length + changed.length;
console.log(`${added.length} ajout(s), ${removed.length} suppression(s), ${changed.length} modification(s)`);
if (!total) process.exit(0);

const MAX = 8;
const lines = (arr, f) => arr.slice(0, MAX).map(f).join("\n") + (arr.length > MAX ? `\n… et ${arr.length - MAX} autre(s)` : "");
const embeds = [];
if (changed.length) embeds.push({ title: `✏️ ${changed.length} cours modifié(s)`, color: 0xffb547, description: lines(changed, c => `**${c.e.title}** — ${dayLabel(c.e.start)}\n${c.what.join("\n")}`).slice(0, 4000) });
if (added.length) embeds.push({ title: `🆕 ${added.length} cours ajouté(s)`, color: 0x00d4a6, description: lines(added, e => `**${e.title}**\n${fmt(e)}`).slice(0, 4000) });
if (removed.length) embeds.push({ title: `❌ ${removed.length} cours supprimé(s)`, color: 0xff5c7a, description: lines(removed, e => `~~**${e.title}**~~\n${fmt(e)}`).slice(0, 4000) });
embeds.push({ description: `[Voir mon EDT à jour](${SITE})`, color: 0x7c5cff });

const demo = process.env.DEMO === "true";
await post({ content: (demo ? (process.env.TEST_MESSAGE || "🧪 Démo") + " — " : "") + "📢 **L'emploi du temps a changé !**", embeds, ping: !demo || process.env.PING === "true" });
