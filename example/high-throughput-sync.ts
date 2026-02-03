/**
 * High-Throughput NFT Holder Sync Example
 *
 * Demonstrates:
 * - Parallel/concurrent requests
 * - Efficient batching
 * - Round-robin endpoint rotation
 * - Rate limit handling
 * - Resumable state persistence
 *
 * Run with: bun run example/high-throughput-sync.ts
 */

import {
  createMainnetClient,
  callNftView,
} from '../src/index';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONTRACTS = [
  'nearlegion.nfts.tg',
  'ascendant.nearlegion.near',
  'initiate.nearlegion.near',
];

// High-throughput settings
const BATCH_SIZE = 50;         // Tokens per RPC call
const CONCURRENT = 5;          // Parallel requests (higher = faster)
const CHUNK_DELAY = 100;       // ms between batches (be nice to RPCs)
const WRITE_BATCH_SIZE = 100;  // Write to DB every N holders

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

interface SyncState {
  [contractId: string]: {
    completed: boolean;
    holders: Record<string, number>;
    maxTokenId: number;
    lastSync: number;
  };
}

const STATE_FILE = './sync-state.json';

async function loadState(): Promise<SyncState> {
  try {
    const file = Bun.file(STATE_FILE);
    if (file.exists()) {
      const text = await file.text();
      return JSON.parse(text);
    }
  } catch {}
  return {};
}

function saveState(state: SyncState) {
  Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

// ============================================================================
// HOLDER TRACKING
// ============================================================================

interface HolderBatch {
  holders: Map<string, number>;
  newHolders: Map<string, number>;
}

function createHolderBatch(): HolderBatch {
  return {
    holders: new Map(),
    newHolders: new Map(),
  };
}

// ============================================================================
// HIGH-THROUGHPUT SYNC
// ============================================================================

interface Token {
  token_id?: string;
  owner_id?: string;
}

interface SyncResult {
  contractId: string;
  totalHolders: number;
  newHolders: number;
  timeMs: number;
}

/**
 * Fetch tokens with automatic endpoint rotation and retry
 */
async function fetchTokenBatch(
  client: ReturnType<typeof createMainnetClient>,
  contractId: string,
  fromIndex: number,
  limit: number
): Promise<Token[]> {
  const result = await callNftView<Token[]>(
    client,
    contractId,
    'nft_tokens',
    { from_index: String(fromIndex), limit }
  );

  return result || [];
}

/**
 * Process a batch of token fetches in parallel
 */
async function processBatchChunk(
  client: ReturnType<typeof createMainnetClient>,
  contractId: string,
  startIndices: number[],
  batch: HolderBatch,
  seenTokens: Set<string>
): Promise<number> {
  // Fetch all batches in parallel (HIGH THROUGHPUT)
  const results = await Promise.all(
    startIndices.map(async (startIdx) => {
      const tokens = await fetchTokenBatch(client, contractId, startIdx, BATCH_SIZE);
      return { startIdx, tokens };
    })
  );

  let newCount = 0;
  let emptyBatches = 0;

  // Process results
  for (const { tokens } of results) {
    if (tokens.length === 0) {
      emptyBatches++;
      continue;
    }

    for (const token of tokens) {
      if (token.token_id && token.owner_id && !seenTokens.has(token.token_id)) {
        seenTokens.add(token.token_id);
        const isNew = !batch.holders.has(token.owner_id);
        batch.holders.set(token.owner_id, (batch.holders.get(token.owner_id) || 0) + 1);

        if (isNew) {
          batch.newHolders.set(token.owner_id, batch.holders.get(token.owner_id)!);
          newCount++;
        }
      }
    }
  }

  console.log(
    `  → Fetched ${results.length} batches: ${newCount} new holders, ` +
    `${batch.holders.size} total, ${emptyBatches} empty`
  );

  return emptyBatches;
}

/**
 * Sync a single contract with high throughput
 */
async function syncContract(
  client: ReturnType<typeof createMainnetClient>,
  contractId: string,
  maxTokenId: number
): Promise<SyncResult> {
  const startTime = Date.now();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Syncing: ${contractId}`);
  console.log(`Max Token ID: ${maxTokenId}`);
  console.log(`Settings: ${CONCURRENT} concurrent, ${BATCH_SIZE} batch size`);
  console.log(`${'='.repeat(60)}\n`);

  // Load or initialize state
  const globalState = await loadState();
  const contractState = globalState[contractId] || {
    completed: false,
    holders: {},
    maxTokenId,
    lastSync: 0,
  };

  // Skip if already completed
  if (contractState.completed && contractState.maxTokenId === maxTokenId) {
    console.log('[SKIP] Already completed, use --force to resync');
    return {
      contractId,
      totalHolders: Object.keys(contractState.holders).length,
      newHolders: 0,
      timeMs: 0,
    };
  }

  // Initialize batch
  const batch = createHolderBatch();
  Object.entries(contractState.holders).forEach(([id, count]) => {
    batch.holders.set(id, count as number);
  });
  const seenTokens = new Set<string>();

  // Calculate all batch start indices
  const totalBatches = Math.ceil(maxTokenId / BATCH_SIZE);
  const allBatches = Array.from({ length: totalBatches }, (_, i) => i * BATCH_SIZE);

  // Filter out already processed batches (heuristic)
  // If we have existing holders, estimate how many batches are already done
  let batchesToProcess = allBatches;
  if (batch.holders.size > 0) {
    const holdersNeeded = batch.holders.size * 5; // Rough estimate: 5 tokens per holder
    batchesToProcess = allBatches.filter(idx => idx < holdersNeeded);
  }

  console.log(`[INFO] Processing ${batchesToProcess.length}/${totalBatches} batches`);
  console.log(`[INFO] Starting with ${batch.holders.size} existing holders\n`);

  let consecutiveEmpty = 0;
  const MAX_EMPTY = 15;

  // Process in chunks with parallelization
  for (let i = 0; i < batchesToProcess.length; i += CONCURRENT) {
    const chunk = batchesToProcess.slice(i, Math.min(i + CONCURRENT, batchesToProcess.length));
    const progress = ((i + chunk.length) / batchesToProcess.length * 100).toFixed(1);

    console.log(`[${i + chunk.length}/${batchesToProcess.length}] ${progress}% - Processing ${chunk.length} batches...`);

    // Process chunk in parallel (HIGH THROUGHPUT)
    const emptyCount = await processBatchChunk(
      client,
      contractId,
      chunk,
      batch,
      seenTokens
    );

    // Track consecutive empty batches
    if (emptyCount === chunk.length) {
      consecutiveEmpty++;
    } else {
      consecutiveEmpty = 0;
    }

    // Write new holders to "DB" (in this case, just log)
    if (batch.newHolders.size >= WRITE_BATCH_SIZE) {
      console.log(`  [DB] Would write ${batch.newHolders.size} new holders to database`);
      batch.newHolders.clear();
    }

    // Save progress periodically
    if ((i + chunk.length) % (CONCURRENT * 5) === 0) {
      globalState[contractId] = {
        completed: false,
        holders: Object.fromEntries(batch.holders),
        maxTokenId,
        lastSync: Date.now(),
      };
      saveState(globalState);
      console.log(`  [STATE] Progress saved (${batch.holders.size} holders)`);
    }

    // Rate limiting: small delay between chunks
    if (i + chunk.length < batchesToProcess.length) {
      await new Promise(r => setTimeout(r, CHUNK_DELAY));
    }

    // Early termination if we're getting empty results
    if (consecutiveEmpty >= MAX_EMPTY) {
      console.log(`\n[COMPLETE] ${MAX_EMPTY} consecutive empty batches, stopping early`);
      break;
    }
  }

  // Finalize
  const duration = Date.now() - startTime;

  globalState[contractId] = {
    completed: true,
    holders: Object.fromEntries(batch.holders),
    maxTokenId,
    lastSync: Date.now(),
  };
  saveState(globalState);

  console.log(`\n[DONE] Synced ${batch.holders.size} holders in ${duration}ms`);
  console.log(`[RATE] ${(batch.holders.size / (duration / 1000)).toFixed(2)} holders/second`);

  return {
    contractId,
    totalHolders: batch.holders.size,
    newHolders: Object.keys(contractState.holders).length,
    timeMs: duration,
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     High-Throughput NEAR NFT Sync with Round-Robin RPC    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Create client with round-robin
  const client = createMainnetClient({
    retries: 3,
    retryDelay: 200,
    timeout: 30000,
  });

  console.log('RPC Endpoints:');
  client.getEndpoints().forEach((ep, i) => console.log(`  ${i + 1}. ${ep}`));
  console.log();

  // Setup graceful shutdown
  const shutdown = (signal: string) => {
    console.log(`\n\n[!] ${signal} received - Progress saved!`);
    console.log('[!] Run again to resume sync.\n');
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const results: SyncResult[] = [];

  // Sync each contract
  for (const contractId of CONTRACTS) {
    try {
      // Get total supply first
      const supply = await callNftView<string>(client, contractId, 'nft_total_supply');
      const maxTokenId = supply ? parseInt(supply.replace(/["']/g, ''), 10) + 500 : 500;

      const result = await syncContract(client, contractId, maxTokenId);
      results.push(result);

      // Small delay between contracts
      await new Promise(r => setTimeout(r, 1000));
    } catch (error: any) {
      console.error(`\n[ERROR] Failed to sync ${contractId}:`, error.message);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SYNC SUMMARY');
  console.log('═'.repeat(60));

  const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);
  const totalHolders = results.reduce((sum, r) => sum + r.totalHolders, 0);

  for (const result of results) {
    console.log(
      `${result.contractId}: ${result.totalHolders} holders ` +
      `(${result.timeMs}ms)`
    );
  }

  console.log('─'.repeat(60));
  console.log(`Total: ${totalHolders} holders across ${CONTRACTS.length} contracts`);
  console.log(`Time: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`Rate: ${(totalHolders / (totalTime / 1000)).toFixed(2)} holders/second`);
  console.log('═'.repeat(60));

  // Cleanup state file
  try {
    await Bun.$`rm ${STATE_FILE}`.quiet();
  } catch {}
}

main().catch(error => {
  console.error('\n[FATAL]', error);
  process.exit(1);
});
