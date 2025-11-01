// Central API configuration & clients
import axios, { AxiosInstance } from 'axios';

export interface JupiterTokenMeta {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals?: number;
  website?: string;
  dev?: string;
  firstPool?: { id: string; createdAt: string };
  graduatedAt?: string;
  holderCount?: number;
  mcap?: number;
  fdv?: number;
  usdPrice?: number;
  liquidity?: number;
  updatedAt?: string;
}

interface ApiConfig {
  jupiter: {
    baseUrl: string;
    endpoints: {
      tokenSearch: (address: string) => string;
    };
    headers: Record<string, string>;
  };
  twitter: {
    baseUrl: string;
    endpoints: {
      communityById: (id: string) => string;
    };
    headers: Record<string,string>;
  }
}

export const apiConfig: ApiConfig = {
  jupiter: {
    baseUrl: 'https://lite-api.jup.ag',
    endpoints: {
      tokenSearch: (address: string) => `/tokens/v2/search?query=${encodeURIComponent(address)}`
    },
    headers: { Accept: 'application/json' }
  },
  twitter: {
    baseUrl: 'https://twitter283.p.rapidapi.com',
    endpoints: {
      communityById: (id: string) => `/CommunityResultsById?community_id=${id}`
    },
    headers: {
      'Accept': 'application/json',
      'x-rapidapi-key': '', // Add your RapidAPI key here - See SETUP.md for instructions
      'x-rapidapi-host': 'twitter283.p.rapidapi.com'
    }
  }
};

// Dexpaprika API client for ATH data
const dexpaprikaClient = createClient('https://api.dexpaprika.com', { Accept: 'application/json' });

export interface DexpaprikaSearchResult {
  tokens?: Array<{
    id: string;
    name: string;
    symbol: string;
    chain: string;
    price_usd: number;
  }>;
  pools?: Array<{
    id: string;
    dex_id: string;
    dex_name: string;
    chain: string;
    created_at: string;
    tokens: Array<{
      id: string;
      name: string;
      symbol: string;
    }>;
  }>;
  dexes?: any[];
}

export interface DexpaprikaOHLCV {
  time_open: string;
  time_close: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchDexpaprikaPoolAddress(coinAddress: string): Promise<string | undefined> {
  try {
    const { data } = await dexpaprikaClient.get<DexpaprikaSearchResult>(`/search?query=${encodeURIComponent(coinAddress)}`);



    if (data?.pools && Array.isArray(data.pools) && data.pools.length > 0) {
      // Find pump.fun pool first, fallback to any pool
      const pumpFunPool = data.pools.find(p => p.dex_name?.toLowerCase() === 'pump.fun');
      const poolAddress = pumpFunPool?.id || data.pools[0]?.id;

      if (poolAddress) {

        return poolAddress;
      } else {

      }
    } else {

    }
  } catch (error: any) {
    console.error(`[API ERROR] Failed fetching pool address for ${coinAddress}`);
    console.error(`[API ERROR] Status: ${error?.response?.status}, Message: ${error?.message}`);
    if (error?.response?.status === 429) {
      console.error('[API ERROR] ⚠️ RATE LIMITED - Too many requests to Dexpaprika API');
    }
    if (error?.response?.status === 403) {
      console.error('[API ERROR] ⚠️ BLOCKED - Access forbidden to Dexpaprika API');
    }
    if (error?.response?.status === 404) {
      console.error('[API ERROR] ⚠️ NOT FOUND - No data available for this coin');
    }
  }
  return undefined;
}

export async function fetchATHData(poolAddress: string, tokenCreationDate: string): Promise<number | undefined> {
  // Try inversed=true first, then inversed=false if data is bad
  const inversedOptions = [true, false];

  for (let i = 0; i < inversedOptions.length; i++) {
    const inversed = inversedOptions[i];

    try {
      // Format date as yyyy-mm-dd
      const dateStr = tokenCreationDate.split('T')[0]; // Extract date part if it's ISO string

      const url = `/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv?start=${dateStr}&limit=60&interval=1h&inversed=${inversed}`;

      const { data } = await dexpaprikaClient.get<DexpaprikaOHLCV[]>(url);

      if (Array.isArray(data) && data.length > 0) {
        // Find the highest 'high' value across all periods by scanning all candles
        const maxHigh = Math.max(...data.map(candle => candle.high || 0));

        if (maxHigh > 0) {
          // Sanity check: maxHigh should be a tiny decimal for Solana tokens (typically < 1)
          // If it's > 1, the data is likely corrupted/wrong
          if (maxHigh > 1) {
            console.warn(`[API] Suspicious maxHigh value ${maxHigh} for pool ${poolAddress} (inversed=${inversed}) - likely bad data, rejecting`);
            // If this was inversed=true and we got bad data, retry with inversed=false
            if (inversed === true) {
              console.log(`[API] Retrying pool ${poolAddress} with inversed=false...`);
              continue;
            }
            return undefined;
          }

          // Calculate ATH: 1,000,000,000 x high price
          const ath = 1000000000 * maxHigh;

          console.log(`[ATH] Pool ${poolAddress} (inversed=${inversed}): Scanned ${data.length} candles, max high = ${maxHigh}, calculated ATH = ${ath.toLocaleString()}`);

          // Validation: reject ATH values above 5 million (likely data errors)
          if (ath > 5_000_000) {
            console.warn(`[API] ATH value ${ath.toLocaleString()} exceeds 5M limit for pool ${poolAddress} (inversed=${inversed}), rejecting`);
            // If this was inversed=true and we got bad data, retry with inversed=false
            if (inversed === true) {
              console.log(`[API] Retrying pool ${poolAddress} with inversed=false...`);
              continue;
            }
            return undefined;
          }

          return ath;
        } else {
          // No valid high price found
          if (inversed === true) {
            console.log(`[API] No valid high price for pool ${poolAddress} (inversed=true), retrying with inversed=false...`);
            continue;
          }
        }
      } else {
        // No data returned
        if (inversed === true) {
          console.log(`[API] No OHLCV data for pool ${poolAddress} (inversed=true), retrying with inversed=false...`);
          continue;
        }
      }
    } catch (error: any) {
      console.error(`[API ERROR] Failed fetching ATH data for pool ${poolAddress} (inversed=${inversed})`);
      console.error(`[API ERROR] Status: ${error?.response?.status}, Message: ${error?.message}`);
      if (error?.response?.status === 429) {
        console.error('[API ERROR] ⚠️ RATE LIMITED - Too many requests to Dexpaprika API');
        console.error('[API ERROR] Consider slowing down ATH requests or waiting before retry');
      }
      if (error?.response?.status === 403) {
        console.error('[API ERROR] ⚠️ BLOCKED - Access forbidden to Dexpaprika API');
      }
      if (error?.response?.status === 404) {
        console.error('[API ERROR] ⚠️ NOT FOUND - Pool or data not available');
        // Try inversed=false if inversed=true failed with 404
        if (inversed === true) {
          console.log(`[API] 404 error with inversed=true, retrying with inversed=false...`);
          continue;
        }
      }
      if (error?.response?.data) {
        console.error('[API ERROR] Response data:', error.response.data);
      }

      // If this was inversed=true and we got an error, try inversed=false
      if (inversed === true && i === 0) {
        console.log(`[API] Error with inversed=true, retrying with inversed=false...`);
        continue;
      }
    }
  }

  return undefined;
}

function createClient(baseURL: string, headers: Record<string,string>): AxiosInstance {
  const instance = axios.create({ baseURL, headers, timeout: 10000 });
  return instance;
}

export const jupiterClient = createClient(apiConfig.jupiter.baseUrl, apiConfig.jupiter.headers);
export const twitterClient = createClient(apiConfig.twitter.baseUrl, apiConfig.twitter.headers);

export async function fetchTokenMeta(address: string): Promise<JupiterTokenMeta | undefined> {
  try {
    const ep = apiConfig.jupiter.endpoints.tokenSearch(address);
    const { data } = await jupiterClient.get(ep);
    if (Array.isArray(data) && data.length > 0) {
      const match = data.find((d:any) => d.id === address) || data[0];
      return match as JupiterTokenMeta;
    }
  } catch (e) {
    // swallow for now; could send to logs
  }
  return undefined;
}

export interface TwitterCommunityInfo {
  communityId: string;
  adminName?: string;
  adminFollowers?: number;
  createdAt?: number;
}

export async function fetchCommunityInfo(id: string): Promise<TwitterCommunityInfo | undefined> {
  if (!id) return undefined;
  try {
    const ep = apiConfig.twitter.endpoints.communityById(id);
    const { data } = await twitterClient.get(ep);
    const communityResult = data?.data?.community_results_by_rest_id?.result;
    const admin = communityResult?.admin_results?.result;
    const followers = admin?.relationship_counts?.followers;
    const screen = admin?.core?.screen_name;
    const createdAtStr = communityResult?.automoderation_settings?.created_at;
    const createdAt = createdAtStr ? parseInt(createdAtStr, 10) : undefined;

    return {
      communityId: id,
      adminName: screen,
      adminFollowers: typeof followers === 'number' ? followers : undefined,
      createdAt: (createdAt && isFinite(createdAt)) ? createdAt : undefined
    };
  } catch {}
  return undefined;
}

// Dexscreener Orders API
const dexscreenerClient = createClient('https://api.dexscreener.com', { Accept: 'application/json' });

export interface DexOrderInfo {
  chainId: 'solana';
  tokenAddress: string;
  type?: string;
  status?: string;
  paymentTimestamp?: number;
}

export async function fetchDexOrderStatus(address: string): Promise<DexOrderInfo | undefined> {
  try {
    const { data } = await dexscreenerClient.get(`/orders/v1/solana/${encodeURIComponent(address)}`);
    const lower = address.toLowerCase();
    let item: any = undefined;
    if (Array.isArray(data)) {
      item = data.find((d: any) => (d?.tokenAddress || '').toLowerCase() === lower) ?? data[0];
    } else if (data && typeof data === 'object') {
      // Some variants may wrap in { orders: [...] }
      if (Array.isArray((data as any).orders)) {
        const arr = (data as any).orders;
        item = arr.find((d: any) => (d?.tokenAddress || '').toLowerCase() === lower) ?? arr[0];
      } else {
        item = data;
      }
    }
    if (item && typeof item === 'object') return item as DexOrderInfo;
  } catch {}
  return undefined;
}
