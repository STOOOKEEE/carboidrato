// Génère la section [amendments] du nœud alphanet local :
// amendments actifs sur le devnet ET connus du build alphanet, plus les extras demandés (V1_2).
// Usage : node infra/alphanet/gen-amendments.mjs > infra/alphanet/amendments.cfg

import { createHash } from "node:crypto";

const DEVNET_WS = "wss://s.devnet.rippletest.net:51233";
const ALPHANET_COMMIT = "e94e578da08a039c5f6dc885984ba593160e1413";
const FEATURES_MACRO_URL = `https://raw.githubusercontent.com/XRPLF/rippled/${ALPHANET_COMMIT}/include/xrpl/protocol/detail/features.macro`;
const EXTRA_AMENDMENTS = ["LendingProtocolV1_2"];
const AMENDMENT_ID_HEX_LENGTH = 64;

// Identifiant d'un amendment = les 256 premiers bits du SHA-512 de son nom.
function amendmentId(name) {
  return createHash("sha512").update(name).digest("hex").slice(0, AMENDMENT_ID_HEX_LENGTH).toUpperCase();
}

async function alphanetAmendmentNames() {
  const response = await fetch(FEATURES_MACRO_URL);
  if (!response.ok) throw new Error(`features.macro : HTTP ${response.status}`);
  const macro = await response.text();
  const names = new Set();
  for (const [, kind, name] of macro.matchAll(/^XRPL_(FEATURE|FIX)\s*\((\w+)/gm)) {
    names.add(kind === "FIX" ? `fix${name}` : name);
  }
  return names;
}

function devnetEnabledFeatures() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(DEVNET_WS);
    ws.onopen = () => ws.send(JSON.stringify({ command: "feature" }));
    ws.onmessage = (msg) => {
      ws.close();
      const features = JSON.parse(msg.data).result?.features;
      if (!features) return reject(new Error("réponse feature inattendue"));
      resolve(Object.entries(features).filter(([, f]) => f.enabled).map(([id, f]) => ({ id, name: f.name })));
    };
    ws.onerror = (event) => reject(new Error(event.message ?? "erreur réseau"));
  });
}

const [known, devnet] = await Promise.all([alphanetAmendmentNames(), devnetEnabledFeatures()]);

for (const { id, name } of devnet) {
  if (amendmentId(name) !== id) throw new Error(`hash incohérent pour ${name}`);
}
for (const name of EXTRA_AMENDMENTS) {
  if (!known.has(name)) throw new Error(`${name} absent du build alphanet`);
}

const selected = [...new Set([...devnet.map((f) => f.name).filter((n) => known.has(n)), ...EXTRA_AMENDMENTS])].sort();
const skipped = devnet.map((f) => f.name).filter((n) => !known.has(n));

console.log(`# Généré par gen-amendments.mjs : ${selected.length} amendments (devnet ∩ alphanet + ${EXTRA_AMENDMENTS.join(", ")})`);
if (skipped.length) console.log(`# Actifs sur devnet mais absents du build (retirés = toujours actifs, ou inconnus) : ${skipped.join(", ")}`);
console.log("[amendments]");
for (const name of selected) console.log(`${amendmentId(name)} ${name}`);
