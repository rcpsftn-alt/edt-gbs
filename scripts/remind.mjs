// Rappels Discord : 1h avant le 1er cours de la journée, 15 min avant les suivants.
// Chaque lancement gère les rappels compris dans un créneau UTC [SLOT_START, SLOT_END).
// Variables : ICAL, DISCORD_WEBHOOK, ROLE_ID, SLOT_START, SLOT_END ("HH:MM" UTC), TEST
process.env.TZ = "Europe/Paris";
const { ICAL, DISCORD_WEBHOOK, ROLE_ID, SLOT_START = "00:00", SLOT_END = "24:00", TEST } = process.env;
if (!DISCORD_WEBHOOK) throw new Error("Secret DISCORD_WEBHOOK manquant");

const SITE = "https://rcpsftn-alt.github.io/edt-gbs/";
const CAMPUS = {
  A: { name: "Campus des quais", color: 0x3d8bff },
  B: { name: "Campus Lucien Faure", color: 0xff8c1a },
  X: { name: "Salle non précisée", color: 0x6b7280 },
};
const campus = l => /(^|\W)(H\d|Amphi)/i.test(l) ? "A" : /(^|\D)1\d\d(\D|$)/.test(l) ? "B" : "X";
const unesc = s => (s || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").trim();
const mk = (d, hm = "0000") => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +hm.slice(0, 2), +hm.slice(2, 4));
const hm = d => String(d.getHours()).padStart(2, "0") + "h" + String(d.getMinutes()).padStart(2, "0");
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function parse(txt) {
  txt = txt.replace(/\r?\n[ \t]/g, "");
  return txt.split("BEGIN:VEVENT").slice(1).map(b => {
    const g = k => (b.match(new RegExp("^" + k + "[^:\\r\\n]*:(.*)$", "m")) || [])[1]?.trim() || "";
    const p = s => { const m = s.match(/(\d{8})T?(\d{4})?/); return mk(m[1], m[2] || "0000"); };
    const parts = unesc(g("SUMMARY")).split("|").map(s => s.trim());
    const loc = [...new Set(unesc(g("LOCATION")).split(",").map(s => s.trim()).filter(Boolean))].join(" / ");
    return {
      start: p(g("DTSTART")), end: p(g("DTEND")),
      title: parts[0].replace(/\s*(1ère|2ème|3ème) année\s*$/, ""),
      mode: parts[1] || "", prof: (parts[2] || "").split(",")[0].trim(), loc, note: unesc(g("DESCRIPTION")),
    };
  }).filter(e => !isNaN(e.start));
}

function embed(e) {
  const c = CAMPUS[campus(e.loc)];
  const fields = [
    { name: "🕒 Horaire", value: `${hm(e.start)} – ${hm(e.end)}`, inline: true },
    { name: "📍 Salle", value: e.loc ? `${e.loc}\n**${c.name}**` : "Non précisée", inline: true },
  ];
  if (e.prof) fields.push({ name: "👤 Intervenant", value: "`" + e.prof + "`", inline: true });
  if (e.note) fields.push({ name: "📝 Note", value: e.note.slice(0, 1000).replace(/(^|\s)(meet\.google\.com\/\S+)/g, "$1https://$2") });
  fields.push({ name: "🔗 Emploi du temps", value: `[Ouvrir mon EDT](${SITE})` });
  return { title: e.title, url: SITE, color: c.color, fields, footer: { text: "EDT GBS · " + c.name } };
}
async function send(e, label, { ping = true, extra = [] } = {}) {
  const evs = [e, ...extra];
  const body = {
    content: (ping && ROLE_ID ? `<@&${ROLE_ID}> ` : "") + label,
    allowed_mentions: { roles: ping && ROLE_ID ? [ROLE_ID] : [] },
    embeds: evs.map(embed),
  };
  const r = await fetch(DISCORD_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
  console.log(`Envoyé : ${label} — ${evs.map(x => x.title).join(", ")}`);
}

let txt;
try {
  const r = await fetch(ICAL); if (!r.ok) throw new Error(r.status);
  txt = await r.text(); if (!txt.includes("BEGIN:VCALENDAR")) throw new Error("iCal invalide");
} catch (err) {
  console.log("iCal live indisponible, utilisation de edt.ics :", err.message);
  txt = (await import("node:fs")).readFileSync(new URL("../edt.ics", import.meta.url), "utf8");
}
const events = parse(txt).sort((a, b) => a.start - b.start);
const now = new Date();

if (process.env.DEMO === "true") {
  const d = (h, m) => { const x = new Date(); x.setHours(h, m, 0, 0); return x; };
  await send(
    { start: d(9, 0), end: d(12, 0), title: "Cours fictif – Campus des quais", prof: "DUPONT Jean", loc: "H2 - Tanjiro", note: "" },
    process.env.TEST_MESSAGE || "Démo des couleurs de campus",
    { ping: false, extra: [{ start: d(14, 0), end: d(17, 0), title: "Cours fictif – Campus Lucien Faure", prof: "MARTIN Claire", loc: "105", note: "Lien : meet.google.com/abc-defg-hij" }] }
  );
  process.exit(0);
}
if (TEST === "true") {
  const next = events.find(e => e.start > now);
  if (next) await send(next, process.env.TEST_MESSAGE || "🧪 Test du bot — prochain cours :");
  process.exit(0);
}

const today = events.filter(e => e.start.toDateString() === now.toDateString());
const reminders = today.map((e, i) => {
  const before = i === 0 ? 60 : 15;
  return { e, at: new Date(e.start - before * 60000), label: i === 0 ? "⏰ Premier cours dans **1h** !" : "⏰ Cours dans **15 min** !" };
});

// Créneau de ce lancement (en UTC)
const utc = (s) => { const [h, m] = s.split(":").map(Number); const d = new Date(now); d.setUTCHours(h, m, 0, 0); return d; };
const slotStart = utc(SLOT_START), slotEnd = utc(SLOT_END);
const mine = reminders.filter(r => r.at >= slotStart && r.at < slotEnd && r.e.start > now);
console.log(`${today.length} cours aujourd'hui, ${mine.length} rappel(s) dans ce créneau.`);

for (const r of mine) {
  const wait = r.at - Date.now();
  if (wait > 0) { console.log(`Attente jusqu'à ${hm(r.at)} pour « ${r.e.title} »`); await sleep(wait); }
  await send(r.e, r.label);
}
