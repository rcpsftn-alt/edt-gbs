// Récap de la semaine (dimanche 20h) : rend l'image de la semaine à venir avec la page du site
// et l'envoie sur Discord avec un résumé.
import { post, parse, hm, CAMPUS, campusOf, SITE } from "./lib.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const types = { ".html": "text/html; charset=utf-8", ".ics": "text/plain; charset=utf-8", ".txt": "text/plain" };
const server = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!f.startsWith(root) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s);
}).listen(0);
const port = server.address().port;

// Semaine à venir : lundi prochain (ou lundi courant en semaine)
const now = new Date();
const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
if (now.getDay() === 0 || now.getDay() === 6) mon.setDate(mon.getDate() + 7);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "Europe/Paris", locale: "fr-FR" });
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction(() => document.getElementById("sync")?.textContent.includes("auto"), null, { timeout: 15000 }).catch(() => {});
const png = await page.evaluate(async (monIso) => {
  await Promise.all(['800 20px Inter', '700 20px Inter', '600 20px Inter', '500 20px "JetBrains Mono"'].map(f => document.fonts.load(f))).catch(() => {});
  wk = new Date(monIso); xFmt = "land";
  const cv = document.createElement("canvas"); cv.width = 1600; cv.height = 1000;
  drawWeek(cv.getContext("2d"), 1600, 1000, 1);
  return cv.toDataURL("image/png").split(",")[1];
}, mon.toISOString());
if (process.env.DEBUG_PNG) fs.writeFileSync(process.env.DEBUG_PNG, Buffer.from(png, "base64"));
await browser.close(); server.close();

// Résumé texte
const evs = parse(fs.readFileSync(path.join(root, "edt.ics"), "utf8"));
const end = new Date(mon); end.setDate(end.getDate() + 7);
const week = evs.filter(e => e.start >= mon && e.start < end);
const tot = week.reduce((s, e) => s + (e.end - e.start), 0) / 36e5;
const days = [...Array(7)].map((_, i) => { const d = new Date(mon); d.setDate(d.getDate() + i); return d; })
  .map(d => {
    const l = week.filter(e => e.start.toDateString() === d.toDateString());
    if (!l.length) return null;
    const camp = [...new Set(l.map(e => campusOf(e.loc)))].map(k => k === "A" ? "🟦" : k === "B" ? "🟧" : "⬜").join("");
    return `**${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })}** ${camp} \`${hm(l[0].start)}–${hm(l[l.length - 1].end)}\` · ${l.map(e => e.title.replace(/\s*\(.*?\)\s*/g, " ").trim()).filter((t, i, a) => a.indexOf(t) === i).join(", ")}`;
  }).filter(Boolean);
const title = `Semaine du ${mon.getDate()} au ${new Date(end - 3 * 864e5).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
await post({
  content: (process.env.TEST_MESSAGE ? process.env.TEST_MESSAGE + "\n" : "") + `🗓️ **Récap de la semaine** — ${week.length} cours · ${Math.round(tot * 10) / 10} h`,
  embeds: [{ title, url: SITE, color: 0x7c5cff, description: (days.join("\n") || "Aucun cours cette semaine 😴").slice(0, 4000) + `\n\n🟦 ${CAMPUS.A.name}  🟧 ${CAMPUS.B.name}`, image: { url: "attachment://semaine.png" } }],
  files: [{ name: "semaine.png", data: Buffer.from(png, "base64"), type: "image/png" }],
  ping: process.env.PING === "true",
});
