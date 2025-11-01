<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CoinRecord } from '$lib/db';

  interface AdminGroup {
    admin: string;
    followers?: number;
    items: CoinRecord[];
    devCounts?: Map<string, number>;
    topDevs?: Set<string>;
    topCount?: number;
    total?: number;
  }

  export let coin: CoinRecord;
  export let group: AdminGroup;
  export let lastCopied: string;

  const dispatch = createEventDispatcher();

  let now = Date.now();

  function formatMc(v: number) {
    return Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 2}).format(v);
  }

  function formatATH(v: number | undefined): string {
    if (v === undefined) return 'Not yet';
    if (v === 0) return '$0';
    return '$' + Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 2}).format(v);
  }

  function formatDuration(ms: number) {
    const s = Math.max(0, Math.floor(ms/1000));
    if (s < 60) return s+'s';
    const m = Math.floor(s/60);
    const rs = s % 60;
    if (m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m/60); const rm = m % 60;
    return `${h}h ${rm}m`;
  }

  function getDexApprovalMs(c: CoinRecord): number | undefined {
    if (typeof c.dexApprovalMs === 'number') return c.dexApprovalMs;
    if (c.dexStatus === 'approved' && c.createdAt && c.dexPaymentAt) {
      const diff = new Date(c.dexPaymentAt).getTime() - new Date(c.createdAt).getTime();
      return isFinite(diff) && diff >= 0 ? diff : undefined;
    }
    return undefined;
  }

  function format(ts: string) {
    const d = new Date(ts);
    const pad = (n:number)=> n.toString().padStart(2,'0');
    let hr = d.getHours();
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12; if (hr === 0) hr = 12;
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${hr}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
  }

  function copyAddress(addr?: string) {
    if (!addr) return;
    dispatch('copy-address', { address: addr });
  }

  function refetch() {
    dispatch('refetch', { address: coin.address });
  }

  function deleteCoin() {
    dispatch('delete', { address: coin.address });
  }

  // Update now time periodically for countdowns
  import { onMount, onDestroy } from 'svelte';
  let tickInterval: any;

  onMount(() => {
    tickInterval = setInterval(() => now = Date.now(), 1000);
  });

  onDestroy(() => {
    clearInterval(tickInterval);
  });
</script>

<div class="row coin-row">
  <div class="name col" title={coin.address}>
    <button class="copy-name" on:click={() => copyAddress(coin.address)} title="Copy address">
      <span class="coin-label">{coin.name}</span>
      <span class="copy-icon">{lastCopied === coin.address ? '✔' : '📋'}</span>
    </button>
  </div>

  <div class="ath col">
    {#if coin.ath !== undefined && coin.ath > 0}
      <span class="ath-value">{formatATH(coin.ath)}</span>
    {:else}
      <span class="ath-pending">Not yet</span>
    {/if}
  </div>

  <div class="dex-time col" title={typeof getDexApprovalMs(coin) === 'number' ? getDexApprovalMs(coin) + ' ms' : ''}>
    {#if typeof getDexApprovalMs(coin) === 'number'}
      {@const v = getDexApprovalMs(coin)}
      <span class="dt-val">{formatDuration(v ?? 0)}</span>
    {:else if coin.dexStatus === 'none'}
      <span class="dt-none">-</span>
    {:else}
      <span class="dt-pending">…</span>
    {/if}
  </div>

  <div class="dex col">
    {#if coin.dexStatus === 'approved'}
      {#if coin.dexPaymentAt}
        <span class="dex-approved">{format(coin.dexPaymentAt)}</span>
      {:else}
        <span class="dex-approved">Approved</span>
      {/if}
    {:else if coin.dexStatus === 'none'}
      <span class="dex-none">None</span>
    {:else}
      <span class="dex-pending">Not yet</span>
    {/if}
  </div>

  <div class="created col" title={coin.createdAt ? format(coin.createdAt) : ''}>
    {coin.createdAt ? format(coin.createdAt) : '—'}
  </div>

  <div class="dev col" title={coin.devAddr || ''}>
    {#if coin.devAddr}
      <button class="copy-name" on:click={() => copyAddress(coin.devAddr)} title="Copy dev address">
        <span class="dev-label {group.topDevs?.has(coin.devAddr) ? 'top-dev' : ''}">{coin.devAddr}</span>
        {#if group.topDevs?.has(coin.devAddr)}
          <span class="dev-badge" title={`Most used in group (${group.devCounts?.get(coin.devAddr)})`}>
            {group.devCounts?.get(coin.devAddr)}
          </span>
        {/if}
        <span class="copy-icon">{lastCopied === coin.devAddr ? '✔' : '📋'}</span>
      </button>
    {:else}
      <span class="dev-placeholder">—</span>
    {/if}
  </div>

  <div class="actions col">
    <button class="mini" title="Refetch" on:click={refetch}>↻</button>
    <button class="mini danger" title="Delete" on:click={deleteCoin}>✕</button>
  </div>
</div>

<style>
  /* grid: name, ath, dexTime, dex, created, dev, actions */
  :root { --grid-cols: 160px 100px 90px 120px 110px 210px 80px; }

  .row {
    display: grid;
    grid-template-columns: var(--grid-cols);
    gap: 8px;
    background: #1b1f29;
    padding: 6px 10px;
    border: 1px solid #262d3a;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.25;
    align-items: center;
  }
  .row:nth-child(odd) { background: #1d222d; }
  .row:hover { border-color: #344155; }

  .name {
    font-weight: 600;
    color: #e2e8f0;
    text-overflow: ellipsis;
  }

  .copy-name {
    all: unset;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    max-width: 100%;
  }
  .copy-name:focus-visible {
    outline: 1px solid #4f46e5;
    outline-offset: 2px;
    border-radius: 4px;
  }

  .coin-label {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy-icon {
    font-size: 12px;
    opacity: .65;
    transition: opacity .15s,color .15s;
    width: 14px;
    text-align: center;
  }
  .copy-name:hover .copy-icon { opacity: 1; }

  .dev .dev-label {
    font-family: monospace;
    font-size: 10px;
    color: #94a3b8;
    max-width: 190px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dev .dev-label.top-dev {
    color: #f0fdf4;
    background: linear-gradient(90deg,rgba(34,197,94,.15),rgba(34,197,94,.05));
    padding: 2px 6px;
    border-radius: 6px;
  }

  .dev-badge {
    margin-left: 6px;
    background: #065f46;
    color: #d1fae5;
    border: 1px solid #10b981;
    font-size: 9px;
    line-height: 1;
    padding: 2px 5px;
    border-radius: 999px;
    font-weight: 700;
  }

  .dev-placeholder {
    color: #6b7280;
    font-size: 10px;
  }

  .created {
    color: #a0aec0;
    font-size: 10px;
    text-align: right;
  }

  .dex { font-size: 10px; }
  .dex-approved { color: #22c55e; font-weight: 600; }
  .dex-none { color: #ef4444; font-weight: 600; }
  .dex-pending { color: #facc15; font-style: italic; }

  .dex-time {
    font-size: 10px;
    color: #cbd5e1;
    text-align: center;
  }
  .dt-val { font-variant-numeric: tabular-nums; }
  .dt-none { color: #6b7280; }
  .dt-pending { color: #facc15; }

  .ath {
    font-size: 11px;

    font-variant-numeric: tabular-nums;
  }
  .ath-value {
    color: #22c55e;
    font-weight: 600;
  }
  .ath-pending {
    color: #facc15;
    font-style: italic;
  }

  .actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

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
  .mini.danger {
    border-color: #55323a;
    background: #40242a;
  }
  .mini.danger:hover {
    background: #5a2f38;
    border-color: #7c3a46;
  }
</style>