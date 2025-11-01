// Content script injected on trenches page (must be classic script: no ESM imports)
// Inline minimal storage helpers to avoid import splitting creating ESM syntax.

const STORAGE_KEYS = {
  trenchingTestCss: 'trenching_test_css_enabled',
  trenchingShowAdminNames: 'trenching_show_admin_names',
  trenchingShowFollowers: 'trenching_show_followers',
  trenchingShowTags: 'trenching_show_tags',
  trenchingShowAdminMcap: 'trenching_show_admin_mcap',
  trenchingTagColors: 'trenching_tag_colors',
  trenchingAthColors: 'trenching_ath_colors',
  adminHistoryPopupEnabled: 'admin_history_popup_enabled',
  dexStatusMonitorEnabled: 'dex_status_monitor_enabled'
} as const;

function getBoolean(key: string, defaultValue = false): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([key], (res) => {
      const v = res[key];
      resolve(typeof v === 'boolean' ? v : defaultValue);
    });
  });
}

function listenStorage(callback: (changes: Record<string, chrome.storage.StorageChange>) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') callback(changes as any);
  });
}

const STYLE_ID = 'padre-trenching-test-style';
const CSS_TEXT = 'h1{color:red !important;}';

function applyCss() {
  if (document.getElementById(STYLE_ID)) return; // already
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.documentElement.appendChild(style);
}

function removeCss() {
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}

// Admin History Popup functionality
let adminHistoryPopupEnabled = false;
const ADMIN_POPUP_ID = 'padre-admin-history-popup';
let currentPopupCommunityId: string | null = null;

async function initAdminHistoryPopup() {
  adminHistoryPopupEnabled = await getBoolean(STORAGE_KEYS.adminHistoryPopupEnabled, false);

  if (adminHistoryPopupEnabled) {
    handlePageForAdminPopup();
  }
}

function handlePageForAdminPopup() {
  const currentUrl = location.href;

  // Reset retry count for new page loads
  resetRetryCount();

  // Check if we're on a page that should have the admin popup - ONLY on individual coin pages
  if (currentUrl.includes('/trade/solana/')) {
    startAdminPopupObserver();
    findAndShowAdminPopup();
  } else {
    stopAdminPopupObserver();
    hideAdminPopup();
  }
}

function findAndShowAdminPopup() {
  // Look for community link in the DOM
  const communityLink = document.querySelector('a[href*="https://x.com/i/communities/"]') as HTMLAnchorElement;

  if (communityLink) {
    const communityId = extractCommunityId(communityLink.href);

    if (communityId && communityId !== currentPopupCommunityId) {
      currentPopupCommunityId = communityId;
      showAdminPopup(communityId);
    }
  } else {
    // If no community link found, hide popup and retry in a moment
    // More frequent retries in the first few seconds for fast page loads
    hideAdminPopup();
    const retryCount = (window as any)._adminPopupRetryCount || 0;
    if (retryCount < 10) {
      (window as any)._adminPopupRetryCount = retryCount + 1;
      const delay = retryCount < 5 ? 300 : 1000; // Quick retries first, then slower
      setTimeout(findAndShowAdminPopup, delay);
    }
  }
}

function resetRetryCount() {
  (window as any)._adminPopupRetryCount = 0;
}

let adminPopupObserver: MutationObserver | null = null;

function startAdminPopupObserver() {
  if (adminPopupObserver) return;

  adminPopupObserver = new MutationObserver((mutations) => {
    let shouldCheck = false;
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          // Check if a community link was added
          if (node.tagName === 'A' && node.getAttribute('href')?.includes('https://x.com/i/communities/')) {
            shouldCheck = true;
            return;
          }
          // Check if any descendant has community links
          if (node.querySelector && node.querySelector('a[href*="https://x.com/i/communities/"]')) {
            shouldCheck = true;
            return;
          }
        }
      });
      if (shouldCheck) break;
    }

    if (shouldCheck) {
      // Debounce the check to avoid too many calls
      clearTimeout((window as any)._adminPopupCheckTimeout);
      (window as any)._adminPopupCheckTimeout = setTimeout(findAndShowAdminPopup, 200);
    }
  });

  adminPopupObserver.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function stopAdminPopupObserver() {
  if (adminPopupObserver) {
    adminPopupObserver.disconnect();
    adminPopupObserver = null;
  }
  clearTimeout((window as any)._adminPopupCheckTimeout);
}

function createAdminPopup(): HTMLElement {
  const popup = document.createElement('div');
  popup.id = ADMIN_POPUP_ID;
  popup.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 340px;
    max-height: 80vh;
    overflow: hidden;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 12px;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;
    font-size: 12px;
    color: #e2e8f0;
    box-shadow:
      0 20px 40px -12px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(16px);
    transform: translateY(-10px);
    opacity: 0;
    animation: popupSlideIn 0.3s ease-out forwards;
  `;

  // Add CSS animation keyframes
  if (!document.getElementById('admin-popup-styles')) {
    const style = document.createElement('style');
    style.id = 'admin-popup-styles';
    style.textContent = `
      @keyframes popupSlideIn {
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      @keyframes shimmer {
        0% { background-position: -200px 0; }
        100% { background-position: calc(200px + 100%) 0; }
      }
      .admin-popup-loading {
        background: linear-gradient(90deg, #334155 25%, #475569 50%, #334155 75%);
        background-size: 200px 100%;
        animation: shimmer 1.5s infinite;
      }
    `;
    document.head.appendChild(style);
  }

  popup.innerHTML = `
    <div style="
      padding: 14px 16px;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(147, 51, 234, 0.1) 100%);
      border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    ">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="
            width: 6px;
            height: 6px;
            background: linear-gradient(45deg, #3b82f6, #8b5cf6);
            border-radius: 50%;
            box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
          "></div>
          <h3 style="
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          ">Admin History</h3>
        </div>
        <button id="${ADMIN_POPUP_ID}-close" style="
          background: rgba(148, 163, 184, 0.1);
          border: 1px solid rgba(148, 163, 184, 0.2);
          color: #94a3b8;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        " onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'; this.style.borderColor='rgba(239, 68, 68, 0.4)'; this.style.color='#ef4444';"
           onmouseout="this.style.background='rgba(148, 163, 184, 0.1)'; this.style.borderColor='rgba(148, 163, 184, 0.2)'; this.style.color='#94a3b8';">&times;</button>
      </div>
    </div>
    <div style="
      padding: 14px;
      max-height: calc(80vh - 60px);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(148, 163, 184, 0.3) transparent;
    ">
      <div id="${ADMIN_POPUP_ID}-content" style="min-height: 40px; line-height: 1.4;">
        <div style="
          text-align: center;
          padding: 16px;
          color: #64748b;
          background: rgba(148, 163, 184, 0.05);
          border-radius: 8px;
          border: 1px dashed rgba(148, 163, 184, 0.2);
        " class="admin-popup-loading">
          Loading admin data...
        </div>
      </div>
    </div>
  `;

  // Add close handler
  popup.querySelector(`#${ADMIN_POPUP_ID}-close`)?.addEventListener('click', hideAdminPopup);

  return popup;
}

function showAdminPopup(communityId: string) {
  // Remove existing popup
  hideAdminPopup();

  // Create new popup
  const popup = createAdminPopup();
  document.body.appendChild(popup);

  // Load admin data
  loadAdminDataForPopup(communityId);
}

function hideAdminPopup() {
  const popup = document.getElementById(ADMIN_POPUP_ID);
  if (popup) {
    popup.remove();
  }
  currentPopupCommunityId = null;
}

async function loadAdminDataForPopup(communityId: string) {
  const contentEl = document.getElementById(`${ADMIN_POPUP_ID}-content`);
  if (!contentEl) return;

  // Show loading state
  contentEl.innerHTML = '<div style="opacity: 0.6; text-align: center;">⟳ Loading...</div>';

  try {
    // First check our cache
    const cached = communityInfoCache.get(communityId);

    if (cached && cached.adminName) {
      displayAdminInfo(cached.adminName, cached.adminFollowers);
      return;
    }

    // If not in cache, request from background script
    chrome.runtime.sendMessage({
      type: 'REQUEST_COMMUNITY_DATA',
      communityId
    });

    // Set a timeout to show "No data found" if we don't get a response
    setTimeout(() => {
      const currentContentEl = document.getElementById(`${ADMIN_POPUP_ID}-content`);
      if (currentContentEl && currentContentEl.innerHTML.includes('Loading')) {
        displayAdminInfo(null);
      }
    }, 5000);

  } catch (error) {
    console.error('[ADMIN_POPUP] Error loading data:', error);
    displayAdminInfo(null);
  }
}

function displayAdminInfo(adminName?: string | null, followers?: number) {
  const contentEl = document.getElementById(`${ADMIN_POPUP_ID}-content`);
  if (!contentEl) return;

  if (!adminName) {
    contentEl.innerHTML = `
      <div style="
        opacity: 0.6;
        text-align: center;
        padding: 24px 16px;
        background: rgba(239, 68, 68, 0.05);
        border: 1px dashed rgba(239, 68, 68, 0.2);
        border-radius: 10px;
        color: #ef4444;
      ">
        <div style="font-size: 20px; margin-bottom: 6px;">🚫</div>
        <div style="font-weight: 500; font-size: 12px;">No admin data found</div>
        <div style="font-size: 10px; color: #64748b; margin-top: 4px;">This coin might not have admin information</div>
      </div>`;
    return;
  }

  const parts: string[] = [];

  // Get admin tag if available
  let adminTag: string | undefined;
  let tagColor = '#ffffff';
  if (adminTagMap.has(adminName)) {
    adminTag = adminTagMap.get(adminName);
    tagColor = tagColors[adminTag!] || '#ffffff';
  }

  // Compact Admin Info Row - includes name, followers, coin count, and tag all in one row
  let adminInfoRow = `
    <div style="
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(147, 51, 234, 0.1) 100%);
      border: 1px solid rgba(59, 130, 246, 0.2);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    ">
      <!-- Admin Name -->
      <div style="font-weight: 600; font-size: 13px; color: #e2e8f0; white-space: nowrap;">
        ${adminName}
      </div>

      <!-- Divider -->
      <div style="width: 1px; height: 16px; background: rgba(148, 163, 184, 0.3);"></div>`;

  // Followers
  if (followers !== undefined && followers !== null) {
    const formattedFollowers = formatFollowers(followers);
    adminInfoRow += `
      <div style="font-size: 10px; color: #94a3b8; display: flex; align-items: center; gap: 4px; white-space: nowrap;">
        <span style="font-size: 8px;">👥</span>
        <span>${formattedFollowers}</span>
      </div>

      <!-- Divider -->
      <div style="width: 1px; height: 16px; background: rgba(148, 163, 184, 0.3);"></div>`;
  }

  // Coins Launched (will be updated via message)
  adminInfoRow += `
      <div style="font-size: 10px; color: #22c55e; display: flex; align-items: center; gap: 4px; white-space: nowrap;">
        <span style="font-weight: 600; font-size: 12px;" id="${ADMIN_POPUP_ID}-coin-count">...</span>
        <span style="color: #94a3b8;">coins</span>
      </div>`;

  // Admin Tag (if exists)
  if (adminTag) {
    adminInfoRow += `
      <!-- Divider -->
      <div style="width: 1px; height: 16px; background: rgba(148, 163, 184, 0.3);"></div>

      <div style="
        background: ${tagColor}15;
        border: 1px solid ${tagColor}40;
        border-radius: 12px;
        padding: 4px 10px;
        color: ${tagColor};
        font-size: 10px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
      ">
        <span style="
          width: 4px;
          height: 4px;
          background: ${tagColor};
          border-radius: 50%;
        "></span>
        ${adminTag}
      </div>`;
  }

  adminInfoRow += `
    </div>`;
  parts.push(adminInfoRow);

  // Request coin count from background script
  chrome.runtime.sendMessage({
    type: 'GET_ADMIN_COIN_COUNT',
    adminName: adminName
  });

  // Request last 3 coins data for table
  chrome.runtime.sendMessage({
    type: 'GET_ADMIN_LAST_COINS',
    adminName: adminName
  });

  // Coins Table Card
  parts.push(`
    <div style="
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 6px;
    ">
      <div style="
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
      ">
        <span style="font-weight: 600; color: #e2e8f0; font-size: 12px;">Previous Launches</span>
      </div>
      <div id="${ADMIN_POPUP_ID}-coins-table">
        <div style="
          text-align: center;
          padding: 12px;
          color: #64748b;
          background: rgba(148, 163, 184, 0.05);
          border-radius: 8px;
          border: 1px dashed rgba(148, 163, 184, 0.2);
        " class="admin-popup-loading">
          Loading coin data...
        </div>
      </div>
    </div>`);

  contentEl.innerHTML = parts.join('');
}

function formatTimeFromMs(ms?: number): string {
  if (!ms || !isFinite(ms)) return '—';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function createCoinsTable(coins: any[]): string {
  if (!coins || coins.length === 0) {
    return `
      <div style="
        text-align: center;
        padding: 16px;
        color: #64748b;
        background: rgba(148, 163, 184, 0.05);
        border-radius: 8px;
        border: 1px dashed rgba(148, 163, 184, 0.2);
      ">
        <div style="font-size: 18px; margin-bottom: 6px;">🎯</div>
        <div style="font-weight: 500; font-size: 11px;">No previous launches</div>
        <div style="font-size: 10px; margin-top: 4px;">This admin has only launched the current coin</div>
      </div>`;
  }

  const tableStyle = `
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 9px;
    margin-top: 6px;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  `;

  const headerStyle = `
    background: #334155;
    color: #e2e8f0;
    padding: 6px 4px;
    border: none;
    font-weight: 600;
    text-align: center;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  `;

  const cellStyle = `
    padding: 6px 4px;
    border: none;
    text-align: center;
    font-size: 9px;
    background: rgba(15, 23, 42, 0.8);
    color: #cbd5e1;
    transition: background-color 0.2s ease;
  `;

  let tableHtml = `
    <table style="${tableStyle}">
      <thead>
        <tr>
          <th style="${headerStyle}">Coin</th>
          <th style="${headerStyle}">ATH</th>
          <th style="${headerStyle}">DEX</th>
        </tr>
      </thead>
      <tbody>`;

  coins.forEach((coin, index) => {
    const coinName = coin.name || coin.address.slice(0, 6);

    // Format ATH value
    const athValue = coin.ath && typeof coin.ath === 'number' && coin.ath > 0
      ? formatATH(coin.ath)
      : '—';
    const athColor = coin.ath && coin.ath > 0 ? '#22c55e' : '#64748b';

    const dexTime = coin.dexApprovalMs ? formatTimeFromMs(coin.dexApprovalMs) :
                    coin.dexStatus === 'approved' ? 'Yes' :
                    coin.dexStatus === 'none' ? 'None' : '—';

    // Add alternating row colors and hover effects
    const rowStyle = index % 2 === 0 ? cellStyle : cellStyle.replace('rgba(15, 23, 42, 0.8)', 'rgba(30, 41, 59, 0.6)');

    // Add status colors for DEX
    const dexColor = dexTime !== '—' && dexTime !== 'None' ? '#3b82f6' : '#64748b';

    tableHtml += `
      <tr style="transition: all 0.2s ease;"
          onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'"
          onmouseout="this.style.background=''">
        <td style="${rowStyle} font-weight: 500; color: #e2e8f0;" title="${coin.name || coin.address}">${coinName}</td>
        <td style="${rowStyle} color: ${athColor}; font-weight: 500;">${athValue}</td>
        <td style="${rowStyle} color: ${dexColor}; font-weight: 500;">${dexTime}</td>
      </tr>`;
  });

  tableHtml += `</tbody></table>`;
  return tableHtml;
}

// Helper function to format ATH values compactly
function formatATH(ath: number): string {
  if (ath >= 1_000_000) {
    return (ath / 1_000_000).toFixed(1) + 'M';
  } else if (ath >= 1_000) {
    return (ath / 1_000).toFixed(1) + 'K';
  } else {
    return ath.toFixed(0);
  }
}

// DEX Status Monitor functionality
let dexStatusMonitorEnabled = false;
const DEX_MONITOR_ID = 'padre-dex-monitor-box';
let monitoringActive = false;
let monitorIntervalId: any = null;
let bannerIntervalId: any = null;
let boostIntervalId: any = null;
let currentMonitoredAddress: string = '';
let lastDexResponse: any = null;
let bannerImageLoaded = false;
let isDexApproved = false;

async function initDexStatusMonitor() {
  dexStatusMonitorEnabled = await getBoolean(STORAGE_KEYS.dexStatusMonitorEnabled, false);
  console.log('[DEX] initDexStatusMonitor - enabled:', dexStatusMonitorEnabled);

  if (dexStatusMonitorEnabled) {
    handlePageForDexMonitor();
  }
}

function extractCoinAddressFromPage(): string | null {
  // Look for the Twitter search link that contains the coin address
  const links = document.querySelectorAll('a[href*="x.com/search"]');
  console.log('[DEX] Found', links.length, 'Twitter search links');
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const href = link.getAttribute('href');
    if (href) {
      console.log('[DEX] Checking href:', href);
      // Decode the URL to handle %20 and other encoded characters
      const decodedHref = decodeURIComponent(href);
      console.log('[DEX] Decoded href:', decodedHref);

      // Extract coin address from the search query
      // Pattern: (ADDRESS OR url:ADDRESS OR url:...)
      // The address should be 32-44 characters (Solana address length)
      const match = decodedHref.match(/\(([A-Za-z0-9]{32,44})\s+OR\s+url:/);
      if (match && match[1]) {
        console.log('[DEX] ✅ Extracted coin address:', match[1]);
        return match[1];
      }
    }
  }
  console.log('[DEX] ❌ No coin address found');
  return null;
}

function handlePageForDexMonitor() {
  const currentUrl = location.href;
  console.log('[DEX] handlePageForDexMonitor called. URL:', currentUrl);
  console.log('[DEX] dexStatusMonitorEnabled:', dexStatusMonitorEnabled);

  // Check if we're on an individual coin page
  if (currentUrl.includes('/trade/solana/')) {
    console.log('[DEX] ✅ On coin page, showing monitor');
    showDexMonitor();
    // Auto-start monitoring after a short delay to ensure DOM is ready
    setTimeout(() => {
      console.log('[DEX] Attempting to extract coin address...');
      const coinAddress = extractCoinAddressFromPage();
      if (coinAddress) {
        console.log('[DEX] Found coin address:', coinAddress);
        const input = document.getElementById('dex-monitor-input') as HTMLInputElement;
        if (input) {
          console.log('[DEX] Populating input and starting monitoring');
          input.value = coinAddress;
          startMonitoring(coinAddress);
        } else {
          console.log('[DEX] ❌ Input element not found!');
        }
      } else {
        console.log('[DEX] ❌ No coin address extracted');
      }
    }, 1000);
  } else {
    console.log('[DEX] Not on coin page, hiding monitor');
    hideDexMonitor();
    stopMonitoring();
  }
}

function showDexMonitor() {
  // Remove existing monitor if present
  const existing = document.getElementById(DEX_MONITOR_ID);
  if (existing) existing.remove();

  // Create monitor box
  const monitorBox = document.createElement('div');
  monitorBox.id = DEX_MONITOR_ID;
  monitorBox.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      z-index: 999999;
      min-width: 280px;
      max-width:333px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      backdrop-filter: blur(10px);
    ">
      <!-- Banner Image -->
      <div id="dex-banner-container" style="display: none; margin-bottom: 10px;">
        <img id="dex-banner-image" src="" alt="DEX Banner" style="
          width: 100%;
          border-radius: 8px;
          display: block;
        " />
      </div>

      <!-- Header with input and buttons -->
      <div style="display: flex; gap: 6px; margin-bottom: 10px; align-items: center;">
        <input
          type="text"
          id="dex-monitor-input"
          placeholder="Token address"
          style="
            flex: 1;
            background: rgba(30, 41, 59, 0.8);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 6px;
            padding: 6px 8px;
            color: #e2e8f0;
            font-size: 11px;
            outline: none;
          "
        />
        <button
          id="dex-monitor-start"
          style="
            background: #55acee;
            border: none;
            border-radius: 6px;
            padding: 6px 10px;
            color: white;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
          "
          onmouseover="this.style.background='#16a34a'"
          onmouseout="this.style.background='#22c55e'"
          title="Start monitoring"
        >🔍</button>
        <button
          id="dex-monitor-stop"
          style="
            background: #ef4444;
            border: none;
            border-radius: 6px;
            padding: 6px 10px;
            color: white;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
          "
          onmouseover="this.style.background='#dc2626'"
          onmouseout="this.style.background='#ef4444'"
          title="Stop monitoring"
        >🛑</button>
      </div>

      <!-- Status rows -->
      <div style="
        background: rgba(15, 23, 42, 0.6);
        border-radius: 8px;
        padding: 8px;
        font-size: 11px;
      ">
        <div id="dex-status-row" style="
          color: #94a3b8;
          display: flex;
          flex-direction: column;
          gap: 4px;
        ">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span id="dex-status-text" style="font-weight: 500;">❓ Searching...</span>
            <span id="dex-type-badge" style="display: none; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 600;"></span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span id="dex-boost-text" style="font-weight: 500; color: #e2e8f0;">💎 Boost: Dex not paid yet</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(monitorBox);

  // Add event listeners
  const startBtn = document.getElementById('dex-monitor-start');
  const stopBtn = document.getElementById('dex-monitor-stop');
  const input = document.getElementById('dex-monitor-input') as HTMLInputElement;

  startBtn?.addEventListener('click', () => startMonitoring(input?.value || ''));
  stopBtn?.addEventListener('click', () => stopMonitoring());
}

function hideDexMonitor() {
  const existing = document.getElementById(DEX_MONITOR_ID);
  if (existing) existing.remove();
}

function startMonitoring(address: string) {
  if (!address || address.trim() === '') {
    updateDexStatus('❌ No address', null, null);
    return;
  }

  stopMonitoring(); // Stop any existing monitoring

  currentMonitoredAddress = address.trim();
  monitoringActive = true;
  bannerImageLoaded = false;
  isDexApproved = false;
  updateDexStatus('🔍 Checking...', null, null);
  updateBoostStatus('not-paid');

  // Poll every 2 seconds
  monitorIntervalId = setInterval(() => {
    checkDexStatus(currentMonitoredAddress);
  }, 2000);

  // Start banner fetching (also every 2 seconds)
  bannerIntervalId = setInterval(() => {
    if (!bannerImageLoaded) {
      fetchBannerImage(currentMonitoredAddress);
    }
  }, 2000);

  // Initial checks
  checkDexStatus(currentMonitoredAddress);
  fetchBannerImage(currentMonitoredAddress);
}

function stopMonitoring() {
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  if (bannerIntervalId) {
    clearInterval(bannerIntervalId);
    bannerIntervalId = null;
  }
  if (boostIntervalId) {
    clearInterval(boostIntervalId);
    boostIntervalId = null;
  }
  monitoringActive = false;
  currentMonitoredAddress = '';
  lastDexResponse = null;
  bannerImageLoaded = false;
  isDexApproved = false;
  updateDexStatus('⏸️ Stopped', null, null);
  updateBoostStatus('not-paid');
  hideBannerImage();
}

async function checkDexStatus(address: string) {
  try {
    // Call DexScreener API directly
    const response = await fetch(`https://api.dexscreener.com/orders/v1/solana/${address}`);

    if (!response.ok) {
      updateDexStatus('❌ API Error', null, null);
      return;
    }

    const data = await response.json();

    // Check if we got valid data
    if (Array.isArray(data) && data.length > 0) {
      const order = data[0];
      lastDexResponse = order;

      const status = order.status;
      const timestamp = order.paymentTimestamp;

      // Check if status changed to a final status (approved or other)
      const statusLower = status?.toLowerCase();
      const wasNotApproved = !isDexApproved;

      if (statusLower === 'approved') {
        isDexApproved = true;

        // Start boost monitoring when approved
        if (wasNotApproved) {
          updateBoostStatus('searching');
          startBoostMonitoring(address);
        }
      } else if (['cancelled', 'on-hold', 'rejected'].includes(statusLower)) {
        isDexApproved = true; // Treat other final statuses as "paid" state

        if (wasNotApproved) {
          updateBoostStatus('searching');
          startBoostMonitoring(address);
        }
      }

      // Check if we should stop status monitoring
      const finalStatuses = ['approved', 'cancelled', 'on-hold', 'rejected'];
      if (finalStatuses.includes(statusLower)) {
        // Stop status monitoring after getting final status
        if (monitorIntervalId) {
          clearInterval(monitorIntervalId);
          monitorIntervalId = null;
          monitoringActive = false;
        }
      }

      updateDexStatus(status, timestamp, order);
    } else {
      updateDexStatus('❓ Not found', null, null);
    }
  } catch (error) {
    console.error('Error checking DEX status:', error);
    updateDexStatus('❌ Error', null, null);
  }
}

async function fetchBannerImage(address: string) {
  if (bannerImageLoaded) return; // Already loaded, no need to fetch

  try {
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`);

    if (!response.ok) {
      console.log('[DEX] Banner API error:', response.status);
      return;
    }

    const data = await response.json();
    console.log('[DEX] Banner API response:', data);

    // API returns an array of pairs - get the first one
    if (data && Array.isArray(data) && data.length > 0) {
      const firstPair = data[0];

      // Try to extract the header image URL from the info object
      if (firstPair.info && firstPair.info.header) {
        const bannerUrl = firstPair.info.header;
        console.log('[DEX] Found banner URL:', bannerUrl);
        displayBannerImage(bannerUrl);
        bannerImageLoaded = true;

        // Stop banner fetching interval
        if (bannerIntervalId) {
          clearInterval(bannerIntervalId);
          bannerIntervalId = null;
        }
      } else {
        console.log('[DEX] No banner found in first pair');
      }
    } else {
      console.log('[DEX] No pairs found in response');
    }
  } catch (error) {
    console.error('[DEX] Error fetching banner:', error);
  }
}

function displayBannerImage(url: string) {
  const bannerContainer = document.getElementById('dex-banner-container');
  const bannerImage = document.getElementById('dex-banner-image') as HTMLImageElement;

  if (bannerContainer && bannerImage) {
    bannerImage.src = url;
    bannerContainer.style.display = 'block';
    console.log('[DEX] Banner image displayed');
  }
}

function hideBannerImage() {
  const bannerContainer = document.getElementById('dex-banner-container');
  const bannerImage = document.getElementById('dex-banner-image') as HTMLImageElement;

  if (bannerContainer && bannerImage) {
    bannerContainer.style.display = 'none';
    bannerImage.src = '';
  }
}

// Boost monitoring functions
function startBoostMonitoring(address: string) {
  // Clear any existing boost interval
  if (boostIntervalId) {
    clearInterval(boostIntervalId);
  }

  // Start polling for boost every 2 seconds
  boostIntervalId = setInterval(() => {
    fetchBoostData(address);
  }, 2000);

  // Initial fetch
  fetchBoostData(address);
}

async function fetchBoostData(address: string) {
  try {
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${address}`);

    if (!response.ok) {
      console.log('[DEX] Boost API error:', response.status);
      return;
    }

    const data = await response.json();
    console.log('[DEX] Boost API response:', data);

    // API returns an array of pairs - check the first one for boosts
    if (data && Array.isArray(data) && data.length > 0) {
      const firstPair = data[0];

      // Check if boosts exist
      if (firstPair.boosts && firstPair.boosts.active !== undefined) {
        const activeBoosts = firstPair.boosts.active;
        console.log('[DEX] Found active boosts:', activeBoosts);
        updateBoostStatus('found', activeBoosts);
      } else {
        console.log('[DEX] No boosts found, still searching...');
        // Keep showing "Searching..." until boosts are found
      }
    } else {
      console.log('[DEX] No pairs found in boost response');
    }
  } catch (error) {
    console.error('[DEX] Error fetching boost data:', error);
  }
}

function updateBoostStatus(state: 'not-paid' | 'searching' | 'found', boostValue?: number) {
  const boostSpan = document.getElementById('dex-boost-text') as HTMLSpanElement;

  if (!boostSpan) return;

  if (state === 'not-paid') {
    boostSpan.innerHTML = '<span style="color: #e2e8f0;">Boost:</span> <span style="color: #94a3b8;">Dex not paid yet</span>';
  } else if (state === 'searching') {
    boostSpan.innerHTML = '<span style="color: #e2e8f0;">Boost:</span> <span style="color: #94a3b8;">Searching...</span>';
  } else if (state === 'found' && boostValue !== undefined) {
    boostSpan.innerHTML = `<span style="color: #e2e8f0;">Boost:</span> <span style="color: #fbbf24; font-weight: 600;">${boostValue}</span>`;
  }
}

function updateDexStatus(status: string | null, timestamp: number | null, orderData: any) {
  const statusRow = document.getElementById('dex-status-row');
  const span = document.getElementById('dex-status-text') as HTMLSpanElement;
  const typeBadge = document.getElementById('dex-type-badge') as HTMLSpanElement;

  if (!span) return;

  // Determine color based on status
  let statusColor = '#94a3b8'; // default gray
  let emoji = '';

  if (status) {
    const statusLower = status.toLowerCase();

    // Special handling for "not found" - treat as searching
    if (statusLower.includes('not found')) {
      statusColor = '#94a3b8';
      emoji = '';
      span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">Searching...</span>`;
    } else if (statusLower === 'approved') {
      statusColor = '#22c55e'; // green
      emoji = '';

      if (timestamp) {
        const timeStr = formatTimestamp(timestamp);
        const timeAgo = getTimeAgo(timestamp);
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span> <span style="color: #e2e8f0;">at</span> <span style="color: #e2e8f0;">${timeStr}</span> <span style="color: #e2e8f0;">(</span><span style="color: #60a5fa;">${timeAgo}</span><span style="color: #e2e8f0;">)</span>`;
      } else {
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
      }
    } else if (statusLower === 'processing') {
      statusColor = '#eab308'; // yellow
      emoji = '⏳';

      if (timestamp) {
        const timeStr = formatTimestamp(timestamp);
        const timeAgo = getTimeAgo(timestamp);
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span> <span style="color: #e2e8f0;">at</span> <span style="color: #e2e8f0;">${timeStr}</span> <span style="color: #e2e8f0;">(</span><span style="color: #60a5fa;">${timeAgo}</span><span style="color: #e2e8f0;">)</span>`;
      } else {
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
      }
    } else if (['cancelled', 'rejected', 'on-hold'].includes(statusLower)) {
      statusColor = '#ef4444'; // red
      emoji = '❌';

      if (timestamp) {
        const timeStr = formatTimestamp(timestamp);
        const timeAgo = getTimeAgo(timestamp);
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span> <span style="color: #e2e8f0;">at</span> <span style="color: #e2e8f0;">${timeStr}</span> <span style="color: #e2e8f0;">(</span><span style="color: #60a5fa;">${timeAgo}</span><span style="color: #e2e8f0;">)</span>`;
      } else {
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
      }
    } else if (statusLower.includes('checking') || statusLower.includes('searching')) {
      statusColor = '#94a3b8';
      emoji = '🔍';
      span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">Searching...</span>`;
    } else if (statusLower.includes('stopped')) {
      statusColor = '#64748b';
      emoji = '⏸️';
      span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">Stopped</span>`;
    } else if (statusLower.includes('error')) {
      statusColor = '#ef4444';
      emoji = '❌';
      span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">Error</span>`;
    } else {
      // Generic fallback for unknown statuses
      if (timestamp) {
        const timeStr = formatTimestamp(timestamp);
        const timeAgo = getTimeAgo(timestamp);
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span> <span style="color: #e2e8f0;">at</span> <span style="color: #e2e8f0;">${timeStr}</span> <span style="color: #e2e8f0;">(</span><span style="color: #60a5fa;">${timeAgo}</span><span style="color: #e2e8f0;">)</span>`;
      } else {
        span.innerHTML = `${emoji} <span style="color: #e2e8f0;">Status:</span> <span style="color: ${statusColor};">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
      }
    }
  } else {
    span.innerHTML = '🔍 <span style="color: #e2e8f0;">Status:</span> <span style="color: #94a3b8;">Searching...</span>';
  }

  // Update type badge
  if (typeBadge && orderData && orderData.type) {
    const orderType = orderData.type.toLowerCase();

    if (orderType === 'tokenprofile') {
      typeBadge.textContent = 'ORIGINAL';
      typeBadge.style.display = 'inline-block';
      typeBadge.style.backgroundColor = 'rgba(34, 197, 94, 0.2)'; // green background
      typeBadge.style.color = '#22c55e'; // green text
      typeBadge.style.border = '1px solid #22c55e';
    } else if (orderType === 'communitytakeover') {
      typeBadge.textContent = 'CTO';
      typeBadge.style.display = 'inline-block';
      typeBadge.style.backgroundColor = 'rgba(249, 115, 22, 0.2)'; // orange background
      typeBadge.style.color = '#f97316'; // orange text
      typeBadge.style.border = '1px solid #f97316';
    } else {
      typeBadge.style.display = 'none';
    }
  } else if (typeBadge) {
    typeBadge.style.display = 'none';
  }
}function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12; // Convert to 12-hour format

  return `${displayHours}:${minutes}:${seconds} ${ampm}`;
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  const remainingHours = diffHours % 24;
  const remainingMinutes = diffMinutes % 60;

  if (diffDays > 0) {
    return `${diffDays} day${diffDays > 1 ? 's' : ''}, ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}, ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours > 1 ? 's' : ''}, ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffSeconds > 0) {
    return `${diffSeconds} second${diffSeconds !== 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

async function init() {
  const enabled = await getBoolean(STORAGE_KEYS.trenchingTestCss);
  if (enabled) applyCss();

  // Initialize community info display
  await initCommunityInfo();

  // Initialize admin history popup
  await initAdminHistoryPopup();

  // Initialize DEX status monitor
  await initDexStatusMonitor();
}

// Community admin info functionality
let showAdminNames = true;
let showFollowers = true;
let showTags = true;
let showAdminMcap = true;
let tagColors: Record<string, string> = {};
let adminTagMap = new Map<string, string>();
let athSettings = {
  lowColor: '#ef4444',
  lowThreshold: 40000,
  midColor: '#fbbf24',
  midThreshold: 60000,
  highColor: '#86efac'
};
const communityInfoCache = new Map<string, { adminName?: string; adminFollowers?: number; adminMcaps?: number[] }>();
const adminInfoCache = new Map<string, { followers?: number }>();
const processedLinks = new WeakSet<Element>();
const recentlyUpdatedFromCache = new Set<string>(); // Track which admins were recently updated from cache response
let cacheInitialized = false; // Track if initial cache has loaded
const pendingRequests = new Set<string>(); // Track pending community data requests
const requestRetries = new Map<string, number>(); // Track retry attempts per community

async function initCommunityInfo() {
  showAdminNames = await getBoolean(STORAGE_KEYS.trenchingShowAdminNames, true);
  showFollowers = await getBoolean(STORAGE_KEYS.trenchingShowFollowers, true);
  showTags = await getBoolean(STORAGE_KEYS.trenchingShowTags, true);
  showAdminMcap = await getBoolean(STORAGE_KEYS.trenchingShowAdminMcap, true);

  // Load ATH color settings
  chrome.storage.sync.get([STORAGE_KEYS.trenchingAthColors], (res) => {
    const settings = res[STORAGE_KEYS.trenchingAthColors];
    if (settings && typeof settings === 'object') {
      athSettings = settings;
    }
  });

  // Load tag colors
  chrome.storage.sync.get([STORAGE_KEYS.trenchingTagColors], (res) => {
    const colors = res[STORAGE_KEYS.trenchingTagColors];
    if (colors && typeof colors === 'object') {
      tagColors = colors;
    } else {
      tagColors = {
        'Alpha': '#00ff00',
        'Blacklist': '#ff0000',
        'Good': '#0080ff',
        'Quick Dex paid': '#ff8000'
      };
    }
  });

  // Prepare and register the cache response listener BEFORE requesting, to avoid race conditions
  const handleCacheResponse = (message: any) => {
    if (message.type === 'COMMUNITY_CACHE_RESPONSE' && message.data) {
      message.data.forEach((item: any) => {
        if (item.communityId && (item.adminName || item.adminFollowers)) {
          // Check if we already have cache data for this community
          const existing = communityInfoCache.get(item.communityId);

          // Only overwrite if we don't have existing data OR if new data has adminMcaps
          const shouldUpdate = !existing ||
            (!existing.adminName && item.adminName) ||
            (!existing.adminFollowers && item.adminFollowers) ||
            (!existing.adminMcaps && item.adminMcaps && item.adminMcaps.length > 0);

          if (shouldUpdate) {
            // Merge with existing data to preserve any fields
            communityInfoCache.set(item.communityId, {
              adminName: item.adminName || existing?.adminName,
              adminFollowers: item.adminFollowers ?? existing?.adminFollowers,
              adminMcaps: item.adminMcaps || existing?.adminMcaps
            });

            // Mark this admin as recently updated from cache to prevent redundant hydration
            if (item.adminName && item.adminMcaps?.length > 0) {
              recentlyUpdatedFromCache.add(item.adminName);
              // Clear the flag after a short delay to allow normal hydration later
              setTimeout(() => recentlyUpdatedFromCache.delete(item.adminName), 5000);
            }
          }
        }
      });

      cacheInitialized = true;

      // Update all existing community links with the loaded data
      updateAllCommunityLinks(true);

      // Remove the listener after receiving the response
      chrome.runtime.onMessage.removeListener(handleCacheResponse);
    }
  };

  chrome.runtime.onMessage.addListener(handleCacheResponse);

  // Load existing community data and admin tag map from database
  chrome.runtime.sendMessage({ type: 'GET_COMMUNITY_CACHE' });
  chrome.runtime.sendMessage({ type: 'GET_ADMIN_TAG_MAP' });
}

function extractCommunityId(href: string): string | null {
  const match = href.match(/communities\/(\d+)/);
  return match ? match[1] : null;
}

function formatFollowers(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function formatMcap(mcap: number): string {
  if (mcap >= 1000000) return `${(mcap / 1000000).toFixed(1)}M`;
  if (mcap >= 1000) return `${Math.round(mcap / 1000)}k`;
  return `${mcap}`;
}

function createCommunityInfo(communityId: string, adminName?: string, adminFollowers?: number, adminMcaps?: number[], isLoading = false): HTMLElement {
  const div = document.createElement('div');
  div.className = 'community-follower-info';
  div.setAttribute('data-community-id', communityId);

  // Get admin tag color for text only
  let textColor = '#ffffff'; // Default text color

  if (showTags && adminName && adminTagMap.has(adminName)) {
    const tag = adminTagMap.get(adminName);
    if (tag && tagColors[tag]) {
      textColor = tagColors[tag];
    }
  }

  div.style.cssText = `
    padding: 3px 6px 3px 0px;
    font-size: 9px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    z-index: 5;
    position: relative;
    flex-shrink: 0;
    border-radius: 3px;
    margin-left: 4px;
    color: ${textColor};
  `;

  let content = '';

  if (isLoading) {
    // Show loading state when data is not yet available
    content = '<span style="opacity: 0.6;">⟳</span>';
  } else {
    const parts: string[] = [];

    // Only show admin name if setting is enabled AND we have the data
    if (showAdminNames && adminName) {
      parts.push(`@${adminName}`);
    }

    // Only show followers if setting is enabled AND we have the data (including 0)
    if (showFollowers && adminFollowers !== undefined && adminFollowers !== null) {
      const followers = formatFollowers(adminFollowers);
      parts.push(`(${followers})`);
    }

    // Only show tag if setting is enabled AND we have admin name AND tag data
    if (showTags && adminName && adminTagMap.has(adminName)) {
      const tag = adminTagMap.get(adminName);
      if (tag) {
        parts.push(tag);
      }
    }

    // Only show admin ATH if setting is enabled AND we have the data
    if (showAdminMcap && adminMcaps && adminMcaps.length > 0) {
      const athStr = adminMcaps.map(ath => formatMcap(ath)).join(' / ');

      // Calculate average ATH
      const avgAth = adminMcaps.reduce((sum, ath) => sum + ath, 0) / adminMcaps.length;

      // Determine color based on average ATH using dynamic settings
      let athColor = athSettings.lowColor;
      if (avgAth >= athSettings.midThreshold) {
        athColor = athSettings.highColor;
      } else if (avgAth >= athSettings.lowThreshold) {
        athColor = athSettings.midColor;
      }

      parts.push(`<span style="color: ${athColor};">[${athStr}]</span>`);
    }

    content = `<span class="ci-content" style="display: inline;">${parts.join(' - ')}</span>`;
  }

  div.innerHTML = content;
  return div;
}

function updateCommunityLink(link: HTMLAnchorElement, forceUpdate = false) {
  const href = link.getAttribute('href');
  if (!href || !href.includes('/communities/')) return;

  const communityId = extractCommunityId(href);
  if (!communityId) return;

  // Skip if already processed and not forcing update
  if (!forceUpdate && processedLinks.has(link)) return;

  // Always remove existing info first
  const existing = link.parentElement?.querySelector(`[data-community-id="${communityId}"]`);
  if (existing) existing.remove();

  // Check if all toggles are completely disabled
  if (!showAdminNames && !showFollowers && !showTags && !showAdminMcap) {
    processedLinks.delete(link);
    return;
  }

  let cached = communityInfoCache.get(communityId);
  let info: HTMLElement;

  // Check if we have ANY data to show
  const hasAnyData = cached && (cached.adminName || cached.adminFollowers !== undefined);

  if (!hasAnyData) {
    // No data yet - check if we've already requested it
    if (!pendingRequests.has(communityId)) {
      // First time seeing this community, request data
      pendingRequests.add(communityId);
      requestRetries.set(communityId, 0);

  // Debug removed: Requesting data for community
      chrome.runtime.sendMessage({
        type: 'REQUEST_COMMUNITY_DATA',
        communityId
      });

      // Set a timeout to retry if data doesn't arrive
      const retryTimeout = setTimeout(() => {
        const updatedCache = communityInfoCache.get(communityId);
        const stillNoData = !updatedCache || (!updatedCache.adminName && updatedCache.adminFollowers === undefined);

        const retryCount = requestRetries.get(communityId) || 0;

        if (stillNoData && retryCount < 2) {
          // Debug removed: Retry no data for community
          requestRetries.set(communityId, retryCount + 1);
          pendingRequests.delete(communityId); // Allow re-request

          // Force re-check the link
          updateCommunityLink(link, true);
        } else {
          // Max retries reached or data arrived
          pendingRequests.delete(communityId);
          requestRetries.delete(communityId);

          if (stillNoData) {
            // Debug removed: Giving up after retries
          }
        }
      }, 3000);
    }

    // Show loading state
    info = createCommunityInfo(communityId, undefined, undefined, undefined, true);
  } else {
    // We have data - clear any pending request tracking
    pendingRequests.delete(communityId);
    requestRetries.delete(communityId);

    // We have data - show it based on current settings
    const shouldShowAdmin = showAdminNames && cached.adminName;
    const shouldShowFollowers = showFollowers && cached.adminFollowers !== undefined && cached.adminFollowers !== null;
    const shouldShowMcap = showAdminMcap && cached.adminMcaps && cached.adminMcaps.length > 0;

    // If we have data but all display options are disabled, don't show anything
    if (!shouldShowAdmin && !shouldShowFollowers && !shouldShowMcap) {
      // Settings don't allow showing this data - remove any existing display
      processedLinks.delete(link);
      return;
    }

    info = createCommunityInfo(
      communityId,
      shouldShowAdmin ? cached.adminName : undefined,
      shouldShowFollowers ? cached.adminFollowers : undefined,
      shouldShowMcap ? cached.adminMcaps : undefined,
      false
    );
  }

  // Always append the info element (either loading or data)
  link.parentElement?.appendChild(info);
  processedLinks.add(link);
}

function updateAllCommunityLinks(forceUpdate = true) {
  // Clear processed links when doing a full update (for toggle changes)
  if (forceUpdate) {
    document.querySelectorAll('.community-follower-info').forEach(info => info.remove());
    // Can't clear WeakSet, but removing elements and re-processing handles it
  }

  const links = document.querySelectorAll('a[href*="/communities/"]') as NodeListOf<HTMLAnchorElement>;

  links.forEach(link => {
    updateCommunityLink(link, forceUpdate);
  });
}

// Enhanced DOM scanning with better detection
function performDeepScan() {
  // Scan for any community links that might have been missed
  const allLinks = document.querySelectorAll('a[href*="/communities/"]') as NodeListOf<HTMLAnchorElement>;
  let processedCount = 0;
  let newCount = 0;

  allLinks.forEach(link => {
    const communityId = extractCommunityId(link.getAttribute('href') || '');
    if (!communityId) return;

    const hasInfo = link.parentElement?.querySelector(`[data-community-id="${communityId}"]`);

    if (!hasInfo && !processedLinks.has(link)) {
      updateCommunityLink(link, false);
      newCount++;
    } else if (hasInfo) {
      processedCount++;
    }
  });

  if (newCount > 0) {
    // Only log if we actually found something significant
  }
}

function updateCommunityData(communityId: string, adminName?: string, adminFollowers?: number, adminMcaps?: number[]) {
  // Get existing cache to preserve data
  const existing = communityInfoCache.get(communityId);

  // Merge new data with existing data - only overwrite if new value is provided
  const mergedData = {
    adminName: adminName ?? existing?.adminName,
    adminFollowers: adminFollowers ?? existing?.adminFollowers,
    // Only accept adminMcaps when it's non-empty; avoid downgrading to empty array
    adminMcaps: (Array.isArray(adminMcaps) && adminMcaps.length > 0) ? adminMcaps : existing?.adminMcaps
  };

  communityInfoCache.set(communityId, mergedData);

  // Clear pending request tracking since data has arrived
  pendingRequests.delete(communityId);
  requestRetries.delete(communityId);

  if (adminName) {
    const existingAdminInfo = adminInfoCache.get(adminName);
    adminInfoCache.set(adminName, {
      followers: adminFollowers ?? existingAdminInfo?.followers
    });
  }

  // Find all links with this community ID and update them immediately
  const links = document.querySelectorAll(`a[href*="/communities/${communityId}"]`) as NodeListOf<HTMLAnchorElement>;

  // Debug removed: updating links for community

  links.forEach(link => {
    // Always force update when new data arrives
    updateCommunityLink(link, true);
  });
}

function removeCommunityInfo() {
  const infos = document.querySelectorAll('.community-follower-info');
  infos.forEach(info => info.remove());
  // WeakSet doesn't have clear method, will be garbage collected naturally
}


listenStorage((changes) => {
  if (STORAGE_KEYS.trenchingTestCss in changes) {
    const { newValue } = changes[STORAGE_KEYS.trenchingTestCss];
    if (newValue) applyCss(); else removeCss();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'TRENCHING_TEST_CSS') {
    if (msg.enabled) applyCss(); else removeCss();
  }
  if (msg?.type === 'SHOW_OVERLAY') {
    toggleOverlay(true);
  }
  if (msg?.type === 'HIDE_OVERLAY') {
    toggleOverlay(false);
  }
  if (msg?.type === 'SNIPE_OPEN' && typeof msg.address === 'string') {
    tryOpenCoinByAddress(msg.address);
  }
});

init();

// Dev live reload for content script: just force full page reload
if (import.meta.env.DEV) {
  try {
    const ws = new WebSocket('ws://localhost:17331');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'RELOAD') location.reload();
      } catch {}
    };
  } catch {}
}

// --- Analytics scanning logic ---
// Strategy: Observe added nodes; for each potential token container search for pump.fun link + name + community link.
// We dedupe by tracking addresses already sent this session.

const discovered = new Set<string>();
// load persisted discovered addresses
chrome.storage.local.get(['discovered_addresses'], res => {
  const arr: string[] = res['discovered_addresses'] || [];
  arr.forEach(a => discovered.add(a));
});
function persistDiscovered() {
  chrome.storage.local.set({ discovered_addresses: Array.from(discovered) });
}
const PUMP_PREFIX = 'https://pump.fun/coin/';
const BONK_PREFIX = 'https://bonk.fun/token/';
const COMMUNITY_SUB = 'https://x.com/i/communities/';

let scanningEnabled = true; // default, will read from storage
chrome.storage.sync.get(['analytics_scan_enabled'], res => {
  if (typeof res['analytics_scan_enabled'] === 'boolean') scanningEnabled = res['analytics_scan_enabled'];
});

function extractCoinData(root: Element) {
  if (!scanningEnabled) return;
  // Support pump.fun & bonk.fun token providers
  const tokenLink = root.querySelector(`a[href^="${PUMP_PREFIX}"], a[href^="${BONK_PREFIX}"]`) as HTMLAnchorElement | null;
  if (!tokenLink) return;
  const href = tokenLink.getAttribute('href') || '';
  let address = '';
  if (href.startsWith(PUMP_PREFIX)) address = href.slice(PUMP_PREFIX.length);
  else if (href.startsWith(BONK_PREFIX)) address = href.slice(BONK_PREFIX.length);
  if (!address) return;
  const communityLink = root.querySelector(`a[href^="${COMMUNITY_SUB}"]`) as HTMLAnchorElement | null;
  if (!communityLink) return;
  const commHref = communityLink.getAttribute('href') || '';
  let communityId = '';
  const match = commHref.match(/communities\/(\d+)/);
  if (match) communityId = match[1];
  // If new coin
  if (!discovered.has(address)) {
    const nameEl = root.querySelector('h1.MuiTypography-root');
    const name = (nameEl?.textContent || '').trim();
    if (!name) return;
    discovered.add(address);
    persistDiscovered();
    chrome.runtime.sendMessage({
      type: 'ADD_COIN',
      address,
      capturedAt: new Date().toISOString(),
      communityId
    });
  } else if (communityId) {
    // Existing coin: maybe update community info if missing
    chrome.runtime.sendMessage({ type: 'COMMUNITY_META', address, communityId });
  }
}

function scanInitial(container: Element) {
  container.querySelectorAll('div[role="gridcell"]').forEach(el => extractCoinData(el));

  // Process community links immediately with loading states
  updateAllCommunityLinks(false);
}

let observer: MutationObserver | null = null;
function getObserver() {
  if (!observer) {
    observer = new MutationObserver(muts => {
      let hasNewLinks = false;
      for (const m of muts) {
        m.addedNodes.forEach(n => {
          if (n instanceof HTMLElement) {
            if (n.getAttribute('role') === 'gridcell') extractCoinData(n);
            n.querySelectorAll?.('div[role="gridcell"]').forEach(el => extractCoinData(el));
            if (n.tagName === 'A' && n.getAttribute('href')?.includes('/communities/')) {
              updateCommunityLink(n as HTMLAnchorElement, false);
              hasNewLinks = true;
            }
            const nestedLinks = n.querySelectorAll?.('a[href*="/communities/"]');
            if (nestedLinks && nestedLinks.length > 0) {
              nestedLinks.forEach(link => {
                updateCommunityLink(link as HTMLAnchorElement, false);
                hasNewLinks = true;
              });
            }
          }
        });
      }
      if (hasNewLinks) setTimeout(() => performDeepScan(), 100);
    });
  }
  return observer;
}
function startObserving(container: Element) { getObserver().observe(container, { subtree: true, childList: true }); }

// --- Main Initialization ---
const CONTAINER_SELECTOR = '.css-1nutvck';
let activeContainer: Element | null = null;

function waitForContainerAndInit() {
  const container = document.querySelector(CONTAINER_SELECTOR);
  if (container && container !== activeContainer) {
    activeContainer = container;
    // Reset discovered when (re)entering trenches so sniper can act on fresh stream
    if (location.pathname.includes('/trenches')) {
      discovered.clear();
      chrome.storage.local.set({ discovered_addresses: [] });
    }
    scanInitial(container);
    startObserving(container);
    startPeriodicScanning();
  }
  if (!activeContainer) setTimeout(waitForContainerAndInit, 250);
}

// Periodic scanning to catch any missed elements
let scanInterval: number;

function startPeriodicScanning() {
  // Clear any existing interval
  if (scanInterval) clearInterval(scanInterval);

  // Scan every 3 seconds for missed elements
  scanInterval = setInterval(() => {
    performDeepScan();
  }, 3000);
}

function stopPeriodicScanning() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = 0;
  }
}

waitForContainerAndInit();

// Additional robustness: Handle SPA navigation and URL changes
let currentUrl = location.href;
const urlCheckInterval = setInterval(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    activeContainer = null; // force reacquire
    // Clear discovered when coming back to trenches view only
    if (location.pathname.includes('/trenches')) {
      discovered.clear();
      chrome.storage.local.set({ discovered_addresses: [] });
    }

    // Handle admin popup for URL changes
    if (adminHistoryPopupEnabled) {
      setTimeout(() => handlePageForAdminPopup(), 300);
    }

    // Handle DEX monitor for URL changes
    if (dexStatusMonitorEnabled) {
      setTimeout(() => handlePageForDexMonitor(), 300);
    }

    setTimeout(() => {
      waitForContainerAndInit();
      updateAllCommunityLinks(false);
      performDeepScan();
    }, 300);
  }
}, 800);

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
  activeContainer = null;
  if (location.pathname.includes('/trenches')) {
    discovered.clear();
    chrome.storage.local.set({ discovered_addresses: [] });
  }

  // Handle admin popup for navigation
  if (adminHistoryPopupEnabled) {
    setTimeout(() => handlePageForAdminPopup(), 250);
  }

  // Handle DEX monitor for navigation
  if (dexStatusMonitorEnabled) {
    setTimeout(() => handlePageForDexMonitor(), 250);
  }

  setTimeout(() => {
    waitForContainerAndInit();
    updateAllCommunityLinks(false);
    performDeepScan();
  }, 250);
});

// IntersectionObserver to avoid scanning off-screen (optional enhancement): here we just hook new gridcells.
// The mutation observer already limits scanning; further optimization can be added later.


// When user returns to the tab, rescan to catch any changes while the tab was backgrounded
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (container) scanInitial(container);
    // Also do a thorough community links scan
    setTimeout(() => {
      updateAllCommunityLinks(false);
      performDeepScan();
    }, 200);
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'SCAN_TOGGLE') {
    scanningEnabled = !!msg.enabled;
  }
  if (msg?.type === 'FORCE_RESCAN') {
    const container = document.querySelector(CONTAINER_SELECTOR);
    if (container) scanInitial(container);
  }

  // Trenching admin info handlers - don't return true since we don't need async responses
  if (msg?.type === 'TRENCHING_ADMIN_NAMES') {
    showAdminNames = msg.enabled;
    updateAllCommunityLinks(true); // Force update for toggle changes
  }
  if (msg?.type === 'TRENCHING_FOLLOWERS') {
    showFollowers = msg.enabled;
    updateAllCommunityLinks(true); // Force update for toggle changes
  }
  if (msg?.type === 'TRENCHING_TAGS') {
    showTags = msg.enabled;
    if (msg.tagColors) {
      tagColors = msg.tagColors;
    }
    updateAllCommunityLinks(true); // Force update for toggle changes
  }
  if (msg?.type === 'TRENCHING_ADMIN_MCAP') {
    showAdminMcap = msg.enabled;
    updateAllCommunityLinks(true); // Force update for toggle changes
  }
  if (msg?.type === 'TRENCHING_TAG_COLORS_UPDATE') {
    if (msg.tagColors) {
      tagColors = msg.tagColors;
      updateAllCommunityLinks(true); // Force update for color changes
    }
  }
  if (msg?.type === 'TRENCHING_ATH_COLORS_UPDATE') {
    if (msg.athSettings) {
      athSettings = msg.athSettings;
      updateAllCommunityLinks(true); // Force update for ATH color changes
    }
  }
  if (msg?.type === 'UPDATE_COMMUNITY_INFO') {
    const { communityId, adminName, adminFollowers, adminMcaps } = msg;

    if (communityId) {
      updateCommunityData(communityId, adminName, adminFollowers, adminMcaps);

      // Update admin popup if it's showing this community
      if (adminHistoryPopupEnabled && currentPopupCommunityId === communityId) {
        displayAdminInfo(adminName, adminFollowers);
      }
    }
  }
  if (msg?.type === 'UPDATE_ADMIN_INFO') {
    const { adminName, adminFollowers } = msg;
    if (adminName) {
      const existingAdminInfo = adminInfoCache.get(adminName);
      adminInfoCache.set(adminName, {
        followers: adminFollowers
      });
      // Find all communities associated with this admin and update them
      for (const [communityId, info] of communityInfoCache.entries()) {
        if (info.adminName === adminName) {
          // Update only followers, preserve other data including adminMcaps
          updateCommunityData(communityId, adminName, adminFollowers, undefined);
        }
      }
    }
  }
  if (msg?.type === 'COMMUNITY_CACHE_RESPONSE') {
    // This is handled by the temporary listener in initCommunityInfo
    return false;
  }
  if (msg?.type === 'ADMIN_TAG_MAP_RESPONSE') {
    if (msg.adminTagMap) {
  // Debug removed: ADMIN_TAG_MAP_RESPONSE count
      adminTagMap = new Map(Object.entries(msg.adminTagMap));
      updateAllCommunityLinks(true); // Force update with new tag data

      // Update admin popup if showing
      if (adminHistoryPopupEnabled && currentPopupCommunityId) {
        const cached = communityInfoCache.get(currentPopupCommunityId);
        if (cached && cached.adminName) {
          displayAdminInfo(cached.adminName, cached.adminFollowers);
        }
      }
    }
    return false;
  }

  if (msg?.type === 'ADMIN_HISTORY_POPUP') {
    adminHistoryPopupEnabled = !!msg.enabled;
    if (adminHistoryPopupEnabled) {
      handlePageForAdminPopup();
    } else {
      stopAdminPopupObserver();
      hideAdminPopup();
    }
    return false;
  }

  if (msg?.type === 'DEX_STATUS_MONITOR') {
    dexStatusMonitorEnabled = !!msg.enabled;
    if (dexStatusMonitorEnabled) {
      handlePageForDexMonitor();
    } else {
      hideDexMonitor();
      stopMonitoring();
    }
    return false;
  }

  if (msg?.type === 'ADMIN_COIN_COUNT_RESPONSE') {
    const { adminName, coinCount } = msg;
    if (adminName && typeof coinCount === 'number') {
      const coinCountEl = document.getElementById(`${ADMIN_POPUP_ID}-coin-count`);
      if (coinCountEl) {
        coinCountEl.innerHTML = coinCount.toString();
        // Add a subtle animation
        coinCountEl.style.transform = 'scale(1.1)';
        setTimeout(() => {
          coinCountEl.style.transform = 'scale(1)';
          coinCountEl.style.transition = 'transform 0.2s ease';
        }, 150);
      }
    }
    return false;
  }

  if (msg?.type === 'ADMIN_LAST_COINS_RESPONSE') {
    const { adminName, coins } = msg;
    if (adminName && Array.isArray(coins)) {
      const tableEl = document.getElementById(`${ADMIN_POPUP_ID}-coins-table`);
      if (tableEl) {
        const tableHtml = createCoinsTable(coins);
        tableEl.innerHTML = tableHtml;

        // Add fade-in animation
        tableEl.style.opacity = '0';
        tableEl.style.transform = 'translateY(10px)';
        setTimeout(() => {
          tableEl.style.transition = 'all 0.3s ease';
          tableEl.style.opacity = '1';
          tableEl.style.transform = 'translateY(0)';
        }, 100);
      }
    }
    return false;
  }
});

// --- Overlay injection ---
const OVERLAY_ID = 'padre-analytics-overlay';
function ensureOverlay(): HTMLDivElement {
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.zIndex = '999999';
  el.style.background = 'rgba(8,11,18,0.85)';
  el.style.backdropFilter = 'blur(2px)';
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.padding = '16px';
  // close button
  const close = document.createElement('button');
  close.textContent = '✕ Close';
  close.style.alignSelf = 'flex-end';
  close.style.marginBottom = '8px';
  close.style.background = '#1f2937';
  close.style.color = '#e5e7eb';
  close.style.border = '1px solid #374151';
  close.style.borderRadius = '6px';
  close.style.padding = '6px 10px';
  close.onclick = () => toggleOverlay(false);
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('overlay.html');
  // Ensure clipboard access works within the extension iframe on the host page
  // Some browsers gate this behind Permissions Policy in cross-origin iframes
  ;(frame as any).allow = 'clipboard-read; clipboard-write';
  frame.style.flex = '1';
  frame.style.width = '75%';
  frame.style.border = '1px solid #334155';
  frame.style.borderRadius = '10px';
  frame.style.boxShadow = '0 10px 30px rgba(0,0,0,.5)';
  frame.style.background = '#0f1115';
  frame.style.margin = 'auto';
  el.appendChild(close);
  el.appendChild(frame);
  document.documentElement.appendChild(el);
  return el;
}

function toggleOverlay(show: boolean) {
  const el = ensureOverlay();
  el.style.display = show ? 'flex' : 'none';
  // ESC to close overlay for quick UX
  if (show) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleOverlay(false);
        document.removeEventListener('keydown', onKey, true);
      }
    };
    document.addEventListener('keydown', onKey, true);
  }
}

// --- Sniper DOM clicker ---
const snipedSession = new Set<string>();

function performLeftClickGridcell(cell: HTMLElement) {
  const rect = cell.getBoundingClientRect();
  const cx = Math.floor(rect.left + rect.width / 2);
  const cy = Math.floor(rect.top + rect.height / 2);
  const target = (document.elementFromPoint(cx, cy) as HTMLElement) || cell;
  const common: MouseEventInit & any = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }; // left
  const pointerCommon: PointerEventInit & any = { bubbles: true, cancelable: true, pointerType: 'mouse', clientX: cx, clientY: cy, button: 0 };
  // Hover
  target.dispatchEvent(new PointerEvent('pointerover', pointerCommon));
  target.dispatchEvent(new MouseEvent('mouseover', common));
  target.dispatchEvent(new MouseEvent('mousemove', common));
  // Press
  target.dispatchEvent(new PointerEvent('pointerdown', { ...pointerCommon, buttons: 1 }));
  target.dispatchEvent(new MouseEvent('mousedown', { ...common, buttons: 1 }));
  // Release
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointerCommon, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
  // Click
  target.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
}
function tryOpenCoinByAddress(address: string, attempts = 18) { // ~4.5s of retries
  if (!address || snipedSession.has(address)) return;
  // Find the gridcell containing the pump.fun link for this address
  const link = document.querySelector(`a[href="${PUMP_PREFIX}${address}"], a[href="${BONK_PREFIX}${address}"]`);
  if (!link) {
    if (attempts > 0) setTimeout(() => tryOpenCoinByAddress(address, attempts - 1), 200);
    return;
  }
  const cell = link.closest('div[role="gridcell"]') as HTMLElement | null;
  if (!cell) {
    // Fallback: try a generic 'open' button if present anywhere
    const btn = document.querySelector('button[aria-label*="open" i], [role="button"][aria-label*="open" i]') as HTMLElement | null;
    if (btn) performLeftClickGridcell(btn); else if (attempts > 0) setTimeout(() => tryOpenCoinByAddress(address, attempts - 1), 250);
    return;
  }
  // Direct left click on the gridcell itself per new requirement
  performLeftClickGridcell(cell);
  snipedSession.add(address);
}
// (no test/inspector code in production)
