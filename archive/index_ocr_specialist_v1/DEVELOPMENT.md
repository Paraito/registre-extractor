# 🛠️ Development Guide

## 🏗️ Development Workflow

### Initial Setup

```bash
# Clone/navigate to project
cd ocr-king

# Install all dependencies
npm run install:all

# Configure backend
cd backend
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

### Daily Development

**Terminal 1 - Backend (with auto-reload):**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend (with hot reload):**
```bash
cd frontend
npm run dev
```

## 🔧 Making Changes

### Frontend Changes

The frontend uses Vite with hot module replacement (HMR). Changes to React components will update instantly in the browser.

**Key files:**
- `frontend/src/App.jsx` - Main component
- `frontend/src/index.css` - Global styles
- `frontend/tailwind.config.js` - Tailwind customization

**Common tasks:**

1. **Add a new UI component:**
   - Create component in `frontend/src/components/`
   - Import in `App.jsx`
   - Tailwind classes will work automatically

2. **Modify prompts:**
   - Edit `EXTRACT_PROMPT` or `BOOST_PROMPT` in `App.jsx`
   - Changes take effect immediately

3. **Add new model:**
   - Add option to model select in `App.jsx`
   - No backend changes needed

### Backend Changes

The backend uses Node.js with `--watch` flag for auto-reload (Node 18+).

**Key files:**
- `backend/server.js` - All API endpoints
- `backend/.env` - Configuration

**Common tasks:**

1. **Add new endpoint:**
```javascript
app.post('/api/new-endpoint', async (req, res) => {
  try {
    // Your logic here
    res.json({ result: 'success' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

2. **Modify Gemini parameters:**
```javascript
const generativeModel = genAI.getGenerativeModel({ 
  model: model,
  generationConfig: {
    temperature: temperature,
    topK: 40,        // Modify these
    topP: 0.95,      // as needed
    maxOutputTokens: 8192,
  }
});
```

3. **Add middleware:**
```javascript
app.use(yourMiddleware());
```

## 🧪 Testing

### Manual Testing

1. **Test image upload:**
   - Drag & drop various image formats
   - Click to upload
   - Test with large images

2. **Test extraction:**
   - Try different models
   - Adjust temperature
   - Enable/disable upscaling
   - Test with various image qualities

3. **Test boost:**
   - Extract text first
   - Apply boost
   - Compare results

### API Testing with curl

**Health check:**
```bash
curl http://localhost:3001/health
```

**Extract text:**
```bash
curl -X POST http://localhost:3001/api/extract-text \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "base64_encoded_image_data",
    "mimeType": "image/png",
    "model": "gemini-2.0-flash-exp",
    "temperature": 0.1,
    "prompt": "Extract text from this image"
  }'
```

**Boost text:**
```bash
curl -X POST http://localhost:3001/api/boost \
  -H "Content-Type: application/json" \
  -d '{
    "rawText": "Some raw OCR text",
    "model": "gemini-2.0-flash-exp",
    "temperature": 0.2,
    "prompt": "Improve this text"
  }'
```

## 📦 Building for Production

### Frontend

```bash
cd frontend
npm run build
```

This creates an optimized build in `frontend/dist/`.

**Preview production build:**
```bash
npm run preview
```

### Backend

The backend doesn't need building - it runs directly with Node.js.

**For production deployment:**
1. Set `NODE_ENV=production`
2. Use a process manager like PM2
3. Configure proper CORS origins
4. Use environment variables for all config

## 🐛 Debugging

### Frontend Debugging

**Browser DevTools:**
- Open Chrome DevTools (F12)
- Check Console for errors
- Network tab for API calls
- React DevTools extension recommended

**Common issues:**
- CORS errors → Check backend is running
- Image not uploading → Check file size/type
- API errors → Check Network tab for response

### Backend Debugging

**Console logging:**
```javascript
console.log('Debug info:', variable);
```

**Check server logs:**
- All requests are logged
- Errors show stack traces
- API key validation on startup

**Common issues:**
- Port in use → Change PORT in .env
- API key invalid → Check .env file
- CORS errors → Verify CORS middleware

## 🔄 Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes
# ...

# Commit
git add .
git commit -m "Add: your feature description"

# Push
git push origin feature/your-feature

# Create pull request
```

**Commit message conventions:**
- `Add:` New feature
- `Fix:` Bug fix
- `Update:` Modify existing feature
- `Docs:` Documentation only
- `Style:` Formatting, no code change
- `Refactor:` Code restructuring

## 📝 Code Style

### JavaScript/React

- Use functional components
- Use hooks (useState, useEffect, etc.)
- Prefer const over let
- Use async/await over promises
- Add comments for complex logic

### CSS/Tailwind

- Use Tailwind utility classes
- Keep custom CSS minimal
- Use semantic class names
- Responsive design: mobile-first

## 🚀 Performance Tips

### Frontend

1. **Image optimization:**
   - Compress images before upload
   - Use appropriate upscale factor
   - Consider lazy loading for results

2. **State management:**
   - Minimize re-renders
   - Use useCallback/useMemo if needed
   - Keep state close to where it's used

### Backend

1. **API optimization:**
   - Set appropriate timeouts
   - Handle large payloads efficiently
   - Consider rate limiting for production

2. **Gemini API:**
   - Use appropriate model for task
   - Adjust temperature for accuracy vs creativity
   - Monitor token usage

## 📚 Resources

### Documentation
- [React Docs](https://react.dev)
- [Vite Docs](https://vitejs.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [Express.js](https://expressjs.com)
- [Gemini API](https://ai.google.dev/docs)

### Tools
- [React DevTools](https://react.dev/learn/react-developer-tools)
- [Postman](https://www.postman.com) - API testing
- [VS Code](https://code.visualstudio.com) - Recommended editor

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

**Before submitting:**
- [ ] Code follows style guide
- [ ] No console.log in production code
- [ ] Tested manually
- [ ] Updated documentation if needed
- [ ] No sensitive data committed

## 📧 Getting Help

- Check existing documentation
- Review error messages carefully
- Search for similar issues
- Ask in discussions/issues

---

Happy coding! 🎉

