# arbitrum-verify

Verifies onchain (Arbitrum One) whether the USDC withdrawals listed in the
Hyperliquid history CSV for `0xad9be64fd7a35d99a138b87cb212baefbcdcf045`
actually arrived.

Runs three steps via the Etherscan v2 API (`chainid=42161`):

1. **QUERY** — every USDC transfer to/from the address, split by counterparty,
   with inbound transfers from the Hyperliquid bridge listed individually.
2. **BALANCE** — current USDC and native ETH balances.
3. **CONFIRMATION** — receipt status (success/failed) and confirmation depth
   of the most recent inbound bridge transfers.

Finally it cross-checks the 14 CSV withdrawals (dates + amounts baked into
`verify.ts`) against actual bridge arrivals and prints a verdict.

## Usage

```bash
npm install
ETHERSCAN_API_KEY=<your-etherscan-key> npx tsx verify.ts
```

A free Etherscan API key works (https://etherscan.io/apis). The bridge address
is a constant at the top of `verify.ts` (`HL_BRIDGE`) if it ever needs updating.
