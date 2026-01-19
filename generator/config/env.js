// generator/config/env.js
// Loads and validates AI-related env; exports getConfig() and getAiClient().
// Ensure dotenv is loaded before this module is used (e.g. import "dotenv/config" at top of server.js).

import process from "node:process";

let cached = null;

function parseAiRefine(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * Returns validated config. Validates on first call and caches.
 * Fail-fast: throws if AI_PROVIDER is invalid or the required API key for the chosen provider is missing.
 * @returns {{
 *   provider: 'openai' | 'gemini',
 *   openai: { apiKey: string, model: string },
 *   gemini: { apiKey: string, model: string },
 *   aiRefine: boolean
 * }}
 */
export function getConfig() {
  if (cached) return cached;

  const raw = String(process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  const provider = raw || "openai";

  if (provider !== "openai" && provider !== "gemini") {
    throw new Error(
      `Invalid AI_PROVIDER: "${process.env.AI_PROVIDER}". Use "openai" or "gemini".`
    );
  }

  const openaiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const geminiKey = String(process.env.GEMINI_API_KEY || "").trim();

  if (provider === "openai" && !openaiKey) {
    throw new Error("Missing OPENAI_API_KEY (AI_PROVIDER=openai)");
  }
  if (provider === "gemini" && !geminiKey) {
    throw new Error("Missing GEMINI_API_KEY (AI_PROVIDER=gemini)");
  }

  const openaiModel = String(process.env.OPENAI_MODEL || "gpt-5.2").trim();
  const geminiModel = String(process.env.GEMINI_MODEL || "gemini-1.5-pro").trim();
  const aiRefine = parseAiRefine(process.env.AI_REFINE);

  cached = {
    provider: /** @type {'openai'|'gemini'} */ (provider),
    openai: { apiKey: openaiKey, model: openaiModel },
    gemini: { apiKey: geminiKey, model: geminiModel },
    aiRefine,
  };
  return cached;
}

function extractTextFromResponsesOutput(outputArr) {
  try {
    const parts = [];
    for (const item of outputArr) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === "output_text" && typeof c?.text === "string") parts.push(c.text);
        if (typeof c?.text === "string" && !c?.type) parts.push(c.text);
      }
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}

/**
 * Factory for a normalized AI client used by aiRefine and similar callers.
 * @param {ReturnType<getConfig>} config - from getConfig()
 * @returns {Promise<{ complete: (opts: { system: string, user: string, maxOutputTokens?: number, temperature?: number }) => Promise<{ text: string }> }>}
 */
export async function getAiClient(config) {
  const maxOut = 1800;
  const temp = 0.15;

  if (config.provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: config.openai.apiKey });
    const model = config.openai.model;

    return {
      async complete({ system, user, maxOutputTokens = maxOut, temperature = temp }) {
        const resp = await client.responses.create({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_output_tokens: maxOutputTokens,
          temperature,
        });
        const text =
          (resp && typeof resp.output_text === "string" && resp.output_text.trim()) ||
          (resp && Array.isArray(resp.output) ? extractTextFromResponsesOutput(resp.output) : "") ||
          "";
        return { text };
      },
    };
  }

  if (config.provider === "gemini") {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    const model = config.gemini.model;

    return {
      async complete({ system, user, maxOutputTokens = maxOut, temperature = temp }) {
        const response = await ai.models.generateContent({
          model,
          contents: user,
          config: {
            systemInstruction: system,
            maxOutputTokens,
            temperature,
          },
        });
        const text = response?.text != null ? String(response.text) : "";
        return { text };
      },
    };
  }

  throw new Error(`Unsupported AI_PROVIDER: ${config.provider}`);
}
