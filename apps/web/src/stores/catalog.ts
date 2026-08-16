import { reactive } from 'vue';
import { api } from '../api/client';
import { t } from '../i18n';
import { fail, ok } from '../lib/feedback';

export type ContentItem = {
  id: string;
  modId: string;
  slotId: string;
  name?: string;
  description?: string;
  artifactSha?: string;
  size?: number;
  fileName?: string;
  uploadedBy?: string | null;
  createdAt?: string;
  approved?: boolean;
  r18?: boolean;
  redacted?: boolean;
};

export type ModRow = {
  id: string;
  name?: string;
  latestVersion?: string;
  versionCount?: number;
  containsDll?: boolean;
  description?: string;
  author?: string;
  artifactSize?: number;
  downloads?: number;
  updatedAt?: string;
  gameVersions?: string[];
  dependsOn?: string[];
  contentSlots?: Array<{ id: string; path: string; label?: string }>;
  contentCounts?: Record<string, number>;
  contents?: ContentItem[];
  r18?: boolean;
  r18ContentCount?: number;
  redacted?: boolean;
  versions?: Array<{
    version: string;
    artifactSha?: string;
    gameVersions?: string[];
    gameVersionRange?: string;
    dependsOn?: string[];
  }>;
};

export type PackRow = {
  id: string;
  name?: string;
  gameVersion?: string;
  entryCount?: number;
  packVersion?: number;
  latestReleaseId?: string;
  entries?: Array<{ modId: string; version: string; required?: boolean; contents?: Record<string, string[]> }>;
};

export const catalog = reactive({
  mods: [] as ModRow[],
  packs: [] as PackRow[]
});

export function packOptionLabel(pack: PackRow) {
  return `${pack.name || pack.id}${pack.packVersion != null ? ` · v${pack.packVersion}` : ''}`;
}

export async function loadMods(opts?: { silent?: boolean }) {
  try {
    const data = await api<{ mods: ModRow[] }>('/api/v1/mods');
    catalog.mods = data.mods || [];
    ok(data, t('mod.loaded'), opts?.silent);
    return data;
  } catch (error) {
    fail(error);
    return null;
  }
}

export async function loadPacks(opts?: { silent?: boolean }) {
  try {
    const data = await api<{ packs: PackRow[] }>('/api/v1/packs');
    catalog.packs = data.packs || [];
    ok(data, t('pack.loaded'), opts?.silent);
    return data;
  } catch (error) {
    fail(error);
    return null;
  }
}
