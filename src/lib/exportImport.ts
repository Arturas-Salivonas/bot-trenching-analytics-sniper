import { db } from '$lib/db';
import { STORAGE_KEYS } from '$lib/storage';
import { version as appVersion } from '../../package.json';
// @ts-ignore - type declarations may not be installed for pako
import { gzip, ungzip } from 'pako';

interface ExportManifest {
  formatVersion: number;
  appVersion: string;
  appSchemaVersion: number;
  exportedAt: string;
  tables: Record<string, { meta: any; rows: any[] }>;
  storage: { sync: Record<string, any>; local: Record<string, any> };
  notes?: string;
}

const FORMAT_VERSION = 1;

async function getAllStorage(area: 'sync' | 'local'): Promise<Record<string, any>> {
  return new Promise(resolve => {
    chrome.storage[area].get(null, data => resolve(data || {}));
  });
}

export async function exportDatabase(includeSettings = true, gzipOutput = true): Promise<Blob> {
  // Enumerate tables dynamically
  const tables: ExportManifest['tables'] = {};
  for (const table of db.tables) {
    const name = table.name;
    try {
      const rows = await (table as any).toArray();
      tables[name] = {
        meta: {
          primaryKey: (table.schema.primKey && table.schema.primKey.name) || undefined,
          indexes: table.schema.indexes.map(i => i.name),
          count: rows.length,
          schemaVersion: (db as any)._dbSchema ? Object.keys((db as any)._dbSchema).length : undefined
        },
        rows
      };
    } catch (e) {
      console.warn('[EXPORT] Failed to export table', name, e);
    }
  }

  let storageSync: Record<string, any> = {};
  let storageLocal: Record<string, any> = {};
  if (includeSettings) {
    storageSync = await getAllStorage('sync');
    storageLocal = await getAllStorage('local');
  }

  const manifest: ExportManifest = {
    formatVersion: FORMAT_VERSION,
    appVersion,
    appSchemaVersion: 14, // hard-coded current Dexie schema version
    exportedAt: new Date().toISOString(),
    tables,
    storage: { sync: storageSync, local: storageLocal },
    notes: 'adminStats will be recomputed on import; included here only for completeness.'
  };

  const json = JSON.stringify(manifest);
  if (!gzipOutput) return new Blob([json], { type: 'application/json' });
  const compressed = gzip(json);
  return new Blob([compressed], { type: 'application/gzip' });
}

export interface ImportResultSummary {
  tableResults: Record<string, { added: number; updated: number; skipped: number; failed?: number }>;
  warnings: string[];
}

export async function parseImportFile(file: File): Promise<any> {
  const buf = await file.arrayBuffer();
  // Check gzip magic numbers 1F 8B
  const bytes = new Uint8Array(buf);
  let jsonStr: string;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { jsonStr = new TextDecoder().decode(ungzip(bytes)); } catch (e) { throw new Error('Failed to decompress gzip'); }
  } else {
    jsonStr = new TextDecoder().decode(bytes);
  }
  try { return JSON.parse(jsonStr); } catch { throw new Error('Invalid JSON in import file'); }
}

function pickTimestamp(table: string, row: any): number {
  if (!row || typeof row !== 'object') return 0;
  switch (table) {
    case 'coins':
      return new Date(row.createdAt || row.capturedAt || 0).getTime() || 0;
    case 'admins':
      return new Date(row.updatedAt || 0).getTime() || 0;
    case 'adminStats':
      return new Date(row.lastUpdated || 0).getTime() || 0;
    default:
      return 0;
  }
}

async function backupCurrent(): Promise<Blob> {
  return exportDatabase(true, true);
}

export interface ImportOptions {
  mode: 'merge' | 'replace';
  includeSettings: boolean;
}

export async function importDatabase(manifest: any, options: ImportOptions, progress?: (msg: string) => void): Promise<ImportResultSummary> {
  const summary: ImportResultSummary = { tableResults: {}, warnings: [] };
  const tablesObj = manifest?.tables || {};
  const includeSettings = options.includeSettings;
  const mode = options.mode;
  progress?.('Starting import...');

  // Backup first
  try { await backupCurrent(); progress?.('Backup created'); } catch { summary.warnings.push('Backup failed'); }

  // Process tables
  for (const table of db.tables) {
    const name = table.name;
    const block = tablesObj[name];
    if (!block || !Array.isArray(block.rows)) { summary.warnings.push(`Missing or invalid table ${name}`); continue; }
    const rows = block.rows;
    const result = { added: 0, updated: 0, skipped: 0 };
    summary.tableResults[name] = result;
    progress?.(`Importing ${name} (${rows.length})`);
    if (name === 'adminStats') { // skip and recompute later
      result.skipped = rows.length;
      continue;
    }
    try {
      if (mode === 'replace') {
        await (table as any).clear();
      }
      if (mode === 'replace') {
  await (table as any).bulkAdd(rows).catch(async (e: any) => {
          // Fallback row by row to salvage
          for (const r of rows) { try { await (table as any).add(r); result.added++; } catch { result.skipped++; } }
          throw e;
        });
        result.added = rows.length;
      } else { // merge
        // build existing index map by primary key if possible
        const pk = (table.schema.primKey && table.schema.primKey.name) || undefined;
        let existingMap: Map<any, any> | null = null;
        if (pk) {
          existingMap = new Map();
          await (table as any).each((rec: any) => {
            existingMap!.set(rec[pk], rec);
          });
        }
        for (const r of rows) {
          if (!pk) { result.skipped++; continue; }
            const key = r[pk];
            if (key == null) { result.skipped++; continue; }
            if (!existingMap!.has(key)) {
              try { await (table as any).add(r); result.added++; } catch { result.skipped++; }
            } else {
              const existing = existingMap!.get(key);
              const oldTs = pickTimestamp(name, existing);
              const newTs = pickTimestamp(name, r);
              if (newTs > oldTs) {
                try { await (table as any).put(r); result.updated++; } catch { result.skipped++; }
              } else {
                result.skipped++;
              }
            }
        }
      }
    } catch (e:any) {
      summary.warnings.push(`Table ${name} failed: ${e?.message || e}`);
    }
  }

  // Storage
  if (includeSettings && manifest?.storage) {
    try {
      const syncData = manifest.storage.sync || {};
      const localData = manifest.storage.local || {};
      chrome.storage.sync.set(syncData, () => {});
      chrome.storage.local.set(localData, () => {});
    } catch (e:any) { summary.warnings.push('Storage import failed: ' + (e?.message || e)); }
  }

  // Recompute adminStats
  try {
    const { recalculateAllAdminStats } = await import('$lib/db');
    await recalculateAllAdminStats();
    progress?.('Recomputed adminStats');
  } catch {}

  progress?.('Import complete');
  return summary;
}
