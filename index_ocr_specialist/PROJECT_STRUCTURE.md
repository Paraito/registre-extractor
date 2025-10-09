# 📁 Project Structure

```
ocr-king/
│
├── 📄 README.md                    # Main documentation
├── 📄 SETUP.md                     # Detailed setup guide
├── 📄 QUICK_START.md               # Quick reference
├── 📄 PROJECT_STRUCTURE.md         # This file
├── 📄 package.json                 # Root package.json with helper scripts
├── 📄 .gitignore                   # Git ignore rules
│
├── 📁 backend/                     # Express.js backend server
│   ├── 📄 server.js               # Main server file with API endpoints
│   ├── 📄 package.json            # Backend dependencies
│   ├── 📄 .env.example            # Environment variables template
│   ├── 📄 .env                    # Your API key (create this, not in git)
│   └── 📄 .gitignore              # Backend-specific ignores
│
└── 📁 frontend/                    # React + Vite frontend
    ├── 📄 index.html              # HTML entry point
    ├── 📄 package.json            # Frontend dependencies
    ├── 📄 vite.config.js          # Vite configuration
    ├── 📄 tailwind.config.js      # Tailwind CSS configuration
    ├── 📄 postcss.config.js       # PostCSS configuration
    ├── 📄 .gitignore              # Frontend-specific ignores
    │
    └── 📁 src/                     # Source code
        ├── 📄 main.jsx            # React entry point
        ├── 📄 App.jsx             # Main OCR component (771 lines)
        └── 📄 index.css           # Global styles with Tailwind
```

## 📊 File Breakdown

### Root Level (6 files)
- **README.md**: Complete documentation with features, setup, API reference
- **SETUP.md**: Step-by-step setup instructions
- **QUICK_START.md**: Quick reference for common tasks
- **PROJECT_STRUCTURE.md**: This file - project organization
- **package.json**: Helper scripts to run both frontend and backend
- **.gitignore**: Prevents committing node_modules, .env, etc.

### Backend (4 files + .env)
- **server.js** (125 lines): Express server with 3 endpoints
  - `POST /api/extract-text`: OCR extraction with Gemini Vision
  - `POST /api/boost`: Apply 60+ correction rules
  - `GET /health`: Health check
- **package.json**: Dependencies (express, @google/generative-ai, cors, dotenv)
- **.env.example**: Template for environment variables
- **.env**: Your actual API key (you create this)
- **.gitignore**: Ignores node_modules, .env, logs

### Frontend (9 files)
- **index.html**: HTML shell for React app
- **package.json**: Dependencies (react, vite, tailwindcss, lucide-react)
- **vite.config.js**: Vite dev server configuration
- **tailwind.config.js**: Tailwind CSS setup
- **postcss.config.js**: PostCSS for Tailwind
- **.gitignore**: Ignores node_modules, dist, .env
- **src/main.jsx**: React app initialization
- **src/App.jsx** (771 lines): Main OCR component with:
  - Image upload (drag & drop)
  - Image upscaling (canvas-based)
  - Model selection
  - Temperature controls
  - Extract & Boost functionality
  - Results display with tabs
  - Copy to clipboard
- **src/index.css**: Tailwind directives + global styles

## 🔄 Data Flow

```
User uploads image
    ↓
Frontend (App.jsx)
    ↓
[Optional] Upscale image in browser (canvas)
    ↓
Send to Backend (/api/extract-text)
    ↓
Backend (server.js)
    ↓
Gemini Vision API (with EXTRACT_PROMPT)
    ↓
Raw OCR result
    ↓
Display in Frontend (Raw tab)
    ↓
[Optional] User clicks "Boost"
    ↓
Send to Backend (/api/boost)
    ↓
Gemini API (with BOOST_PROMPT + raw text)
    ↓
Boosted result with corrections
    ↓
Display in Frontend (Boosted tab)
```

## 📦 Dependencies Summary

### Backend Dependencies
```json
{
  "@google/generative-ai": "^0.21.0",  // Gemini API client
  "cors": "^2.8.5",                     // CORS middleware
  "dotenv": "^16.4.5",                  // Environment variables
  "express": "^4.21.2"                  // Web server
}
```

### Frontend Dependencies
```json
{
  "lucide-react": "^0.468.0",           // Icons
  "react": "^18.3.1",                   // UI library
  "react-dom": "^18.3.1"                // React DOM
}
```

### Frontend Dev Dependencies
```json
{
  "@vitejs/plugin-react": "^4.3.4",    // Vite React plugin
  "autoprefixer": "^10.4.20",          // PostCSS plugin
  "postcss": "^8.4.49",                // CSS processor
  "tailwindcss": "^3.4.17",            // Utility CSS
  "vite": "^6.0.5"                     // Build tool
}
```

## 🎯 Key Features by File

### App.jsx (Frontend)
- ✅ Drag & drop image upload
- ✅ Image upscaling (1.5x - 4x)
- ✅ Model selection (6 Gemini models)
- ✅ Temperature controls (extraction & boost)
- ✅ Dual-tab results view
- ✅ Copy to clipboard
- ✅ Error handling
- ✅ Loading states
- ✅ Responsive design

### server.js (Backend)
- ✅ CORS enabled
- ✅ JSON body parsing (50MB limit for images)
- ✅ Environment variable validation
- ✅ Error handling with details
- ✅ Health check endpoint
- ✅ Configurable model & temperature
- ✅ Startup diagnostics

## 🔐 Security

- ✅ API key stored in backend .env (never exposed to browser)
- ✅ .env files in .gitignore
- ✅ CORS configured for local development
- ✅ Image processing happens client-side (reduces server load)
- ✅ No sensitive data logged

## 📈 Lines of Code

| File | Lines | Purpose |
|------|-------|---------|
| App.jsx | 771 | Main UI component |
| server.js | 125 | Backend API |
| **Total** | **~900** | Core application |

Plus configuration files, documentation, and dependencies.

## 🚀 Next Steps

1. Follow [SETUP.md](SETUP.md) to get started
2. Read [README.md](README.md) for full documentation
3. Use [QUICK_START.md](QUICK_START.md) as a reference

---

**Note**: This structure is designed for clarity and ease of development. The frontend and backend are separate for better organization and potential future deployment flexibility.

