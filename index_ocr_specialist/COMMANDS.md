# 🎮 Command Reference

Quick reference for all common commands in the OCR KING project.

## 📦 Installation

```bash
# Install all dependencies (from root)
npm run install:all

# Install backend only
cd backend && npm install

# Install frontend only
cd frontend && npm install
```

## 🚀 Running the Application

### From Root Directory

```bash
# Run backend
npm run dev:backend

# Run frontend
npm run dev:frontend

# Build frontend for production
npm run build:frontend

# Preview production build
npm run start:frontend
```

### From Subdirectories

**Backend:**
```bash
cd backend

# Start server (production)
npm start

# Start with auto-reload (development)
npm run dev
```

**Frontend:**
```bash
cd frontend

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🔧 Configuration

```bash
# Create backend .env file
cd backend
cp .env.example .env

# Edit .env file (add your GEMINI_API_KEY)
nano .env
# or
code .env
```

## 🧪 Testing

### API Testing with curl

**Health check:**
```bash
curl http://localhost:3001/health
```

**Test extract endpoint:**
```bash
curl -X POST http://localhost:3001/api/extract-text \
  -H "Content-Type: application/json" \
  -d '{"imageData":"...","mimeType":"image/png","model":"gemini-2.0-flash-exp","temperature":0.1,"prompt":"..."}'
```

**Test boost endpoint:**
```bash
curl -X POST http://localhost:3001/api/boost \
  -H "Content-Type: application/json" \
  -d '{"rawText":"...","model":"gemini-2.0-flash-exp","temperature":0.2,"prompt":"..."}'
```

## 🔍 Debugging

```bash
# Check if backend is running
curl http://localhost:3001/health

# Check backend logs
# (view terminal where backend is running)

# Check frontend in browser
# Open http://localhost:5173
# Press F12 for DevTools
```

## 📁 File Operations

```bash
# View project structure
tree -L 2 -I node_modules

# Find all JavaScript files
find . -name "*.js" -o -name "*.jsx" | grep -v node_modules

# Count lines of code
find . -name "*.js" -o -name "*.jsx" | grep -v node_modules | xargs wc -l
```

## 🧹 Cleanup

```bash
# Remove all node_modules
rm -rf node_modules backend/node_modules frontend/node_modules

# Remove build artifacts
rm -rf frontend/dist

# Clean and reinstall
npm run install:all
```

## 🔄 Git Commands

```bash
# Initialize git (if not already)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: OCR KING application"

# Create .gitignore (already created)
# Ensures .env and node_modules are not committed

# Check status
git status

# View ignored files
git status --ignored
```

## 📊 Monitoring

```bash
# Check backend port usage
lsof -i :3001

# Check frontend port usage
lsof -i :5173

# Kill process on port (if needed)
kill -9 $(lsof -t -i:3001)
kill -9 $(lsof -t -i:5173)
```

## 🔐 Environment Variables

```bash
# View current environment (backend)
cd backend
cat .env

# Check if GEMINI_API_KEY is set
grep GEMINI_API_KEY .env

# Set environment variable temporarily (Unix/Mac)
export GEMINI_API_KEY=your_key_here

# Set environment variable temporarily (Windows)
set GEMINI_API_KEY=your_key_here
```

## 📦 Package Management

```bash
# Update all dependencies
npm update

# Check for outdated packages
npm outdated

# Install specific package (backend)
cd backend
npm install package-name

# Install specific package (frontend)
cd frontend
npm install package-name

# Remove package
npm uninstall package-name
```

## 🏗️ Build Commands

```bash
# Build frontend for production
cd frontend
npm run build

# Output will be in frontend/dist/

# Preview production build locally
npm run preview
```

## 🔍 Troubleshooting Commands

```bash
# Clear npm cache
npm cache clean --force

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Check Node.js version
node --version

# Check npm version
npm --version

# Verify backend dependencies
cd backend
npm list

# Verify frontend dependencies
cd frontend
npm list
```

## 📝 Useful Aliases (Optional)

Add these to your `~/.bashrc` or `~/.zshrc`:

```bash
# OCR KING aliases
alias ocr-backend="cd ~/path/to/ocr-king/backend && npm start"
alias ocr-frontend="cd ~/path/to/ocr-king/frontend && npm run dev"
alias ocr-install="cd ~/path/to/ocr-king && npm run install:all"
```

Then reload your shell:
```bash
source ~/.bashrc
# or
source ~/.zshrc
```

## 🎯 Quick Workflows

### First Time Setup
```bash
cd ocr-king
npm run install:all
cd backend
cp .env.example .env
# Edit .env and add GEMINI_API_KEY
cd ..
```

### Daily Development
```bash
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

### Production Build
```bash
cd frontend
npm run build
# Deploy dist/ folder
```

### Clean Restart
```bash
# Kill all processes
# Ctrl+C in both terminals

# Clean install
rm -rf node_modules backend/node_modules frontend/node_modules
npm run install:all

# Restart
npm run dev:backend  # Terminal 1
npm run dev:frontend # Terminal 2
```

## 🆘 Emergency Commands

```bash
# Backend won't start - check port
lsof -i :3001
kill -9 $(lsof -t -i:3001)

# Frontend won't start - check port
lsof -i :5173
kill -9 $(lsof -t -i:5173)

# Complete reset
rm -rf node_modules backend/node_modules frontend/node_modules
rm -rf frontend/dist
npm run install:all

# Check if .env exists
ls -la backend/.env

# Verify API key is set
cd backend && grep GEMINI_API_KEY .env
```

## 📚 Documentation Commands

```bash
# View README
cat README.md

# View quick start
cat QUICK_START.md

# View all markdown files
ls *.md

# Search documentation
grep -r "search term" *.md
```

---

## 💡 Tips

- Use `Ctrl+C` to stop running servers
- Use `Ctrl+Shift+R` to hard refresh browser
- Check browser console (F12) for frontend errors
- Check terminal for backend errors
- Keep both terminals visible during development

---

**Need more help?** Check the full documentation:
- [README.md](README.md) - Complete guide
- [SETUP.md](SETUP.md) - Setup instructions
- [DEVELOPMENT.md](DEVELOPMENT.md) - Development workflow

