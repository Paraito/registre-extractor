/**
 * PDF to Images Conversion Module
 * 
 * Converts PDF pages to PNG images with optimized settings for OCR.
 */

import { pdfToPng } from 'pdf-to-png-converter';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { CONFIG } from '../../config/runtime.js';
import { Logger } from '../util/log.js';
import { FetchResult } from './fetch.js';

export interface PDFPage {
  pageNumber: number;
  content: Buffer;
  width: number;
  height: number;
}

export interface PDFConversionResult {
  pages: PDFPage[];
  totalPages: number;
  tempDir: string;
}

/**
 * Convert PDF buffer to PNG pages
 */
export async function pdfToImages(
  pdfBuffer: Buffer, 
  logger: Logger,
  tempDir?: string
): Promise<PDFConversionResult> {
  const workingDir = tempDir || `${CONFIG.tempDir}/pdf-${Date.now()}`;
  
  return await logger.time('pdf_to_images', 'Converting PDF to PNG pages', async () => {
    // Create temp directory
    if (!existsSync(workingDir)) {
      await mkdir(workingDir, { recursive: true });
    }
    
    // Write PDF to temp file
    const pdfPath = `${workingDir}/input.pdf`;
    await writeFile(pdfPath, pdfBuffer);
    
    await logger.info('pdf_to_images', `Saved PDF to ${pdfPath}`, {
      sizeBytes: pdfBuffer.length
    });
    
    // Convert to PNGs with optimized settings
    const pngResult = await pdfToPng(pdfPath, {
      outputFolder: workingDir,
      disableFontFace: true,  // Force system fonts for better rendering
      useSystemFonts: true,   // Use system fonts
      viewportScale: CONFIG.viewportScale, // High resolution for OCR
      // Don't specify pagesToProcess to get all pages
    });
    
    // Normalize result to array
    const pngPages = Array.isArray(pngResult) ? pngResult : [pngResult];
    
    await logger.success('pdf_to_images', `Converted ${pngPages.length} pages`, {
      totalPages: pngPages.length,
      viewportScale: CONFIG.viewportScale,
      tempDir: workingDir
    });
    
    // Log page details
    for (const page of pngPages) {
      await logger.info('pdf_to_images', `Page ${page.pageNumber}`, {
        dimensions: `${page.width}x${page.height}px`,
        sizeBytes: page.content.length,
        sizeKB: (page.content.length / 1024).toFixed(2)
      }, page.pageNumber);
    }
    
    return {
      pages: pngPages,
      totalPages: pngPages.length,
      tempDir: workingDir
    };
  });
}

/**
 * Save page images to artifacts directory
 */
export async function savePageImages(
  pages: PDFPage[],
  logger: Logger,
  runId: string,
  subdir: string = 'images'
): Promise<void> {
  return await logger.time('save_images', `Saving ${pages.length} page images`, async () => {
    const imagesDir = `${CONFIG.artifactsDir}/${runId}/${subdir}`;

    if (!existsSync(imagesDir)) {
      await mkdir(imagesDir, { recursive: true });
    }

    for (const page of pages) {
      const filename = `page_${page.pageNumber}.png`;
      const filepath = `${imagesDir}/${filename}`;

      await writeFile(filepath, page.content);

      await logger.info('save_images', `Saved page ${page.pageNumber}`, {
        filename,
        size: page.content.length,
        dimensions: `${page.width}x${page.height}`
      }, page.pageNumber);
    }

    await logger.success('save_images', `Saved ${pages.length} images`, {
      directory: imagesDir,
      totalSize: pages.reduce((sum, p) => sum + p.content.length, 0)
    });
  });
}


