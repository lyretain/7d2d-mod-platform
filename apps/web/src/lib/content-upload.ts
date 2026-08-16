import { api, hashAndUploadZip, type UploadProgress } from '../api/client';
import { t } from '../i18n';
import type { ContentItem } from '../stores/catalog';
import { can } from '../stores/session';

export function zipFilesFrom(list: FileList | File[] | null | undefined) {
  return [...(list || [])].filter((file) => /\.zip$/i.test(file.name));
}

export function contentNameFrom(file: File, override = '') {
  return String(override || file.name.replace(/\.zip$/i, '')).trim().slice(0, 80);
}

export async function uploadContentZips(opts: {
  files: File[];
  modId: string;
  slotId: string;
  name?: string;
  description?: string;
  r18?: boolean;
  onProgress?: (state: { index: number; total: number; file: File; event: UploadProgress }) => void;
}) {
  const created: ContentItem[] = [];
  const errors: Array<{ name: string; message: string }> = [];
  const sharedName = opts.files.length === 1 ? String(opts.name || '').trim() : '';
  const description = String(opts.description || '').trim();
  for (let index = 0; index < opts.files.length; index += 1) {
    const file = opts.files[index];
    try {
      const uploaded = await hashAndUploadZip(file, (event) => opts.onProgress?.({ index, total: opts.files.length, file, event }));
      if (can('review.approve')) {
        await api(`/api/v1/reviews/${uploaded.hash}`, {
          method: 'POST',
          body: JSON.stringify({ status: 'approved', licenseConfirmed: true })
        });
      }
      const name = contentNameFrom(file, sharedName);
      if (!name) throw new Error(t('content.needName'));
      created.push(await api<ContentItem>(`/api/v1/mods/${encodeURIComponent(opts.modId)}/slots/${encodeURIComponent(opts.slotId)}/contents`, {
        method: 'POST',
        body: JSON.stringify({ artifactSha: uploaded.hash, name, description, r18: Boolean(opts.r18) })
      }));
    } catch (error) {
      errors.push({ name: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { created, errors };
}
