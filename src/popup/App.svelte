<script lang="ts">
  const chrome: any = (globalThis as any).chrome;
  import Tabs from './components/Tabs.svelte';
  import TrenchingTab from './components/TrenchingTab.svelte';
  import AnalyticsTab from './components/AnalyticsTab.svelte';
  import SniperTab from './components/SniperTab.svelte';

  let active = 'trenching';

  const tabs = [
    { id: 'trenching', label: 'Trenching' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'sniper', label: 'Sniper' }
  ];
</script>

<div class="app">
  <header>
    <h1>eCobra Bot Helper</h1>
    <div class="actions">
      <button class="mini" on:click={() => window.open(chrome.runtime.getURL('popup.html'), '_blank')}>Open Full Tab</button>
      <button class="mini" on:click={() => chrome.tabs.query({active:true, currentWindow:true}, tabs => {
        const t = tabs[0]; if (!t?.id) return; chrome.tabs.sendMessage(t.id, { type:'SHOW_OVERLAY' });
      })}>Overlay on Trenches</button>
    </div>
  </header>
  <Tabs {tabs} bind:active/>
  {#if active === 'trenching'}
    <TrenchingTab />
  {:else if active === 'analytics'}
    <AnalyticsTab />
  {:else if active === 'sniper'}
    <SniperTab />
  {/if}
</div>

<style>
  .app { width: 760px; padding: 12px 14px 18px; background:#0f1115; }
  header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  h1 { font-size:16px; margin:0; font-weight:600; letter-spacing:.5px; }
  .actions { display:flex; gap:8px; }
  .mini { background:#273243; border:1px solid #334155; color:#e2e8f0; font-size:11px; padding:4px 8px; border-radius:6px; cursor:pointer; }
  .mini:hover { background:#334155; }
</style>
