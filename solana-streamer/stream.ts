import Client, {
  CommitmentLevel,
  SubscribeRequest,
} from "@triton-one/yellowstone-grpc";
import bs58 from "bs58";

const ENDPOINT = "https://solana-mainnet.streaming.alchemy.com";
const X_TOKEN = process.env.ALCHEMY_API_KEY;

if (!X_TOKEN) {
  console.error("ERROR: ALCHEMY_API_KEY environment variable is not set.");
  process.exit(1);
}

let accountUpdates = 0;
let transactions = 0;
let other = 0;
const startedAt = Date.now();

async function main() {
  const client = new Client(ENDPOINT, X_TOKEN, undefined);
  await client.connect();

  // Open bidirectional subscription stream
  const stream = await client.subscribe();

  // Create stream request: filter account updates & transactions
  const request: SubscribeRequest = {
    accounts: {
      myAccounts: {
        account: [],
        owner: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"], // Example: SPL Token Program
        filters: [],
      },
    },
    transactions: {
      allTxs: {
        vote: false,   // Filter out validator votes
        failed: false, // Filter out failed txs
        signature: undefined,
        accountInclude: [],
        accountExclude: [],
        accountRequired: [],
      },
    },
    slots: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    blockFooter: {},
    entry: {},
    commitment: CommitmentLevel.CONFIRMED,
    accountsDataSlice: [],
    ping: undefined,
  };

  // Listen for incoming Geyser messages
  stream.on("data", (data) => {
    if (data.account?.account) {
      accountUpdates++;
      const pubkey = bs58.encode(Buffer.from(data.account.account.pubkey));
      console.log(`[Account Update] Slot: ${data.account.slot} | Pubkey (Base58): ${pubkey}`);
    } else if (data.transaction?.transaction) {
      transactions++;
      const sig = bs58.encode(Buffer.from(data.transaction.transaction.signature));
      console.log(`[Transaction] Slot: ${data.transaction.slot} | Sig (Base58): ${sig}`);
    } else {
      other++;
    }
  });

  stream.on("error", (err) => {
    console.error("Stream error:", err);
  });

  stream.on("end", () => {
    console.log("Stream ended.");
    printStats();
    process.exit(0);
  });

  // Periodic stats so the firehose volume is observable
  const statsTimer = setInterval(printStats, 5000);

  function printStats() {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(
      `[Stats] ${secs}s elapsed | transactions: ${transactions} | account updates: ${accountUpdates} | other: ${other}`
    );
  }

  function shutdown() {
    clearInterval(statsTimer);
    console.log("\nShutting down...");
    printStats();
    stream.destroy();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Send the subscription request
  await new Promise<void>((resolve, reject) => {
    stream.write(request, (err?: Error | null) => {
      if (err) return reject(err);
      console.log("Subscription request active.");
      resolve();
    });
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
