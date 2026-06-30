import { describe, expect, it } from 'vitest';
import { SupabaseSessionFileStore } from '../src/server/connectors/SupabaseSessionFileStore';

describe('SupabaseSessionFileStore', () => {
  it('round-trips Baileys auth files by company prefix', async () => {
    const storage = new Map<string, Buffer>();
    const store = new SupabaseSessionFileStore({
      upload: async (path, body) => {
        storage.set(path, Buffer.from(body));
      },
      download: async (path) => storage.get(path) ?? null,
      list: async (prefix) => [...storage.keys()].filter((key) => key.startsWith(prefix)),
      removePrefix: async (prefix) => {
        for (const key of storage.keys()) {
          if (key.startsWith(prefix)) storage.delete(key);
        }
      },
    });

    await store.saveFile('company-a', 'creds.json', Buffer.from('{"noiseKey":"abc"}'));
    await store.saveFile('company-b', 'creds.json', Buffer.from('{"noiseKey":"other"}'));

    const restored = await store.loadCompanyFiles('company-a');

    expect(restored).toEqual([{ relativePath: 'creds.json', body: Buffer.from('{"noiseKey":"abc"}') }]);
  });
});
