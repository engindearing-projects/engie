// Summarize raw agent "thought" text into a user-friendly status line via local Ollama.
// Falls back to a truncated version of the original if Ollama is unavailable or slow.

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "engie-coder:latest";
const TIMEOUT_MS = 3000;

/**
 * Rewrite raw agent continuation/planning text into a brief friendly summary.
 * @param {string} rawText - The raw thought text from the agent
 * @returns {Promise<string>} - Summarized text, or trimmed original on failure
 */
export async function summarizeThought(rawText) {
  if (!rawText || rawText.length < 20) return rawText;

  try {
    const resp = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You rewrite internal AI planning notes into a brief, friendly status update for the user. " +
              "Keep it under 2 sentences. Use plain language. No markdown, no bullet points, no emojis. " +
              "Start with what the AI is doing or has decided, like a coworker giving a quick update.",
          },
          {
            role: "user",
            content: rawText.slice(0, 800),
          },
        ],
        stream: false,
        options: { num_predict: 100, temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) return rawText;

    const data = await resp.json();
    const summary = data.message?.content?.trim();

    return summary && summary.length > 5 ? summary : rawText;
  } catch {
    return rawText;
  }
}
