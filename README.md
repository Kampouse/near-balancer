# NEAR Balancer

> High-performance NEAR RPC client with automatic load balancing, round-robin rotation, and intelligent retry logic.

[![npm version](https://badge.fury.io/js/near-balancer.svg)](https://www.npmjs.com/package/near-balancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Round-robin Load Balancing** - Automatically distributes requests across multiple RPC endpoints
- **Automatic Retry** - Retries failed requests with exponential backoff
- **Rate Limit Handling** - Gracefully handles 429 responses by rotating to next endpoint
- **Request Timeout** - Prevents hanging requests with configurable timeout
- **TypeScript** - Fully typed for excellent developer experience
- **Zero Dependencies** - Uses only native `fetch` API
- **High Throughput** - Optimized for parallel/concurrent operations
- **Resumable Operations** - Built-in state management for long-running syncs

## Installation

```bash
npm install near-balancer
# or
bun add near-balancer
# or
yarn add near-balancer
```

## Quick Start

```typescript
import { createMainnetClient } from 'near-balancer';

// Create client with default mainnet endpoints
const client = createMainnetClient();

// Call NFT method
const tokens = await client.callNftView(
  'meme.near',
  'nft_tokens',
  { from_index: '0', limit: 10 }
);

console.log(tokens);
```

## Configuration

### Custom Endpoints

```typescript
import { createRpcClient } from 'near-balancer';

const client = createRpcClient({
  endpoints: [
    'https://rpc.mainnet.near.org',
    'https://near.lava.build',
    'https://your-custom-rpc.com',
  ],
  retries: 5,           // Number of retries (default: 3)
  retryDelay: 500,      // Delay between retries in ms (default: 200)
  timeout: 60000,       // Request timeout in ms (default: 30000)
});
```

### Preconfigured Clients

```typescript
import { createMainnetClient, createTestnetClient } from 'near-balancer';

// Mainnet with 5 public endpoints
const mainnet = createMainnetClient();

// Testnet with 2 public endpoints
const testnet = createTestnetClient();
```

## API Reference

### `createRpcClient(config)`

Creates a new RPC client instance with custom configuration.

```typescript
const client = createRpcClient({
  endpoints: string[],    // Required: List of RPC endpoints
  retries?: number,       // Optional: Retry count (default: 3)
  retryDelay?: number,    // Optional: Delay between retries in ms (default: 200)
  timeout?: number,       // Optional: Request timeout in ms (default: 30000)
});
```

### `client.query(params, options?)`

Make a raw RPC query request with automatic retry and endpoint rotation.

```typescript
const result = await client.query<YourType>({
  request_type: 'call_function',
  finality: 'final',
  account_id: 'example.near',
  method_name: 'get_method',
  args_base64: 'e30=', // base64 encoded JSON args
});

// Force specific endpoint (useful for testing)
const result = await client.query(params, { endpointIndex: 0 });
```

### `client.getNextEndpoint()`

Get the next endpoint URL (rotation happens automatically on each request).

### `client.getEndpoints()`

Get all configured endpoints.

### `client.getCurrentIndex()`

Get current endpoint index.

## Helper Functions

### `callNftView(client, contractId, method, args)`

Call an NFT contract view method with automatic args encoding.

```typescript
import { callNftView, createMainnetClient } from 'near-balancer';

const client = createMainnetClient();

const tokens = await callNftView(
  client,
  'paras-fanatic.near',
  'nft_tokens',
  { from_index: '0', limit: 50 }
);
```

### `getAccountBalance(client, accountId)`

Get account balance information.

```typescript
import { getAccountBalance, createMainnetClient } from 'near-balancer';

const client = createMainnetClient();

const balance = await getAccountBalance(client, 'example.near');
console.log(balance.amount, balance.staked);
```

## Examples

### High-Throughput NFT Holder Sync

```typescript
import { createMainnetClient, callNftView } from 'near-balancer';

const client = createMainnetClient({
  endpoints: [
    'https://rpc.mainnet.near.org',
    'https://near.lava.build',
    'https://near.drpc.org',
  ],
  retries: 3,
});

async function syncNftHolders(contractId: string) {
  const holders = new Map<string, number>();
  const BATCH_SIZE = 50;
  const CONCURRENT = 5;

  // Get total supply
  const supply = await callNftView<string>(client, contractId, 'nft_total_supply');
  const maxTokenId = parseInt(supply || '0', 10) + 500;

  // Fetch in parallel batches
  for (let i = 0; i < maxTokenId; i += BATCH_SIZE * CONCURRENT) {
    const batch = Array.from({ length: CONCURRENT }, (_, j) => i + j * BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (startIdx) => {
        const tokens = await callNftView<any[]>(
          client,
          contractId,
          'nft_tokens',
          { from_index: String(startIdx), limit: BATCH_SIZE }
        );
        return { startIdx, tokens };
      })
    );

    // Process results
    for (const { tokens } of results) {
      if (tokens) {
        for (const token of tokens) {
          if (token.owner_id) {
            holders.set(token.owner_id, (holders.get(token.owner_id) || 0) + 1);
          }
        }
      }
    }

    console.log(`Progress: ${i}/${maxTokenId} - ${holders.size} holders found`);
  }

  return holders;
}

// Usage
const holders = await syncNftHolders('nearlegion.nfts.tg');
console.log(`Found ${holders.size} unique holders`);
```

### Multi-Contract Operations

```typescript
import { createMainnetClient, callNftView } from 'near-balancer';

const client = createMainnetClient();

const CONTRACTS = [
  'paras-fanatic.near',
  'neargen.near',
  'meme.near',
];

// Process contracts in parallel
const results = await Promise.all(
  CONTRACTS.map(async (contract) => {
    const supply = await callNftView<string>(
      client,
      contract,
      'nft_total_supply'
    );
    return { contract, supply };
  })
);

for (const { contract, supply } of results) {
  console.log(`${contract}: ${supply} tokens`);
}
```

## How Round-Robin Load Balancing Works

The client automatically rotates through endpoints on each request:

```
Request 1 → endpoint[0]
Request 2 → endpoint[1]
Request 3 → endpoint[2]
Request 4 → endpoint[0]  (cycles back to start)
...
```

### Benefits

1. **Load Distribution** - Spreads requests across multiple RPC providers
2. **Rate Limit Avoidance** - Automatically switches endpoints on 429 errors
3. **High Availability** - If one endpoint fails, retries use other endpoints
4. **Improved Throughput** - Parallel requests hit different endpoints

## Default Endpoints

### Mainnet (5 endpoints)
- `https://rpc.mainnet.near.org` - Official NEAR RPC
- `https://near.lava.build` - Lava Network
- `https://near.blockpi.network/v1/rpc/public` - BlockPI
- `https://near.drpc.org` - dRPC
- `https://endpoints.omniatech.io/v1/near/mainnet/public` - Omnia

### Testnet (2 endpoints)
- `https://rpc.testnet.near.org` - Official NEAR testnet RPC
- `https://near-testnet.lava.build` - Lava Network testnet

## Performance Tips

### High Throughput Configuration

```typescript
const client = createMainnetClient({
  retries: 2,         // Lower retries for faster failure
  retryDelay: 100,    // Lower delay between retries
  timeout: 15000,     // Lower timeout for quicker error detection
});

// Use parallel requests
const CONCURRENT = 10;
const results = await Promise.all(
  Array.from({ length: CONCURRENT }, (_, i) =>
    callNftView(client, contract, method, args)
  )
);
```

### Conservative Configuration (Reliability)

```typescript
const client = createMainnetClient({
  retries: 5,         // More retries
  retryDelay: 500,    // Longer delay
  timeout: 60000,     // Longer timeout
});
```

## Error Handling

The library gracefully handles errors and returns `null` when all retries fail:

```typescript
const result = await callNftView(client, 'contract.near', 'some_method');

if (result === null) {
  console.error('All endpoints failed after retries');
  // Handle error appropriately
}
```

## Testing

The library includes comprehensive tests:

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage
```

## Roadmap

- [ ] WebSocket subscription support
- [ ] Request caching layer
- [ ] Automatic endpoint health checking
- [ ] Metrics and monitoring hooks
- [ ] Deno/native compatibility

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT © 2025

---

**Note**: This library is designed to work in Node.js, Bun, Deno, and browser environments. For browser usage, ensure your RPC endpoints support CORS.
