# 🚀 Quick Setup Guide

Follow these steps to get OCR KING up and running in minutes!

## Step 1: Get Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

## Step 2: Install Backend Dependencies

```bash
cd backend
npm install
```

## Step 3: Configure Environment

Create a `.env` file in the `backend` directory:

```bash
# In the backend directory
cp .env.example .env
```

Edit `.env` and add your API key:

```env
GEMINI_API_KEY=your_actual_api_key_here
PORT=3001
```

## Step 4: Start Backend Server

```bash
# Still in backend directory
npm start
```

You should see:
```
🚀 Server running on http://localhost:3001
📝 API endpoints:
   - POST /api/extract-text
   - POST /api/boost
   - GET  /health
✅ GEMINI_API_KEY configured
```

## Step 5: Install Frontend Dependencies

Open a **new terminal** and run:

```bash
cd frontend
npm install
```

## Step 6: Start Frontend

```bash
# In frontend directory
npm run dev
```

The app will automatically open in your browser at `http://localhost:5173`

## Step 7: Test the Application

1. You should see the "Registre Foncier OCR" interface
2. The backend URL should be pre-filled as `http://localhost:3001`
3. Try uploading a test image
4. Click "Extract Text"
5. Optionally click "Boost Results"

## ✅ Verification Checklist

- [ ] Backend running on port 3001
- [ ] Frontend running on port 5173
- [ ] GEMINI_API_KEY configured in backend/.env
- [ ] Can upload images
- [ ] Can extract text
- [ ] Can boost results

## 🐛 Common Issues

### "GEMINI_API_KEY not configured"
- Make sure you created the `.env` file in the `backend` directory
- Check that the API key is correct (no extra spaces)
- Restart the backend server after adding the key

### "Failed to extract text"
- Check that backend is running
- Verify the backend URL in the frontend matches (default: http://localhost:3001)
- Check browser console for CORS errors

### Port already in use
- Backend (3001): Change `PORT` in backend/.env
- Frontend (5173): Change port in frontend/vite.config.js

## 🎉 You're Ready!

Your OCR KING application is now running. Upload a Quebec land registry document and start extracting!

## 📚 Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore advanced settings (upscaling, temperature controls)
- Try different Gemini models for comparison
- Review the boost rules to understand corrections

---

Need help? Check the troubleshooting section in README.md or open an issue on GitHub.

