# Prompt Architecture - Unified System

## Overview

The OCR King system uses a **unified prompt architecture** that ensures any prompt changes automatically affect both the Gemini and Qwen3-VL engines. This eliminates duplicate maintenance and guarantees fair comparisons between engines.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  prompts-unified.js                          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  BASE_EXTRACT_PROMPT (structured object)              │ │
│  │  BASE_BOOST_PROMPT (structured object)                │ │
│  │  BASE_CONTINUE_PROMPT (structured object)             │ │
│  └────────────────────────────────────────────────────────┘ │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Adapter Functions                                     │  │
│  │  - toGeminiPrompt() → Convert to text string          │  │
│  │  - toQwenPrompt() → Convert to message array          │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Auto-Generated Exports                                │  │
│  │  - GEMINI_EXTRACT_PROMPT                               │  │
│  │  - GEMINI_BOOST_PROMPT                                 │  │
│  │  - QWEN_EXTRACT_PROMPT                                 │  │
│  │  - QWEN_BOOST_PROMPT                                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
              ↓                              ↓
     ┌────────────────┐             ┌────────────────┐
     │   prompts.js   │             │ qwen-server.js │
     │  (backward     │             │  (imports      │
     │   compatible)  │             │   Qwen         │
     │                │             │   prompts)     │
     └────────────────┘             └────────────────┘
              ↓                              ↓
     ┌────────────────┐             ┌────────────────┐
     │   server.js    │             │  qwen-client   │
     │   (Gemini)     │             │    (vLLM)      │
     └────────────────┘             └────────────────┘
```

## File Structure

### Core Files

```
backend/
├── prompts-unified.js    # ⭐ EDIT PROMPTS HERE
│   ├── BASE_EXTRACT_PROMPT       # Base extraction prompt
│   ├── BASE_BOOST_PROMPT         # Base boost prompt
│   ├── BASE_CONTINUE_PROMPT      # Base continuation prompt
│   ├── toGeminiPrompt()          # Adapter for Gemini
│   ├── toQwenPrompt()            # Adapter for Qwen3-VL
│   └── getPromptHash()           # Verification hash
│
├── prompts.js            # Gemini imports (backward compatible)
│   └── Re-exports GEMINI_* from prompts-unified.js
│
├── server.js             # Gemini server (uses prompts.js)
├── qwen-server.js        # Qwen server (uses prompts-unified.js)
└── qwen-client.js        # Qwen vLLM client
```

## How to Edit Prompts

### Step 1: Open prompts-unified.js

```bash
vim backend/prompts-unified.js
```

### Step 2: Edit BASE_EXTRACT_PROMPT or BASE_BOOST_PROMPT

Example: Adding a new rule to extraction prompt

```javascript
export const BASE_EXTRACT_PROMPT = {
  role: "Tu es un assistant IA...",

  task: `Ta tâche est d'extraire...`,

  rules: {
    definition: `# DÉFINITION...`,

    format: `# FORMAT...`,

    // Add new section here
    newRule: `# NOUVELLE RÈGLE

    **Règle spéciale** : Si le document contient...`,

    examples: `# EXEMPLES...`
  },

  // ... rest of prompt
};
```

### Step 3: Verify Changes

```bash
# Test Gemini (existing tests)
cd backend
npm test

# Test Qwen (new tests)
npm run test:qwen

# Compare both (uses identical prompts)
npm run test:compare <pdf-url>
```

### Step 4: Check Prompt Hash

The comparison tool will verify both engines use identical prompts:

```
╔══════════════════════════════════════════════════════════════════╗
║ PROMPT VERIFICATION                                              ║
╚══════════════════════════════════════════════════════════════════╝
  ✓ Both engines using prompts from prompts-unified.js
  ✓ Prompt hash: a3f2d9e1 (identical)
```

## Adapter Pattern

### Why Adapters?

Different engines have different input formats:

- **Gemini**: Accepts a single text string prompt
- **Qwen3-VL**: Expects OpenAI-style message array with vision

Adapters convert the base structured prompt to each engine's format.

### Gemini Adapter (toGeminiPrompt)

```javascript
export function toGeminiPrompt(basePrompt) {
  if (basePrompt === BASE_EXTRACT_PROMPT) {
    // Concatenate all sections into a single text string
    return `${basePrompt.role}

${basePrompt.task}

---

${basePrompt.rules.definition}

---

${basePrompt.rules.format}

---

${basePrompt.rules.examples}

---

${basePrompt.outputFormat}`;
  }
  // ... similar for other prompts
}
```

**Output format**: Plain text string

```
Tu es un assistant IA spécialisé...

Ta tâche est d'extraire...

---

# DÉFINITION D'UNE INSCRIPTION
...
```

### Qwen Adapter (toQwenPrompt)

```javascript
export function toQwenPrompt(basePrompt) {
  if (basePrompt === BASE_EXTRACT_PROMPT) {
    // Build the same text content
    const textContent = `${basePrompt.role}

${basePrompt.task}

---
...`;

    // Return text (will be combined with image in qwen-client.js)
    return textContent;
  }
  // ... similar for other prompts
}
```

**Output format**: Text string (combined with image in client)

```javascript
// In qwen-client.js:
const messages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: promptText },
      { type: 'image_url', image_url: { url: `data:image/png;base64,...` }}
    ]
  }
];
```

## Engine-Specific Customization

### When to Customize

Most of the time, you DON'T need engine-specific customization. The base prompts work for both engines.

**Customize adapters only if:**
- Engine has special tokens (e.g., `<vision>` tags)
- Engine requires different formatting
- Engine has unique capabilities

### Example: Adding Engine-Specific Prefix

```javascript
export function toQwenPrompt(basePrompt) {
  if (basePrompt === BASE_EXTRACT_PROMPT) {
    const textContent = `${basePrompt.role}

${basePrompt.task}
...`;

    // Add Qwen-specific prefix
    return `[Qwen Vision Mode]\n\n${textContent}`;
  }
}
```

## Verification System

### Prompt Hash

The `getPromptHash()` function generates a hash of the base prompt to verify both engines use identical prompts:

```javascript
export function getPromptHash(promptType = 'extract') {
  let basePrompt;
  switch (promptType) {
    case 'extract':
      basePrompt = BASE_EXTRACT_PROMPT;
      break;
    case 'boost':
      basePrompt = BASE_BOOST_PROMPT;
      break;
    // ...
  }

  const promptStr = JSON.stringify(basePrompt);
  // Generate hash...
  return hash;
}
```

### Usage in Comparison Tool

```javascript
import { getPromptHash } from './prompts-unified.js';

const geminiHash = getPromptHash('extract');
const qwenHash = getPromptHash('extract');

if (geminiHash === qwenHash) {
  console.log('✓ Both engines using identical prompts');
} else {
  console.error('✗ Prompt mismatch detected!');
}
```

## Benefits

### ✅ Single Source of Truth

- Edit prompts in **ONE place** (`prompts-unified.js`)
- Changes automatically propagate to **ALL engines**
- No duplicate maintenance
- No sync issues

### ✅ Fair Comparisons

- **Guaranteed identical prompts** for both engines
- Apples-to-apples testing
- Accurate performance metrics

### ✅ Backward Compatible

- Existing Gemini code unchanged
- All existing tests pass
- No breaking changes

### ✅ Extensible

- Easy to add new engines (Claude, GPT-4V, etc.)
- Adapter pattern is flexible
- Core prompts remain engine-agnostic

## Common Scenarios

### Scenario 1: Add New Extraction Rule

**Goal**: Add a rule to detect "Servitude" when "Hydro-Québec" is mentioned.

**Steps**:
1. Open `backend/prompts-unified.js`
2. Edit `BASE_EXTRACT_PROMPT.rules.format`
3. Add the new rule text
4. Save and test both engines

**Result**: Both Gemini and Qwen now use the updated rule.

### Scenario 2: Adjust Boost Confidence Thresholds

**Goal**: Increase confidence boost for bank names from +10% to +15%.

**Steps**:
1. Open `backend/prompts-unified.js`
2. Edit `BASE_BOOST_PROMPT.boostRules`
3. Update the confidence adjustment text
4. Save and test both engines

**Result**: Both engines apply the new confidence threshold.

### Scenario 3: Change Output Format

**Goal**: Switch from pipe-separated to JSON output.

**Steps**:
1. Open `backend/prompts-unified.js`
2. Edit `BASE_EXTRACT_PROMPT.outputFormat`
3. Update the format specification
4. Update adapters if needed (usually not)
5. Update parsing logic in `server.js` and `qwen-server.js`

**Result**: Both engines output in the new format.

## Troubleshooting

### Issue: Prompts not updating

**Symptom**: Changes to `prompts-unified.js` don't appear in tests.

**Solution**:
1. Check syntax: `node --check backend/prompts-unified.js`
2. Restart servers: `npm start` and `npm run start:qwen`
3. Clear Node cache: `rm -rf node_modules/.cache`

### Issue: Different results from Gemini and Qwen

**Symptom**: Same prompt, different outputs.

**Possible causes**:
1. **Different model capabilities** (expected)
2. **Different temperature settings** (check config)
3. **Adapter formatting issue** (check adapters)

**Debug**:
```bash
# Verify prompt hash matches
npm run test:compare <pdf-url>

# Check raw prompts
node -e "import('./prompts-unified.js').then(m => console.log(m.GEMINI_EXTRACT_PROMPT))"
node -e "import('./prompts-unified.js').then(m => console.log(m.QWEN_EXTRACT_PROMPT))"
```

### Issue: Syntax error in prompts-unified.js

**Symptom**: `SyntaxError: Unexpected token`

**Common causes**:
1. Backticks (`) not escaped in strings
2. Colons (:) in JSDoc comments
3. Missing closing braces

**Solution**:
```bash
# Check syntax
node --check backend/prompts-unified.js

# Locate error
node backend/prompts-unified.js
```

## Best Practices

### ✅ DO

- Edit prompts in `prompts-unified.js`
- Test both engines after changes
- Use descriptive section names in base prompts
- Keep adapters minimal
- Document major prompt changes

### ❌ DON'T

- Edit prompts in `prompts.js` (backward compat only)
- Modify prompts in `server.js` or `qwen-server.js`
- Add engine-specific logic to base prompts
- Break the JSON structure in base prompts
- Skip testing after changes

## Future Extensions

### Adding a New Engine (e.g., Claude)

1. Create adapter function:
```javascript
export function toClaudePrompt(basePrompt) {
  // Convert base prompt to Claude format
  return claudeFormattedPrompt;
}
```

2. Export Claude prompts:
```javascript
export const CLAUDE_EXTRACT_PROMPT = toClaudePrompt(BASE_EXTRACT_PROMPT);
export const CLAUDE_BOOST_PROMPT = toClaudePrompt(BASE_BOOST_PROMPT);
```

3. Create Claude server:
```javascript
import { CLAUDE_EXTRACT_PROMPT, CLAUDE_BOOST_PROMPT } from './prompts-unified.js';
// ... use in Claude API calls
```

4. Done! All three engines now share the same base prompts.

## Summary

The unified prompt system ensures:
- **Single edit** → affects all engines
- **Fair comparisons** with identical prompts
- **No duplicate maintenance**
- **Extensible** to new engines

**Remember**: Always edit `backend/prompts-unified.js`, never `prompts.js` or server files!
