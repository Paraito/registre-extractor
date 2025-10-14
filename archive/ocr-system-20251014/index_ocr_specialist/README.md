# 🏛️ OCR KING - Registre Foncier OCR

A powerful OCR application for Quebec land registry documents using Google's Gemini AI. This application provides advanced text extraction with confidence scoring and intelligent boost corrections using 60+ domain-specific rules.

## ✨ Features

- **🖼️ Image Upload**: Drag & drop or click to upload land registry images
- **🔍 Advanced OCR**: Extract text with confidence scoring for critical fields
- **⚡ Image Upscaling**: Browser-based image enhancement (1.5x to 4x) before OCR
- **🎯 Smart Boost**: Apply 60+ correction rules for Quebec land registry documents
- **🎛️ Model Selection**: Choose from multiple Gemini models
- **🌡️ Temperature Control**: Fine-tune extraction and boost precision
- **📋 Copy to Clipboard**: Easy result copying
- **📊 Dual View**: Compare raw extraction vs boosted results

## 🏗️ Architecture

```
workspace/
├── frontend/          # React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── App.jsx   # Main OCR component
│   │   ├── main.jsx
│   │   └── index.css
│   └── package.json
├── backend/           # Express + Gemini API
│   ├── server.js     # API endpoints
│   └── package.json
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### 1. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend` directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3001
```

Start the backend server:

```bash
npm start
```

The backend will run on `http://localhost:3001`

### 2. Frontend Setup

```bash
cd frontend
npm install
```

Start the development server:

```bash
npm run dev
```

The frontend will open automatically at `http://localhost:5173`

## 📖 Usage

1. **Start Backend**: Make sure the backend is running with your Gemini API key configured
2. **Open Frontend**: Navigate to `http://localhost:5173`
3. **Upload Image**: Drag & drop or click to upload a land registry image
4. **Configure Settings** (optional):
   - Select Gemini model
   - Enable/disable image upscaling
   - Adjust temperature settings
5. **Extract Text**: Click "Extract Text" to perform OCR
6. **Boost Results** (optional): Click "Boost Results" to apply correction rules
7. **Copy Results**: Use the copy button to copy extracted text

## 🎛️ Configuration Options

### Gemini Models

- **gemini-2.0-flash-exp** (Default): Latest experimental model, fast and accurate
- **gemini-1.5-flash**: Stable, fast model
- **gemini-1.5-flash-8b**: Lightweight version
- **gemini-1.5-pro**: More capable, slower
- **gemini-2.5-flash**: Newer flash model
- **gemini-2.5-pro**: Latest pro model

### Advanced Settings

- **Image Upscaling**: Enhance image quality before OCR (1.5x - 4x)
  - Recommended: 2x for most documents
  - Higher values = better quality but slower processing
  
- **Extraction Temperature**: Controls OCR precision (0.0 - 1.0)
  - Recommended: 0.1 (more precise)
  - Lower = more conservative, Higher = more creative
  
- **Boost Temperature**: Controls correction aggressiveness (0.0 - 1.0)
  - Recommended: 0.2
  - Lower = conservative corrections, Higher = more aggressive

## 🔧 API Endpoints

### POST `/api/extract-text`

Extract text from an image using Gemini Vision.

**Request Body:**
```json
{
  "imageData": "base64_encoded_image",
  "mimeType": "image/png",
  "model": "gemini-2.0-flash-exp",
  "temperature": 0.1,
  "prompt": "extraction_prompt"
}
```

**Response:**
```json
{
  "text": "extracted_text_with_confidence_scores"
}
```

### POST `/api/boost`

Apply 60+ correction rules to raw OCR text.

**Request Body:**
```json
{
  "rawText": "raw_ocr_text",
  "model": "gemini-2.0-flash-exp",
  "temperature": 0.2,
  "prompt": "boost_prompt"
}
```

**Response:**
```json
{
  "boostedText": "corrected_and_formatted_text"
}
```

### GET `/health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Backend is running"
}
```

## 📊 Boost Rules

The boost system applies 60+ domain-specific rules including:

- **Utilities/Electricity**: Hydro-Québec servitude detection
- **Transportation**: Ministry of Transport, railways
- **Banking/Finance**: Hypothèques, mainlevées, RBC, TD, BMO, etc.
- **Public Organizations**: Municipalities, school boards
- **Semantic Co-occurrences**: Cross-column validation
- **Party Disambiguation**: Fuzzy matching for known entities
- **Temporal Rules**: Date-based context
- **Low OCR Signal Fallbacks**: Smart defaults when confidence is low

## 🛠️ Development

### Frontend Development

```bash
cd frontend
npm run dev      # Start dev server
npm run build    # Build for production
npm run preview  # Preview production build
```

### Backend Development

```bash
cd backend
npm run dev      # Start with auto-reload (Node 18+)
npm start        # Start normally
```

## 📦 Dependencies

### Frontend
- React 18
- Vite 6
- Tailwind CSS 3
- lucide-react (icons)

### Backend
- Express 4
- @google/generative-ai
- cors
- dotenv

## 🔒 Security Notes

- Never commit your `.env` file
- Keep your Gemini API key secure
- The backend handles all API calls to avoid exposing keys in the browser
- Image upscaling happens client-side to reduce server load

## 🐛 Troubleshooting

### Backend won't start
- Check that `GEMINI_API_KEY` is set in `.env`
- Verify Node.js version is 18+
- Check port 3001 is not in use

### Frontend can't connect to backend
- Verify backend is running on `http://localhost:3001`
- Check CORS is enabled in backend
- Update backend URL in frontend if using different port

### OCR results are poor
- Try enabling image upscaling (2x recommended)
- Use higher quality source images
- Try different Gemini models (gemini-1.5-pro for better accuracy)
- Adjust extraction temperature (lower = more precise)

### Boost not improving results
- Ensure raw extraction completed successfully
- Try adjusting boost temperature
- Check that document is a Quebec land registry format

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

## 📧 Support

For issues and questions, please open an issue on GitHub.

---

Built with ❤️ using React, Express, and Google Gemini AI

