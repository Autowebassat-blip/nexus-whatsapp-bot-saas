import type { SupabaseAdminClient } from '../infra/supabase';
import type { SessionStorageDriver } from './SupabaseSessionFileStore';

export class SupabaseStorageDriver implements SessionStorageDriver {
  private readonly admin: SupabaseAdminClient;
  private readonly bucket: string;

  constructor(admin: SupabaseAdminClient, bucket = 'bot-sessions') {
    this.admin = admin;
    this.bucket = bucket;
  }

  async upload(path: string, body: Buffer): Promise<void> {
    const { error } = await this.admin.storage.from(this.bucket).upload(path, body, {
      upsert: true,
      contentType: 'application/json',
    });
    if (error) throw new Error(`session_upload_failed: ${error.message}`);
  }

  async download(path: string): Promise<Buffer | null> {
    const { data, error } = await this.admin.storage.from(this.bucket).download(path);
    if (error) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async list(prefix: string): Promise<string[]> {
    const parts = prefix.replace(/\/$/, '').split('/');
    const folder = parts.slice(0, -1).join('/');
    const leaf = parts.at(-1) ?? '';
    const { data, error } = await this.admin.storage.from(this.bucket).list(folder, {
      limit: 1000,
      search: leaf,
    });
    if (error) throw new Error(`session_list_failed: ${error.message}`);
    return (data ?? [])
      .filter((item) => item.name)
      .map((item) => `${folder}/${item.name}`)
      .filter((key) => key.startsWith(prefix));
  }

  async removePrefix(prefix: string): Promise<void> {
    const keys = await this.list(prefix);
    if (!keys.length) return;
    const { error } = await this.admin.storage.from(this.bucket).remove(keys);
    if (error) throw new Error(`session_remove_failed: ${error.message}`);
  }
}
