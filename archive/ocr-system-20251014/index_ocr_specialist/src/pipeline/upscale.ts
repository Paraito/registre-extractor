/**
 * Image Upscaling Module
 * 
 * Upscales images using Sharp with deterministic, high-quality algorithms.
 */

import sharp from 'sharp';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { CONFIG } from '../../config/runtime.js';
import { Logger } from '../util/log.js';
import { PDFPage } from './pdf_to_images.js';

export interface UpscaledPage {
  pageNumber: number;
  content: Buffer;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  upscaledWidth: number;
  upscaledHeight: number;
  upscaleFactor: number;
}

/**
 * Upscale a single image buffer
 */
export async function upscaleImage(
  imageBuffer: Buffer, 
  factor: number = CONFIG.upscaleFactor
): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata();
  const newWidth = Math.floor((metadata.width || 0) * factor);
  const newHeight = Math.floor((metadata.height || 0) * factor);

  return await sharp(imageBuffer)
    .resize(newWidth, newHeight, {
      kernel: sharp.kernel.lanczos3, // High-quality deterministic upscaling
      fit: 'fill',                   // Maintain aspect ratio
    })
    .png()                          // Ensure PNG output
    .toBuffer();
}

/**
 * Upscale multiple PDF pages
 */
export async function upscalePages(
  pages: PDFPage[],
  logger: Logger,
  factor: number = CONFIG.upscaleFactor,
  maxConcurrency: number = 4
): Promise<UpscaledPage[]> {
  return await logger.time('upscale', `Upscaling ${pages.length} pages by ${factor}x`, async () => {
    // Cap upscale factor for resilience (max 3x to prevent memory issues)
    const safeFactor = Math.min(factor, 3.0);
    if (safeFactor !== factor) {
      await logger.warn('upscale', `Upscale factor capped at ${safeFactor}x for resilience`, {
        requestedFactor: factor,
        cappedFactor: safeFactor
      });
    }

    // Process pages in parallel with concurrency limit
    const upscaledPages: UpscaledPage[] = new Array(pages.length);

    const processPage = async (page: PDFPage, index: number): Promise<void> => {
      const startTime = Date.now();

      await logger.info('upscale', `Upscaling page ${page.pageNumber}`, {
        originalSize: `${page.width}x${page.height}px`,
        factor: safeFactor
      }, page.pageNumber);

      const upscaledBuffer = await upscaleImage(page.content, safeFactor);
      const upscaledMetadata = await sharp(upscaledBuffer).metadata();

      const upscaledPage: UpscaledPage = {
        pageNumber: page.pageNumber,
        content: upscaledBuffer,
        width: upscaledMetadata.width || 0,
        height: upscaledMetadata.height || 0,
        originalWidth: page.width,
        originalHeight: page.height,
        upscaledWidth: upscaledMetadata.width || 0,
        upscaledHeight: upscaledMetadata.height || 0,
        upscaleFactor: safeFactor
      };

      upscaledPages[index] = upscaledPage;

      const duration = Date.now() - startTime;
      await logger.success('upscale', `Page ${page.pageNumber} upscaled`, {
        newSize: `${upscaledPage.upscaledWidth}x${upscaledPage.upscaledHeight}px`,
        sizeIncrease: `${((upscaledBuffer.length / page.content.length) * 100).toFixed(1)}%`,
        sizeKB: (upscaledBuffer.length / 1024).toFixed(2)
      }, page.pageNumber, duration);
    };

    // Process in batches to control memory usage
    for (let i = 0; i < pages.length; i += maxConcurrency) {
      const batch = pages.slice(i, i + maxConcurrency);
      const batchPromises = batch.map((page, batchIndex) =>
        processPage(page, i + batchIndex)
      );

      await Promise.all(batchPromises);

      await logger.info('upscale', `Batch ${Math.floor(i / maxConcurrency) + 1} completed`, {
        pagesProcessed: Math.min(i + maxConcurrency, pages.length),
        totalPages: pages.length
      });
    }

    await logger.success('upscale', `All pages upscaled successfully`, {
      totalPages: upscaledPages.length,
      factor: safeFactor,
      avgSizeKB: (upscaledPages.reduce((sum, p) => sum + p.content.length, 0) / upscaledPages.length / 1024).toFixed(2)
    });

    return upscaledPages;
  });
}

/**
 * Save upscaled images to artifacts directory
 */
export async function saveUpscaledImages(
  pages: UpscaledPage[],
  logger: Logger,
  runId: string
): Promise<void> {
  return await logger.time('save_upscaled', `Saving ${pages.length} upscaled images`, async () => {
    const upscaledDir = `${CONFIG.artifactsDir}/${runId}/upscaled`;

    if (!existsSync(upscaledDir)) {
      await mkdir(upscaledDir, { recursive: true });
    }

    for (const page of pages) {
      const filename = `page_${page.pageNumber}_upscaled.png`;
      const filepath = `${upscaledDir}/${filename}`;

      await writeFile(filepath, page.content);

      await logger.info('save_upscaled', `Saved upscaled page ${page.pageNumber}`, {
        filename,
        originalSize: `${page.originalWidth}x${page.originalHeight}`,
        upscaledSize: `${page.width}x${page.height}`,
        sizeBytes: page.content.length
      }, page.pageNumber);
    }

    await logger.success('save_upscaled', `Saved ${pages.length} upscaled images`, {
      directory: upscaledDir,
      totalSize: pages.reduce((sum, p) => sum + p.content.length, 0)
    });
  });
}


