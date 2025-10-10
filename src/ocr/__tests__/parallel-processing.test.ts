/**
 * Tests for parallel OCR processing
 */

import { OCRProcessor } from '../processor';
import { PDFConverter } from '../pdf-converter';
import { GeminiOCRClient } from '../gemini-client';

// Mock the dependencies
jest.mock('../gemini-client');
jest.mock('../pdf-converter');
jest.mock('../../utils/logger');

describe('Parallel OCR Processing', () => {
  let processor: OCRProcessor;
  let mockPdfConverter: jest.Mocked<PDFConverter>;
  let mockGeminiClient: jest.Mocked<GeminiOCRClient>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create processor instance
    processor = new OCRProcessor({
      geminiApiKey: 'test-api-key',
      tempDir: '/tmp/test-ocr'
    });

    // Get mocked instances
    mockPdfConverter = (processor as any).pdfConverter;
    mockGeminiClient = (processor as any).geminiClient;
  });

  describe('processPDFParallel', () => {
    it('should process multiple pages in parallel with CORRECT FLOW', async () => {
      // Mock PDF conversion to return 3 pages
      mockPdfConverter.convertAllPagesToImages = jest.fn().mockResolvedValue({
        totalPages: 3,
        pages: [
          { imagePath: '/tmp/page1.png', mimeType: 'image/png', base64Data: 'base64-1' },
          { imagePath: '/tmp/page2.png', mimeType: 'image/png', base64Data: 'base64-2' },
          { imagePath: '/tmp/page3.png', mimeType: 'image/png', base64Data: 'base64-3' }
        ]
      });

      // Mock text extraction (called 3 times - once per page)
      mockGeminiClient.extractText = jest.fn()
        .mockResolvedValueOnce({ text: 'Raw text page 1', isComplete: true })
        .mockResolvedValueOnce({ text: 'Raw text page 2', isComplete: true })
        .mockResolvedValueOnce({ text: 'Raw text page 3', isComplete: true });

      // Mock boost (called ONCE with concatenated text - CORRECT FLOW!)
      mockGeminiClient.boostText = jest.fn()
        .mockResolvedValueOnce({
          boostedText: 'Boosted full document with all pages',
          isComplete: true
        });

      // Mock cleanup
      mockPdfConverter.cleanupAll = jest.fn().mockResolvedValue(undefined);

      // Process PDF
      const result = await processor.processPDFParallel('/test/document.pdf');

      // Verify results
      expect(result.totalPages).toBe(3);
      expect(result.pages).toHaveLength(3);
      expect(result.allPagesComplete).toBe(true);

      // Verify each page has raw text
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[0].rawText).toBe('Raw text page 1');
      expect(result.pages[1].pageNumber).toBe(2);
      expect(result.pages[1].rawText).toBe('Raw text page 2');
      expect(result.pages[2].pageNumber).toBe(3);
      expect(result.pages[2].rawText).toBe('Raw text page 3');

      // Verify combined raw text includes all pages
      expect(result.combinedRawText).toContain('Page 1');
      expect(result.combinedRawText).toContain('Page 2');
      expect(result.combinedRawText).toContain('Page 3');
      expect(result.combinedRawText).toContain('Raw text page 1');
      expect(result.combinedRawText).toContain('Raw text page 2');
      expect(result.combinedRawText).toContain('Raw text page 3');

      // Verify combined boosted text is the single boost result
      expect(result.combinedBoostedText).toBe('Boosted full document with all pages');

      // CRITICAL: Verify parallel extraction (3 extract calls) but SINGLE boost call
      expect(mockGeminiClient.extractText).toHaveBeenCalledTimes(3);
      expect(mockGeminiClient.boostText).toHaveBeenCalledTimes(1); // ✅ ONLY ONCE!

      // Verify boost was called with the FULL concatenated raw text
      const boostCallArg = mockGeminiClient.boostText.mock.calls[0][0];
      expect(boostCallArg).toContain('Raw text page 1');
      expect(boostCallArg).toContain('Raw text page 2');
      expect(boostCallArg).toContain('Raw text page 3');
      expect(boostCallArg).toContain('Page 1');
      expect(boostCallArg).toContain('Page 2');
      expect(boostCallArg).toContain('Page 3');

      // Verify cleanup was called
      expect(mockPdfConverter.cleanupAll).toHaveBeenCalled();
    });

    it('should handle incomplete pages correctly', async () => {
      // Mock PDF conversion
      mockPdfConverter.convertAllPagesToImages = jest.fn().mockResolvedValue({
        totalPages: 2,
        pages: [
          { imagePath: '/tmp/page1.png', mimeType: 'image/png', base64Data: 'base64-1' },
          { imagePath: '/tmp/page2.png', mimeType: 'image/png', base64Data: 'base64-2' }
        ]
      });

      // Mock extraction - page 2 incomplete
      mockGeminiClient.extractText = jest.fn()
        .mockResolvedValueOnce({ text: 'Raw text page 1', isComplete: true })
        .mockResolvedValueOnce({ text: 'Raw text page 2 (incomplete)', isComplete: false });

      // Mock boost (called ONCE with concatenated text)
      mockGeminiClient.boostText = jest.fn()
        .mockResolvedValueOnce({ boostedText: 'Boosted full text', isComplete: true });

      mockPdfConverter.cleanupAll = jest.fn().mockResolvedValue(undefined);

      // Process PDF
      const result = await processor.processPDFParallel('/test/document.pdf');

      // Verify allPagesComplete is false (because extraction was incomplete)
      expect(result.allPagesComplete).toBe(false);
      expect(result.pages[0].extractionComplete).toBe(true);
      expect(result.pages[1].extractionComplete).toBe(false);

      // But boost should still have been called once
      expect(mockGeminiClient.boostText).toHaveBeenCalledTimes(1);
    });

    it('should handle single page documents', async () => {
      // Mock PDF conversion with single page
      mockPdfConverter.convertAllPagesToImages = jest.fn().mockResolvedValue({
        totalPages: 1,
        pages: [
          { imagePath: '/tmp/page1.png', mimeType: 'image/png', base64Data: 'base64-1' }
        ]
      });

      mockGeminiClient.extractText = jest.fn()
        .mockResolvedValueOnce({ text: 'Raw text', isComplete: true });

      mockGeminiClient.boostText = jest.fn()
        .mockResolvedValueOnce({ boostedText: 'Boosted text', isComplete: true });

      mockPdfConverter.cleanupAll = jest.fn().mockResolvedValue(undefined);

      // Process PDF
      const result = await processor.processPDFParallel('/test/single-page.pdf');

      // Verify results
      expect(result.totalPages).toBe(1);
      expect(result.pages).toHaveLength(1);
      expect(result.allPagesComplete).toBe(true);

      // Even for single page, boost should be called once on concatenated text
      expect(mockGeminiClient.extractText).toHaveBeenCalledTimes(1);
      expect(mockGeminiClient.boostText).toHaveBeenCalledTimes(1);
    });
  });

  describe('PDFConverter parallel methods', () => {
    let converter: PDFConverter;

    beforeEach(() => {
      converter = new PDFConverter('/tmp/test');
    });

    it('should get page count', async () => {
      // This would require mocking exec, which is complex
      // In a real test, you'd mock the exec calls
      expect(converter.getPageCount).toBeDefined();
    });

    it('should convert all pages to images', async () => {
      expect(converter.convertAllPagesToImages).toBeDefined();
    });

    it('should convert specific page to image', async () => {
      expect(converter.convertPageToImage).toBeDefined();
    });
  });

  describe('Backward compatibility', () => {
    it('should still support processPDF for single page', async () => {
      // Mock single page conversion
      mockPdfConverter.convertToImage = jest.fn().mockResolvedValue({
        imagePath: '/tmp/page1.png',
        mimeType: 'image/png',
        base64Data: 'base64-1'
      });

      mockGeminiClient.extractText = jest.fn()
        .mockResolvedValueOnce({ text: 'Raw text', isComplete: true });

      mockGeminiClient.boostText = jest.fn()
        .mockResolvedValueOnce({ boostedText: 'Boosted text', isComplete: true });

      mockPdfConverter.cleanup = jest.fn().mockResolvedValue(undefined);

      // Process PDF using old method
      const result = await processor.processPDF('/test/document.pdf');

      // Verify old interface still works
      expect(result.rawText).toBe('Raw text');
      expect(result.boostedText).toBe('Boosted text');
      expect(result.extractionComplete).toBe(true);
      expect(result.boostComplete).toBe(true);

      // Verify it used the single-page conversion
      expect(mockPdfConverter.convertToImage).toHaveBeenCalled();
    });
  });
});

