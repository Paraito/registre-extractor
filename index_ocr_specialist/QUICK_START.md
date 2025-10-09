# ⚡ Quick Start - OCR KING

## 🎯 One-Command Setup (from root directory)

```bash
# Install all dependencies
npm run install:all
```

## 🔑 Configure API Key

```bash
# 1. Get API key from https://aistudio.google.com/app/apikey
# 2. Create .env file in backend directory
cd backend
cp .env.example .env
# 3. Edit .env and add your key:
#    GEMINI_API_KEY=your_key_here
```

## 🚀 Run the Application

### Option 1: Two Terminals (Recommended)

**Terminal 1 - Backend:**
```bash
npm run dev:backend
```

**Terminal 2 - Frontend:**
```bash
npm run dev:frontend
```

### Option 2: From Subdirectories

**Backend:**
```bash
cd backend
npm start
```

**Frontend:**
```bash
cd frontend
npm run dev
```

## 🌐 Access the App

- Frontend: http://localhost:5173
- Backend: http://localhost:3001
- Health Check: http://localhost:3001/health

## 📝 Quick Test

1. Open http://localhost:5173
2. Drag & drop an image of a Quebec land registry document
3. Click "Extract Text"
4. Click "Boost Results" (optional)
5. Copy results with the copy button

## 🎛️ Recommended Settings

- **Model**: gemini-2.0-flash-exp (default)
- **Upscaling**: Enabled at 2x
- **Extract Temperature**: 0.1
- **Boost Temperature**: 0.2

## 📚 Documentation

- Full setup: [SETUP.md](SETUP.md)
- Complete docs: [README.md](README.md)

## 🆘 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Backend won't start | Check GEMINI_API_KEY in backend/.env |
| Frontend can't connect | Verify backend is running on port 3001 |
| Poor OCR results | Enable upscaling, try gemini-1.5-pro model |
| Port in use | Change PORT in backend/.env or frontend/vite.config.js |

## 🎉 That's It!

You're ready to extract text from Quebec land registry documents with AI-powered OCR!

