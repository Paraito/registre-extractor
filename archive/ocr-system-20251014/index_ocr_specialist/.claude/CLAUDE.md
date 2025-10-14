# Claude Code Project Guidelines - OCR King Backend

## 🎯 Project Overview

**OCR King** is a backend API for extracting text from Quebec land registry documents using Google's Gemini AI. The system uses advanced prompts with confidence scoring and 60+ correction rules for high-accuracy OCR.

**Status**: Backend-only (frontend removed)
**Purpose**: Standalone API or integration module for other apps

---

## 📁 Project Structure

```
workspace/
├── backend/              # Main backend (all code lives here)
│   ├── server.js        # Express API server (3 endpoints)
│   ├── prompts.js       # OCR extraction & boost prompts
│   ├── test-backend.js  # API endpoint tests (11 tests)
│   ├── test-url.js      # Full PDF URL test
│   ├── test-url-pages.js  # Page-by-page URL test ⭐
│   ├── package.json     # Dependencies & scripts
│   └── .env             # API key (never commit)
├── README_BACKEND.md    # Main backend documentation ⭐
├── README_URL_TESTING.md  # URL testing guide
├── COMPLETION_DETECTION.md  # Token limit handling
└── .claude/             # This directory
    └── CLAUDE.md        # This file
```

---

## 🔑 Key Commands

### Development
```bash
npm start              # Start backend server (port 3001)
npm run dev            # Start with auto-reload (Node 18+)
```

### Testing
```bash
npm test               # Run API endpoint tests (11 tests)
npm run test:url <url>  # Test full PDF URL
npm run test:url:pages <url>  # Test PDF page-by-page ⭐
```

### URL Testing Options
```bash
# Test specific pages
npm run test:url:pages <url> --pages=1,2,3

# Adjust upscaling
npm run test:url:pages <url> --upscale=3

# Set rate limiting
npm run test:url:pages <url> --delay=3000

# Limit pages
npm run test:url:pages <url> --max-pages=5
```

---

## 🧪 Testing Guidelines

### Before Committing
**ALWAYS** run:
```bash
npm test
```
All **11 tests must pass** before committing.

### Testing URL-based OCR

**Use `test-url-pages.js` for:**
- Production testing
- Large PDFs (5+ pages)
- Rate limit compliance
- Per-page results

**Process:**
1. Download PDF
2. Split into pages
3. Upscale each page (2x)
4. Extract raw text (per page)
5. Apply boost corrections (per page)
6. Display results in terminal

### Rate Limiting

**Critical**: Gemini API has RPM limits
- Free tier: 15 RPM
- Each page = 2 API calls (extract + boost)
- Default delay: 2000ms between calls
- Adjust with `--delay=<ms>`

---

## 📝 Code Style & Patterns

### Server Code (server.js)
- ES modules (`import`/`export`)
- Express middleware: CORS, JSON body parser
- Error handling with try/catch
- Response format: `{ text }` or `{ boostedText }`

### Test Scripts
- Colored terminal output (ANSI codes)
- Progress indicators
- Statistics tracking
- Cleanup temp files

### Prompts (prompts.js)
- Long, detailed prompts (10K+ characters)
- French language for Quebec documents
- Require completion markers
- Export as constants

---

## 🔧 API Endpoints

### `GET /health`
Health check

### `POST /api/extract-text`
**Input:**
```json
{
  "imageData": "base64_string",
  "mimeType": "image/png",
  "model": "gemini-2.0-flash-exp",
  "temperature": 0.1
}
```

**Output:**
```json
{
  "text": "Raw extraction with confidence scores..."
}
```

### `POST /api/boost`
**Input:**
```json
{
  "rawText": "Raw OCR text",
  "model": "gemini-2.5-pro",
  "temperature": 0.4
}
```

**Output:**
```json
{
  "boostedText": "[{...}, {...}]"
}
```

---

## 🎯 Gemini Models

### For Extraction
- **gemini-2.0-flash-exp** (default, fastest)
- gemini-1.5-pro (better accuracy, slower)
- gemini-2.5-pro (latest, most accurate)

### For Boost
- **gemini-2.5-pro** (default, best corrections)
- gemini-2.0-flash-exp (faster, less accurate)

### Temperature
- **Extraction**: 0.1 (more precise)
- **Boost**: 0.4 (balanced correction)

---

## 🚨 Critical Rules

### Security
1. **NEVER** commit `.env` files
2. **NEVER** log API keys
3. **ALWAYS** use environment variables for secrets
4. **ALWAYS** enable CORS for local dev only

### API Usage
1. **RESPECT** rate limits (15-60 RPM)
2. **USE** delays between sequential calls
3. **CHECK** for completion markers
4. **HANDLE** truncated responses (see COMPLETION_DETECTION.md)

### Testing
1. **RUN** `npm test` before every commit
2. **VERIFY** all 11 tests pass
3. **TEST** URL scripts with real PDFs
4. **CHECK** rate limiting doesn't fail

### Code Quality
1. **USE** try/catch for async operations
2. **PROVIDE** detailed error messages
3. **LOG** progress for long operations
4. **CLEAN UP** temp files after processing

---

## 📊 Monitoring & Logging

### Server Logs
Server startup shows:
```
🚀 Server running on http://localhost:3001
📝 API endpoints: ...
✅ GEMINI_API_KEY configured
```

### Test Output
Tests show colored output:
- ✓ Green: Success
- ✗ Red: Failure
- ℹ Blue: Info
- ⚠ Yellow: Warning

### Statistics
URL tests show:
- Total pages processed
- Time per page
- Success/failure rate
- Total API time

---

## 🐛 Common Issues

### 1. API Key Not Found
**Error**: `GEMINI_API_KEY not configured`
**Fix**: Create `backend/.env` with `GEMINI_API_KEY=your_key`

### 2. Rate Limit Errors
**Error**: `429 Too Many Requests`
**Fix**: Increase delay: `--delay=5000`

### 3. Incomplete Extractions
**Warning**: `Extraction may be incomplete`
**Fix**: Use Pro model or check COMPLETION_DETECTION.md

### 4. JSON Parse Errors
**Error**: `Could not parse as JSON`
**Fix**: Check BOOST_PROMPT requires JSON output

---

## 📚 Documentation Map

| File | Purpose |
|------|---------|
| [README_BACKEND.md](../README_BACKEND.md) | Main backend docs - **START HERE** |
| [README_URL_TESTING.md](../backend/README_URL_TESTING.md) | Complete URL testing guide |
| [COMPLETION_DETECTION.md](../COMPLETION_DETECTION.md) | Token limit handling |
| [QUICK_START.md](../QUICK_START.md) | Quick reference |
| [backend/test-backend.js](../backend/test-backend.js) | Test suite examples |
| [backend/prompts.js](../backend/prompts.js) | OCR prompts |

---

## 🔄 Workflow Examples

### Adding a New Feature
1. Read relevant documentation
2. Update code (server.js or prompts.js)
3. Update tests if needed
4. Run `npm test` - ensure all pass
5. Test manually with `npm run test:url:pages`
6. Update documentation
7. Commit

### Debugging OCR Issues
1. Run `npm run test:url:pages <url> --max-pages=1`
2. Check raw extraction output
3. Check for completion markers
4. If incomplete, try Pro model
5. Check boosted JSON output
6. Verify correction rules applied

### Testing Rate Limits
1. Start with `--delay=2000` (default)
2. Monitor for 429 errors
3. Increase delay if needed
4. Calculate RPM: `60000 / (delay * 2)`
5. Keep under API limit

---

## 🎓 Learning Resources

### Understanding the System
1. Read [README_BACKEND.md](../README_BACKEND.md) first
2. Run `npm test` to see all endpoints
3. Examine [prompts.js](../backend/prompts.js) for OCR logic
4. Read [COMPLETION_DETECTION.md](../COMPLETION_DETECTION.md) for edge cases

### Testing Strategy
1. Start with `npm test` (API tests)
2. Test single page: `--max-pages=1`
3. Test specific pages: `--pages=1,2,3`
4. Test full document: no limits

---

## 💡 Pro Tips

1. **Development**: Use `npm run dev` for auto-reload
2. **Testing**: Start with 1 page, then scale up
3. **Rate Limits**: 2s delay is safe, 3s is very safe
4. **Upscaling**: 2x is optimal (quality vs speed)
5. **Models**: Flash for speed, Pro for accuracy
6. **Logging**: Redirect to file: `npm test > test-results.txt`
7. **Debugging**: Check completion markers first
8. **Large PDFs**: Use `--max-pages` for initial tests

---

## 🚀 Future Enhancements

Potential improvements (not yet implemented):
- [ ] Parallel page processing (with smart rate limiting)
- [ ] Resume from last page (if interrupted)
- [ ] Export results to JSON file
- [ ] Compare multiple models side-by-side
- [ ] Batch processing multiple PDFs
- [ ] Web UI for test scripts
- [ ] Docker containerization
- [ ] CI/CD integration

---

## 📞 Getting Help

1. Check relevant documentation above
2. Run tests to verify setup: `npm test`
3. Check error messages (usually self-explanatory)
4. Review [COMPLETION_DETECTION.md](../COMPLETION_DETECTION.md) for truncation issues
5. Check Gemini API console for quota/limits

---

**Last Updated**: 2025-10-11
**Version**: 1.0.0
**Status**: ✅ Production Ready (Backend-only)
