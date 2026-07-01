import path from 'node:path';

export type StoredSessionFile = {
  relativePath: string;
  body: Buffer;
};

export type SessionStorageDriver = {
  upload(path: string, body: Buffer): Promise<void>;
  download(path: string): Promise<Buffer | null>;
  list(prefix: string): Promise<string[]>;
  removePrefix(prefix: string): Promise<void>;
};

function safeRelativePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    throw new Error('invalid_session_file_path');
  }
  return normalized;
}

export class SupabaseSessionFileStore {
  private readonly driver: SessionStorageDriver;

  constructor(driver: SessionStorageDriver) {
    this.driver = driver;
  }

  prefixForCompany(companyId: string) {
    return `baileys/${companyId}/`;
  }

  bundlePathForCompany(companyId: string) {
    return `${this.prefixForCompany(companyId)}auth-bundle.json`;
  }

  async saveFile(companyId: string, relativePath: string, body: Buffer) {
    const key = `${this.prefixForCompany(companyId)}${safeRelativePath(relativePath)}`;
    await this.driver.upload(key, body);
  }

  async saveCompanyFiles(companyId: string, files: StoredSessionFile[]) {
    const bundle = files.map((file) => ({
      relativePath: safeRelativePath(file.relativePath),
      body: file.body.toString('base64'),
    }));
    await this.driver.upload(
      this.bundlePathForCompany(companyId),
      Buffer.from(JSON.stringify({ version: 1, files: bundle })),
    );
  }

  async loadCompanyFiles(companyId: string): Promise<StoredSessionFile[]> {
    const prefix = this.prefixForCompany(companyId);
    const bundleBody = await this.driver.download(this.bundlePathForCompany(companyId));
    if (bundleBody) {
      const parsed = JSON.parse(bundleBody.toString('utf8')) as {
        files?: Array<{ relativePath: string; body: string }>;
      };
      return (parsed.files ?? []).map((file) => ({
        relativePath: safeRelativePath(file.relativePath),
        body: Buffer.from(file.body, 'base64'),
      }));
    }
    const keys = await this.driver.list(prefix);
    const files = await Promise.all(keys.map(async (key) => {
      const body = await this.driver.download(key);
      if (!body) return null;
      return {
        relativePath: path.posix.relative(prefix, key),
        body,
      };
    }));
    return files.filter((file): file is StoredSessionFile => Boolean(file));
  }

  async clearCompany(companyId: string) {
    await this.driver.removePrefix(this.prefixForCompany(companyId));
  }
}
