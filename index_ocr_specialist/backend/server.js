import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Extract text from image endpoint
app.post('/api/extract-text', async (req, res) => {
  try {
    const { imageData, mimeType, model = 'gemini-2.0-flash-exp', temperature = 0.1, prompt, previousText } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    // Determine max tokens based on model
    let maxTokens = 8192; // Default for flash models
    if (model.includes('pro')) {
      maxTokens = 32768; // Pro models support more tokens
    }

    // Initialize the model
    const generativeModel = genAI.getGenerativeModel({
      model: model,
      generationConfig: {
        temperature: temperature,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: maxTokens,
      }
    });

    // Prepare the image part
    const imagePart = {
      inlineData: {
        data: imageData,
        mimeType: mimeType
      }
    };

    // If there's previous text, add continuation instruction
    let finalPrompt = prompt;
    if (previousText) {
      finalPrompt = `${prompt}\n\n⚠️ CONTINUATION REQUEST: The previous response was truncated. Continue from where you left off and ensure you include the completion marker.`;
    }

    // Generate content
    const result = await generativeModel.generateContent([finalPrompt, imagePart]);
    const response = await result.response;
    const text = response.text();

    res.json({ text });
  } catch (error) {
    console.error('Error extracting text:', error);
    res.status(500).json({
      error: 'Failed to extract text from image',
      details: error.message
    });
  }
});

// Boost text endpoint
app.post('/api/boost', async (req, res) => {
  try {
    const { rawText, model = 'gemini-2.5-pro', temperature = 0.2, prompt, previousText } = req.body;

    if (!rawText) {
      return res.status(400).json({ error: 'No raw text provided' });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }

    // Determine max tokens based on model
    let maxTokens = 8192; // Default for flash models
    if (model.includes('pro')) {
      maxTokens = 32768; // Pro models support more tokens
    }

    // Initialize the model
    const generativeModel = genAI.getGenerativeModel({
      model: model,
      generationConfig: {
        temperature: temperature,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: maxTokens,
      }
    });

    // Create the full prompt
    let fullPrompt = `${prompt}\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;

    // If there's previous text, add continuation instruction
    if (previousText) {
      fullPrompt = `${prompt}\n\n⚠️ CONTINUATION REQUEST: The previous response was truncated. Continue from where you left off and ensure you include the completion marker.\n\n---\n\nTEXTE BRUT À BOOSTER :\n\n${rawText}`;
    }

    // Generate content
    const result = await generativeModel.generateContent(fullPrompt);
    const response = await result.response;
    const boostedText = response.text();

    res.json({ boostedText });
  } catch (error) {
    console.error('Error boosting text:', error);
    res.status(500).json({
      error: 'Failed to boost text',
      details: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 API endpoints:`);
  console.log(`   - POST /api/extract-text`);
  console.log(`   - POST /api/boost`);
  console.log(`   - GET  /health`);
  
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY not found in .env file');
  } else {
    console.log('✅ GEMINI_API_KEY configured');
  }
});

