import './style.css';
import App from './App.svelte';

const target = document.getElementById('app');

if (target) {
  new App({ target });
}

// Dev live reload (ignored in production because no WS server then)
if (import.meta.env.DEV) {
  try {
    const ws = new WebSocket('ws://localhost:17331');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'RELOAD') {
          // reload popup window only
          location.reload();
        }
      } catch {}
    };
  } catch {}
}
