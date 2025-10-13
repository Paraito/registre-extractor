import { logger } from '../utils/logger';

/**
 * Structured OCR Logger
 * Provides formatted, easy-to-read terminal output for OCR operations
 */

const SEPARATOR = '='.repeat(80);
const SUBSEPARATOR = '-'.repeat(80);

export class OCRLogger {
  private static messageCounter = 0;

  /**
   * Increment message counter
   */
  static incrementMessageCounter(): void {
    this.messageCounter++;
  }

  /**
   * Get current message counter
   */
  static getMessageCounter(): number {
    return this.messageCounter;
  }

  /**
   * Log OCR monitor start
   */
  static monitorStarted(enabledEnvironments: string[]): void {
    this.messageCounter++;
    console.log('\n' + SEPARATOR);
    console.log(`🚀 OCR Monitor Started - Message #${this.messageCounter}`);
    console.log(SEPARATOR);
    console.log('\n⚙️  Configuration');
    console.log(`   Enabled Environments: ${enabledEnvironments.join(', ') || 'none'}`);
    console.log(`   Poll Interval: 10s`);
    console.log('\n' + SEPARATOR + '\n');
  }

  /**
   * Log document processing start
   */
  static documentStart(docNumber: string, environment: string, docId: string): void {
    this.messageCounter++;
    console.log('\n' + SEPARATOR);
    console.log(`📄 OCR Processing Started - Message #${this.messageCounter}`);
    console.log(SEPARATOR);
    console.log('\n📋 Document Details');
    console.log(`   Document Number: ${docNumber}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Document ID: ${docId}`);
    console.log(`   Status: Downloading PDF...`);
    console.log('\n' + SEPARATOR + '\n');
  }

  /**
   * Log PDF conversion start
   */
  static pdfConversionStart(totalPages: number): void {
    console.log(SUBSEPARATOR);
    console.log('📸 PDF Conversion');
    console.log(SUBSEPARATOR);
    console.log(`   Total Pages: ${totalPages}`);
    console.log(`   Status: Converting to images...`);
    console.log(SUBSEPARATOR);
  }

  /**
   * Log PDF conversion complete
   */
  static pdfConverted(totalPages: number, fileSizeKB: number): void {
    console.log(`   ✓ Conversion complete → ${fileSizeKB} KB`);
    console.log(`   Status: Extracting text from ${totalPages} page(s)...`);
    console.log(SUBSEPARATOR + '\n');
  }

  /**
   * Log page extraction progress
   */
  static pageExtracted(pageNumber: number, totalPages: number, textLength: number): void {
    const progress = `[${pageNumber}/${totalPages}]`;
    console.log(`   ${progress} Page ${pageNumber} extracted → ${textLength.toLocaleString()} chars`);
  }

  /**
   * Log extraction complete
   */
  static extractionComplete(totalPages: number, totalChars: number): void {
    console.log('\n' + SUBSEPARATOR);
    console.log('📝 Text Extraction Complete');
    console.log(SUBSEPARATOR);
    console.log(`   Pages Processed: ${totalPages}`);
    console.log(`   Total Characters: ${totalChars.toLocaleString()}`);
    console.log(`   Status: Applying boost corrections...`);
    console.log(SUBSEPARATOR + '\n');
  }

  /**
   * Log boost complete
   */
  static boostComplete(boostedChars: number, duration: number): void {
    console.log(SUBSEPARATOR);
    console.log('✨ Boost Corrections Applied');
    console.log(SUBSEPARATOR);
    console.log(`   Output Characters: ${boostedChars.toLocaleString()}`);
    console.log(`   Processing Time: ${duration.toFixed(1)}s`);
    console.log(SUBSEPARATOR + '\n');
  }

  /**
   * Log document completion
   */
  static documentComplete(
    docNumber: string,
    environment: string,
    totalPages: number,
    fileContentChars: number,
    boostedChars: number,
    totalDuration: number
  ): void {
    this.messageCounter++;
    console.log('\n' + SEPARATOR);
    console.log(`✅ OCR Processing Complete - Message #${this.messageCounter}`);
    console.log(SEPARATOR);
    console.log('\n📊 Processing Summary');
    console.log(`   Document Number: ${docNumber}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Total Pages: ${totalPages}`);
    console.log(`   File Content: ${fileContentChars.toLocaleString()} chars`);
    console.log(`   Boosted Content: ${boostedChars.toLocaleString()} chars`);
    console.log(`   Total Duration: ${totalDuration.toFixed(1)}s`);
    console.log(`   Status: ✅ Saved to database`);
    console.log('\n' + SEPARATOR + '\n');
  }

  /**
   * Log document error
   */
  static documentError(
    docNumber: string,
    environment: string,
    error: string,
    docId?: string
  ): void {
    this.messageCounter++;
    console.log('\n' + SEPARATOR);
    console.log(`❌ OCR Processing Failed - Message #${this.messageCounter}`);
    console.log(SEPARATOR);
    console.log('\n📋 Document Details');
    console.log(`   Document Number: ${docNumber}`);
    console.log(`   Environment: ${environment}`);
    if (docId) {
      console.log(`   Document ID: ${docId}`);
    }
    console.log('\n⚠️  Error Details');
    console.log(`   Error: ${error}`);
    console.log(`   Status: ❌ Failed (will retry on next poll)`);
    console.log('\n' + SEPARATOR + '\n');
  }

  /**
   * Log warning
   */
  static warning(message: string, details?: Record<string, any>): void {
    console.log('\n' + SUBSEPARATOR);
    console.log(`⚠️  Warning: ${message}`);
    if (details) {
      console.log(SUBSEPARATOR);
      Object.entries(details).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
    console.log(SUBSEPARATOR + '\n');
  }

  /**
   * Log info message
   */
  static info(message: string, details?: Record<string, any>): void {
    console.log('\n' + SUBSEPARATOR);
    console.log(`ℹ️  ${message}`);
    if (details) {
      console.log(SUBSEPARATOR);
      Object.entries(details).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
    }
    console.log(SUBSEPARATOR + '\n');
  }

  /**
   * Log debug info (only if LOG_LEVEL=debug)
   */
  static debug(message: string, data?: Record<string, any>): void {
    logger.debug(data || {}, message);
  }
}

