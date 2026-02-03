/**
 * NEAR RPC Round-Robin Client
 *
 * A lightweight TypeScript library for making NEAR RPC calls with automatic
 * round-robin endpoint rotation, retry logic, and rate limit handling.
 *
 * @example
 * ```ts
 * import { createRpcClient } from 'near-rpc-round-robin';
 *
 * const client = createRpcClient({
 *   endpoints: [
 *     'https://rpc.mainnet.near.org',
 *     'https://near.lava.build',
 *   ],
 *   retries: 3,
 * });
 *
 * const result = await client.query({
 *   request_type: 'call_function',
 *   account_id: 'example.near',
 *   method_name: 'get_balance',
 *   args_base64: 'e30=',
 * });
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export interface RpcClientConfig {
  /** List of RPC endpoints to rotate through */
  endpoints: string[];
  /** Number of retries per request (default: 3) */
  retries?: number;
  /** Delay between retries in ms (default: 200) */
  retryDelay?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface QueryParams {
  request_type: 'call_function' | 'view_account' | 'view_state' | 'call_view';
  finality?: 'final' | 'optimistic';
  block_id?: number | string;
  account_id: string;
  method_name?: string;
  args_base64?: string;
}

export interface RpcRequestOptions {
  /** Force a specific endpoint index (for testing) */
  endpointIndex?: number;
}

export interface RpcResponse<T = unknown> {
  result?: {
    result?: T;
  };
  error?: {
    message: string;
    data?: string;
  };
}

export interface RpcClient {
  /** Make a query request with automatic retry and endpoint rotation */
  query<T = unknown>(params: QueryParams, options?: RpcRequestOptions): Promise<T | null>;
  /** Get the next RPC URL (useful for custom requests) */
  getNextEndpoint(): string;
  /** Get all endpoints */
  getEndpoints(): readonly string[];
  /** Get current endpoint index */
  getCurrentIndex(): number;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

class RpcClientImpl implements RpcClient {
  private endpoints: readonly string[];
  private currentIndex: number = 0;
  private config: Required<Pick<RpcClientConfig, 'retries' | 'retryDelay' | 'timeout'>>;

  constructor(config: RpcClientConfig) {
    if (!config.endpoints || config.endpoints.length === 0) {
      throw new Error('At least one RPC endpoint is required');
    }

    this.endpoints = [...config.endpoints];
    this.config = {
      retries: config.retries ?? 3,
      retryDelay: config.retryDelay ?? 200,
      timeout: config.timeout ?? 30000,
    };
  }

  getNextEndpoint(): string {
    const url = this.endpoints[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    return url;
  }

  getEndpoints(): readonly string[] {
    return this.endpoints;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  async query<T = unknown>(
    params: QueryParams,
    options?: RpcRequestOptions
  ): Promise<T | null> {
    const { retries, retryDelay, timeout } = this.config;

    for (let attempt = 0; attempt < retries; attempt++) {
      const rpcUrl = options?.endpointIndex !== undefined
        ? this.endpoints[options.endpointIndex]
        : this.getNextEndpoint();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: `rpc-${Date.now()}-${attempt}`,
            method: 'query',
            params,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle rate limiting
        if (response.status === 429) {
          await this.delay(retryDelay);
          continue;
        }

        if (!response.ok) {
          if (attempt === retries - 1) return null;
          await this.delay(retryDelay);
          continue;
        }

        const result = await response.json() as RpcResponse<T>;

        // Handle RPC error
        if (result.error) {
          if (attempt === retries - 1) return null;
          await this.delay(retryDelay);
          continue;
        }

        // Extract and decode result
        const rawResult = result.result?.result;

        if (!rawResult) {
          return null;
        }

        // Handle base64 encoded result
        if (Array.isArray(rawResult) && rawResult.length > 0 && typeof rawResult[0] === 'number') {
          const buffer = Buffer.from(new Uint8Array(rawResult));
          try {
            return JSON.parse(buffer.toString()) as T;
          } catch {
            return null;
          }
        }

        // Handle string result (already base64 encoded)
        if (typeof rawResult === 'string') {
          try {
            const decoded = Buffer.from(rawResult, 'base64').toString();
            return JSON.parse(decoded) as T;
          } catch {
            return rawResult as T;
          }
        }

        return rawResult as T;

      } catch (error) {
        // Timeout or network error
        if (attempt === retries - 1) return null;
        await this.delay(retryDelay);
      }
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new RPC client with round-robin endpoint rotation
 *
 * @param config - Client configuration
 * @returns Configured RPC client instance
 */
export function createRpcClient(config: RpcClientConfig): RpcClient {
  return new RpcClientImpl(config);
}

/**
 * Default list of public NEAR mainnet RPC endpoints
 */
export const DEFAULT_MAINNET_ENDPOINTS = [
  'https://rpc.mainnet.near.org',
  'https://near.lava.build',
  'https://near.blockpi.network/v1/rpc/public',
  'https://near.drpc.org',
  'https://endpoints.omniatech.io/v1/near/mainnet/public',
] as const;

/**
 * Default list of public NEAR testnet RPC endpoints
 */
export const DEFAULT_TESTNET_ENDPOINTS = [
  'https://rpc.testnet.near.org',
  'https://near-testnet.lava.build',
] as const;

/**
 * Create a preconfigured mainnet RPC client
 */
export function createMainnetClient(config?: Partial<RpcClientConfig>): RpcClient {
  return createRpcClient({
    endpoints: [...DEFAULT_MAINNET_ENDPOINTS],
    ...config,
  });
}

/**
 * Create a preconfigured testnet RPC client
 */
export function createTestnetClient(config?: Partial<RpcClientConfig>): RpcClient {
  return createRpcClient({
    endpoints: [...DEFAULT_TESTNET_ENDPOINTS],
    ...config,
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Call an NFT view method with automatic args encoding
 *
 * @example
 * ```ts
 * const tokens = await callNftView(client, 'meme.near', 'nft_tokens', {
 *   from_index: '0',
 *   limit: 10,
 * });
 * ```
 */
export async function callNftView<T = unknown>(
  client: RpcClient,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<T | null> {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString('base64');

  return client.query<T>({
    request_type: 'call_function',
    finality: 'final',
    account_id: contractId,
    method_name: method,
    args_base64: argsBase64,
  });
}

/**
 * Call an FT view method with automatic args encoding
 */
export async function callFtView<T = unknown>(
  client: RpcClient,
  contractId: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<T | null> {
  return callNftView<T>(client, contractId, method, args);
}

/**
 * Get account balance
 */
export async function getAccountBalance(
  client: RpcClient,
  accountId: string
): Promise<{ amount: string; staked: string; } | null> {
  return client.query({
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

export default createRpcClient;
