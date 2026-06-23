/**
 * Tests for near-rpc-round-robin
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createRpcClient,
  createMainnetClient,
  createTestnetClient,
  DEFAULT_MAINNET_ENDPOINTS,
  DEFAULT_TESTNET_ENDPOINTS,
  callNftView,
  getAccountBalance,
} from '../src/index';

describe('createRpcClient', () => {
  it('should create a client with endpoints', () => {
    const client = createRpcClient({
      endpoints: ['https://rpc.mainnet.near.org'],
    });

    expect(client.getEndpoints()).toHaveLength(1);
    expect(client.getEndpoints()[0]).toBe('https://rpc.mainnet.near.org');
  });

  it('should throw error with empty endpoints', () => {
    expect(() => {
      createRpcClient({ endpoints: [] });
    }).toThrow('At least one RPC endpoint is required');
  });

  it('should rotate through endpoints', () => {
    const client = createRpcClient({
      endpoints: ['rpc1', 'rpc2', 'rpc3'],
    });

    expect(client.getNextEndpoint()).toBe('rpc1');
    expect(client.getNextEndpoint()).toBe('rpc2');
    expect(client.getNextEndpoint()).toBe('rpc3');
    expect(client.getNextEndpoint()).toBe('rpc1'); // Back to start
  });

  it('should track current index', () => {
    const client = createRpcClient({
      endpoints: ['rpc1', 'rpc2', 'rpc3'],
    });

    expect(client.getCurrentIndex()).toBe(0);
    client.getNextEndpoint();
    expect(client.getCurrentIndex()).toBe(1);
    client.getNextEndpoint();
    expect(client.getCurrentIndex()).toBe(2);
  });
});

describe('createMainnetClient', () => {
  it('should create client with default mainnet endpoints', () => {
    const client = createMainnetClient();

    const endpoints = client.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints[0]).toBe(DEFAULT_MAINNET_ENDPOINTS[0]);
  });

  it('should accept custom config', () => {
    const client = createMainnetClient({
      retries: 10,
      retryDelay: 1000,
    });

    expect(client).toBeDefined();
  });
});

describe('createTestnetClient', () => {
  it('should create client with default testnet endpoints', () => {
    const client = createTestnetClient();

    const endpoints = client.getEndpoints();
    expect(endpoints.length).toBeGreaterThan(0);
    expect(endpoints[0]).toBe(DEFAULT_TESTNET_ENDPOINTS[0]);
  });
});

describe('Live RPC calls (integration tests)', () => {
  const client = createMainnetClient({
    retries: 3,
    retryDelay: 200,
    timeout: 30000,
  });

  it('should query nft_total_supply from a real contract', async () => {
    const result = await callNftView<string>(client, 'nearlegion.nfts.tg', 'nft_total_supply');

    expect(result).toBeDefined();
    // Result should be a string that can be parsed as number
    if (result) {
      const supply = parseInt(result.replace(/["']/g, ''), 10);
      expect(supply).toBeGreaterThan(0);
    }
  });

  it('should query nft_tokens from a real contract', async () => {
    const tokens = await callNftView<any[]>(client, 'nearlegion.nfts.tg', 'nft_tokens', {
      from_index: '0',
      limit: 5,
    });

    expect(tokens).toBeDefined();
    expect(Array.isArray(tokens)).toBe(true);
    if (tokens && tokens.length > 0) {
      expect(tokens[0].token_id).toBeDefined();
      expect(tokens[0].owner_id).toBeDefined();
    }
  });

  it('should get account balance', async () => {
    const balance = await getAccountBalance(client, 'near.near');

    expect(balance).toBeDefined();
    if (balance) {
      expect(balance.amount).toBeDefined();
      expect(balance.staked).toBeDefined();
    }
  });

  it('should handle non-existent account gracefully', async () => {
    const balance = await getAccountBalance(client, 'this-account-definitely-does-not-exist-12345.near');

    // Should return null for non-existent account
    expect(balance).toBeNull();
  });

  it('should handle invalid contract method gracefully', async () => {
    const result = await callNftView(client, 'nearlegion.nfts.tg', 'nonexistent_method', {});

    // Should return null for non-existent method
    expect(result).toBeNull();
  });
});

describe('Round-robin rotation', () => {
  it('should use different endpoints for sequential requests', async () => {
    const client = createRpcClient({
      endpoints: DEFAULT_MAINNET_ENDPOINTS.slice(0, 3),
      retries: 1,
    });

    const endIndex1 = client.getCurrentIndex();
    await callNftView(client, 'nearlegion.nfts.tg', 'nft_total_supply');
    const endIndex2 = client.getCurrentIndex();
    await callNftView(client, 'nearlegion.nfts.tg', 'nft_total_supply');
    const endIndex3 = client.getCurrentIndex();

    // Index should have changed
    expect(endIndex1).not.toBe(endIndex2);
    expect(endIndex2).not.toBe(endIndex3);
  });
});

describe('Error handling', () => {
  it('should handle invalid endpoint URL', async () => {
    const client = createRpcClient({
      endpoints: ['https://this-domain-does-not-exist-12345.com'],
      retries: 2,
      retryDelay: 100,
    });

    const result = await callNftView(client, 'nearlegion.nfts.tg', 'nft_total_supply');

    // Should return null after all retries fail
    expect(result).toBeNull();
  });

  it('should handle malformed RPC response', async () => {
    // Use a valid endpoint but expect graceful handling
    const client = createMainnetClient({
      retries: 2,
    });

    // This should work even if RPC returns unexpected data
    const result = await callNftView(client, 'nearlegion.nfts.tg', 'nft_total_supply');
    expect(result !== undefined).toBe(true);
  });

  it('should return Uint8Array for raw option', async () => {
    const client = createMainnetClient({ retries: 2 });

    const result = await client.query<Uint8Array>({
      request_type: 'call_function',
      finality: 'final',
      account_id: 'nearlegion.nfts.tg',
      method_name: 'nft_total_supply',
      args_base64: Buffer.from('{}').toString('base64'),
    }, { raw: true });

    expect(result).toBeDefined();
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe('Helper functions', () => {
  const client = createMainnetClient();

  it('callNftView should encode args correctly', async () => {
    const result = await callNftView<any[]>(
      client,
      'nearlegion.nfts.tg',
      'nft_tokens',
      { from_index: '0', limit: 2 }
    );

    expect(result).toBeDefined();
  });

  it('getAccountBalance should return balance data', async () => {
    const result = await getAccountBalance(client, 'near.near');

    expect(result).toBeDefined();
  });
});
