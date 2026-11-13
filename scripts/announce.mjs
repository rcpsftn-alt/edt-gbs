// Poste une annonce (fichier JSON dans annonces/) sur Discord, sans ping par défaut.
import { post } from "./lib.mjs";
import fs from "node:fs";
const file = process.env.ANNONCE || "annonces/patch-v1.json";
const a = JSON.parse(fs.readFileSync(file, "utf8"));
await post({ content: a.content, embeds: a.embeds, ping: process.env.PING === "true" });
