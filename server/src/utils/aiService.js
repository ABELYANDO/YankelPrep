import { GoogleGenAI } from '@google/genai'
import Anthropic from '@anthropic-ai/sdk'
import { jsonrepair } from 'jsonrepair'
import dotenv from 'dotenv'

dotenv.config()

// ── Which AI provider to use ───────────────────────────────────
// Controlled by AI_PROVIDER in your .env file.
// Defaults to 'gemini' if not set.
const provider = process.env.AI_PROVIDER || 'gemini'

// ── Initialise the Gemini client ───────────────────────────────
// GoogleGenAI automatically reads GEMINI_API_KEY from process.env.
// You do not need to pass the key manually.
let geminiClient = null
let anthropicClient = null

if (provider === 'gemini') {
  geminiClient = new GoogleGenAI({})
} else {
  anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// ── Core function — used by all modules ────────────────────────
// Takes a prompt string and optional system prompt.
// Returns the AI's text response as a plain string.
export const generateAIResponse = async (prompt, systemPrompt = '') => {
  try {
    if (provider === 'gemini') {
      return await callGemini(prompt, systemPrompt)
    } else {
      return await callClaude(prompt, systemPrompt)
    }
  } catch (error) {
    // ── Rate limit guard for free tier ─────────────────────────
    // Free tier allows ~15 requests/minute. If you hit the limit,
    // this returns a clear message instead of crashing.
    if (error.status === 429) {
      console.warn('[AI Service] Free tier rate limit hit. Slow down requests.')
      throw new Error('AI is temporarily busy due to rate limits. Please wait 60 seconds and try again.')
    }

    console.error(`[AI Service] ${provider} call failed:`, error.message)
    throw new Error(`AI generation failed: ${error.message}`)
  }
}

// ── Gemini implementation ──────────────────────────────────────
// Uses gemini-3.5-flash-lite — the recommended free-tier model.
// Combines systemPrompt and user prompt into a single contents string
// since the new SDK handles them together.
const callGemini = async (prompt, systemPrompt) => {
  const fullPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt}`
    : prompt

  const response = await geminiClient.models.generateContent({
    model:    'gemini-3.5-flash-lite',
    contents: fullPrompt,
  })

  return requireText(response)
}

// Gemini occasionally returns a response with no usable text — blocked
// by a safety filter, truncated for hitting the output token limit, or
// simply no candidates at all. `response.text` is then `undefined`,
// and every caller downstream (JSON parsing, etc.) would crash on it
// with an opaque "Cannot read properties of undefined" deep inside
// string processing. Fail clearly, right here, instead.
const requireText = (response) => {
  if (response.text) return response.text
  const reason = response.candidates?.[0]?.finishReason
  throw new Error(
    reason
      ? `AI returned no usable content (${reason}). Try a shorter document or fewer pages.`
      : 'AI returned an empty response. Please try again.'
  )
}

// ── Claude implementation (kept for easy switching later) ──────
const callClaude = async (prompt, systemPrompt) => {
  const message = await anthropicClient.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system:     systemPrompt || undefined,
    messages:   [{ role: 'user', content: prompt }],
  })
  return message.content[0].text
}

// ── JSON helper ────────────────────────────────────────────────
// Many AI calls expect structured JSON back.
// Strips markdown code fences Gemini sometimes wraps around JSON
// and parses the result safely.
export const generateAIJSON = async (prompt, systemPrompt = '') => {
  const raw = await generateAIResponse(prompt, systemPrompt)
  return await parseJSONResponse(raw)
}

// ── Multimodal core function ────────────────────────────────────
// Same as generateAIResponse, but also sends page images alongside
// the text prompt — used by the PDF extractor so the AI can actually
// see diagrams/figures instead of only reading whatever text happens
// to be extractable from the page.
// `images`: [{ mimeType, data (base64) }, ...]
export const generateAIResponseWithImages = async (prompt, systemPrompt = '', images = []) => {
  try {
    if (provider === 'gemini') {
      return await callGeminiWithImages(prompt, systemPrompt, images)
    } else {
      return await callClaudeWithImages(prompt, systemPrompt, images)
    }
  } catch (error) {
    if (error.status === 429) {
      console.warn('[AI Service] Free tier rate limit hit. Slow down requests.')
      throw new Error('AI is temporarily busy due to rate limits. Please wait 60 seconds and try again.')
    }

    console.error(`[AI Service] ${provider} call failed:`, error.message)
    throw new Error(`AI generation failed: ${error.message}`)
  }
}

const callGeminiWithImages = async (prompt, systemPrompt, images) => {
  const fullPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt}`
    : prompt

  const response = await geminiClient.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [
          { text: fullPrompt },
          ...images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
        ],
      },
    ],
  })

  return requireText(response)
}

const callClaudeWithImages = async (prompt, systemPrompt, images) => {
  const message = await anthropicClient.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system:     systemPrompt || undefined,
    messages: [{
      role: 'user',
      content: [
        // A scanned answer can be a PDF, which Claude takes as a document
        // block rather than an image.
        ...images.map(img => ({
          type:   img.mimeType === 'application/pdf' ? 'document' : 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.data },
        })),
        { type: 'text', text: prompt },
      ],
    }],
  })
  return message.content[0].text
}

export const generateAIJSONWithImages = async (prompt, systemPrompt = '', images = []) => {
  const raw = await generateAIResponseWithImages(prompt, systemPrompt, images)
  return await parseJSONResponse(raw)
}

const stripCodeFences = (text) => text
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i,     '')
  .replace(/```\s*$/,      '')
  .trim()

// ── Shared JSON parsing ─────────────────────────────────────────
// Strips markdown code fences Gemini sometimes wraps around JSON, then
// parses with two fallback layers for the rare malformed response:
//  1. jsonrepair — a proper JSON-grammar-aware fixer (trailing commas,
//     unescaped quotes, etc). Safe because it understands JSON structure,
//     so it never touches the actual content of strings.
//  2. Ask the AI to fix its own output. Needed for corruptions jsonrepair
//     can't guess (e.g. a stray token dropped mid-document) — a blind
//     regex fix for those risks silently mangling real question text
//     wherever a comma happens to appear inside it, which is far worse
//     than a slower retry. The model still has the context of what it
//     meant, so it can correct just the syntax.
const parseJSONResponse = async (raw) => {
  const cleaned = stripCodeFences(raw)

  try {
    return JSON.parse(cleaned)
  } catch {
    try {
      return JSON.parse(jsonrepair(cleaned))
    } catch {
      try {
        const fixedRaw = await generateAIResponse(
          `The text below is meant to be valid JSON but has a syntax error ` +
          `(e.g. a stray character, missing comma/quote). Return ONLY the ` +
          `corrected JSON with the exact same content — fix just the syntax, ` +
          `change nothing else. No markdown, no explanation.\n\n${raw}`,
          'You are a strict JSON syntax fixer. Output only valid JSON, nothing else.'
        )
        return JSON.parse(stripCodeFences(fixedRaw))
      } catch (err) {
        console.error('[AI Service] JSON parse failed even after repair. Raw output:', raw)
        throw new Error('AI returned invalid JSON. Raw: ' + raw.slice(0, 300))
      }
    }
  }
}