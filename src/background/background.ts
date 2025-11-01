import { STORAGE_KEYS, getBoolean, getNumber, getStringArray } from '$lib/storage';
import { db, addCoinIfNew, markDiscovered, isDiscovered, recalculateAllAdminStats, getCoinsNeedingATH, updateCoinATH, getCoinsForATHRefresh, updateCoinATHIfHigher } from '$lib/db';
import { fetchTokenMeta, fetchCommunityInfo, fetchDexOrderStatus, fetchDexpaprikaPoolAddress, fetchATHData } from '$lib/api';

function isDexApprovedStatus(status: any): boolean {
  const s = (status ?? '').toString().toLowerCase();
  return s === 'approved' || s === 'paid';
}

async function setBadge(enabled: boolean) {
  if (enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function init() {
  const enabled = await getBoolean(STORAGE_KEYS.trenchingTestCss);
  setBadge(enabled);
  // Reschedule DEX check alarms for coins missing intervals (handles extension reloads)
  const coins = await db.coins.toArray();
  // One-time cleanup: remove coins without admin info (avoid 'Unknown' group)
  try { await db.coins.filter(c => !c.adminName).delete(); } catch {}
  const now = Date.now();
  for (const c of coins) {
    // Reschedule DEX checks if not finalized
    if (c.dexStatus !== 'approved' && c.dexStatus !== 'none' && c.createdAt) {
      const base = new Date(c.createdAt).getTime();
      DEX_MINUTES.forEach(min => {
        const remaining = (base + min*60000 - now)/60000; // minutes
        if (remaining > 0) {
          chrome.alarms.create(`dex_${c.address}_${min}`, { delayInMinutes: remaining });
        }
      });
    }
  }
  // Ensure a periodic DEX poll runs to catch approvals between fixed times
  chrome.alarms.create('dex_poll', { delayInMinutes: 1, periodInMinutes: 5 });
  // Periodic rescan of trenches tabs so content keeps collecting even if inactive
  chrome.alarms.create('scan_tick', { delayInMinutes: 1, periodInMinutes: 1 });
  // Periodically recalculate all admin stats
  chrome.alarms.create('recalc_admin_stats', { delayInMinutes: 5, periodInMinutes: 60 });
  // Periodic ATH check for coins older than 60 mins - runs every 1 minute
  chrome.alarms.create('ath_check', { delayInMinutes: 1, periodInMinutes: 1 });
}

// --- Sniper 24h cache helpers ---
const SNIPE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function shouldSnipeAndMark(address: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    chrome.storage.local.get(['sniped_cache', 'sniped_addresses'], raw => {
      const now = Date.now();
      let changed = false;
      let cache: Record<string, number> = raw['sniped_cache'] || {};

      // Migration: legacy array without timestamps -> assign current time
      const legacy: string[] | undefined = raw['sniped_addresses'];
      if (legacy && legacy.length) {
        for (const addr of legacy) {
          if (!cache[addr]) cache[addr] = now; // mark now
        }
        changed = true;
        // Remove legacy key by overwriting to empty list
        chrome.storage.local.set({ sniped_addresses: [] });
      }

      // Prune expired entries
      const entries = Object.entries(cache);
      for (const [addr, ts] of entries) {
        if (typeof ts !== 'number' || now - ts > SNIPE_TTL_MS) {
          delete cache[addr];
          changed = true;
        }
      }

      // If address already in cache (still fresh) skip
      if (cache[address]) {
        if (changed) chrome.storage.local.set({ sniped_cache: cache });
        resolve(false);
        return;
      }
      // Mark & persist
      cache[address] = now;
      chrome.storage.local.set({ sniped_cache: cache });
      resolve(true);
    });
  });
}

// Broadcast updated admin ATH (last 3) to all Padre tabs for all communities of this admin
async function broadcastAdminATH(adminName?: string) {
  try {
    if (!adminName) return;
    const adminCoins = await db.coins.where('adminName').equals(adminName).toArray();
    if (!adminCoins.length) return;
    // Sort latest first
    adminCoins.sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());
    const adminMcaps = adminCoins
      .filter(c => c.ath != null && typeof c.ath === 'number')
      .slice(0, 3)
      .map(c => c.ath) as number[];

    // If nothing to send, skip
    if (!adminMcaps.length) return;

    // Pick a followers value from any coin that has it
    const followers = adminCoins.find(c => typeof c.adminFollowers === 'number')?.adminFollowers;
    // Unique communityIds for this admin
    const communityIds = Array.from(new Set(adminCoins.map(c => c.communityId).filter(Boolean))) as string[];

    if (!communityIds.length) return;

    chrome.tabs.query({ url: 'https://trade.padre.gg/*' }, (tabs) => {
      for (const communityId of communityIds) {
        for (const t of tabs) {
          if (!t.id) continue;
          chrome.tabs.sendMessage(t.id, {
            type: 'UPDATE_COMMUNITY_INFO',
            communityId,
            adminName,
            adminFollowers: followers,
            adminMcaps
          }).catch(() => {});
        }
      }
    });
  } catch (e) {
    // Silent catch - errors can happen during tab messaging
  }
}

async function consolidateDuplicates(adminName: string | undefined) {
  if (!adminName) return;
  const all = await db.coins.filter(c => c.adminName === adminName).toArray();
  if (all.length <= 1) return;
  const normalize = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g,' ');
  const byName = new Map<string, typeof all>();
  for (const c of all) {
    const key = normalize(c.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(c);
  }
  const toDelete: string[] = [];
  byName.forEach(list => {
    if (list.length <= 1) return;
    list.sort((a,b)=> {
      const atA = new Date(a.createdAt || a.capturedAt).getTime();
      const atB = new Date(b.createdAt || b.capturedAt).getTime();
      return atA - atB; // keep earliest
    });
    list.slice(1).forEach(x => toDelete.push(x.address));
  });
  if (toDelete.length) {
    await db.coins.where('address').anyOf(toDelete).delete();
    console.log(`[DEDUP] Removed ${toDelete.length} duplicate coin(s) for admin ${adminName}`);
  }
}

// DEX status check scheduling
const DEX_MINUTES = [1,5,15,30,60];

function scheduleDexChecks(address: string) {
  // Schedule DEX status checks
  DEX_MINUTES.forEach(min => {
    chrome.alarms.create(`dex_${address}_${min}`, { delayInMinutes: min });
  });
}

async function handleDexAlarm(alarmName: string) {
  // Format: dex_<address>_<minutes>
  const parts = alarmName.split('_');
  if (parts.length < 3) return;
  const minutesStr = parts.pop()!;
  const address = parts.slice(1).join('_');
  const rec = await db.coins.where('address').equals(address).first();
  if (!rec) return;
  // If already approved or marked none, stop further checks
  if (rec.dexStatus === 'approved' || rec.dexStatus === 'none') return;
  const info = await fetchDexOrderStatus(address);
  if (isDexApprovedStatus(info?.status)) {
  const raw = info?.paymentTimestamp as any;
    const tsMs = (typeof raw === 'number' && raw > 0) ? (raw < 1e12 ? raw * 1000 : raw) : undefined; // handle seconds vs ms; ignore 0/undefined
    const ts = tsMs ? new Date(tsMs).toISOString() : undefined;
    await db.coins.where('address').equals(address).modify(c => {
      c.dexStatus = 'approved';
      if (ts) c.dexPaymentAt = ts;
      const createdMs = c.createdAt ? new Date(c.createdAt).getTime() : undefined;
      if (createdMs && tsMs) c.dexApprovalMs = Math.max(0, tsMs - createdMs);
    });
    return; // stop scheduling
  }
  // If this was the 60-minute check and still not approved, mark none and stop
  if (minutesStr === '60') {
    await db.coins.where('address').equals(address).modify(c => {
      c.dexStatus = 'none';
    });
  }
}

async function pollDexPending() {
  const now = Date.now();
  const coins = await db.coins.toArray();
  for (const c of coins) {
    if (!c.createdAt) continue;
    if (c.dexStatus === 'approved' || c.dexStatus === 'none') continue;
    const base = new Date(c.createdAt).getTime();
    const elapsedMin = (now - base) / 60000;
    // Stop polling beyond 60 mins and mark none if still not approved
    if (elapsedMin >= 60) {
      await db.coins.where('address').equals(c.address).modify(x => { x.dexStatus = 'none'; });
      continue;
    }
    const info = await fetchDexOrderStatus(c.address);
    if (isDexApprovedStatus(info?.status)) {
  const raw = info?.paymentTimestamp as any;
      const tsMs = (typeof raw === 'number' && raw > 0) ? (raw < 1e12 ? raw * 1000 : raw) : undefined;
      const ts = tsMs ? new Date(tsMs).toISOString() : undefined;
      await db.coins.where('address').equals(c.address).modify(x => {
        x.dexStatus = 'approved';
        if (ts) x.dexPaymentAt = ts;
        const createdMs = x.createdAt ? new Date(x.createdAt).getTime() : undefined;
        if (createdMs && tsMs) x.dexApprovalMs = Math.max(0, tsMs - createdMs);
      });
    }
  }
}

// --- ATH processing state ---
let athProcessing = false;
let athCancelRequested = false;
let athErrorCount = 0; // Track consecutive errors for backoff
let lastATHProcessTime = 0; // Track timing for rate limiting

async function processATHQueue() {
  try {
    if (athProcessing) {
  // Debug removed: process already running
      return;
    }
    athProcessing = true;

    if (athCancelRequested) {
  // Debug removed: cancel requested before start
      athProcessing = false;
      athCancelRequested = false; // consume one-shot cancel
      return;
    }

    // Rate limit protection: if we had errors recently, slow down
    if (athErrorCount > 3) {
      const backoffMs = Math.min(athErrorCount * 5000, 60000); // 5s per error, max 60s
      console.log(`[ATH] Backing off for ${backoffMs}ms due to ${athErrorCount} recent errors`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      athErrorCount = 0; // Reset after backoff
    }

    const coins = await getCoinsNeedingATH();

    if (coins.length === 0) {
  // Debug removed: no coins needing ATH
      return;
    }

  // Debug removed: processing batch for ATH

    // Process up to 60 coins per batch, but with delays between requests
    const batch = coins.slice(0, 60);
    let successCount = 0;
    let errorCount = 0;

    for (const coin of batch) {
      if (athCancelRequested) {
  // Debug removed: cancellation requested during batch
        break;
      }
      try {
        if (!coin.createdAt || !coin.id) continue;

        // Add delay between requests to avoid rate limiting (500ms = max 2 req/sec)
        const timeSinceLastRequest = Date.now() - lastATHProcessTime;
        if (timeSinceLastRequest < 500) {
          await new Promise(resolve => setTimeout(resolve, 500 - timeSinceLastRequest));
        }
        lastATHProcessTime = Date.now();

        // Debug removed: per-coin header/state
        /* console.log(`[ATH] Checking ATH for ${coin.name} (${coin.address})`);
        console.log(`[ATH] Current state:`, {
          currentATH: coin.ath,
          dexStatus: coin.dexStatus,
          createdAt: coin.createdAt,
          athCheckedAt: coin.athCheckedAt
        }); */

        // Step 1: Get pool address from Dexpaprika
  // Debug removed: step logging
        const poolAddress = await fetchDexpaprikaPoolAddress(coin.address);

        if (!poolAddress) {
          // Debug removed: no pool found for coin
          // Mark as checked to avoid retrying
          await db.coins.update(coin.id, { athCheckedAt: new Date().toISOString() });
          continue;
        }

  // Debug removed: found pool address

        // Step 2: Extract date from createdAt (format: yyyy-mm-dd)
        const creationDate = coin.createdAt.split('T')[0];
  // Debug removed: using creation date

        // Step 3: Fetch ATH data
  // Debug removed: fetching ATH data
        const ath = await fetchATHData(poolAddress, creationDate);

        if (ath !== undefined && ath > 0) {
          // Debug removed: found ATH value
          await updateCoinATH(coin.id, ath, poolAddress);
          // Debug removed: updated DB with new ATH
          // Push live update of admin's last 3 ATH to content scripts
          await broadcastAdminATH(coin.adminName);
          successCount++;
        } else {
          // Debug removed: no ATH data available
          // Mark as checked even if no data to avoid retrying
          await db.coins.update(coin.id, { athCheckedAt: new Date().toISOString() });
        }
      } catch (error) {
        errorCount++;
        console.error(`[ATH ERROR] Failed processing coin ${coin.address}:`, error);
        // Log detailed error information
        if (error instanceof Error) {
          console.error(`[ATH ERROR] Error message: ${error.message}`);
          console.error(`[ATH ERROR] Error stack: ${error.stack}`);
        }
        // Don't mark as checked if error, allow retry
      }
    }

    // Update error tracking for backoff
    if (errorCount > successCount) {
      athErrorCount = Math.min(athErrorCount + 1, 12); // Cap at 12 errors (60s backoff)
      console.log(`[ATH] Error count increased to ${athErrorCount} (${errorCount} errors vs ${successCount} successes)`);
    } else if (successCount > 0) {
      athErrorCount = Math.max(0, athErrorCount - 1); // Decrease on successful batch
      if (athErrorCount === 0 && errorCount === 0) {
        console.log(`[ATH] Batch completed successfully: ${successCount} coins processed`);
      }
    }

    if (athCancelRequested) {
  // Debug removed: cancelled processing run
    } else {
  // Debug removed: completed batch
    }
  } catch (error) {
    console.error('[ATH ERROR] Critical error in processATHQueue:', error);
    if (error instanceof Error) {
      console.error(`[ATH ERROR] Error message: ${error.message}`);
      console.error(`[ATH ERROR] Error stack: ${error.stack}`);
    }
  } finally {
    athProcessing = false;
    // Clear cancel flag after a run to allow future runs
    athCancelRequested = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('dex_')) handleDexAlarm(alarm.name);
  if (alarm.name === 'dex_poll') pollDexPending();
  if (alarm.name === 'scan_tick') {
    chrome.tabs.query({ url: 'https://trade.padre.gg/trenches*' }, (tabs) => {
      for (const t of tabs) {
        if (!t.id) continue;
        // Skip discarded tabs (Chrome may unload them under memory pressure)
        if ((t as any).discarded) continue;
        chrome.tabs.sendMessage(t.id, { type: 'FORCE_RESCAN' });
      }
    });
  }
  if (alarm.name === 'recalc_admin_stats') {
    recalculateAllAdminStats();
  }
  if (alarm.name === 'ath_check') {
    processATHQueue();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes[STORAGE_KEYS.trenchingTestCss]) {
    setBadge(!!changes[STORAGE_KEYS.trenchingTestCss].newValue);
  }
});

// Helper function to get admin tag map
async function getAdminTagMapForAnalytics(): Promise<Record<string, string>> {
  const admins = await db.admins.toArray();
  const adminTagMap: Record<string, string> = {};
  admins.forEach(admin => {
    if (admin.tag) {
      adminTagMap[admin.admin] = admin.tag;
    }
  });
  return adminTagMap;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'TRENCHING_TEST_CSS') setBadge(!!msg.enabled);
  if (msg?.type === 'CANCEL_ATH_RECALC') {
    athCancelRequested = true;
  // Debug removed: cancel requested via message
    try { sendResponse?.({ ok: true }); } catch {}
    return; // keep listener
  }
  if (msg?.type === 'RECALCULATE_ALL_ATH') {
    (async () => {
      try {
        const now = Date.now();
        const sixtyMinsAgo = now - 60 * 60 * 1000;

        // Find all coins without ATH that are older than 60 mins
        const coinsNeedingATH = await db.coins.filter(coin => {
          // Must have creation date
          if (!coin.createdAt) return false;

          const createdTime = new Date(coin.createdAt).getTime();

          // Only coins older than 60 mins
          if (createdTime > sixtyMinsAgo) return false;

          // Only coins without ATH or with invalid ATH
          const hasValidATH = typeof coin.ath === 'number' && coin.ath > 0;
          if (hasValidATH) return false;

          return true;
        }).toArray();

        const count = coinsNeedingATH.length;
        console.log(`[ATH_RECALC] Found ${count} coins needing ATH recalculation`);

        if (count === 0) {
          sendResponse?.({ ok: true, count: 0 });
          return;
        }

        // Mark all these coins as needing ATH check by clearing their athCheckedAt
        const addresses = coinsNeedingATH.map(c => c.address);
        await db.coins.where('address').anyOf(addresses).modify(coin => {
          delete coin.athCheckedAt; // Clear the flag so processATHQueue will pick them up
        });

        console.log(`[ATH_RECALC] Marked ${count} coins for ATH processing`);

        // Trigger the ATH queue processor immediately
        processATHQueue();

        sendResponse?.({ ok: true, count });
      } catch (e: any) {
        console.error('[ATH_RECALC] Error:', e);
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async response
  }
  if (msg?.type === 'RECALCULATE_ALL_ATH_REFRESH') {
    (async () => {
      try {
        // Get all coins that are 60+ mins old, regardless of existing ATH
        // But skip coins with ATH already > 5M
        const coinsToRefresh = await getCoinsForATHRefresh();

        const count = coinsToRefresh.length;
        console.log(`[ATH_REFRESH] Found ${count} coins for ATH refresh (60+ mins old, ATH <= 5M)`);

        if (count === 0) {
          sendResponse?.({ ok: true, count: 0, updated: 0, skipped: 0 });
          return;
        }

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        // Process each coin
        for (const coin of coinsToRefresh) {
          try {
            if (!coin.createdAt || !coin.id) continue;

            // Add delay between requests to avoid rate limiting (500ms = max 2 req/sec)
            await new Promise(resolve => setTimeout(resolve, 500));

            console.log(`[ATH_REFRESH] Processing ${coin.name} (${coin.address}) - Current ATH: ${coin.ath || 'none'}`);

            // Step 1: Get pool address from Dexpaprika
            const poolAddress = await fetchDexpaprikaPoolAddress(coin.address);

            if (!poolAddress) {
              console.log(`[ATH_REFRESH] No pool found for ${coin.address}, skipping`);
              skippedCount++;
              continue;
            }

            // Step 2: Extract date from createdAt (format: yyyy-mm-dd)
            const creationDate = coin.createdAt.split('T')[0];

            // Step 3: Fetch ATH data
            const newATH = await fetchATHData(poolAddress, creationDate);

            if (newATH !== undefined && newATH > 0) {
              // Use updateCoinATHIfHigher to only update if new ATH is higher
              const result = await updateCoinATHIfHigher(coin.id, newATH, poolAddress);

              if (result.updated) {
                console.log(`[ATH_REFRESH] ✅ Updated ${coin.name}: ${coin.ath || 'none'} → ${newATH.toLocaleString()} (${result.reason})`);
                updatedCount++;

                // Push live update of admin's last 3 ATH to content scripts
                if (coin.adminName) {
                  await broadcastAdminATH(coin.adminName);
                }
              } else {
                console.log(`[ATH_REFRESH] ⏭️ Skipped ${coin.name}: New ATH ${newATH.toLocaleString()} not higher than existing ${coin.ath?.toLocaleString() || 'none'} (${result.reason})`);
                skippedCount++;
              }
            } else {
              console.log(`[ATH_REFRESH] No ATH data available for ${coin.address}`);
              skippedCount++;
            }
          } catch (error) {
            errorCount++;
            console.error(`[ATH_REFRESH] Failed processing coin ${coin.address}:`, error);
          }
        }

        console.log(`[ATH_REFRESH] Completed: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`);
        sendResponse?.({ ok: true, count, updated: updatedCount, skipped: skippedCount, errors: errorCount });
      } catch (e: any) {
        console.error('[ATH_REFRESH] Error:', e);
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async response
  }
  if (msg?.type === 'FORCE_ATH_FOR_ADDRESS') {
    const address = msg.address as string | undefined;
    (async () => {
      if (!address) return sendResponse?.({ ok: false, error: 'no address' });

  // Debug removed: starting forced ATH check

      const rec = await db.coins.where('address').equals(address).first();
      if (!rec?.id) {
  // Debug removed: coin not found on re-fetch
        return sendResponse?.({ ok: false, error: 'not found' });
      }

      /* Debug removed: found coin on re-fetch
      console.log(`[ATH_REFETCH] Found coin:`, {
        name: rec.name,
        dexStatus: rec.dexStatus,
        currentATH: rec.ath,
        athCheckedAt: rec.athCheckedAt,
        createdAt: rec.createdAt
      }); */

      if (!rec.createdAt) {
  // Debug removed: no creation date available
        return sendResponse?.({ ok: false, error: 'no creation date' });
      }

      // Process THIS coin only, don't trigger the entire queue
  // Debug removed: processing single coin

      try {
        // Step 1: Get pool address
  // Debug removed: step logging
        const poolAddress = await fetchDexpaprikaPoolAddress(address);

        if (!poolAddress) {
          // Debug removed: no pool found on re-fetch
          await db.coins.update(rec.id, { athCheckedAt: new Date().toISOString() });
          return sendResponse?.({ ok: false, error: 'no pool found' });
        }

  // Debug removed: found pool on re-fetch

        // Step 2: Fetch ATH data
        const creationDate = rec.createdAt.split('T')[0];
  // Debug removed: fetching ATH data for date
        const ath = await fetchATHData(poolAddress, creationDate);

        if (ath !== undefined && ath > 0) {
          // Debug removed: found ATH on re-fetch
          await updateCoinATH(rec.id, ath, poolAddress);
          sendResponse?.({ ok: true, ath });
          // Push live update of admin's last 3 ATH to content scripts
          await broadcastAdminATH(rec.adminName);
        } else {
          // Debug removed: no ATH data on re-fetch
          await db.coins.update(rec.id, { athCheckedAt: new Date().toISOString() });
          sendResponse?.({ ok: false, error: 'no ath data' });
        }
      } catch (error) {
        console.error(`[ATH_REFETCH] ❌ Error:`, error);
        sendResponse?.({ ok: false, error: String(error) });
      }
    })();
    return true; // async response
  }
  if (msg?.type === 'ADD_COIN') {
    const { address, capturedAt, communityId } = msg;
    isDiscovered(address).then(async already => {
      if (already) return;
      // Require valid community admin; if missing, don't track this coin
      let comm: Awaited<ReturnType<typeof fetchCommunityInfo>> | undefined = undefined;
      if (communityId) {
        try { comm = await fetchCommunityInfo(communityId); } catch {}
      }

      // Validate community creation date: must be within the last 45 minutes
      if (comm?.createdAt) {
        const communityCreationTime = comm.createdAt;
        const now = Date.now();
        const fortyFiveMinutesInMillis = 45 * 60 * 1000;
        if (now - communityCreationTime > fortyFiveMinutesInMillis) {
          console.log(`[VALIDATION] Skipping coin ${address} from community ${communityId} - created too long ago.`);
          return; // Stop processing if community is too old
        }
      }

      if (!comm?.adminName) {
        // Skip tracking coins without admin (likely dead/scam projects)
        return;
      }
      let meta = await fetchTokenMeta(address);
      const name = meta?.symbol || meta?.name || address.slice(0, 6);
      const createdAt = meta?.firstPool?.createdAt;
      const devAddr = meta?.dev;
      const added = await addCoinIfNew({ address, name, capturedAt, createdAt, communityId, devAddr, adminName: comm.adminName, adminFollowers: comm.adminFollowers });
      if (added) markDiscovered(address);
      if (added) scheduleDexChecks(address);
      // Sniper: if enabled and admin followers exceed threshold, trigger open once per 24h
      if (added) {
        try {
          const followersEnabled = await getBoolean(STORAGE_KEYS.sniperEnabled, false);
          const minFollowers = await getNumber(STORAGE_KEYS.sniperFollowersMin, 0);
          const admin3McapsEnabled = await getBoolean(STORAGE_KEYS.sniperAdmin3McapsEnabled, false);
          const admin3McapsMin = await getNumber(STORAGE_KEYS.sniperAdmin3McapsMin, 10000);
          const launchCountEnabled = await getBoolean(STORAGE_KEYS.sniperLaunchCountEnabled, false);
          const launchCountMin = await getNumber(STORAGE_KEYS.sniperLaunchCountMin, 0);
          const launchCountMax = await getNumber(STORAGE_KEYS.sniperLaunchCountMax, Number.MAX_SAFE_INTEGER);
          const migratedCountEnabled = await getBoolean(STORAGE_KEYS.sniperMigratedCountEnabled, false);
          const migratedCountMin = await getNumber(STORAGE_KEYS.sniperMigratedCountMin, 0);
          const andMode = await getBoolean(STORAGE_KEYS.sniperAndMode, false);
          const tagRuleEnabled = await getBoolean(STORAGE_KEYS.sniperAllowedTagsEnabled, false);
          const allowedTags = tagRuleEnabled ? await getStringArray(STORAGE_KEYS.sniperAllowedTags) : [];

          const followers = comm.adminFollowers || 0;
          const adminName = comm.adminName;

          // Blacklist hard block: if admin tag is Blacklist, skip all sniper logic
          let adminTag: string | undefined;
          if (adminName) {
            try {
              const meta = await db.admins.where('admin').equals(adminName).first();
              adminTag = meta?.tag;
              if (adminTag === 'Blacklist') return; // ignore this coin entirely
            } catch {}
          }

          // Collect rule evaluations. We treat only enabled rules.
          const ruleResults: boolean[] = [];

          // Followers rule (only evaluated if enabled)
          if (followersEnabled) ruleResults.push(followers > minFollowers);

          // Allowed tags rule (passes if adminTag exists in allowed list)
          if (tagRuleEnabled) {
            let ok = false;
            if (adminTag && allowedTags.length) ok = allowedTags.includes(adminTag);
            ruleResults.push(ok);
          }

          // Load admin coins once if any admin-based rule is enabled
          let adminCoins: any[] | null = null;
          if (adminName && (admin3McapsEnabled || launchCountEnabled || migratedCountEnabled)) {
            try {
              adminCoins = await db.coins.where('adminName').equals(adminName).toArray();
            } catch { adminCoins = null; }
          }

          if (admin3McapsEnabled) {
            let ok = false;
            try {
              if (adminCoins && adminCoins.length) {
                // Sort latest first and take last up to 3 coins that have ATH
                const sorted = [...adminCoins].sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());
                const aths: number[] = sorted
                  .filter(c => c && typeof c.ath === 'number' && c.ath > 0)
                  .slice(0, 3)
                  .map(c => c.ath as number);

                if (aths.length > 0) {
                  const avg = aths.reduce((s, n) => s + n, 0) / aths.length;
                  ok = avg >= admin3McapsMin;
                } else {
                  ok = false; // no ATH data yet -> do not pass
                }
              }
            } catch {}
            ruleResults.push(ok);
          }

          if (launchCountEnabled) {
            let ok = false;
            if (adminCoins) {
              const total = adminCoins.length;
              ok = total >= launchCountMin && total <= launchCountMax;
            }
            ruleResults.push(ok);
          }

          if (migratedCountEnabled) {
            let ok = false;
            if (adminCoins) {
              const migrated = adminCoins.filter(c => typeof c.migratedInMs === 'number' && isFinite(c.migratedInMs) && c.migratedInMs >= 0).length;
              ok = migrated >= migratedCountMin;
            }
            ruleResults.push(ok);
          }

          // Determine pass/fail depending on mode
          let passes = false;
          if (ruleResults.length) {
            if (andMode) {
              passes = ruleResults.every(r => r === true);
            } else {
              passes = ruleResults.some(r => r === true);
            }
          }

          if (passes) {
            const allowed = await shouldSnipeAndMark(address);
            if (allowed) {
              chrome.tabs.query({ url: 'https://trade.padre.gg/trenches*' }, (tabs) => {
                for (const t of tabs) {
                  if (!t.id) continue;
                  chrome.tabs.sendMessage(t.id, { type: 'SNIPE_OPEN', address });
                }
              });
            }
          }
        } catch {}
      }
      // Immediate DEX status check on add
      if (added) {
        try {
          const info = await fetchDexOrderStatus(address);
          if (isDexApprovedStatus(info?.status)) {
            const raw = info?.paymentTimestamp as any;
            const tsMs = (typeof raw === 'number' && raw > 0) ? (raw < 1e12 ? raw * 1000 : raw) : undefined;
            const ts = tsMs ? new Date(tsMs).toISOString() : undefined;
            await db.coins.where('address').equals(address).modify(c => {
              c.dexStatus = 'approved';
              if (ts) c.dexPaymentAt = ts;
              const createdMs = c.createdAt ? new Date(c.createdAt).getTime() : undefined;
              if (createdMs && tsMs) c.dexApprovalMs = Math.max(0, tsMs - createdMs);
            });
          }
        } catch {}
      }
      if (added && communityId) {
        // admin is already set on add; duplicates consolidation for safety
        if (added && comm?.adminName) consolidateDuplicates(comm.adminName);
        // Proactively push updated admin data to all trenching tabs
        const adminCoins = await db.coins.where('adminName').equals(comm.adminName).toArray();
        adminCoins.sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());

        chrome.tabs.query({ url: 'https://trade.padre.gg/trenches*' }, (tabs) => {
          for (const t of tabs) {
            if (!t.id) continue;
            chrome.tabs.sendMessage(t.id, {
              type: 'UPDATE_ADMIN_INFO',
              adminName: comm.adminName,
              adminFollowers: comm.adminFollowers
            });
          }
        });

        // Also push admin's last 3 ATHs (from previous coins) so UI shows immediately
        await broadcastAdminATH(comm.adminName);
      }
      if (!meta && added) {
        // retry later lazily
        setTimeout(async () => {
          meta = await fetchTokenMeta(address);
          if (meta) {
            const m = meta; // non-null
            db.coins.where('address').equals(address).modify(c => {
              c.name = m.symbol || m.name || c.name;
              c.createdAt = m.firstPool?.createdAt || c.createdAt;
              // marketCap field removed, will use ATH later
            });
          }
        }, 4000);
      }
    });
  }
  if (msg?.type === 'COMMUNITY_META') {
    const { address, communityId } = msg;
    if (!communityId) return;
    db.coins.where('address').equals(address).first(async rec => {
      if (rec && (!rec.adminName || !rec.adminFollowers)) {
        const info = await fetchCommunityInfo(communityId);
        if (info?.adminName) {
          db.coins.where('address').equals(address).modify(c => {
            c.communityId = communityId;
            c.adminName = info.adminName;
            c.adminFollowers = info.adminFollowers;
          });
          consolidateDuplicates(info.adminName);
        }
      }
    });
  }
  if (msg?.type === 'REFETCH_META') {
    const { address } = msg;
    fetchTokenMeta(address).then(meta => {
      console.log('[REFETCH_META]', { address, meta });
      if (!meta) return;
      let adminNameForPush: string | undefined;
      db.coins.where('address').equals(address).modify(c => {
        c.createdAt = meta.firstPool?.createdAt;
        c.devAddr = meta.dev || c.devAddr;

        adminNameForPush = c.adminName;
      });
      if (adminNameForPush) {
        const adminName = adminNameForPush;
        db.coins.where('adminName').equals(adminName).toArray().then(coins => {
          coins.sort((a,b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());
          const followers = coins.find(c => typeof c.adminFollowers === 'number')?.adminFollowers;
          chrome.tabs.query({ url: 'https://trade.padre.gg/trenches*' }, (tabs) => {
            for (const t of tabs) {
              if (!t.id) continue;
              chrome.tabs.sendMessage(t.id, {
                type: 'UPDATE_ADMIN_INFO',
                adminName,
                adminFollowers: followers
              });
            }
          });
        });
      }
    });
    // Also refresh DEX status and update if approved
    fetchDexOrderStatus(address).then(info => {
      console.log('[DEX][REFETCH]', { address, status: info?.status, paymentTimestamp: info?.paymentTimestamp, raw: info });
      if (isDexApprovedStatus(info?.status)) {
        const raw = info?.paymentTimestamp as any;
        const tsMs = (typeof raw === 'number' && raw > 0) ? (raw < 1e12 ? raw * 1000 : raw) : undefined;
        const ts = tsMs ? new Date(tsMs).toISOString() : undefined;
        console.log('[DEX][REFETCH] approved -> update', { address, rawTs: raw, ts });
        db.coins.where('address').equals(address).modify(c => {
          c.dexStatus = 'approved';
          if (ts) c.dexPaymentAt = ts;
          const createdMs = c.createdAt ? new Date(c.createdAt).getTime() : undefined;
          if (createdMs && tsMs) c.dexApprovalMs = Math.max(0, tsMs - createdMs);
        });
      } else {
        console.log('[DEX][REFETCH] not approved', { address, status: info?.status });
      }
    });
  }
  if (msg?.type === 'DELETE_COIN') {
    const { address } = msg;
    db.coins.where('address').equals(address).delete();
    db.discovered.where('address').equals(address).delete();
    chrome.storage.local.get(['discovered_addresses'], res => {
      const arr: string[] = res['discovered_addresses'] || [];
      const next = arr.filter(a => a !== address);
      chrome.storage.local.set({ discovered_addresses: next });
    });
  }
  if (msg?.type === 'REQUEST_SCAN_STATUS') {
    chrome.storage.sync.get(['analytics_scan_enabled'], (res) => {
      chrome.runtime.sendMessage({ type: 'SCAN_STATUS', enabled: !!res['analytics_scan_enabled'] });
    });
  }
  if (msg?.type === 'GET_COMMUNITY_CACHE') {
    // Return all coins with community admin data for content script caching
    db.coins.where('adminName').above('').toArray().then(async coins => {
  const data: { communityId: string | undefined; adminName: string; adminFollowers: number | undefined; adminMcaps: number[] }[] = [];
      const adminCoinMap = new Map<string, any[]>();

      // Group coins by admin
      for (const coin of coins) {
        if (!adminCoinMap.has(coin.adminName!)) {
          adminCoinMap.set(coin.adminName!, []);
        }
        adminCoinMap.get(coin.adminName!)!.push(coin);
      }

      // Process each admin's coins
      for (const [adminName, adminCoins] of adminCoinMap.entries()) {
        // Sort coins by creation date descending to get the latest ones
        adminCoins.sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());

        // Get last 3 coins with ATH data (skip coins without ATH)
        const adminMcaps = adminCoins
          .filter(c => c.ath != null && typeof c.ath === 'number')
          .slice(0, 3)
          .map(c => c.ath) as number[];

        // Find a representative coin to get communityId and followers
        const repCoin = adminCoins[0];

        data.push({
          communityId: repCoin.communityId,
          adminName: adminName,
          adminFollowers: repCoin.adminFollowers,
          adminMcaps: adminMcaps
        });
      }

      // Send response back to requesting content script tab (fallback to all Padre tabs if sender missing)
      const targetTabId = sender?.tab?.id;
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, { type: 'COMMUNITY_CACHE_RESPONSE', data });
      } else {
        chrome.tabs.query({ url: 'https://trade.padre.gg/*' }, (tabs) => {
          tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id!, { type: 'COMMUNITY_CACHE_RESPONSE', data }); });
        });
      }
    });
  }
  if (msg?.type === 'GET_ADMIN_TAG_MAP') {
    // Return all admin tags for content script
    db.admins.toArray().then(admins => {
      const adminTagMap: Record<string, string> = {};
      admins.forEach(admin => {
        if (admin.tag) {
          adminTagMap[admin.admin] = admin.tag;
        }
      });

      // Send response back to requesting content script tab (fallback to all Padre tabs if sender missing)
      const targetTabId = sender?.tab?.id;
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, { type: 'ADMIN_TAG_MAP_RESPONSE', adminTagMap });
      } else {
        chrome.tabs.query({ url: 'https://trade.padre.gg/*' }, (tabs) => {
          tabs.forEach(tab => { if (tab.id) chrome.tabs.sendMessage(tab.id!, { type: 'ADMIN_TAG_MAP_RESPONSE', adminTagMap }); });
        });
      }
    });
  }
  if (msg?.type === 'GET_DISTINCT_ADMIN_TAGS') {
    db.admins.toArray().then(admins => {
      const set = new Set<string>();
      admins.forEach(a => { if (a.tag) set.add(a.tag); });
      chrome.runtime.sendMessage({ type: 'DISTINCT_ADMIN_TAGS', tags: Array.from(set).sort() });
    });
  }
  if (msg?.type === 'REQUEST_COMMUNITY_DATA') {
    const { communityId } = msg;
    if (!communityId) return;

    // This is now a fallback. The main update path is proactive from the background.
    db.coins.where('communityId').equals(communityId).first(async (coin) => {
      let adminName: string | undefined;
      let adminFollowers: number | undefined;

      if (coin && coin.adminName) {
        // We have a coin with this communityId
        adminName = coin.adminName;
        adminFollowers = coin.adminFollowers;
      } else {
        // No coin with this communityId, try to fetch from API
        try {
          const info = await fetchCommunityInfo(communityId);
          if (info?.adminName) {
            adminName = info.adminName;
            adminFollowers = info.adminFollowers;

            // Update any existing coins from this community (shouldn't be any, but just in case)
            await db.coins.where('communityId').equals(communityId).modify(c => {
              c.adminName = info.adminName;
              c.adminFollowers = info.adminFollowers;
            });
          }
        } catch (error) {
          console.log('Failed to fetch community data for:', communityId, error);
          return;
        }
      }

      if (!adminName) {
        return;
      }

      // Now get ATH data by ADMIN NAME (not by communityId)
      // This allows us to show ATH even if this specific community has no coins yet
      const adminCoins = await db.coins.where('adminName').equals(adminName).toArray();
      adminCoins.sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());

      // Get last 3 coins with ATH data
      const adminMcapsRaw = adminCoins
        .filter(c => c.ath != null && typeof c.ath === 'number')
        .slice(0, 3)
        .map(c => c.ath) as number[];

      // Send to ALL trade.padre.gg tabs, not just active one
      chrome.tabs.query({ url: 'https://trade.padre.gg/*' }, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            const payload: any = {
              type: 'UPDATE_COMMUNITY_INFO',
              communityId,
              adminName: adminName,
              adminFollowers: adminFollowers,
            };
            if (adminMcapsRaw.length > 0) payload.adminMcaps = adminMcapsRaw;
            chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
          }
        });
      });
    });
  }
  if (msg?.type === 'CLEANUP_DUPLICATE_COINS') {
    (async () => {
      const summary: Record<string, number> = {};
      const admins = new Set<string>((await db.coins.where('adminName').above('').toArray()).map(c => c.adminName!).filter(Boolean));
      const normalize = (s?: string) => (s || '').trim().toLowerCase().replace(/\s+/g,' ');
      for (const admin of admins) {
        const coins = await db.coins.where('adminName').equals(admin).toArray();
        const groups = new Map<string, typeof coins>();
        for (const c of coins) {
          const key = normalize(c.name);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(c);
        }
        const toDelete: string[] = [];
        groups.forEach(list => {
          if (list.length <= 1) return;
          list.sort((a,b)=> new Date(a.createdAt || a.capturedAt).getTime() - new Date(b.createdAt || b.capturedAt).getTime());
          list.slice(1).forEach(x => toDelete.push(x.address));
        });
        if (toDelete.length) {
          await db.coins.where('address').anyOf(toDelete).delete();
          summary[admin] = toDelete.length;
        }
      }
      const total = Object.values(summary).reduce((a,b)=>a+b,0);
      sendResponse({ message: `Removed ${total} duplicate coin(s) across ${Object.keys(summary).length} admin(s).` });
    })();
    return true; // async
  }
  if (msg?.type === 'GET_ADMIN_COIN_COUNT') {
    const { adminName } = msg;
    if (!adminName) return;

    db.coins.where('adminName').equals(adminName).toArray().then(coins => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'ADMIN_COIN_COUNT_RESPONSE',
            adminName,
            coinCount: coins.length
          });
        }
      });
    });
  }
  if (msg?.type === 'GET_ADMIN_LAST_COINS') {
    const { adminName } = msg;
    if (!adminName) return;

    db.coins.where('adminName').equals(adminName).toArray().then(coins => {
      // Sort by creation date descending to get the latest coins
      coins.sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());

      // Skip the first coin (current/most recent) and take the next 3 (2nd, 3rd, 4th)
      const previousCoins = coins.slice(1, 4);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'ADMIN_LAST_COINS_RESPONSE',
            adminName,
            coins: previousCoins // Return 2nd, 3rd, 4th coins (excluding current)
          });
        }
      });
    });
  }
  if (msg?.type === 'GET_ADMIN_STATS') {
    const { adminName } = msg;
    if (!adminName) return;

    db.coins.where('adminName').equals(adminName).toArray().then(coins => {
      if (!coins.length) {
        sendResponse({ followers: null });
        return;
      }

      // Sort by creation date descending to get the latest coins
      coins.sort((a, b) => new Date(b.createdAt || b.capturedAt).getTime() - new Date(a.createdAt || a.capturedAt).getTime());

      // Get followers from any coin that has this data
      const followers = coins.find(c => typeof c.adminFollowers === 'number')?.adminFollowers;

      sendResponse({ followers });
    }).catch(error => {
      console.error('Error fetching admin data:', error);
      sendResponse({ followers: null });
    });

    return true; // Indicates we will respond asynchronously
  }
  if (msg?.type === 'CHECK_DEX_STATUS') {
    const { address } = msg;
    if (!address) {
      sendResponse({ status: null });
      return;
    }

    fetchDexOrderStatus(address).then(info => {
      if (isDexApprovedStatus(info?.status)) {
        sendResponse({ status: 'Approved' });
      } else if (info?.status) {
        sendResponse({ status: info.status });
      } else {
        sendResponse({ status: 'Not found' });
      }
    }).catch(error => {
      console.error('Error checking DEX status:', error);
      sendResponse({ status: 'Error' });
    });

    return true; // Indicates we will respond asynchronously
  }
  // --- Admin DB Tools: List coin fields and delete selected fields ---
  if (msg?.type === 'DB_LIST_FIELDS') {
    (async () => {
      try {
        const coins = await db.coins.toArray();
        const allowed = new Set<string>([
          'id','address','name','capturedAt','createdAt','ath','athCheckedAt','athPoolAddress','devAddr','dexStatus','dexPaymentAt','dexApprovalMs','communityId','adminName','adminFollowers'
        ]);
        const fieldMap = new Map<string, { count: number; sample?: any; obsolete: boolean }>();
        for (const c of coins) {
          const keys = Object.keys(c as any);
          for (const k of keys) {
            let entry = fieldMap.get(k);
            if (!entry) {
              entry = { count: 0, obsolete: !allowed.has(k) };
              fieldMap.set(k, entry);
            }
            entry.count += 1;
            if (entry.sample === undefined && (c as any)[k] !== undefined) entry.sample = (c as any)[k];
          }
        }
        const fields = Array.from(fieldMap.entries()).map(([field, info]) => ({ field, ...info })).sort((a,b)=> a.field.localeCompare(b.field));
        sendResponse?.({ ok: true, total: coins.length, fields });
      } catch (e:any) {
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async
  }
  if (msg?.type === 'DB_DELETE_FIELDS') {
    (async () => {
      try {
        const fields: string[] = Array.isArray(msg.fields) ? msg.fields : [];
        if (!fields.length) return sendResponse?.({ ok: false, error: 'No fields provided' });
        const modified = await db.coins.toCollection().modify((c:any) => {
          let changed = false;
          for (const f of fields) {
            if (Object.prototype.hasOwnProperty.call(c, f)) {
              delete c[f];
              changed = true;
            }
          }
          return changed;
        });
        sendResponse?.({ ok: true, modified });
      } catch (e:any) {
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async
  }
  // --- Admin DB Tools: Prune coins by rules (with dry-run preview) ---
  if (msg?.type === 'DB_PRUNE_COINS') {
    (async () => {
      const params = msg.params || {};
      const dryRun: boolean = !!params.dryRun;
      const olderThanDays: number | undefined = typeof params.olderThanDays === 'number' ? params.olderThanDays : undefined;
      const noATH: boolean = !!params.noATH;
      const keepApproved: boolean = params.keepApproved !== false; // default true
      const keepWithATH: boolean = params.keepWithATH !== false; // default true
      const olderThanDaysBase: 'createdAt' = 'createdAt';

      try {
        const all = await db.coins.toArray();
  const toDelete = new Set<string>(); // address
  const reasons: Record<string, number> = { older: 0, noATH: 0 } as any;
        const now = Date.now();

        function isProtected(c: any) {
          if (keepApproved && c.dexStatus === 'approved') return true;
          if (keepWithATH && typeof c.ath === 'number' && c.ath > 0) return true;
          return false;
        }

        // Rule: older than X days
        if (olderThanDays && olderThanDays > 0) {
          const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
          for (const c of all) {
            const ts = olderThanDaysBase === 'createdAt'
              ? (c.createdAt ? new Date(c.createdAt).getTime() : undefined)
              : (c.capturedAt ? new Date(c.capturedAt).getTime() : undefined);
            if (!ts) continue;
            if (ts < cutoff && !isProtected(c)) {
              if (!toDelete.has(c.address)) { toDelete.add(c.address); reasons.older += 1; }
            }
          }
        }

        // Rule: coins without ATH (missing or <= 0)
        if (noATH) {
          for (const c of all) {
            const hasATH = typeof c.ath === 'number' && c.ath > 0;
            if (!hasATH && !isProtected(c)) {
              if (!toDelete.has(c.address)) { toDelete.add(c.address); reasons.noATH += 1; }
            }
          }
        }


        const deleteCount = toDelete.size;
        if (dryRun) {
          sendResponse?.({ ok: true, preview: true, total: all.length, deleteCount, reasons });
          return;
        }

        if (deleteCount === 0) {
          sendResponse?.({ ok: true, deleted: 0, reasons });
          return;
        }

        // Execute deletes
        const addresses = Array.from(toDelete);
        await db.transaction('rw', db.coins, db.discovered, async () => {
          await db.coins.where('address').anyOf(addresses).delete();
          await db.discovered.where('address').anyOf(addresses).delete();
        });
        sendResponse?.({ ok: true, deleted: deleteCount, reasons });
      } catch (e:any) {
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async
  }
});

init();