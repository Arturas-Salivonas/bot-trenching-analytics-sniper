import Dexie, { Table } from 'dexie';
import { liveQuery } from 'dexie';

export interface CoinRecord {
  id?: number; // auto increment
  address: string; // pump.fun address
  name: string;
  capturedAt: string; // ISO string
  createdAt?: string; // from external API (ISO) firstPool.createdAt
  ath?: number; // all-time high market cap (to be populated later)
  athCheckedAt?: string; // ISO string - when we last checked ATH
  athPoolAddress?: string; // cached pool address for ATH lookup
  devAddr?: string; // developer address from API
  // Dexscreener Orders API fields
  dexStatus?: 'approved' | 'none' | 'pending';
  dexPaymentAt?: string; // ISO string if approved
  dexApprovalMs?: number; // time between token created and dex approved, in ms
  communityId?: string; // twitter community id
  adminName?: string; // cached admin screen_name
  adminFollowers?: number; // cached admin follower count
}

interface DiscoveredRecord { address: string; }

export interface AdminMeta { admin: string; tag?: string; notes?: string }
export interface Category { label: string }
export interface AdminStats {
  admin: string;
  lastCoinsCount: number; // how many coins used for calculation (up to 5)
  lastUpdated: string; // ISO timestamp
}

class AppDB extends Dexie {
  coins!: Table<CoinRecord, number>;
  discovered!: Table<DiscoveredRecord, string>; // key is address
  admins!: Table<AdminMeta, string>; // key is admin
  categories!: Table<Category, string>; // key is label
  adminStats!: Table<AdminStats, string>; // key is admin
  constructor() {
    super('padre_db');
  this.version(2).stores({ coins: '++id,&address', discovered: '&address' });
  this.version(3).stores({ coins: '++id,&address,marketCap,createdAt,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs', discovered: '&address' });
  this.version(4).stores({ coins: '++id,&address,marketCap,createdAt,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers', discovered: '&address' });
  this.version(5).stores({ coins: '++id,&address,marketCap,createdAt,devAddr,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers', discovered: '&address' });
  this.version(6).stores({ coins: '++id,&address,marketCap,createdAt,devAddr,dexStatus,dexPaymentAt,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers', discovered: '&address' });
  this.version(7).stores({
    coins: '++id,&address,marketCap,createdAt,devAddr,dexStatus,dexPaymentAt,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label'
  });
  this.version(8).stores({
    coins: '++id,&address,marketCap,createdAt,devAddr,dexStatus,dexPaymentAt,dexApprovalMs,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label'
  });
  this.version(9).stores({
    coins: '++id,&address,marketCap,createdAt,devAddr,dexStatus,dexPaymentAt,dexApprovalMs,migratedAt,migratedInMs,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label'
  });
  this.version(10).stores({
    coins: '++id,&address,marketCap,createdAt,devAddr,dexStatus,dexPaymentAt,dexApprovalMs,migratedAt,migratedInMs,mc0s,mc1m,mc5m,mc15m,mc30m,mc60m,mcBaseTs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label',
    adminStats: '&admin,lastUpdated'
  });
  this.version(11).stores({
    coins: '++id,&address,createdAt,capturedAt,devAddr,dexStatus,dexPaymentAt,dexApprovalMs,migratedAt,migratedInMs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label',
    adminStats: '&admin,lastUpdated'
  });
  this.version(12).stores({
    coins: '++id,&address,createdAt,capturedAt,devAddr,ath,dexStatus,dexPaymentAt,dexApprovalMs,migratedAt,migratedInMs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label',
    adminStats: '&admin,lastUpdated'
  });
  this.version(13).stores({
    coins: '++id,&address,createdAt,capturedAt,devAddr,ath,dexStatus,dexPaymentAt,dexApprovalMs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label',
    adminStats: '&admin,lastUpdated'
  });
  this.version(14).stores({
    coins: '++id,&address,createdAt,capturedAt,devAddr,ath,athCheckedAt,athPoolAddress,dexStatus,dexPaymentAt,dexApprovalMs,communityId,adminName,adminFollowers',
    discovered: '&address',
    admins: '&admin,tag',
    categories: '&label',
    adminStats: '&admin,lastUpdated'
  });
  }
}

export const db = new AppDB();

export async function addCoinIfNew(rec: Omit<CoinRecord, 'id'>) {
  // Normalization helper (local to avoid export unless needed elsewhere)
  const normalize = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g,' ');
  // Guard: duplicate by address
  const existing = await db.coins.where('address').equals(rec.address).first();
  if (existing) return false;
  // Guard: duplicate by admin + normalized name (only if admin present and name non-empty)
  if (rec.adminName && rec.name) {
    const normName = normalize(rec.name);
    const dupe = await db.coins
      .where('adminName')
      .equals(rec.adminName)
      .filter(c => normalize(c.name) === normName)
      .first();
    if (dupe) {
      console.log(`[DEDUP] Skipping coin ${rec.address} name='${rec.name}' admin='${rec.adminName}' duplicate of ${dupe.address}`);
      return false;
    }
  }
  await db.coins.add(rec);
  if (rec.adminName) {
    updateAdminStats(rec.adminName).catch(console.error);
  }
  return true;
}

export function coinsLive() {
  return liveQuery(() => db.coins.orderBy('id').reverse().toArray());
}

export async function markDiscovered(address: string) {
  try { await db.discovered.add({ address }); } catch {}
}

export async function isDiscovered(address: string) {
  return !!(await db.discovered.get(address));
}

// Admin tagging helpers
export function adminTagMapLive() {
  return liveQuery(async () => {
    const rows = await db.admins.toArray();
    const map = new Map<string, string>();
    rows.forEach(r => { if (r.tag) map.set(r.admin, r.tag); });
    return map;
  });
}

export function categoriesLive() {
  return liveQuery(async () => (await db.categories.orderBy('label').toArray()).map(c => c.label));
}

export async function setAdminTag(admin: string, tag?: string) {
  if (!admin) return;
  if (!tag) {
    // Preserve notes if clearing tag
    const existing = await db.admins.get(admin);
    if (existing?.notes) {
      await db.admins.put({ admin, notes: existing.notes });
    } else {
      await db.admins.delete(admin);
    }
    return;
  }
  const existing = await db.admins.get(admin);
  await db.admins.put({ admin, tag, notes: existing?.notes });
}

export async function setAdminNotes(admin: string, notes?: string) {
  if (!admin) return;
  const existing = await db.admins.get(admin);
  if (!notes && !existing?.tag) {
    // Remove record entirely if no tag and notes cleared
    await db.admins.delete(admin);
    return;
  }
  await db.admins.put({ admin, tag: existing?.tag, notes: notes || undefined });
}

export async function addCategory(label: string) {
  if (!label) return;
  try { await db.categories.add({ label }); } catch {}
}

export async function ensureDefaultCategories() {
  const defaults = ['Good', 'Alpha', 'Blacklist', 'Quick Dex paid', 'Bundler'];
  const existing = new Set((await db.categories.toArray()).map(c => c.label));
  const toAdd = defaults.filter(l => !existing.has(l)).map(label => ({ label }));
  if (toAdd.length) await db.categories.bulkAdd(toAdd);
}

// Admin Statistics Functions
export async function calculateAdminStats(adminName: string): Promise<AdminStats | null> {
  if (!adminName) return null;

  // Get last 5 coins by this admin (or less if not available), ordered by creation date
  const adminCoins = await db.coins
    .where('adminName')
    .equals(adminName)
    .and(coin => coin.createdAt != null)
    .reverse() // newest first
    .sortBy('createdAt');

  const recentCoins = adminCoins.slice(0, 5);

  if (recentCoins.length === 0) return null;

  // Calculate basic statistics
  const stats: AdminStats = {
    admin: adminName,
    lastCoinsCount: recentCoins.length,
    lastUpdated: new Date().toISOString()
  };

  return stats;
}

export async function updateAdminStats(adminName: string): Promise<void> {
  if (!adminName) return;

  const stats = await calculateAdminStats(adminName);
  if (!stats) {
    // No valid coins for this admin, remove stats if they exist
    await db.adminStats.delete(adminName);
    return;
  }

  // Save or update the stats
  await db.adminStats.put(stats);
}

export async function getAdminStats(adminName: string): Promise<AdminStats | null> {
  if (!adminName) return null;
  return await db.adminStats.get(adminName) || null;
}

export function adminStatsLive() {
  return liveQuery(async () => {
    const stats = await db.adminStats.toArray();
    const map = new Map<string, AdminStats>();
    stats.forEach(s => map.set(s.admin, s));
    return map;
  });
}

export async function updateCoinATH(coinId: number, ath: number, poolAddress: string): Promise<void> {
  // Validation: reject ATH values above 5 million (safety guard at DB layer)
  if (ath > 5_000_000) {
    console.warn(`[DB] Rejecting ATH value ${ath.toLocaleString()} for coin ${coinId} - exceeds 5M limit`);
    // Still mark as checked to avoid retrying with bad data
    await db.coins.update(coinId, {
      athCheckedAt: new Date().toISOString()
    });
    return;
  }

  await db.coins.update(coinId, {
    ath,
    athPoolAddress: poolAddress,
    athCheckedAt: new Date().toISOString()
  });
}

export async function updateCoinATHIfHigher(coinId: number, newATH: number, poolAddress: string): Promise<{ updated: boolean; reason: string }> {
  // Validation: reject ATH values above 5 million (safety guard at DB layer)
  if (newATH > 5_000_000) {
    console.warn(`[DB] Rejecting ATH value ${newATH.toLocaleString()} for coin ${coinId} - exceeds 5M limit`);
    return { updated: false, reason: 'exceeds_5M_limit' };
  }

  // Get current coin data
  const coin = await db.coins.get(coinId);
  if (!coin) {
    return { updated: false, reason: 'coin_not_found' };
  }

  // If coin has no ATH yet, set it
  if (coin.ath === undefined || coin.ath === null || coin.ath <= 0) {
    await db.coins.update(coinId, {
      ath: newATH,
      athPoolAddress: poolAddress,
      athCheckedAt: new Date().toISOString()
    });
    return { updated: true, reason: 'no_previous_ath' };
  }

  // If new ATH is higher than existing, update it
  if (newATH > coin.ath) {
    await db.coins.update(coinId, {
      ath: newATH,
      athPoolAddress: poolAddress,
      athCheckedAt: new Date().toISOString()
    });
    return { updated: true, reason: 'higher_ath_found' };
  }

  // Otherwise, just update the checked timestamp but keep existing ATH
  await db.coins.update(coinId, {
    athCheckedAt: new Date().toISOString()
  });
  return { updated: false, reason: 'existing_ath_higher' };
}

export async function getCoinsNeedingATH(): Promise<CoinRecord[]> {
  const now = Date.now();
  const sixtyMinsAgo = now - 60 * 60 * 1000;

  // Get coins that are older than 60 mins and haven't had ATH checked yet
  const coins = await db.coins
    .filter(coin => {
      // Must have creation date
      if (!coin.createdAt) return false;

      const createdTime = new Date(coin.createdAt).getTime();

      // Only process coins that were created recently (within reasonable time frame)
      // This ensures we only check newly added coins, not old historical data
      const capturedTime = coin.capturedAt ? new Date(coin.capturedAt).getTime() : createdTime;
      const hoursSinceCaptured = (now - capturedTime) / (60 * 60 * 1000);

      // Skip coins captured more than 12 hours ago (these are old/historical)
      if (hoursSinceCaptured > 12) return false;

      // Check if older than 60 mins (so the pool has time to establish)
      if (createdTime > sixtyMinsAgo) return false;

      // Must not have been checked already
      if (coin.athCheckedAt) return false;

      return true;
    })
    .toArray();

  return coins;
}

export async function getCoinsForATHRefresh(): Promise<CoinRecord[]> {
  const now = Date.now();
  const sixtyMinsAgo = now - 60 * 60 * 1000;

  // Get ALL coins that are older than 60 mins (regardless of existing ATH)
  // But skip coins with ATH > 5M (these are already too high to recalculate)
  const coins = await db.coins
    .filter(coin => {
      // Must have creation date
      if (!coin.createdAt) return false;

      const createdTime = new Date(coin.createdAt).getTime();

      // Check if older than 60 mins (so the pool has time to establish)
      if (createdTime > sixtyMinsAgo) return false;

      // Skip coins with ATH already > 5M (too high to recalculate)
      if (coin.ath && coin.ath > 5_000_000) return false;

      return true;
    })
    .toArray();

  return coins;
}

export async function recalculateAllAdminStats(): Promise<void> {
  const adminNames = new Set<string>();
  const allCoins = await db.coins.where('adminName').above('').toArray();
  allCoins.forEach(coin => { if (coin.adminName) adminNames.add(coin.adminName); });
  for (const admin of adminNames) {
    try { await updateAdminStats(admin); } catch (e) { console.error('[ADMIN_STATS] Failed to update', admin, e); }
  }
}
