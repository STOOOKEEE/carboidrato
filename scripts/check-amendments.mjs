// Vérifie qu'un ou plusieurs nœuds XRPL ont activé les amendments dont le projet a besoin.
// Usage : node scripts/check-amendments.mjs [wss://url ...]   (défaut : $XRPL_WS, sinon devnet)

const DEVNET_WS = "wss://s.devnet.rippletest.net:51233";
const TIMEOUT_MS = 10_000;

const REQUIRED = [
  "MPTokensV1",
  "ConfidentialTransfer",
  "SingleAssetVault",
  "LendingProtocol",
  "LendingProtocolV1_1",
  "Credentials",
  "PermissionedDomains",
  "BatchV1_1",
  "fixBatchV1_2",
];
const OPTIONAL = ["LendingProtocolV1_2", "TokenEscrow"];

function fetchFeatures(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timeout"));
    }, TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify({ command: "feature" }));
    ws.onmessage = (msg) => {
      clearTimeout(timer);
      ws.close();
      const features = JSON.parse(msg.data).result?.features;
      if (!features) return reject(new Error(`réponse inattendue : ${String(msg.data).slice(0, 200)}`));
      resolve(Object.fromEntries(Object.values(features).map((f) => [f.name, f])));
    };
    ws.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(event.message ?? "erreur réseau"));
    };
  });
}

function status(feature) {
  if (!feature) return "ABSENT (inconnu du serveur)";
  return feature.enabled ? "ENABLED" : "supporté, NON activé";
}

async function check(url) {
  console.log(`\n== ${url}`);
  let features;
  try {
    features = await fetchFeatures(url);
  } catch (error) {
    console.log(`   injoignable : ${error.message}`);
    return false;
  }
  let ok = true;
  for (const name of REQUIRED) {
    const enabled = features[name]?.enabled === true;
    ok &&= enabled;
    console.log(`   ${enabled ? "✓" : "✗"} ${name.padEnd(22)} ${status(features[name])}`);
  }
  for (const name of OPTIONAL) {
    console.log(`   ${features[name]?.enabled ? "✓" : "·"} ${name.padEnd(22)} ${status(features[name])} (optionnel)`);
  }
  console.log(`   => ${ok ? "tous les amendments requis sont actifs" : "il manque des amendments requis"}`);
  return ok;
}

const urls = process.argv.slice(2);
if (urls.length === 0) urls.push(process.env.XRPL_WS ?? DEVNET_WS);

const results = [];
for (const url of urls) results.push(await check(url));
process.exitCode = results.every(Boolean) ? 0 : 1;
