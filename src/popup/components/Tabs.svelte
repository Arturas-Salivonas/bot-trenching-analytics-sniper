<script lang="ts">
  export let tabs: { id: string; label: string }[] = [];
  export let active: string;
  function select(id: string) { active = id; }
</script>
<nav>
  {#each tabs as t}
    <button class:selected={t.id===active} on:click={() => select(t.id)}>{t.label}</button>
  {/each}
</nav>
<style>
  nav { display:flex; gap:6px; margin-bottom:10px; }
  button { flex:1; background:#1b1f29; border:1px solid #262d3a; color:#cbd5e1; padding:6px 4px; font-size:12px; border-radius:6px; cursor:pointer; letter-spacing:.5px; }
  button.selected { background:#334155; color:#fff; border-color:#475569; }
  button:hover { background:#2a3140; }
</style>
