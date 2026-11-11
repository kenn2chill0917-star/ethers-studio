/**
 * Arbitrum verification for the Hyperliquid history export of
 * 0xad9be64fd7a35d99a138b87cb212baefbcdcf045.
 *
 * Runs the three steps locally via the Etherscan v2 API (chainid 42161):
 *   1. QUERY        - all USDC token transfers to/from the address
 *   2. BALANCE      - current USDC + native ETH balances
 *   3. CONFIRMATION - receipt status + confirmation depth of inbound transfers
 *
 * Then cross-checks inbound USDC from the Hyperliquid bridge against the
 * 14 withdrawals listed in the CSV export (EXPECTED_WITHDRAWALS).
 *
 * Usage:
 *   ETHERSCAN_API_KEY=<your-key> npx tsx verify.ts
 */

const ADDRESS = "0xad9be64fd7a35d99a138b87cb212baefbcdcf045";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // native USDC on Arbitrum
// Hyperliquid's known Arbitrum bridge (edit here if it ever changes):
const HL_BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";
const CHAIN_ID = 42161; // Arbitrum One
const API = "https://api.etherscan.io/v2/api";

const KEY = process.env.ETHERSCAN_API_KEY;
if (!KEY) {
  console.error("ERROR: ETHERSCAN_API_KEY environment variable is not set.");
  process.exit(1);
}

// Withdrawals from the CSV (class=WITHDRAW), expected to arrive on Arbitrum as USDC.
const EXPECTED_WITHDRAWALS: { date: string; amount: number }[] = [
  { date: "2025-10-28", amount: 212_806.86 },
  { date: "2025-11-28", amount: 235_441.88 },
  { date: "2025-12-29", amount: 150_860.66 },
  { date: "2026-01-31", amount: 248_122.58 },
  { date: "2026-03-01", amount: 317_248.47 },
  { date: "2026-03-29", amount: 290_863.10 },
  { date: "2026-04-28", amount: 343_908.19 },
  { date: "2026-05-30", amount: 486_289.76 },
  { date: "2026-05-30", amount: 15_619.34 },
  { date: "2026-06-24", amount: 547_804.58 },
  { date: "2026-07-24", amount: 451_870.13 },
  { date: "2026-08-25", amount: 425_726.66 },
  { date: "2026-09-19", amount: 560_000.00 },
  { date: "2026-10-24", amount: 915_386.88 },
];
const EXPECTED_TOTAL = EXPECTED_WITHDRAWALS.reduce((s, w) => s + w.amount, 0);

interface TokenTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  blockNumber: string;
}

async function callApi<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ chainid: String(CHAIN_ID), apikey: KEY!, ...params });
  const res = await fetch(`${API}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} from Etherscan`);
  const json = (await res.json()) as { status: string; message: string; result: T | string };
  if (typeof json.result === "string" && json.status !== "1") {
    if (json.message === "No transactions found") return [] as unknown as T;
    throw new Error(`Etherscan error: ${json.message} (${json.result})`);
  }
  return json.result as T;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const dateOf = (ts: string) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);

async function main() {
  // ---- 2. BALANCE (cheap, do first) --------------------------------------
  console.log("== BALANCE ==");
  const ethWei = await callApi<string>({ module: "account", action: "balance", address: ADDRESS, tag: "latest" });
  console.log(`  Native ETH: ${(Number(ethWei) / 1e18).toFixed(6)} ETH`);
  const usdcRaw = await callApi<string>({ module: "account", action: "tokenbalance", contractaddress: USDC_ARBITRUM, address: ADDRESS, tag: "latest" });
  console.log(`  USDC:       ${fmt(Number(usdcRaw) / 1e6)} USDC`);

  // ---- 1. QUERY: all USDC transfers --------------------------------------
  console.log("\n== QUERY: USDC transfers ==");
  const all: TokenTx[] = [];
  for (let page = 1; ; page++) {
    const batch = await callApi<TokenTx[]>({
      module: "account", action: "tokentx",
      contractaddress: USDC_ARBITRUM, address: ADDRESS,
      page: String(page), offset: "1000", sort: "asc",
    });
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  const inbound = all.filter((t) => t.to.toLowerCase() === ADDRESS);
  const outbound = all.filter((t) => t.from.toLowerCase() === ADDRESS);
  const fromBridge = inbound.filter((t) => t.from.toLowerCase() === HL_BRIDGE);
  const sum = (txs: TokenTx[]) => txs.reduce((s, t) => s + Number(t.value) / 1e6, 0);
  console.log(`  Total transfers: ${all.length} (in: ${inbound.length}, out: ${outbound.length})`);
  console.log(`  Total in:  ${fmt(sum(inbound))} USDC`);
  console.log(`  Total out: ${fmt(sum(outbound))} USDC`);
  console.log(`  Inbound from Hyperliquid bridge (${HL_BRIDGE}): ${fromBridge.length} txs, ${fmt(sum(fromBridge))} USDC`);
  for (const t of fromBridge.slice(-20)) {
    console.log(`    ${dateOf(t.timeStamp)}  +${fmt(Number(t.value) / 1e6)}  ${t.hash}`);
  }

  // ---- Cross-check against CSV withdrawals --------------------------------
  console.log("\n== CROSS-CHECK: CSV withdrawals vs bridge arrivals ==");
  const unmatched = [...fromBridge];
  let matchedTotal = 0;
  for (const w of EXPECTED_WITHDRAWALS) {
    const hit = unmatched.find(
      (t) => Math.abs(Number(t.value) / 1e6 - w.amount) / w.amount < 0.01 && Math.abs(Number(t.timeStamp) * 1000 - Date.parse(w.date)) < 3 * 86400_000
    );
    if (hit) {
      matchedTotal += w.amount;
      unmatched.splice(unmatched.indexOf(hit), 1);
      console.log(`  MATCH   ${w.date}  expected ${fmt(w.amount)}  got ${fmt(Number(hit.value) / 1e6)}  (${hit.hash.slice(0, 18)}...)`);
    } else {
      console.log(`  MISSING ${w.date}  expected ${fmt(w.amount)}  — no matching inbound USDC found`);
    }
  }

  // ---- 3. CONFIRMATION: receipt status + depth for recent inbound ---------
  console.log("\n== CONFIRMATION: latest inbound transfers ==");
  const latestBlock = parseInt(await callApi<string>({ module: "proxy", action: "eth_blockNumber" }), 16);
  for (const t of fromBridge.slice(-5)) {
    const receipt = await callApi<{ status: string }>({ module: "transaction", action: "gettxreceiptstatus", txhash: t.hash });
    const confs = latestBlock - parseInt(t.blockNumber, 10);
    console.log(`  ${t.hash.slice(0, 18)}...  status=${receipt.status === "1" ? "SUCCESS" : "FAILED"}  confirmations=${confs.toLocaleString()}`);
  }

  // ---- Verdict -------------------------------------------------------------
  console.log("\n== VERDICT ==");
  console.log(`  Expected from CSV:   ${fmt(EXPECTED_TOTAL)} USDC`);
  console.log(`  Matched on Arbitrum: ${fmt(matchedTotal)} USDC`);
  console.log(`  Total ever received from bridge: ${fmt(sum(fromBridge))} USDC`);
  if (fromBridge.length === 0) {
    console.log("  ❌ NO USDC ever arrived from the Hyperliquid bridge — the CSV withdrawals cannot be confirmed onchain.");
  } else if (Math.abs(matchedTotal - EXPECTED_TOTAL) / EXPECTED_TOTAL < 0.02) {
    console.log("  ✅ Arbitrum inflows match the CSV withdrawal history.");
  } else {
    console.log("  ⚠️  Partial match only — review the MISSING lines above.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
