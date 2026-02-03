/**
 * Basic usage example for near-rpc-round-robin
 *
 * Run with: bun run example/basic-usage.ts
 */

import {
  createMainnetClient,
  createTestnetClient,
  callNftView,
  getAccountBalance,
} from '../src/index';

// Example 1: Basic NFT query
async function example1() {
  console.log('=== Example 1: Basic NFT Query ===\n');

  const client = createMainnetClient();

  const tokens = await callNftView(client, 'paras-fanatic.near', 'nft_tokens', {
    from_index: '0',
    limit: 5,
  });

  console.log('First 5 tokens:', tokens);
}

// Example 2: Custom endpoints
async function example2() {
  console.log('\n=== Example 2: Custom Endpoints ===\n');

  const client = createMainnetClient({
    endpoints: [
      'https://rpc.mainnet.near.org',
      'https://near.lava.build',
      'https://near.drpc.org',
    ],
    retries: 5,
    retryDelay: 300,
  });

  console.log('Endpoints:', client.getEndpoints());

  const supply = await callNftView(client, 'meme.near', 'nft_total_supply');
  console.log('Meme.near total supply:', supply);
}

// Example 3: Multiple contracts (like syncing holders)
async function example3() {
  console.log('\n=== Example 3: Multi-Contract Sync ===\n');

  const client = createMainnetClient();

  const CONTRACTS = [
    'paras-fanatic.near',
    'meme.near',
  ];

  for (const contract of CONTRACTS) {
    const supply = await callNftView(client, contract, 'nft_total_supply');
    console.log(`${contract}: ${supply} tokens`);

    // Small delay between requests
    await new Promise(r => setTimeout(r, 200));
  }
}

// Example 4: Get account balance
async function example4() {
  console.log('\n=== Example 4: Account Balance ===\n');

  const client = createMainnetClient();

  const balance = await getAccountBalance(client, 'near.near');
  console.log('NEAR foundation balance:', balance);
}

// Example 5: Testnet
async function example5() {
  console.log('\n=== Example 5: Testnet ===\n');

  const client = createTestnetClient();

  const balance = await getAccountBalance(client, 'test.near');
  console.log('Test account balance:', balance);
}

// Run all examples
async function main() {
  try {
    await example1();
    await example2();
    await example3();
    await example4();
    await example5();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
