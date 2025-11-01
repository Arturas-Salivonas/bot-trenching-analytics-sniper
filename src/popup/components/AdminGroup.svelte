<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import CoinRow from './CoinRow.svelte';
  import type { CoinRecord, AdminStats } from '$lib/db';

  interface AdminGroup {
    admin: string;
    followers?: number;
    items: CoinRecord[];
    devCounts?: Map<string, number>;
    topDevs?: Set<string>;
    topCount?: number;
    total?: number;
    stats?: AdminStats;
  }

  export let group: AdminGroup;
  export let adminTags: Map<string, string>;
  export let categories: string[];
  export let collapsed: boolean;
  export let lastCopied: string;

  const dispatch = createEventDispatcher();

  function handleTagChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    dispatch('tag-change', { admin: group.admin, value });
  }

  function toggleGroup() {
    dispatch('toggle-group', { admin: group.admin });
  }

  function handleCopyAddress(event: CustomEvent) {
    dispatch('copy-address', event.detail);
  }

  function handleRefetch(event: CustomEvent) {
    dispatch('refetch', event.detail);
  }

  function handleDelete(event: CustomEvent) {
    dispatch('delete', event.detail);
  }
</script>

<div class="group-block">
  <div class="group-head">
    <button
      type="button"
      class="group-header"
      aria-expanded={!collapsed}
      on:click={toggleGroup}
      on:keydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleGroup();
        }
      }}
    >
      <div class="chevron {collapsed ? 'collapsed' : ''}"></div>
      <div class="admin-name" title={group.admin}>{group.admin}</div>
      <div class="admin-followers" title={group.followers?.toString() || ''}>
        ({group.followers !== undefined && group.followers !== null ? Intl.NumberFormat('en-US', {notation: 'compact'}).format(group.followers) : '—'})
      </div>
      <div class="group-meta">
        <div class="group-count">{group.total ?? group.items.length} coin{(group.total ?? group.items.length) > 1 ? 's' : ''}</div>
      </div>
    </button>
    <div class="group-tools">
      <label class="tagger">
        <span class="tag-label">Tag:</span>
        <select on:change={handleTagChange}>
          <option value="" selected={!adminTags.get(group.admin)}>—</option>
          {#each categories as cat}
            <option value={cat} selected={adminTags.get(group.admin) === cat}>{cat}</option>
          {/each}
        </select>
        {#if adminTags.get(group.admin)}
          <span class="active-tag">{adminTags.get(group.admin)}</span>
        {/if}
      </label>
    </div>
  </div>

  {#if !collapsed}
    <div class="cols-labels">
      <span class="c-name col">Coin</span>
      <span class="c-ath col">ATH 60min</span>
      <span class="c-dex-time col">DEX Time</span>
      <span class="c-dex col">DEX</span>
      <span class="c-created col">Token Created</span>
      <span class="c-dev col">DA</span>
      <span class="c-actions col">Actions</span>
    </div>
    <div class="coins">
      {#each group.items as coin (coin.address)}
        <CoinRow
          {coin}
          {group}
          {lastCopied}
          on:copy-address={handleCopyAddress}
          on:refetch={handleRefetch}
          on:delete={handleDelete}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  /* grid: name, ath, dexTime, dex, created, dev, actions */
  :root { --grid-cols: 160px 100px 90px 120px 110px 210px 80px; }

  .group-block {
    border: 1px solid #253140;
    background: #121923;
    border-radius: 14px;
    padding: 12px 10px 14px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 2px 6px -2px rgba(0,0,0,.55);
  }
  .group-block:hover { border-color: #2f3d4d; }

  .group-head { display: flex; align-items: center; gap: 10px; }

  .group-header {
    all: unset;
    display: flex;
    align-items: center;
    gap: 10px;
    background: linear-gradient(90deg,#243244,#1e2938);
    border: 1px solid #334454;
    padding: 8px 12px;
    border-radius: 10px;
    font-size: 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,.4);
    cursor: pointer;
    user-select: none;
    color: inherit;
    flex: 1 1 auto;
  }
  .group-header:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }

  .chevron {
    width: 6px;
    height: 6px;
    flex: 0 0 6px;
    border-right: 2px solid #94a3b8;
    border-bottom: 2px solid #94a3b8;
    transform: rotate(45deg);
    transition: transform .18s;
  }
  .chevron.collapsed { transform: rotate(-45deg); }

  .admin-name {
    font-weight: 600;
    color: #f8fafc;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .admin-followers {
    font-size: 10px;
    color: #f1f5f9;
    padding: 2px 8px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 500;
  }

  .group-meta {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .group-count {
    color: #29c499;
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 5px;
  }

  .group-tools {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .tagger {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #cbd5e1;
  }

  .tagger select {
    background: #1f2937;
    color: #e2e8f0;
    border: 1px solid #334155;
    padding: 3px 6px;
    border-radius: 6px;
    font-size: 11px;
  }

  .tagger .active-tag {
    background: #374151;
    color: #e2e8f0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    margin-left: 4px;
  }

  .cols-labels {
    display: grid;
    grid-template-columns: var(--grid-cols);
    gap: 8px;
    padding: 6px 10px 0 10px;
    color: #8091a5;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .55px;
    font-weight: 600;
    margin-top: 10px;
  }

  .coins {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding: 0 8px 4px 8px;
  }
</style>