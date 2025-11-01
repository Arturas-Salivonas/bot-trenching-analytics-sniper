<script lang="ts">
  import { onMount } from 'svelte';
  import { STORAGE_KEYS, getBoolean, saveBoolean, getTagColors, saveTagColors, getAthColors, saveAthColors, type AthColorSettings } from '$lib/storage';
  import { categoriesLive, adminTagMapLive } from '$lib/db';

  let showAdminNames = true;
  let showFollowers = true;
  let showTags = true;
  let showAdminMcap = true;
  let adminHistoryPopupEnabled = false;
  let dexStatusMonitorEnabled = false;
  let loading = true;
  let categories: string[] = [];
  let tagColors: Record<string, string> = {};
  let adminTagMap = new Map<string, string>();
  let athSettings: AthColorSettings = {
    lowColor: '#ef4444',
    lowThreshold: 40000,
    midColor: '#fbbf24',
    midThreshold: 60000,
    highColor: '#86efac'
  };

  onMount(async () => {
    showAdminNames = await getBoolean(STORAGE_KEYS.trenchingShowAdminNames, true);
    showFollowers = await getBoolean(STORAGE_KEYS.trenchingShowFollowers, true);
    showTags = await getBoolean(STORAGE_KEYS.trenchingShowTags, true);
    showAdminMcap = await getBoolean(STORAGE_KEYS.trenchingShowAdminMcap, true);
    adminHistoryPopupEnabled = await getBoolean(STORAGE_KEYS.adminHistoryPopupEnabled, false);
    dexStatusMonitorEnabled = await getBoolean(STORAGE_KEYS.dexStatusMonitorEnabled, false);
    tagColors = await getTagColors();
    athSettings = await getAthColors();

    // Subscribe to categories and admin tags
    categoriesLive().subscribe((cats) => categories = cats || []);
    adminTagMapLive().subscribe((map) => adminTagMap = map || new Map());

    loading = false;
  });

  async function toggleAdminNames() {
    await saveBoolean(STORAGE_KEYS.trenchingShowAdminNames, showAdminNames);

    // Send message directly to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRENCHING_ADMIN_NAMES',
          enabled: showAdminNames
        });
      }
    });
  }

  async function toggleFollowers() {
    await saveBoolean(STORAGE_KEYS.trenchingShowFollowers, showFollowers);

    // Send message directly to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRENCHING_FOLLOWERS',
          enabled: showFollowers
        });
      }
    });
  }

  async function toggleTags() {
    await saveBoolean(STORAGE_KEYS.trenchingShowTags, showTags);

    // Send message directly to content script with current tag colors
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRENCHING_TAGS',
          enabled: showTags,
          tagColors: tagColors
        });
      }
    });
  }

  async function toggleAdminMcap() {
    await saveBoolean(STORAGE_KEYS.trenchingShowAdminMcap, showAdminMcap);

    // Send message directly to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRENCHING_ADMIN_MCAP',
          enabled: showAdminMcap
        });
      }
    });
  }

  async function updateAthSettings() {
    await saveAthColors(athSettings);

    // Send updated settings to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRENCHING_ATH_COLORS_UPDATE',
          athSettings: athSettings
        });
      }
    });
  }

  function handleAthColorChange(field: 'lowColor' | 'midColor' | 'highColor', event: Event) {
    const target = event.target as HTMLInputElement;
    if (target?.value) {
      athSettings[field] = target.value;
      updateAthSettings();
    }
  }

  function handleAthThresholdChange(field: 'lowThreshold' | 'midThreshold', event: Event) {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);
    if (value && value > 0) {
      athSettings[field] = value;
      updateAthSettings();
    }
  }

  async function toggleAdminHistoryPopup() {
    await saveBoolean(STORAGE_KEYS.adminHistoryPopupEnabled, adminHistoryPopupEnabled);

    // Send message directly to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'ADMIN_HISTORY_POPUP',
          enabled: adminHistoryPopupEnabled
        });
      }
    });
  }

  async function toggleDexStatusMonitor() {
    await saveBoolean(STORAGE_KEYS.dexStatusMonitorEnabled, dexStatusMonitorEnabled);

    // Send message directly to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'DEX_STATUS_MONITOR',
          enabled: dexStatusMonitorEnabled
        });
      }
    });
  }

  async function updateTagColor(tag: string, color: string) {
    tagColors[tag] = color;
    await saveTagColors(tagColors);

    // Send updated colors to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TRENCHING_TAG_COLORS_UPDATE',
          tagColors: tagColors
        });
      }
    });
  }

  function handleColorChange(tag: string, event: Event) {
    const target = event.target as HTMLInputElement;
    if (target?.value) {
      updateTagColor(tag, target.value);
    }
  }
</script>

<div class="section">
  <div class="donation-banner">
    <div class="donation-icon">☕</div>
    <div class="donation-content">
      <div class="donation-title">Support the Developer</div>
      <div class="donation-text">If you find this tool helpful, and you want to thank me (Solana wallet):</div>
      <div class="wallet-address">3ueu8X9QszUX1C4DZ4Z6u1eALLLk1EdzVMHPhbsA5pcw</div>
      <div class="donation-footer">Thank you! 🙏</div>
    </div>
  </div>

  <h2>Trenching Settings</h2>

  <div class="group">
    <h3 class="group-title">Community Link Enhancements</h3>
    <div class="row">
      <label>
        <input type="checkbox" bind:checked={showAdminNames} disabled={loading} on:change={toggleAdminNames} />
        <span>Show admin names on community links</span>
      </label>
    </div>

    <div class="row">
      <label>
        <input type="checkbox" bind:checked={showFollowers} disabled={loading} on:change={toggleFollowers} />
        <span>Show follower counts on community links</span>
      </label>
    </div>

    <div class="row">
      <label>
        <input type="checkbox" bind:checked={showTags} disabled={loading} on:change={toggleTags} />
        <span>Show admin tags/categories on community links</span>
      </label>
    </div>

    <div class="row">
      <label>
        <input type="checkbox" bind:checked={showAdminMcap} disabled={loading} on:change={toggleAdminMcap} />
        <span>Show admin's last 3 available coins ATH</span>
      </label>
    </div>

    <div class="row">
      <label>
        <input type="checkbox" bind:checked={adminHistoryPopupEnabled} disabled={loading} on:change={toggleAdminHistoryPopup} />
        <span>Show Admin History Popup on individual coin pages (/trade/solana/*)</span>
      </label>
    </div>

    <div class="row">
      <label>
        <input type="checkbox" bind:checked={dexStatusMonitorEnabled} disabled={loading} on:change={toggleDexStatusMonitor} />
        <span>Show DEX status and boost monitoring</span>
      </label>
    </div>
  </div>

  {#if showTags && categories.length > 0}
    <div class="color-section">
      <h4>Tag Colors</h4>
      <div class="tag-color-grid">
        {#each categories.filter(tag => tag !== 'Quick Migrate') as tag}
          <div class="tag-color-card">
            <span class="tag-card-name">{tag}</span>
            <input
              type="color"
              value={tagColors[tag] || '#ffffff'}
              on:input={(e) => handleColorChange(tag, e)}
              class="color-picker"
            />
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if showAdminMcap}
    <div class="color-section">
      <h4>ATH Color Settings</h4>
      <p class="section-description">Configure colors based on average ATH of last 3 coins</p>

      <div class="ath-grid">
        <div class="ath-row">
          <span class="ath-label">Low (Below threshold)</span>
          <div class="ath-controls">
            <input
              type="number"
              value={athSettings.lowThreshold}
              on:input={(e) => handleAthThresholdChange('lowThreshold', e)}
              class="threshold-input"
              min="1000"
              step="1000"
              placeholder="40000"
            />
            <input
              type="color"
              value={athSettings.lowColor}
              on:input={(e) => handleAthColorChange('lowColor', e)}
              class="color-picker"
            />
          </div>
        </div>

        <div class="ath-row">
          <span class="ath-label">Mid (Below threshold)</span>
          <div class="ath-controls">
            <input
              type="number"
              value={athSettings.midThreshold}
              on:input={(e) => handleAthThresholdChange('midThreshold', e)}
              class="threshold-input"
              min="1000"
              step="1000"
              placeholder="60000"
            />
            <input
              type="color"
              value={athSettings.midColor}
              on:input={(e) => handleAthColorChange('midColor', e)}
              class="color-picker"
            />
          </div>
        </div>

        <div class="ath-row">
          <span class="ath-label">High (Above mid threshold)</span>
          <div class="ath-controls">
            <span class="threshold-placeholder">-</span>
            <input
              type="color"
              value={athSettings.highColor}
              on:input={(e) => handleAthColorChange('highColor', e)}
              class="color-picker"
            />
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  h2 { font-size:13px; font-weight:600; margin:0 0 8px; text-transform:uppercase; letter-spacing:.75px; color:#94a3b8; }
  h4 { font-size:12px; font-weight:500; margin:0 0 8px; color:#94a3b8; }
  .row { background:#1b1f29; padding:10px 12px; border:1px solid #262d3a; }
  .group { border:1px solid #262d3a; border-radius:8px; overflow:hidden; }
  .group .row:not(:last-child) { border-bottom:1px solid #262d3a; }
  .group .row:first-child { border-top-left-radius:8px; border-top-right-radius:8px; }
  .group .row:last-child { border-bottom-left-radius:8px; border-bottom-right-radius:8px; }
  .group-title { font-size:11px; font-weight:600; padding:8px 12px; background:#1f2736; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; }
  label { display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; }
  input[type="checkbox"] { width:16px; height:16px; accent-color:#6366f1; }
  .section { display:flex; flex-direction:column; gap:10px; }

  .donation-banner {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    padding: 16px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
  }

  .donation-icon {
    font-size: 32px;
    line-height: 1;
  }

  .donation-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .donation-title {
    font-size: 14px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.3px;
  }

  .donation-text {
    font-size: 12px;
    color: #e0e7ff;
    line-height: 1.4;
  }

  .wallet-address {
    background: rgba(255, 255, 255, 0.15);
    padding: 8px 10px;
    border-radius: 6px;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #ffffff;
    word-break: break-all;
    border: 1px solid rgba(255, 255, 255, 0.2);
    margin-top: 4px;
  }

  .donation-footer {
    font-size: 11px;
    color: #c7d2fe;
    font-style: italic;
    margin-top: 2px;
  }

  .color-section {
    background:#1b1f29;
    padding:12px;
    border:1px solid #262d3a;
    border-radius:8px;
    margin-top:8px;
  }

  .tag-color-grid {
    display:grid;
    grid-template-columns:repeat(3, 1fr);
    gap:10px;
  }

  .tag-color-card {
    display:flex;
    flex-direction:column;
    align-items:center;
    gap:8px;
    background:#0f172a;
    padding:12px;
    border:1px solid #262d3a;
    border-radius:6px;
    transition:background 0.2s ease;
  }

  .tag-color-card:hover {
    background:#1e293b;
  }

  .tag-card-name {
    font-size:12px;
    color:#e2e8f0;
    font-weight:500;
    text-align:center;
    word-break:break-word;
  }

  .color-picker {
    width:32px;
    height:24px;
    border:none;
    border-radius:4px;
    cursor:pointer;
    background:none;
  }

  .color-picker::-webkit-color-swatch-wrapper {
    padding:0;
  }

  .color-picker::-webkit-color-swatch {
    border:1px solid #262d3a;
    border-radius:4px;
  }

  .section-description {
    font-size:11px;
    color:#64748b;
    margin:0 0 12px;
    font-style:italic;
  }

  .ath-grid {
    display:flex;
    flex-direction:column;
    gap:10px;
  }

  .ath-row {
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    padding:8px;
    background:#0f172a;
    border-radius:6px;
    border:1px solid #262d3a;
  }

  .ath-label {
    font-size:12px;
    color:#e2e8f0;
    flex:1;
    font-weight:500;
  }

  .ath-controls {
    display:flex;
    align-items:center;
    gap:8px;
  }

  .threshold-input {
    width:80px;
    height:24px;
    padding:0 6px;
    background:#1e293b;
    border:1px solid #334155;
    border-radius:4px;
    color:#e2e8f0;
    font-size:11px;
    text-align:right;
  }

  .threshold-input:focus {
    outline:none;
    border-color:#6366f1;
  }

  .threshold-placeholder {
    width:80px;
    text-align:center;
    color:#64748b;
    font-size:14px;
  }
</style>
