// Fonctions communes aux scripts Discord (heure de Paris)
process.env.TZ = "Europe/Paris";

export const SITE = "https://rcpsftn-alt.github.io/edt-gbs/";
export const CAMPUS = {
  A: { name: "Campus des quais", color: 0x3d8bff, maps: "https://www.google.com/maps/search/?api=1&query=Gaming+Campus+Hangar+16+Quai+de+Bacalan+33300+Bordeaux" },
  B: { name: "Campus Lucien Faure", color: 0xff8c1a, maps: "https://www.google.com/maps/search/?api=1&query=Rue+Lucien+Faure+33300+Bordeaux" },
  X: { name: "Salle non précisée", color: 0x6b7280, maps: "" },
};
export const campusOf = l => /(^|\W)(H\d|Amphi)/i.test(l || "") ? "A" : /(^|\D)1\d\d(\D|$)/.test(l || "") ? "B" : "X";
export const ROLE_ID = process.env.ROLE_ID || "";
const WEBHOOK = process.env.DISCORD_WEBHOOK;

const unesc = s => (s || "").replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
const mk = (d, hm = "0000") => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +hm.slice(0, 2), +hm.slice(2, 4));
export const hm = d => String(d.getHours()).padStart(2, "0") + "h" + String(d.getMinutes()).padStart(2, "0");
export const dayLabel = d => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
export const sameDay = (a, b) => a.toDateString() === b.toDateString();
export const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
export const linkify = s => (s || "").replace(/(^|\s)(meet\.google\.com\/\S+)/g, "$1https://$2");

export function parse(txt) {
  txt = txt.replace(/\r?\n[ \t]/g, "");
  return txt.split("BEGIN:VEVENT").slice(1).map(b => {
    const g = k => (b.match(new RegExp("^" + k + "[^:\\r\\n]*:(.*)$", "m")) || [])[1]?.trim() || "";
    const p = s => { const m = s.match(/(\d{8})T?(\d{4})?/); return m ? mk(m[1], m[2] || "0000") : new Date(NaN); };
    const parts = unesc(g("SUMMARY")).split("|").map(s => s.trim());
    const loc = [...new Set(unesc(g("LOCATION")).split(",").map(s => s.trim()).filter(Boolean))].join(" / ");
    return {
      uid: g("UID"), start: p(g("DTSTART")), end: p(g("DTEND")),
      title: parts[0].replace(/\s*(1ère|2ème|3ème) année\s*$/, ""),
      mode: parts[1] || "", prof: (parts[2] || "").split(",")[0].trim(), loc, note: unesc(g("DESCRIPTION")),
    };
  }).filter(e => !isNaN(e.start)).sort((a, b) => a.start - b.start);
}

export async function loadEvents() {
  try {
    const r = await fetch(process.env.ICAL); if (!r.ok) throw new Error("HTTP " + r.status);
    const t = await r.text(); if (!t.includes("BEGIN:VCALENDAR")) throw new Error("iCal invalide");
    return parse(t);
  } catch (err) {
    console.log("iCal live indisponible, utilisation de edt.ics :", err.message);
    const fs = await import("node:fs");
    return parse(fs.readFileSync(new URL("../edt.ics", import.meta.url), "utf8"));
  }
}

export function courseEmbed(e, extra = {}) {
  const c = CAMPUS[campusOf(e.loc)];
  const fields = [
    { name: "🕒 Horaire", value: `${hm(e.start)} – ${hm(e.end)}`, inline: true },
    { name: "📍 Salle", value: e.loc ? `${e.loc}\n**${c.maps ? `[${c.name}](${c.maps})` : c.name}**` : "Non précisée", inline: true },
  ];
  if (e.prof) fields.push({ name: "👤 Intervenant", value: "`" + e.prof + "`", inline: true });
  if (e.note) fields.push({ name: "📝 Note", value: linkify(e.note).slice(0, 1000) });
  fields.push({ name: "🔗 Emploi du temps", value: `[Ouvrir mon EDT](${SITE})` });
  return { title: e.title, url: SITE, color: c.color, fields, footer: { text: "EDT GBS · " + c.name }, ...extra };
}

/** Envoie un message sur le webhook. files: [{name, data: Buffer, type}] */
export async function post({ content = "", embeds = [], ping = false, files = [] }) {
  if (!WEBHOOK) throw new Error("Secret DISCORD_WEBHOOK manquant");
  const payload = {
    content: (ping && ROLE_ID ? `<@&${ROLE_ID}> ` : "") + content,
    allowed_mentions: { roles: ping && ROLE_ID ? [ROLE_ID] : [] },
    embeds: embeds.slice(0, 10),
  };
  let opts;
  if (files.length) {
    const fd = new FormData();
    fd.append("payload_json", JSON.stringify(payload));
    files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.data], { type: f.type || "application/octet-stream" }), f.name));
    opts = { method: "POST", body: fd };
  } else {
    opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
  }
  const r = await fetch(WEBHOOK, opts);
  if (!r.ok) throw new Error(`Discord ${r.status}: ${await r.text()}`);
  console.log("Envoyé :", content.slice(0, 80), embeds.map(e => e.title).filter(Boolean).join(" | "));
}

/** Créneaux libres (≥ 30 min) entre les cours d'une journée */
export function freeSlots(dayEvents) {
  const out = [];
  for (let i = 1; i < dayEvents.length; i++) {
    const a = dayEvents[i - 1].end, b = dayEvents[i].start;
    if (b - a >= 30 * 60000) out.push([a, b]);
  }
  return out;
}

/** Blocs de partiels : partiels regroupés si moins de 4 jours d'écart */
export function examBlocks(events) {
  const ex = events.filter(e => /partiel/i.test(e.title));
  const blocks = [];
  for (const e of ex) {
    const last = blocks[blocks.length - 1];
    if (last && e.start - last[last.length - 1].start < 4 * 864e5) last.push(e); else blocks.push([e]);
  }
  return blocks;
}
export const daysUntil = (d, now = new Date()) => {
  const a = new Date(d); a.setHours(0, 0, 0, 0); const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / 864e5);
};

/* ---------- Programme du jour ---------- */
export async function programme(events, day, { manual = false, ping = false, prefix = "" } = {}) {
  const list = events.filter(e => sameDay(e.start, day));
  const wd = day.getDay();
  if (!list.length) {
    if (wd >= 1 && wd <= 5 || manual) await post({ content: (prefix ? prefix + "\n" : "") + `☀️ **${dayLabel(day)}** — pas cours aujourd'hui 😴`, ping: manual && ping });
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
    content: (prefix ? prefix + "\n" : "") + `☀️ **Programme du ${dayLabel(day)}** — ${list.length} cours · ${Math.round(tot * 10) / 10} h`,
    embeds: [{
      color: CAMPUS[campusOf(first.loc)].color,
      description: lines.join("\n\n").slice(0, 3800) + (free.length ? `\n\n🟩 **Créneaux libres** : ${free.join(" · ")}` : "") + `\n\n[Ouvrir mon EDT](${SITE})`,
    }],
    ping: manual && ping,
  });
}

/* ---------- Compte à rebours des partiels ---------- */
export async function partiels(events, now, { force = false, ping = false, prefix = "" } = {}) {
  for (const block of examBlocks(events)) {
    const j = daysUntil(block[0].start, now);
    if (!force && ![7, 3, 1].includes(j)) continue;
    if (force && j < 0) continue;
    const lines = block.map(e => `**${dayLabel(e.start)}** · \`${hm(e.start)}–${hm(e.end)}\`\n${e.title.replace(/^Partiels S\d\s*[–-]\s*/, "")}${e.loc ? ` · 📍 ${e.loc} (${CAMPUS[campusOf(e.loc)].name})` : ""}${e.note ? `\n> ⚠️ ${e.note.replace(/\n+/g, " ").trim()}` : ""}`);
    await post({
      content: (prefix ? prefix + "\n" : "") + `📚 **Partiels dans ${j} jour${j > 1 ? "s" : ""}** (J-${j}) — ${block.length} épreuve${block.length > 1 ? "s" : ""}`,
      embeds: [{ color: 0xff5c7a, title: `Partiels du ${block[0].start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}${block.length > 1 ? ` au ${block[block.length - 1].start.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}`, url: SITE, description: lines.join("\n\n").slice(0, 4000) }],
      ping: force ? ping : true,
    });
    if (force) break; // en manuel : seulement le prochain bloc
  }
}

