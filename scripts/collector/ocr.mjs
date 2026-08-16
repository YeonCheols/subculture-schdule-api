import kor from '@tesseract.js-data/kor';
import { tmpdir } from 'node:os';
import tesseract from 'tesseract.js';
import { classify, extractBannerInfo } from './lib.mjs';

const { createWorker } = tesseract;
let workerPromise = null;
let recognitionQueue = Promise.resolve();

async function worker() {
  workerPromise ??= createWorker('kor', undefined, { langPath: kor.langPath, gzip: kor.gzip, cachePath: tmpdir(), errorHandler: () => {} });
  return workerPromise;
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: { accept: 'image/png,image/jpeg', 'user-agent': 'GameTimeCalendar/0.1 (+official schedule collector)' },
    signal: AbortSignal.timeout(Number(process.env.OCR_IMAGE_TIMEOUT_MS || 15_000)),
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!/^image\/(?:png|jpeg)/i.test(contentType)) throw new Error(`unsupported image content type: ${contentType || 'unknown'}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const maxBytes = Number(process.env.OCR_MAX_IMAGE_BYTES || 10 * 1024 * 1024);
  if (buffer.length < 128 || buffer.length > maxBytes) throw new Error(`invalid image size: ${buffer.length}`);
  return buffer;
}

async function recognize(url) {
  const task = recognitionQueue.then(async () => {
    const activeWorker = await worker();
    const result = await activeWorker.recognize(await downloadImage(url));
    return result.data.text.trim();
  });
  recognitionQueue = task.catch(() => {});
  return task;
}

export async function enrichBannerPagesWithOcr(source, pages) {
  if (source.bannerOcr?.enabled !== true || process.env.BANNER_OCR_ENABLED === 'false') return pages;
  const maxPosts = Number(process.env.OCR_MAX_POSTS_PER_SOURCE || source.bannerOcr.maxPosts || 3);
  const maxImages = Number(process.env.OCR_MAX_IMAGES_PER_POST || source.bannerOcr.maxImagesPerPost || 2);
  let processedPosts = 0;
  const enriched = [];

  for (const page of pages) {
    const existing = extractBannerInfo(page);
    const hasTargets = existing.some((banner) => banner.featuredCharacters.length || banner.featuredWeapons.length);
    if (classify(page.title) !== 'banner' || hasTargets || !page.imageUrls?.length || processedPosts >= maxPosts) {
      enriched.push(page);
      continue;
    }
    processedPosts += 1;
    const texts = [];
    for (const imageUrl of page.imageUrls.slice(0, maxImages)) {
      try {
        const text = await recognize(imageUrl);
        if (text) texts.push(text);
      } catch (error) {
        process.stderr.write(`Banner OCR skipped ${imageUrl}: ${error.message}\n`);
      }
    }
    enriched.push(texts.length ? { ...page, ocrText: texts.join('\n\n') } : page);
  }
  return enriched;
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const activeWorker = await workerPromise;
  await activeWorker.terminate();
  workerPromise = null;
  recognitionQueue = Promise.resolve();
}
