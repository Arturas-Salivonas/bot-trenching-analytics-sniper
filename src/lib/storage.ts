export const STORAGE_KEYS = {
  trenchingTestCss: 'trenching_test_css_enabled',
  analyticsScanEnabled: 'analytics_scan_enabled',
  sniperEnabled: 'sniper_enabled',
  sniperFollowersMin: 'sniper_followers_min',
  sniperAdmin3McapsEnabled: 'sniper_admin3_mcaps_enabled',
  sniperAdmin3McapsMin: 'sniper_admin3_mcaps_min',
  sniperLaunchCountEnabled: 'sniper_launch_count_enabled',
  sniperLaunchCountMin: 'sniper_launch_count_min',
  sniperLaunchCountMax: 'sniper_launch_count_max',
  sniperMigratedCountEnabled: 'sniper_migrated_count_enabled',
  sniperMigratedCountMin: 'sniper_migrated_count_min',
  sniperAndMode: 'sniper_and_mode',
  sniperAllowedTagsEnabled: 'sniper_allowed_tags_enabled',
  sniperAllowedTags: 'sniper_allowed_tags',
  trenchingShowAdminNames: 'trenching_show_admin_names',
  trenchingShowFollowers: 'trenching_show_followers',
  trenchingShowTags: 'trenching_show_tags',
  trenchingShowAdminMcap: 'trenching_show_admin_mcap',
  trenchingTagColors: 'trenching_tag_colors',
  trenchingAthColors: 'trenching_ath_colors',
  adminHistoryPopupEnabled: 'admin_history_popup_enabled',
  dexStatusMonitorEnabled: 'dex_status_monitor_enabled'
} as const;

export async function saveBoolean(key: string, value: boolean) {
  return new Promise<void>((resolve) => {
    chrome.storage.sync.set({ [key]: value }, () => resolve());
  });
}

export async function getBoolean(key: string, defaultValue = false): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([key], (res) => {
      if (typeof res[key] === 'boolean') resolve(res[key]);
      else resolve(defaultValue);
    });
  });
}

export async function saveNumber(key: string, value: number) {
  return new Promise<void>((resolve) => {
    chrome.storage.sync.set({ [key]: value }, () => resolve());
  });
}

export async function getNumber(key: string, defaultValue = 0): Promise<number> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([key], (res) => {
      const v = res[key];
      if (typeof v === 'number' && isFinite(v)) resolve(v);
      else resolve(defaultValue);
    });
  });
}

export async function saveStringArray(key: string, values: string[]) {
  return new Promise<void>((resolve) => {
    chrome.storage.sync.set({ [key]: values }, () => resolve());
  });
}

export async function getStringArray(key: string): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([key], (res) => {
      const v = res[key];
      if (Array.isArray(v)) resolve(v.filter(x => typeof x === 'string'));
      else resolve([]);
    });
  });
}

export function onStorageChange(callback: (changes: Record<string, chrome.storage.StorageChange>) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') callback(changes);
  });
}

export async function saveTagColors(tagColors: Record<string, string>) {
  return new Promise<void>((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.trenchingTagColors]: tagColors }, () => resolve());
  });
}

export async function getTagColors(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.trenchingTagColors], (res) => {
      const colors = res[STORAGE_KEYS.trenchingTagColors];
      if (colors && typeof colors === 'object') resolve(colors);
      else resolve({
        'Alpha': '#00ff00',      // Green
        'Blacklist': '#ff0000',  // Red
        'Good': '#0080ff',       // Blue
        'Quick Dex paid': '#ff8000' // Orange
      });
    });
  });
}

export interface AthColorSettings {
  lowColor: string;
  lowThreshold: number;
  midColor: string;
  midThreshold: number;
  highColor: string;
}

export async function saveAthColors(settings: AthColorSettings) {
  return new Promise<void>((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.trenchingAthColors]: settings }, () => resolve());
  });
}

export async function getAthColors(): Promise<AthColorSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.trenchingAthColors], (res) => {
      const settings = res[STORAGE_KEYS.trenchingAthColors];
      if (settings && typeof settings === 'object') resolve(settings);
      else resolve({
        lowColor: '#ef4444',    // red
        lowThreshold: 40000,    // below 40k
        midColor: '#fbbf24',    // yellow
        midThreshold: 60000,    // 40k-60k
        highColor: '#86efac'    // light green (60k+)
      });
    });
  });
}
