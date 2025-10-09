import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface PDFToImageOptions {
  dpi?: number;
  format?: 'png' | 'jpg';
  quality?: number;
}

export interface ConversionResult {
  imagePath: string;
  mimeType: string;
  base64Data: string;
}

export interface MultiPageConversionResult {
  pages: ConversionResult[];
  totalPages: number;
}

/**
 * Convert PDF to image using ImageMagick/GraphicsMagick
 * Falls back to pdftoppm if ImageMagick is not available
 */
export class PDFConverter {
  private tempDir: string;

  constructor(tempDir?: string) {
    this.tempDir = tempDir || '/tmp/ocr-processing';
  }

  async initialize(): Promise<void> {
    // Ensure temp directory exists
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
      logger.info({ tempDir: this.tempDir }, 'PDF converter initialized');
    } catch (error) {
      logger.error({ error, tempDir: this.tempDir }, 'Failed to create temp directory');
      throw error;
    }
  }

  /**
   * Get the number of pages in a PDF
   */
  async getPageCount(pdfPath: string): Promise<number> {
    try {
      // Use pdfinfo to get page count
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}" | grep Pages`);
      const match = stdout.match(/Pages:\s+(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    } catch (error) {
      logger.warn({ error }, 'pdfinfo failed, trying ImageMagick identify');

      try {
        // Fallback to ImageMagick identify
        const { stdout } = await execAsync(`identify -format "%n\n" "${pdfPath}" | head -1`);
        const pageCount = parseInt(stdout.trim(), 10);
        if (!isNaN(pageCount)) {
          return pageCount;
        }
      } catch (fallbackError) {
        logger.warn({ error: fallbackError }, 'Failed to get page count, assuming 1 page');
      }
    }

    // Default to 1 page if all methods fail
    return 1;
  }

  /**
   * Convert all pages of a PDF to images in parallel
   */
  async convertAllPagesToImages(
    pdfPath: string,
    options?: PDFToImageOptions
  ): Promise<MultiPageConversionResult> {
    const pageCount = await this.getPageCount(pdfPath);
    logger.info({ pdfPath, pageCount }, 'Converting all PDF pages to images');

    // Convert all pages in parallel
    const conversionPromises = Array.from({ length: pageCount }, (_, i) =>
      this.convertPageToImage(pdfPath, i + 1, options)
    );

    const pages = await Promise.all(conversionPromises);

    logger.info({
      pdfPath,
      totalPages: pageCount,
      totalSizeKB: Math.round(pages.reduce((sum, p) => sum + p.base64Data.length, 0) / 1024)
    }, 'All PDF pages converted successfully');

    return {
      pages,
      totalPages: pageCount
    };
  }

  /**
   * Convert a specific page of a PDF to an image
   */
  async convertPageToImage(
    pdfPath: string,
    pageNumber: number,
    options?: PDFToImageOptions
  ): Promise<ConversionResult> {
    const dpi = options?.dpi || 300;
    const format = options?.format || 'png';
    const quality = options?.quality || 95;

    const outputPath = path.join(
      this.tempDir,
      `${path.basename(pdfPath, '.pdf')}-page${pageNumber}.${format}`
    );

    try {
      // Try ImageMagick first (convert command)
      await this.convertPageWithImageMagick(pdfPath, outputPath, pageNumber, dpi, quality);
    } catch (error) {
      logger.warn({ error, pageNumber }, 'ImageMagick conversion failed, trying pdftoppm');

      try {
        // Fallback to pdftoppm
        await this.convertPageWithPdftoppm(pdfPath, outputPath, pageNumber, dpi);
      } catch (fallbackError) {
        logger.error({ error: fallbackError, pageNumber }, 'All PDF conversion methods failed');
        throw new Error(`Failed to convert PDF page ${pageNumber} to image. Please ensure ImageMagick or poppler-utils is installed.`);
      }
    }

    // Read the image and convert to base64
    const imageBuffer = await fs.readFile(outputPath);
    const base64Data = imageBuffer.toString('base64');
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';

    logger.debug({
      pdfPath,
      pageNumber,
      outputPath,
      sizeKB: Math.round(imageBuffer.length / 1024)
    }, 'PDF page converted to image successfully');

    return {
      imagePath: outputPath,
      mimeType,
      base64Data
    };
  }

  /**
   * Convert PDF to image (first page only) - kept for backward compatibility
   */
  async convertToImage(
    pdfPath: string,
    options?: PDFToImageOptions
  ): Promise<ConversionResult> {
    return this.convertPageToImage(pdfPath, 1, options);
  }

  /**
   * Convert a specific page using ImageMagick (convert command)
   */
  private async convertPageWithImageMagick(
    pdfPath: string,
    outputPath: string,
    pageNumber: number,
    dpi: number,
    quality: number
  ): Promise<void> {
    // Convert specific page (0-indexed, so pageNumber - 1)
    const command = `convert -density ${dpi} -quality ${quality} "${pdfPath}[${pageNumber - 1}]" "${outputPath}"`;

    logger.debug({ command, pageNumber }, 'Running ImageMagick conversion');

    const { stdout, stderr } = await execAsync(command);

    if (stderr && !stderr.includes('Warning')) {
      logger.warn({ stderr, pageNumber }, 'ImageMagick conversion warnings');
    }
  }

  /**
   * Convert a specific page using pdftoppm (from poppler-utils)
   */
  private async convertPageWithPdftoppm(
    pdfPath: string,
    outputPath: string,
    pageNumber: number,
    dpi: number
  ): Promise<void> {
    const outputPrefix = path.join(
      this.tempDir,
      path.basename(pdfPath, '.pdf') + `-page${pageNumber}`
    );

    // pdftoppm creates files with -1.png suffix for single page
    const command = `pdftoppm -png -r ${dpi} -f ${pageNumber} -l ${pageNumber} "${pdfPath}" "${outputPrefix}"`;

    logger.debug({ command, pageNumber }, 'Running pdftoppm conversion');

    const { stdout, stderr } = await execAsync(command);

    if (stderr) {
      logger.warn({ stderr, pageNumber }, 'pdftoppm conversion warnings');
    }

    // Rename the output file (pdftoppm adds -1 suffix)
    const pdftoppmOutput = `${outputPrefix}-1.png`;
    await fs.rename(pdftoppmOutput, outputPath);
  }

  /**
   * Clean up temporary files
   */
  async cleanup(imagePath: string): Promise<void> {
    try {
      await fs.unlink(imagePath);
      logger.debug({ imagePath }, 'Cleaned up temporary image file');
    } catch (error) {
      logger.warn({ error, imagePath }, 'Failed to clean up temporary file');
    }
  }

  /**
   * Clean up all files in temp directory
   */
  async cleanupAll(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir);
      await Promise.all(
        files.map(file => fs.unlink(path.join(this.tempDir, file)))
      );
      logger.info({ tempDir: this.tempDir, count: files.length }, 'Cleaned up all temporary files');
    } catch (error) {
      logger.warn({ error, tempDir: this.tempDir }, 'Failed to clean up temp directory');
    }
  }
}

