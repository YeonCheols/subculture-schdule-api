import { Injectable, NotFoundException } from '@nestjs/common';
import { del, get, list, put } from '@vercel/blob';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

@Injectable()
export class StorageService {
  private readonly localDirectory = process.env.LOCAL_DATA_DIR ?? (process.env.VERCEL ? undefined : './data');

  async readJson<T>(pathname: string): Promise<T> {
    if (this.localDirectory) {
      try {
        return JSON.parse(await readFile(join(this.localDirectory, pathname), 'utf8')) as T;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException(`${pathname} has not been imported yet`);
        throw error;
      }
    }

    const result = await get(pathname, { access: 'private' });
    if (!result || result.statusCode === 304) throw new NotFoundException(`${pathname} has not been imported yet`);
    return JSON.parse(await new Response(result.stream).text()) as T;
  }

  async tryReadJson<T>(pathname: string): Promise<T | undefined> {
    try {
      return await this.readJson<T>(pathname);
    } catch (error) {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    }
  }

  async writeJson(pathname: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value, null, 2);
    if (this.localDirectory) {
      const filePath = join(this.localDirectory, pathname);
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, serialized, 'utf8');
      await rename(temporary, filePath);
      return;
    }
    await put(pathname, serialized, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
    });
  }

  async deleteFiles(pathnames: string[]): Promise<void> {
    if (!pathnames.length) return;
    if (this.localDirectory) {
      await Promise.all(pathnames.map((pathname) => rm(join(this.localDirectory!, pathname), { force: true })));
      return;
    }
    await del(pathnames);
  }

  async listFiles(prefix: string): Promise<Array<{ pathname: string; size: number; uploadedAt: string }>> {
    if (this.localDirectory) {
      const root = join(this.localDirectory, prefix);
      try {
        const relativePaths = await listLocalFiles(root);
        const files = await Promise.all(relativePaths.map(async (relativePath) => {
          const pathname = join(prefix, relativePath).replaceAll('\\', '/');
          const metadata = await stat(join(this.localDirectory!, pathname));
          return { pathname, size: metadata.size, uploadedAt: metadata.mtime.toISOString() };
        }));
        return files.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    }

    const files: Array<{ pathname: string; size: number; uploadedAt: string }> = [];
    let cursor: string | undefined;
    do {
      const result = await list({ prefix, cursor });
      files.push(...result.blobs.map((blob) => ({ pathname: blob.pathname, size: blob.size, uploadedAt: blob.uploadedAt.toISOString() })));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return files.sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  }
}

async function listLocalFiles(directory: string, relativeDirectory = ''): Promise<string[]> {
  const entries = await readdir(join(directory, relativeDirectory), { withFileTypes: true });
  const paths = await Promise.all(entries.map((entry) => {
    const relativePath = join(relativeDirectory, entry.name);
    return entry.isDirectory() ? listLocalFiles(directory, relativePath) : [relativePath];
  }));
  return paths.flat();
}
