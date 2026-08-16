import { Injectable, NotFoundException } from '@nestjs/common';
import { get, put } from '@vercel/blob';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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
}
