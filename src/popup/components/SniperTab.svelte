<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { liveQuery } from 'dexie';
  import { STORAGE_KEYS, getBoolean, getNumber, saveNumber, saveBoolean, getStringArray, saveStringArray } from '$lib/storage';
  import { db } from '$lib/db';

  let followersEnabled = false; // toggle for min followers rule
  let minFollowers = 5000;
  let admin3McapsEnabled = false; // new toggle
  let admin3McapsMin = 10000; // default 10k
  // New condition states
  let launchCountEnabled = false;
  let launchCountMin = 2;
  let launchCountMax = 10;
  let andMode = false; // false = OR (default), true = AND
  let tagRuleEnabled = false;
  let availableTags: string[] = [];
  let selectedTags: string[] = [];

  onMount(async () => {
  followersEnabled = await getBoolean(STORAGE_KEYS.sniperEnabled, false);
  minFollowers = await getNumber(STORAGE_KEYS.sniperFollowersMin, 5000);
    admin3McapsEnabled = await getBoolean(STORAGE_KEYS.sniperAdmin3McapsEnabled, false);
    admin3McapsMin = await getNumber(STORAGE_KEYS.sniperAdmin3McapsMin, 10000);
    launchCountEnabled = await getBoolean(STORAGE_KEYS.sniperLaunchCountEnabled, false);
    launchCountMin = await getNumber(STORAGE_KEYS.sniperLaunchCountMin, 2);
    launchCountMax = await getNumber(STORAGE_KEYS.sniperLaunchCountMax, 10);
    andMode = await getBoolean(STORAGE_KEYS.sniperAndMode, false);
    tagRuleEnabled = await getBoolean(STORAGE_KEYS.sniperAllowedTagsEnabled, false);
    selectedTags = await getStringArray(STORAGE_KEYS.sniperAllowedTags);
    // Load distinct tags (excluding Blacklist is handled in UI visibility logic if desired)
    try {
      const adminRows = await db.admins.toArray();
      const tags = new Set<string>();
      adminRows.forEach(r => { if (r.tag) tags.add(r.tag); });
      availableTags = Array.from(tags).sort();
    } catch {}

    // Live subscription to admin tag changes
    const sub = liveQuery(async () => {
      const rows = await db.admins.toArray();
      const tags = new Set<string>();
      rows.forEach(r => { if (r.tag) tags.add(r.tag); });
      return Array.from(tags).sort();
    }).subscribe({
      next: (tags) => {
        availableTags = tags;
        // Prune deselected tags if they were removed
        const removed = selectedTags.filter(t => !tags.includes(t));
        if (removed.length) {
          selectedTags = selectedTags.filter(t => tags.includes(t));
          saveStringArray(STORAGE_KEYS.sniperAllowedTags, selectedTags);
        }
      },
      error: () => {}
    });

    onDestroy(() => { try { sub.unsubscribe(); } catch {} });
  });

  async function onFollowersEnabledChange() {
    await saveBoolean(STORAGE_KEYS.sniperEnabled, followersEnabled);
  }

  async function onMinFollowersChange(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    minFollowers = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;
    await saveNumber(STORAGE_KEYS.sniperFollowersMin, minFollowers);
  }

  async function onAdmin3McapsEnabledChange() {
    await saveBoolean(STORAGE_KEYS.sniperAdmin3McapsEnabled, admin3McapsEnabled);
  }

  async function onAdmin3McapsMinChange(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    admin3McapsMin = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;
    await saveNumber(STORAGE_KEYS.sniperAdmin3McapsMin, admin3McapsMin);
  }

  async function onLaunchCountEnabledChange() { await saveBoolean(STORAGE_KEYS.sniperLaunchCountEnabled, launchCountEnabled); }
  async function onLaunchCountMinChange(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    launchCountMin = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 0;
    if (launchCountMin > launchCountMax) launchCountMax = launchCountMin;
    await saveNumber(STORAGE_KEYS.sniperLaunchCountMin, launchCountMin);
    await saveNumber(STORAGE_KEYS.sniperLaunchCountMax, launchCountMax);
  }
  async function onLaunchCountMaxChange(e: Event) {
    const val = Number((e.target as HTMLInputElement).value);
    launchCountMax = Number.isFinite(val) ? Math.max(launchCountMin, Math.floor(val)) : launchCountMin;
    await saveNumber(STORAGE_KEYS.sniperLaunchCountMax, launchCountMax);
  }

  async function onModeChange() {
    await saveBoolean(STORAGE_KEYS.sniperAndMode, andMode);
  }

  async function onTagRuleEnabledChange() {
    await saveBoolean(STORAGE_KEYS.sniperAllowedTagsEnabled, tagRuleEnabled);
  }
  function toggleTag(tag: string) {
    if (selectedTags.includes(tag)) {
      selectedTags = selectedTags.filter(t => t !== tag);
    } else {
      selectedTags = [...selectedTags, tag];
    }
    saveStringArray(STORAGE_KEYS.sniperAllowedTags, selectedTags);
  }

</script>

<div class="sniper">
  <div class="mode-row">
    <h3 class="section-title">Sniper Rules</h3>
    <label class="mode-toggle" title="Switch between OR (any rule triggers) and AND (all enabled rules must pass)">
      <span class="mode-label" class:active={!andMode}>OR</span>
      <input type="checkbox" bind:checked={andMode} on:change={onModeChange} aria-label="Toggle AND mode" />
      <span class="mode-slider"></span>
      <span class="mode-label" class:active={andMode}>AND</span>
    </label>
  </div>

  <ul class="rule-list">
    <li class="rule">
      <label class="switch-col">
        <input type="checkbox" bind:checked={tagRuleEnabled} on:change={onTagRuleEnabledChange} aria-label="Enable tag filter rule" />
        <span class="toggle-track small"></span>
      </label>
      <div class="body">
        <div class="row-line">
          <span class="rule-name">Allowed tags</span>
          {#if availableTags.length === 0}
            <div class="hint mini">No tags yet</div>
          {/if}
        </div>
        {#if tagRuleEnabled}
          <div class="tag-grid">
            {#each availableTags as tag}
              <button
                type="button"
                class:selected={selectedTags.includes(tag)}
                class="tag-chip"
                on:click={() => toggleTag(tag)}
                disabled={tag === 'Blacklist'}
                title={tag === 'Blacklist' ? 'Blacklist always blocks sniping' : `Toggle ${tag}`}
              >{tag}</button>
            {/each}
          </div>
          <div class="hint mini">Snipes only if admin tag matches one of selected. Blacklist always blocks.</div>
        {/if}
      </div>
    </li>
    <li class="rule">
      <label class="switch-col">
        <input type="checkbox" bind:checked={followersEnabled} on:change={onFollowersEnabledChange} aria-label="Enable followers rule" />
        <span class="toggle-track small"></span>
      </label>
      <div class="body">
        <div class="row-line">
          <span class="rule-name">Min followers</span>
          <div class="inputs">
            <input class="num sm" type="number" min="0" step="100" bind:value={minFollowers} on:change={onMinFollowersChange} on:blur={onMinFollowersChange} />
            <span class="unit">followers</span>
          </div>
        </div>
        <div class="hint mini">Opens if admin followers > value.</div>
      </div>
    </li>
    <li class="rule">
      <label class="switch-col">
        <input type="checkbox" bind:checked={launchCountEnabled} on:change={onLaunchCountEnabledChange} aria-label="Enable launch count rule" />
        <span class="toggle-track small"></span>
      </label>
      <div class="body">
        <div class="row-line multi">
          <span class="rule-name">Launch count</span>
          <div class="inputs gap">
            <input class="num xs" type="number" min="0" step="1" bind:value={launchCountMin} on:change={onLaunchCountMinChange} on:blur={onLaunchCountMinChange} />
            <span class="sep">–</span>
            <input class="num xs" type="number" min={launchCountMin} step="1" bind:value={launchCountMax} on:change={onLaunchCountMaxChange} on:blur={onLaunchCountMaxChange} />
          </div>
        </div>
        <div class="hint mini">Total launches in range.</div>
      </div>
    </li>
    <li class="rule">
      <label class="switch-col">
  <input type="checkbox" bind:checked={admin3McapsEnabled} on:change={onAdmin3McapsEnabledChange} aria-label="Enable avg last 3 ATH rule" />
        <span class="toggle-track small"></span>
      </label>
      <div class="body">
        <div class="row-line">
          <span class="rule-name">Avg last 3 ATH ≥</span>
          <div class="inputs">
            <input class="num sm" type="number" min="0" step="500" bind:value={admin3McapsMin} on:change={onAdmin3McapsMinChange} on:blur={onAdmin3McapsMinChange} />
            <span class="unit">USD</span>
          </div>
        </div>
  <div class="hint mini">Average of last up to 3 coins' ATH (USD).</div>
      </div>
    </li>
  </ul>
  <div class="foot-note">{andMode ? 'All enabled rules must pass to open a coin page.' : 'Any enabled rule can trigger an open coin page.'}</div>
</div>

<style>
  .sniper { display:flex; flex-direction:column; gap:12px; }
  .mode-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 2px; }
  .mode-toggle { position:relative; display:flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:#64748b; cursor:pointer; user-select:none; }
  .mode-toggle input { position:absolute; opacity:0; pointer-events:none; }
  .mode-slider { width:42px; height:18px; background:#1f2937; border:1px solid #334155; border-radius:20px; position:relative; }
  .mode-slider::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; background:#475569; border-radius:50%; transition:.2s transform, .2s background; }
  .mode-toggle input:checked + .mode-slider::after { transform:translateX(24px); background:#059669; }
  .mode-toggle input:checked + .mode-slider { background:#064e3b; }
  .mode-label { font-size:10px; letter-spacing:.5px; color:#475569; }
  .mode-label.active { color:#e5e7eb; }
  .section-title { margin:0; font-size:12px; font-weight:600; color:#e2e8f0; letter-spacing:.5px; padding:4px 2px; }
  .rule-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
  .rule { display:flex; background:#0b1016; border:1px solid #1e2936; border-radius:9px; padding:6px 10px; gap:10px; align-items:flex-start; position:relative; }
  .rule:hover { border-color:#2c3c4d; }
  .switch-col { position:relative; width:32px; display:flex; justify-content:center; padding-top:2px; }
  .switch-col input { position:absolute; opacity:0; inset:0; cursor:pointer; }
  .toggle-track.small { width:28px; height:14px; background:#1f2937; border:1px solid #334155; border-radius:14px; position:relative; margin-top:4px; }
  .toggle-track.small::after { content:''; position:absolute; top:1px; left:1px; width:10px; height:10px; background:#475569; border-radius:50%; transition:.18s transform, .18s background; }
  .switch-col input:checked + .toggle-track.small { background:#064e3b; }
  .switch-col input:checked + .toggle-track.small::after { transform:translateX(13px); background:#059669; }
  .body { flex:1; display:flex; flex-direction:column; gap:3px; }
  .row-line { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .row-line.multi { align-items:flex-end; }
  .rule-name { font-size:11px; font-weight:600; color:#e5e7eb; letter-spacing:.3px; }
  .inputs { display:flex; align-items:center; gap:4px; }
  .tag-grid { display:flex; flex-wrap:wrap; gap:6px; }
  .tag-chip { background:#1e2936; border:1px solid #334155; color:#93adc5; font-size:10px; padding:3px 8px; border-radius:14px; cursor:pointer; transition:.15s background,.15s color,.15s border; }
  .tag-chip.selected { background:#065f46; border-color:#059669; color:#e6fffa; }
  .tag-chip:disabled { opacity:.45; cursor:not-allowed; }
  .tag-chip:not(:disabled):hover { border-color:#0ea5e9; }
  .inputs.gap { gap:6px; }
  .sep { font-size:11px; color:#64748b; }
  input.num { background:#0d141c; border:1px solid #293444; color:#e2e8f0; border-radius:6px; padding:3px 6px; font-size:11px; width:90px; }
  input.num.sm { width:100px; }
  input.num.xs { width:60px; }
  input.num:focus { outline:1px solid #0ea5e9; border-color:#0ea5e9; }
  .unit { font-size:10px; color:#7aa4c2; }
  .hint.mini { font-size:10px; color:#64748b; line-height:1.2; }
  .foot-note { font-size:10px; color:#475569; text-align:right; padding:2px 4px; }
  @media (max-width:480px) { .row-line { flex-direction:column; align-items:flex-start; } .inputs { flex-wrap:wrap; } }
</style>
