/**
 * PDF Fetch Module
 * 
 * Downloads PDF files from URLs with proper error handling and validation.
 */

import { Logger } from '../util/log.js';

export interface FetchResult {
  buffer: Buffer;
  contentType: string;
  contentLength: number;
  url: string;
}

/**
 * Download PDF from URL
 */
export async function fetchPDF(url: string, logger: Logger): Promise<FetchResult> {
  return await logger.time('fetch', 'Downloading PDF', async () => {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    
    // Validate content type
    if (!contentType.includes('pdf') && !contentType.includes('application/octet-stream')) {
      await logger.warn('fetch', `Unexpected content type: ${contentType}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Validate PDF magic bytes
    if (!buffer.subarray(0, 4).equals(Buffer.from('%PDF'))) {
      throw new Error('Downloaded file is not a valid PDF (missing PDF header)');
    }
    
    await logger.success('fetch', 'PDF downloaded successfully', {
      contentType,
      sizeBytes: buffer.length,
      sizeMB: (buffer.length / 1024 / 1024).toFixed(2)
    });
    
    return {
      buffer,
      contentType,
      contentLength: buffer.length,
      url
    };
  });
}
