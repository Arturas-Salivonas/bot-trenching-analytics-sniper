<script lang="ts" context="module">
  declare const chrome: any;
</script>
<script lang="ts">
  // Bind MV3 chrome API for template handlers
  const chrome: any = (globalThis as any).chrome;
  import { onMount, onDestroy } from 'svelte';
  import { List as VirtualList } from 'svelte-virtual';
  import AdminGroup from './AdminGroup.svelte';
  import type { CoinRecord, AdminStats } from '$lib/db';
  import { coinsLive, db, adminTagMapLive, categoriesLive, setAdminTag, ensureDefaultCategories, adminStatsLive } from '$lib/db';
  import { getBoolean, saveBoolean, STORAGE_KEYS } from '$lib/storage';

  // Performance optimization: Debounce reactive updates
  let coins: CoinRecord[] = [];
  let search = '';
  let debounced = '';
  let debounceTimer: any;
  let subscription: { unsubscribe: () => void } | undefined;
  let scanEnabled = true;
  let now = Date.now();
  let tickInterval: any;
  let collapsed = new Set<string>();
  let lastCopied = '';
  let copyTimer: any;
  let adminTags = new Map<string,string>();
  let adminStats = new Map<string, AdminStats>();
  let categories: string[] = [];
  let selectedTag: string = '';
  let dexActiveOnly: boolean = false; // show only DEX approved
  let minAdminCoinsFilter: number = 0; // filter by minimum admin coin count
  let sortBy: string = 'default'; // 'default', 'dex-time'
  let loading = false;
  let showAdminModal = false;
  let exportingDb = false;
  let exportMessage: string | null = null;
  let importing = false;
  let importProgress: string = '';
  let importSummary: any = null;
  let includeSettingsImport = true;

  // Performance optimization: Memoize expensive computations
  let dexApprovedCount = 0;
  let filteredGroups: AdminGroup[] = [];

  // Enable virtual scrolling when there are many groups
  let useVirtualScrolling = false;
  $: useVirtualScrolling = filteredGroups.length > 50; // Only for very large datasets

  // Simple pagination for large datasets
  let itemsPerPage = 50;
  let currentPage = 0;

  // Helper function to get sort display text
  function getSortDisplayText(sort: string): string {
    switch (sort) {
      case 'dex-time': return 'By DEX Speed';
      case 'highest-ath': return 'By Highest ATH';
      default: return 'Default';
    }
  }

  $: maxPages = Math.ceil(filteredGroups.length / itemsPerPage);
  $: visibleGroups = useVirtualScrolling
    ? filteredGroups.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage)
    : filteredGroups;

  // Persist collapsed state to localStorage for better UX
  const COLLAPSED_KEY = 'analytics_collapsed_groups';

  interface AdminGroup {
    admin: string;
    followers?: number;
    items: CoinRecord[];
    devCounts?: Map<string, number>;
    topDevs?: Set<string>;
    topCount?: number;
    total?: number;
    stats?: AdminStats; // Add admin statistics
  }

  // Performance optimization: Throttle reactive recalculations
  let updateTimer: any;
  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      updateGroups();
    }, 16); // 60fps throttle
  }

  function updateGroups() {
    // Batch all expensive computations
    dexApprovedCount = coins.filter(c => c.dexStatus === 'approved').length;

    // Build filtered list: if searching by admin name include all that admin's coins
    let filteredRaw: CoinRecord[];
    if (!debounced) {
      filteredRaw = coins;
    } else {
      const term = debounced;
      const adminMatches = new Set<string>();
      for (const c of coins) {
        if (c.adminName && c.adminName.toLowerCase().includes(term)) adminMatches.add(c.adminName);
      }
      filteredRaw = [];
      for (const c of coins) {
        const cn = c.name?.toLowerCase() || '';
        const addr = c.address.toLowerCase();
        if (adminMatches.has(c.adminName || '')) {
          filteredRaw.push(c);
          continue;
        }
        if (cn.includes(term) || addr.includes(term)) filteredRaw.push(c);
      }
    }

    // Apply tag filter (by admin tag)
    let filteredTagged: CoinRecord[];
    if (!selectedTag) {
      filteredTagged = filteredRaw;
    } else {
      filteredTagged = filteredRaw.filter((c) => {
        const admin = c.adminName || 'Unknown';
        const tag = adminTags.get(admin);
        return tag === selectedTag;
      });
    }

    // Apply DEX status filter (approved only)
    let filteredDex: CoinRecord[];
    if (!dexActiveOnly) {
      filteredDex = filteredTagged;
    } else {
      filteredDex = filteredTagged.filter(c => c.dexStatus === 'approved');
    }

    // Build groups
    const map = new Map<string, AdminGroup>();
    // Build overall stats by admin across ALL coins (ignores current filters)
    const overall = new Map<string, { total: number }>();
    for (const c of coins) {
      const key = c.adminName || 'Unknown';
      let o = overall.get(key);
      if (!o) { o = { total: 0 }; overall.set(key, o); }
      o.total += 1;
    }

    for (const c of filteredDex) {
      const key = c.adminName || 'Unknown';

      let g = map.get(key);
      if (!g) {
        g = {
          admin: key,
          followers: c.adminFollowers,
          items: [],
          stats: adminStats.get(key) // Add admin stats
        };
        map.set(key, g);
      }
      if (typeof c.adminFollowers === 'number' && (!g.followers || c.adminFollowers > g.followers)) g.followers = c.adminFollowers; // keep max seen
      g.items.push(c);
    }

    // compute dev wallet usage per group and find top(s)
    for (const g of map.values()) {
      const counts = new Map<string, number>();
      for (const it of g.items) {
        const da = it.devAddr?.trim();
        if (!da) continue;
        counts.set(da, (counts.get(da) || 0) + 1);
      }
      let max = 0;
      counts.forEach(v => { if (v > max) max = v; });
      const tops = new Set<string>();
      if (max > 0) counts.forEach((v,k) => { if (v === max) tops.add(k); });
      g.devCounts = counts;
      g.topDevs = tops;
      g.topCount = max || undefined;
      // attach overall stats
      const o = overall.get(g.admin);
      if (o) {
        g.total = o.total;
      } else {
        g.total = 0;
      }
    }

    // Build groups array
    let groupsArray = Array.from(map.values());

    // Apply min admin coins filter
    if (minAdminCoinsFilter > 0) {
      groupsArray = groupsArray.filter(g => (g.total || 0) >= minAdminCoinsFilter);
    }

    // Sort groups based on sortBy selection
    if (sortBy === 'dex-time') {
      // Sort by fastest DEX approval time (only include groups with DEX approved coins)
      groupsArray = groupsArray.filter(g => g.items.some(c => typeof c.dexApprovalMs === 'number' && isFinite(c.dexApprovalMs) && c.dexApprovalMs >= 0));
      groupsArray.sort((a, b) => {
        const aFastest = Math.min(...a.items.map(c => typeof c.dexApprovalMs === 'number' && isFinite(c.dexApprovalMs) && c.dexApprovalMs >= 0 ? c.dexApprovalMs : Infinity));
        const bFastest = Math.min(...b.items.map(c => typeof c.dexApprovalMs === 'number' && isFinite(c.dexApprovalMs) && c.dexApprovalMs >= 0 ? c.dexApprovalMs : Infinity));
        return aFastest - bFastest;
      });
    } else if (sortBy === 'highest-ath') {
      // Sort by highest ATH (only include groups with coins that have ATH data)
      groupsArray = groupsArray.filter(g => g.items.some(c => typeof c.ath === 'number' && c.ath > 0));
      groupsArray.sort((a, b) => {
        const aHighest = Math.max(...a.items.map(c => typeof c.ath === 'number' && c.ath > 0 ? c.ath : -Infinity));
        const bHighest = Math.max(...b.items.map(c => typeof c.ath === 'number' && c.ath > 0 ? c.ath : -Infinity));
        return bHighest - aHighest; // Descending order (highest first)
      });
    } else {
      // Default sort: by followers desc then name
      groupsArray.sort((a, b) => (b.followers || 0) - (a.followers || 0) || a.admin.localeCompare(b.admin));
    }

    filteredGroups = groupsArray;
  }

  // Watch for changes and schedule updates
  $: if (coins || debounced || selectedTag || dexActiveOnly || minAdminCoinsFilter || sortBy || adminTags) {
    scheduleUpdate();
  }

  function onSearchInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    search = v;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(()=> debounced = v.trim().toLowerCase(), 250); // Increased debounce for performance
  }

  function clearSearch() {
    search = '';
    debounced = '';
  }

  function clearAllFilters() {
    dexActiveOnly = false;
    selectedTag = '';
    minAdminCoinsFilter = 0;
    sortBy = 'default';
    clearSearch();
  }

  function toggleGroup(admin: string) {
    if (collapsed.has(admin)) collapsed.delete(admin); else collapsed.add(admin);
    // Reassign to trigger Svelte reactivity (Set mutations aren't tracked)
    collapsed = new Set(collapsed);
    saveCollapsedState();
  }

  function saveCollapsedState() {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsed)));
    } catch (e) {
      // Ignore storage errors
    }
  }

  function loadCollapsedState() {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY);
      if (saved) {
        collapsed = new Set(JSON.parse(saved));
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  async function loadToggle() {
    scanEnabled = await getBoolean(STORAGE_KEYS.analyticsScanEnabled, true);
  }

  async function toggleScan() {
    scanEnabled = !scanEnabled;
    await saveBoolean(STORAGE_KEYS.analyticsScanEnabled, scanEnabled);
    chrome.runtime.sendMessage({ type: 'SCAN_TOGGLE', enabled: scanEnabled });
  }

  function copyAddress(addr?: string) {
    if (!addr) return;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(addr);
      } else {
        const ta = document.createElement('textarea');
        ta.value = addr; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
    } catch (e) { /* swallow */ }
    lastCopied = addr;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(()=> { if (lastCopied === addr) lastCopied=''; }, 1500);
  }

  function handleGroupTagChange(event: CustomEvent) {
    const { admin, value } = event.detail;
    setAdminTag(admin, value || undefined);
  }

  function handleGroupToggle(event: CustomEvent) {
    const { admin } = event.detail;
    toggleGroup(admin);
  }

  function handleCopyAddress(event: CustomEvent) {
    const { address } = event.detail;
    copyAddress(address);
  }

  function handleRefetch(event: CustomEvent) {
    const { address } = event.detail;
    chrome.runtime.sendMessage({ type:'REFETCH_META', address });
    // Also force immediate ATH check for this coin if it's DEX-approved
    chrome.runtime.sendMessage({ type:'FORCE_ATH_FOR_ADDRESS', address });
  }

  function handleDelete(event: CustomEvent) {
    const { address } = event.detail;
    chrome.runtime.sendMessage({ type:'DELETE_COIN', address });
  }

  onMount(() => {
    loadToggle();
    loadCollapsedState();
    ensureDefaultCategories();
    subscription = coinsLive().subscribe((arr)=> coins = arr);
    const subTags = adminTagMapLive().subscribe((m)=> adminTags = m);
    const subCats = categoriesLive().subscribe((arr)=> categories = arr);
    const subStats = adminStatsLive().subscribe((m)=> adminStats = m);

    // Reduce tick frequency for better performance
    tickInterval = setInterval(()=> now = Date.now(), 5000); // Update every 5 seconds instead of 1

    return () => { subTags.unsubscribe(); subCats.unsubscribe(); subStats.unsubscribe(); };
  });
  async function exportDb() {
    if (exportingDb) return;
    exportingDb = true; exportMessage = null;
    try {
      const mod = await import('$lib/exportImport');
      const blob = await mod.exportDatabase(true, true);
      const ts = new Date().toISOString().replace(/[:.]/g,'-');
      const filename = `padre-backup-${ts}.json.gz`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(()=> URL.revokeObjectURL(url), 4000);
      exportMessage = `Exported ${filename}`;
    } catch (e:any) {
      exportMessage = 'Export failed: ' + (e?.message || e);
    } finally {
      exportingDb = false;
    }
  }

  async function handleImport(mode: 'merge' | 'replace', file: File) {
    importing = true; importProgress = 'Reading file...'; importSummary = null;
    try {
      const mod = await import('$lib/exportImport');
      const manifest = await mod.parseImportFile(file);
      importProgress = 'Importing...';
      const summary = await mod.importDatabase(manifest, { mode, includeSettings: includeSettingsImport }, (msg)=> importProgress = msg);
      importSummary = summary;
      importProgress = 'Done';
    } catch (e:any) {
      importProgress = 'Failed: ' + (e?.message || e);
    } finally {
      importing = false;
    }
  }
  function onImportFileChange(e: Event, mode: 'merge' | 'replace') {
    const input = e.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    handleImport(mode, file);
    input.value='';
  }
  // Helper to safely iterate table results with typing
  function tableResultEntries() {
    if (!importSummary) return [] as Array<[string, { added:number; updated:number; skipped:number; failed?:number }]>;
    return Object.entries(importSummary.tableResults) as Array<[string, { added:number; updated:number; skipped:number; failed?:number }]>;
  }

  onDestroy(()=> {
    subscription?.unsubscribe();
    clearInterval(tickInterval);
    clearTimeout(debounceTimer);
    clearTimeout(updateTimer);
  });

  async function cleanupDuplicates() {
    duplicateCleanupMessage = 'Running duplicate cleanup...';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'CLEANUP_DUPLICATE_COINS' });
      duplicateCleanupMessage = res?.message || 'Cleanup done';
    } catch (e:any) {
      duplicateCleanupMessage = 'Cleanup failed: ' + (e?.message || e);
    }
  }
  let duplicateCleanupMessage: string | null = null;

  // --- Admin DB Tools state ---
  let dbFields: Array<{ field: string; count: number; sample?: any; obsolete: boolean }> = [];
  let dbFieldsLoading = false;
  let selectedFields = new Set<string>();
  let deleteFieldsMessage: string | null = null;

  async function loadDbFields() {
    dbFieldsLoading = true; deleteFieldsMessage = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DB_LIST_FIELDS' });
      if (res?.ok) {
        dbFields = res.fields || [];
      } else {
        deleteFieldsMessage = 'Failed to list fields: ' + (res?.error || 'Unknown error');
      }
    } catch (e:any) {
      deleteFieldsMessage = 'Failed: ' + (e?.message || e);
    } finally {
      dbFieldsLoading = false;
    }
  }

  function toggleFieldSelection(f: string) {
    if (selectedFields.has(f)) selectedFields.delete(f); else selectedFields.add(f);
    selectedFields = new Set(selectedFields);
  }

  async function deleteSelectedFields() {
    if (selectedFields.size === 0) { deleteFieldsMessage = 'Select at least one field'; return; }
    const confirmMsg = `Delete fields from all coins: ${Array.from(selectedFields).join(', ')}? This cannot be undone.`;
    if (!confirm(confirmMsg)) return;
    deleteFieldsMessage = 'Deleting...';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DB_DELETE_FIELDS', fields: Array.from(selectedFields) });
      if (res?.ok) {
        deleteFieldsMessage = `Removed fields from ${res.modified ?? 0} records.`;
        await loadDbFields();
      } else {
        deleteFieldsMessage = 'Failed: ' + (res?.error || 'Unknown error');
      }
    } catch (e:any) {
      deleteFieldsMessage = 'Failed: ' + (e?.message || e);
    }
  }

  // Prune tools (simplified)
  let pruneOlderThanDays: number = 0;
  let pruneNoATH = false;
  let pruneKeepApproved = true;
  let pruneKeepWithATH = true;
  let prunePreview: any = null;
  let pruneMessage: string | null = null;
  let pruning = false;
  let prunePhase: 'idle' | 'preview' | 'delete' = 'idle';

  // ATH Recalculation
  let athRecalcMessage: string | null = null;
  let athRecalculating = false;

  async function recalculateAllATH() {
    athRecalcMessage = null;
    athRecalculating = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'RECALCULATE_ALL_ATH' });
      if (res?.ok) {
        athRecalcMessage = `Processing ${res.count} coin(s) without ATH (older than 60 mins). Check console for progress.`;
      } else {
        athRecalcMessage = 'Failed: ' + (res?.error || 'Unknown error');
      }
    } catch (e: any) {
      athRecalcMessage = 'Failed: ' + (e?.message || e);
    } finally {
      athRecalculating = false;
    }
  }

  // ATH Refresh (recalculate all coins, update only if higher)
  let athRefreshMessage: string | null = null;
  let athRefreshing = false;

  async function refreshAllATH() {
    athRefreshMessage = null;
    athRefreshing = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'RECALCULATE_ALL_ATH_REFRESH' });
      if (res?.ok) {
        athRefreshMessage = `Processed ${res.count} coin(s). Updated: ${res.updated}, Skipped: ${res.skipped}, Errors: ${res.errors || 0}. Check console for details.`;
      } else {
        athRefreshMessage = 'Failed: ' + (res?.error || 'Unknown error');
      }
    } catch (e: any) {
      athRefreshMessage = 'Failed: ' + (e?.message || e);
    } finally {
      athRefreshing = false;
    }
  }

  async function previewPrune() {
    pruning = true; prunePhase = 'preview'; pruneMessage = null; prunePreview = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DB_PRUNE_COINS', params: {
        dryRun: true,
        olderThanDays: pruneOlderThanDays || undefined,
        noATH: pruneNoATH || undefined,
        keepApproved: pruneKeepApproved,
        keepWithATH: pruneKeepWithATH,
      }});
      if (res?.ok) {
        prunePreview = res;
      } else {
        pruneMessage = 'Preview failed: ' + (res?.error || 'Unknown error');
      }
    } catch (e:any) {
      pruneMessage = 'Preview failed: ' + (e?.message || e);
    } finally {
      pruning = false; prunePhase = 'idle';
    }
  }

  async function executePrune() {
    pruneMessage = null;
    // Auto-preview if needed
    if (!prunePreview) {
      await previewPrune();
    }
    if (!prunePreview || prunePreview.deleteCount === 0) { pruneMessage = 'Nothing to delete'; return; }
    if (!confirm(`Delete ${prunePreview.deleteCount} coins? This cannot be undone.`)) return;
    pruning = true; prunePhase = 'delete'; pruneMessage = 'Deleting…';
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DB_PRUNE_COINS', params: {
        dryRun: false,
        olderThanDays: pruneOlderThanDays || undefined,
        noATH: pruneNoATH || undefined,
        keepApproved: pruneKeepApproved,
        keepWithATH: pruneKeepWithATH,
      }});
      if (res?.ok) {
        pruneMessage = `Deleted ${res.deleted || 0} coins.`;
        prunePreview = null;
      } else {
        pruneMessage = 'Delete failed: ' + (res?.error || 'Unknown error');
      }
    } catch (e:any) {
      pruneMessage = 'Delete failed: ' + (e?.message || e);
    } finally {
      pruning = false; prunePhase = 'idle';
    }
  }
</script>

<div class="toolbar">
  <label class="scan-toggle">
    <input type="checkbox" bind:checked={scanEnabled} on:change={toggleScan} />
    <span>Scanning</span>
  </label>
  <button class="clear-all-btn" on:click={clearAllFilters}>🗑️ Clear All Filters</button>
  <button class="admin-tools-btn auto-margin-left" on:click={() => showAdminModal = true} title="Admin Tools">
    ⚙️
  </button>
</div>

<!-- Admin Tools Modal -->
{#if showAdminModal}
  <div class="modal-overlay" role="button" tabindex="0" on:click={(e) => { if (e.target === e.currentTarget) showAdminModal = false; }} on:keydown={(e) => e.key === 'Escape' && (showAdminModal = false)}>
  <div class="modal-content" role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <div class="title-wrap">
          <h3>Admin Tools</h3>
          <span class="subtitle">Maintenance & Utilities</span>
        </div>
        <button class="modal-close" on:click={() => showAdminModal = false} aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid two-col">
          <div class="card">
            <div class="card-header">
              <h4>Data Management</h4>
              <div class="actions">
                <button class="btn primary" on:click={exportDb} disabled={exportingDb}>{exportingDb ? '⏳ Exporting…' : '⬇️ Export DB (gzip)'}</button>
              </div>
            </div>
            {#if exportMessage}<div class="hint success">{exportMessage}</div>{/if}
            <div class="import-block">
              <label class="settings-check"><input type="checkbox" bind:checked={includeSettingsImport}/> Include settings</label>
              <div class="import-row">
                <label class="import-btn">
                  <span class="btn">🔁 Import (Merge)</span>
                  <input type="file" accept=".json,.gz" on:change={(e)=> onImportFileChange(e,'merge')} />
                </label>
                <label class="import-btn" title="Replace all tables">
                  <span class="btn danger">🗑️ Import (Replace)</span>
                  <input type="file" accept=".json,.gz" on:change={(e)=> onImportFileChange(e,'replace')} />
                </label>
              </div>
              {#if importing}<div class="hint">{importProgress}</div>{/if}
              {#if importSummary}
                <details class="summary-details" open>
                  <summary>Import Summary</summary>
                  <ul class="summary-list">
                    {#each tableResultEntries() as item (item[0])}
                      <li><strong>{item[0]}</strong>: +{item[1].added} / upd {item[1].updated} / skip {item[1].skipped}{item[1].failed ? ` / fail ${item[1].failed}` : ''}</li>
                    {/each}
                  </ul>
                  {#if importSummary.warnings?.length}
                    <div class="warnings">Warnings:
                      <ul>{#each importSummary.warnings as w}<li>{w}</li>{/each}</ul>
                    </div>
                  {/if}
                </details>
              {/if}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h4>Quick Fix</h4>
              <div class="actions">
                <button class="btn" on:click={cleanupDuplicates}>🧹 Remove Duplicate Coins</button>
                <button class="btn" on:click={recalculateAllATH} disabled={athRecalculating}>
                  {athRecalculating ? '⏳ Processing...' : '🔄 Recalc ATH (60+ mins)'}
                </button>
                <button class="btn" on:click={refreshAllATH} disabled={athRefreshing}>
                  {athRefreshing ? '⏳ Refreshing...' : '🔁 Refresh All ATH (60+ mins)'}
                </button>
              </div>
            </div>
            {#if duplicateCleanupMessage}<div class="hint">{duplicateCleanupMessage}</div>{/if}
            {#if athRecalcMessage}<div class="hint">{athRecalcMessage}</div>{/if}
            {#if athRefreshMessage}<div class="hint">{athRefreshMessage}</div>{/if}
            <div class="db-tools">
              <div class="fields-section">
                <div class="row">
                  <button class="btn" on:click={loadDbFields} disabled={dbFieldsLoading}>{dbFieldsLoading ? 'Scanning…' : 'Scan Fields'}</button>
                  <button class="btn warn" on:click={deleteSelectedFields} disabled={!dbFields?.length || selectedFields.size === 0}>Delete Selected</button>
                </div>
                {#if deleteFieldsMessage}<div class="hint">{deleteFieldsMessage}</div>{/if}
                {#if dbFields?.length}
                  <div class="fields-list">
                    {#each dbFields as f (f.field)}
                      <label class="field-item">
                        <input type="checkbox" checked={selectedFields.has(f.field)} on:change={() => toggleFieldSelection(f.field)} />
                        <span class="fname">{f.field}</span>
                        {#if f.obsolete}<span class="badge warn" title="Not in current schema">obsolete</span>{/if}
                        <span class="badge">{f.count}</span>
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </div>

        <div class="card wide">
          <div class="card-header">
            <h4>Database Cleanup</h4>
          </div>
          <div class="prune-section">
            <div class="row">
              <label>Older than (days): <input type="number" min="0" step="1" bind:value={pruneOlderThanDays} /></label>
            </div>
            <div class="row">
              <label><input type="checkbox" bind:checked={pruneNoATH}/> Remove coins without ATH</label>
            </div>
            <div class="row split">
              <label><input type="checkbox" bind:checked={pruneKeepApproved}/> Keep DEX approved</label>
              <label><input type="checkbox" bind:checked={pruneKeepWithATH}/> Keep coins with ATH</label>
            </div>
            <div class="row">
              <button class="btn" on:click={previewPrune} disabled={pruning}>{pruning && prunePhase==='preview' ? 'Previewing…' : 'Preview'}</button>
              <button class="btn danger" on:click={executePrune} disabled={pruning}>{pruning && prunePhase==='delete' ? 'Deleting…' : 'Delete'}</button>
            </div>
            {#if prunePreview}
              <div class="hint">Will delete: {prunePreview.deleteCount} / {prunePreview.total}. Reasons: older {prunePreview.reasons?.older || 0}, noATH {prunePreview.reasons?.noATH || 0}</div>
            {/if}
            {#if pruneMessage}
              <div class="hint {pruneMessage?.startsWith('Deleted') ? 'success' : (pruneMessage?.startsWith('Preview') || pruneMessage==='Nothing to delete' ? '' : '')}">{pruneMessage}</div>
            {/if}
          </div>
        </div>
      </div>
  </div>
  </div>
{/if}

<!-- Search Section -->
<div class="search-section">
  <div class="search-input-group">
    <input type="text" placeholder="Search name or address" value={search} on:input={onSearchInput} />
    {#if search}
      <button class="mini clear" on:click={clearSearch}>Clear</button>
    {/if}
  </div>
</div>

<!-- Filters Section -->
<div class="filters-section">
  <div class="filter-group">
    <span class="filter-group-label">Status Filters:</span>
    <div class="filter-options">
      <label class="filter-checkbox">
        <input type="checkbox" bind:checked={dexActiveOnly} />
        <span>DEX approved only</span>
      </label>
    </div>
  </div>

  <div class="filter-group">
    <span class="filter-group-label">Advanced Filters:</span>
    <div class="filter-options">
      <div class="number-filter">
        <label>
          <span>Min admin coins:</span>
          <input type="number" bind:value={minAdminCoinsFilter} min="0" step="1" />
        </label>
      </div>
      <div class="select-filter">
        <label>
          <span>Sort by:</span>
          <select bind:value={sortBy}>
            <option value="default">Default</option>
            <option value="highest-ath">Highest ATH</option>
            <option value="dex-time">Fastest DEX Time</option>
          </select>
        </label>
      </div>
    </div>
  </div>
</div>

<!-- Tag Filters Section -->
{#if categories?.length}
  <div class="tags-section">
    <span class="section-label">Filter by Tag:</span>
    <div class="tag-filter" role="group" aria-label="Filter by tag">
      <button class="chip {selectedTag === '' ? 'active' : ''}" on:click={() => selectedTag = ''}>All</button>
      {#each categories as cat}
        <button class="chip {selectedTag === cat ? 'active' : ''}" on:click={() => selectedTag = cat}>{cat}</button>
      {/each}
    </div>
  </div>
{/if}

<div class="summary">
  <div><strong>{coins.length}</strong> total coins</div>
  <div><strong>{dexApprovedCount}</strong> DEX approved</div>
  <div><strong>{filteredGroups.length}</strong> admins</div>
  {#if debounced || selectedTag || dexActiveOnly || minAdminCoinsFilter > 0 || sortBy !== 'default'}
    <div class="filtered-note">
      Filtered{selectedTag ? `: ${selectedTag}` : ''}
      {dexActiveOnly ? (selectedTag ? ' · DEX' : ': DEX') : ''}
      {minAdminCoinsFilter > 0 ? ((selectedTag || dexActiveOnly) ? ` · ≥${minAdminCoinsFilter} coins` : `: ≥${minAdminCoinsFilter} coins`) : ''}
      {sortBy !== 'default' ? ((selectedTag || dexActiveOnly || minAdminCoinsFilter > 0) ? ` · ${getSortDisplayText(sortBy)}` : `: ${getSortDisplayText(sortBy)}`) : ''}
    </div>
  {/if}
</div>

{#if filteredGroups.length === 0}
  <div class="placeholder">No coins {debounced ? 'match filter' : 'captured yet'}.</div>
{:else}
  {#if useVirtualScrolling}
    <!-- Pagination controls for large datasets -->
    <div class="pagination-controls">
      <button
        class="mini"
        disabled={currentPage === 0}
        on:click={() => currentPage = Math.max(0, currentPage - 1)}
      >← Previous</button>
      <span class="pagination-info">
        Page {currentPage + 1} of {maxPages}
        (showing {currentPage * itemsPerPage + 1}-{Math.min((currentPage + 1) * itemsPerPage, filteredGroups.length)} of {filteredGroups.length})
      </span>
      <button
        class="mini"
        disabled={currentPage >= maxPages - 1}
        on:click={() => currentPage = Math.min(maxPages - 1, currentPage + 1)}
      >Next →</button>
    </div>
  {/if}

  <!-- Render groups -->
  <div class="list">
    {#each visibleGroups as group (group.admin)}
      <AdminGroup
        {group}
        {adminTags}
        {categories}
        collapsed={collapsed.has(group.admin)}
        {lastCopied}
        on:tag-change={handleGroupTagChange}
        on:toggle-group={handleGroupToggle}
        on:copy-address={handleCopyAddress}
        on:refetch={handleRefetch}
        on:delete={handleDelete}
      />
    {/each}
  </div>

  {#if useVirtualScrolling}
    <!-- Bottom pagination controls -->
    <div class="pagination-controls">
      <button
        class="mini"
        disabled={currentPage === 0}
        on:click={() => currentPage = Math.max(0, currentPage - 1)}
      >← Previous</button>
      <span class="page-info">
        Page {currentPage + 1} of {maxPages}
      </span>
      <button
        class="mini"
        disabled={currentPage >= maxPages - 1}
        on:click={() => currentPage = Math.min(maxPages - 1, currentPage + 1)}
      >Next →</button>
    </div>
  {/if}
{/if}

<style>
  .placeholder {
    font-size: 12px;
    color: #64748b;
    background: #161a23;
    padding: 16px;
    border: 1px dashed #334155;
    border-radius: 8px;
    text-align: center;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: auto;
    max-height: 500px; /* Constrain height for better performance */
  }

  /* Search Section */
  .search-section {
    margin-bottom: 12px;
  }

  .search-input-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .search-input-group input {
    flex: 1;
    background: #1d2431;
    border: 1px solid #2f3946;
    color: #e2e8f0;
    padding: 8px 12px;
    font-size: 13px;
    border-radius: 8px;
  }
  .search-input-group input:focus {
    outline: none;
    border-color: #475569;
    box-shadow: 0 0 0 2px rgba(71, 85, 105, 0.1);
  }

  /* Clear Filters Section */
  .clear-all-btn {
    background: #dc2626;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s ease;
  }

  .clear-all-btn:hover {
    background: #b91c1c;
    transform: translateY(-1px);
  }

  /* Filters Section */
  .filters-section {
    background: #0f1a26;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
  }

  .filter-group {
    margin-bottom: 12px;
  }
  .filter-group:last-child {
    margin-bottom: 0;
  }

  .filter-group-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #94a3b8;
    margin-bottom: 8px;
  }

  .filter-options {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
  }

  .filter-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #cbd5e1;
    cursor: pointer;
  }

  .filter-checkbox input {
    width: 16px;
    height: 16px;
    accent-color: #6366f1;
    cursor: pointer;
  }

  .number-filter,
  .select-filter {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #cbd5e1;
  }

  .number-filter input[type="number"] {
    width: 60px;
    background: #1e293b;
    border: 1px solid #334155;
    color: #e2e8f0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .select-filter select {
    background: #1e293b;
    border: 1px solid #334155;
    color: #e2e8f0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    min-width: 140px;
  }

  /* Tags Section */
  .tags-section {
    margin-bottom: 12px;
  }

  .section-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: #94a3b8;
    margin-bottom: 8px;
  }

  .tag-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    background: #1f2937;
    color: #cbd5e1;
    border: 1px solid #334155;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    cursor: pointer;
  }
  .chip:hover { background: #243042; }
  .chip.active {
    background: #334155;
    color: #e2e8f0;
    border-color: #475569;
  }

  /* Summary Section */
  .summary {
    background: #0a1423;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 16px;
    display: flex;
    gap: 16px;
    align-items: center;
    font-size: 12px;
    color: #93a3b8;
    flex-wrap: wrap;
  }
  .summary strong {
    color: #e2e8f0;
    font-weight: 600;
  }

  .filtered-note {
    background: #1e40af;
    color: #dbeafe;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 500;
    margin-left: auto;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    margin-bottom: 10px;
    gap: 12px;
  }

  .auto-margin-left {
    margin-left: auto;
  }

  .scan-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #cbd5e1;
  }
  .scan-toggle input {
    width: 14px;
    height: 14px;
    accent-color: #6366f1;
  }

  .admin-tools-btn {
    background: #374151;
    border: 1px solid #6b7280;
    color: #d1d5db;
    font-size: 16px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .admin-tools-btn:hover {
    background: #4b5563;
    border-color: #9ca3af;
    color: #f3f4f6;
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: linear-gradient(180deg, #0b1220 0%, #0e1626 100%);
    border: 1px solid #1b2434;
    border-radius: 14px;
    min-width: 360px;
    max-width: 720px;
    width: 92vw;
    box-shadow: 0 24px 60px rgba(0,0,0,0.6);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #374151;
  }

  .title-wrap { display:flex; flex-direction:column; gap:4px; }
  .modal-header h3 {
    margin: 0;
    color: #e6edf6;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .subtitle { color:#9fb1c5; font-size:11px; }

  .modal-close {
    background: none;
    border: none;
    color: #9ca3af;
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.2s ease;
  }
  .modal-close:hover {
    background: #374151;
    color: #f3f4f6;
  }

  .modal-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .grid.two-col {
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 12px;
  }
  @media (max-width: 680px) {
    .grid.two-col { grid-template-columns: 1fr; }
  }

  .card { background:#0c1322; border:1px solid #1c2940; border-radius: 10px; padding: 12px; }
  .card.wide { padding: 14px; }
  .card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; }
  .card h4 { margin:0; color:#e2e8f0; font-size: 14px; font-weight: 600; }
  .actions { display:flex; gap:8px; align-items:center; }

  .btn { background:#1b2537; border:1px solid #2a3955; color:#e2e8f0; font-size:12px; padding:6px 10px; border-radius:8px; cursor:pointer; transition:.2s; }
  .btn:hover { background:#22314b; border-color:#354a73; }
  .btn.primary { background:#304b82; border-color:#33569a; }
  .btn.primary:hover { background:#365a9a; }
  .btn.warn { background:#633f16; border-color:#84521b; }
  .btn.warn:hover { background:#7a4c1a; }
  .btn.danger { background:#6c1d1d; border-color:#8a2626; }
  .btn.danger:hover { background:#842121; }

  .mini {
    background: #273243;
    border: 1px solid #334155;
    color: #e2e8f0;
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 4px;
    cursor: pointer;
    line-height: 1;
  }
  .mini:hover { background: #334155; }
  .mini.clear {
    background: #374151;
    border-color: #4b5563;
  }
  .mini.clear:hover { background: #475569; }

  /* Pagination controls */
  .pagination-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 16px 0;
    padding: 8px;
    background: #111722;
    border-radius: 8px;
    border: 1px solid #2f3946;
  }

  .pagination-controls button {
    background: #1e293b;
    border: 1px solid #2f3946;
    color: #e2e8f0;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .pagination-controls button:hover:not(:disabled) {
    background: #334155;
    border-color: #475569;
  }

  .pagination-controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pagination-info {
    color: #94a3b8;
    font-size: 14px;
    font-weight: 500;
  }

  /* Scrollbar refinement */
  .list::-webkit-scrollbar { width: 8px; }
  .list::-webkit-scrollbar-track { background: #111722; }
  .list::-webkit-scrollbar-thumb { background: #2f3a49; border-radius: 8px; }
  .list::-webkit-scrollbar-thumb:hover { background: #3a4757; }

  .db-tools { margin-top: 6px; }
  .fields-list { max-height: 160px; overflow: auto; background:#0f172a; border:1px solid #334155; border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:4px; }
  .field-item { display:flex; align-items:center; gap:8px; font-size:12px; color:#cbd5e1; }
  .field-item .fname { min-width: 120px; }
  .badge { background:#1f2937; border:1px solid #374151; color:#cbd5e1; font-size:10px; padding:1px 6px; border-radius:12px; }
  .badge.warn { background:#3b1d1d; border-color:#7f1d1d; color:#fecaca; }
  .row { display:flex; gap:12px; align-items:center; margin:6px 0; color:#cbd5e1; font-size:12px; }
  .row.split { justify-content:space-between; }
  .row input[type="number"] { width: 80px; background:#1e293b; border:1px solid #334155; color:#e2e8f0; border-radius:4px; padding:2px 6px; }
  .danger { background:#7f1d1d; border-color:#b91c1c; }
  .hint { font-size:11px; color:#cbd5e1; background:#0e1828; border:1px solid #22324d; padding:6px 8px; border-radius:6px; }
  .hint.success { color:#c7f7cf; background:#0f2916; border-color:#1c3b23; }

  /* Data Management: import controls */
  .import-block { display:flex; flex-direction:column; gap:8px; }
  .import-row { display:flex; flex-wrap:wrap; gap:8px; }
  .import-btn { position: relative; display:inline-flex; align-items:center; }
  .import-btn input[type="file"] {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
  }
  .settings-check { font-size:12px; color:#cbd5e1; display:flex; align-items:center; gap:6px; }
  @media (max-width: 520px) {
    .import-row { flex-direction: column; align-items: stretch; }
    .import-btn .btn { width: 100%; text-align: center; }
  }
</style>