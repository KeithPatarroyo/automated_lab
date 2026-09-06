import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "../env.js";

const client = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// gemini-2.5-flash was retired for new users; gemini-3.6-flash was its confirmed live
// replacement, then gemini-3.7-flash gave frequent 503s (observed directly - a newly
// launched model likely still short on served capacity). For now (2026-08-31), pinned
// to gemini-3.5-flash-lite everywhere - Google's cheapest/fastest tier, explicitly
// positioned for high-volume automation/subagents - to see whether it clears up the
// failures across both the human-facing terminals/chat and the background agent loop.
// Kept as two named constants (not one) so the fast-vs-thinking split can be
// reintroduced later without restructuring anything - just point them at different
// models again. Retry logic for transient 503/429s lives in generate() below regardless.
const FAST_MODEL = "gemini-3.5-flash-lite";
const THINKING_MODEL = FAST_MODEL;

export interface TerminalTurn {
  role: "user" | "assistant";
  text: string;
}

export class GeminiClientError extends Error {}

interface GenerateOptions {
  model: string;
  systemPrompt: string;
  maxOutputTokens: number;
  /** Omit to let the model default its own thinking effort - only set this once its
   * real constraints are known live (see THINKING_MODEL note above). */
  thinkingBudget?: number;
}

// A 503 ("model overloaded") is Google's servers being briefly at capacity - genuinely
// transient, worth one short retry. A 429 is a rate/quota limit - confirmed via the AI
// Studio dashboard (2026-09-01: ~1500 429s vs. 17 503s over a day-long run) to be the
// dominant failure mode here, and it is NOT transient on this timescale: an 800ms retry
// doesn't give a per-minute/per-day quota window time to reset, so retrying a 429 just
// spends a second request that also fails - actively worse than failing once, since it
// doubles pressure on an already-exhausted quota. Only 503 gets retried; a 429 fails
// straight to the caller's fallback. If this keeps happening, the fix is fewer/less
// frequent requests (see agents/runtime.ts's DECISION_INTERVAL_MS) or a paid tier, not
// a smarter retry - there's no Retry-After info in this SDK's error to retry smartly on.
const RETRYABLE_STATUS = new Set([503]);
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 800;

function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return RETRYABLE_STATUS.has(status);
  const message = err instanceof Error ? err.message : "";
  return /\b503\b|UNAVAILABLE|overloaded/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generate(history: TerminalTurn[], opts: GenerateOptions): Promise<string> {
  if (!client) {
    throw new GeminiClientError("GEMINI_API_KEY is not configured on the server");
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: opts.model,
        contents: history.map((turn) => ({
          role: turn.role === "assistant" ? "model" : "user",
          parts: [{ text: turn.text }],
        })),
        config: {
          systemInstruction: opts.systemPrompt,
          maxOutputTokens: opts.maxOutputTokens,
          ...(opts.thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } } : {}),
        },
      });
      return response.text ?? "";
    } catch (err) {
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      if (!isLastAttempt && isRetryableError(err)) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      const message = err instanceof Error ? err.message : "Unknown error calling Gemini API";
      throw new GeminiClientError(message);
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TypeScript happy about
  // the function's return type without an unsafe assertion.
  throw new GeminiClientError("Gemini API call failed after retries");
}

/** Fast model, minimal thinking budget - shared by anything a human is waiting on in
 * real time (measured 4-60s with no thinking-budget config on the old model vs. ~3s
 * typical with a minimal one; thinkingBudget: 0 outright fails with INVALID_ARGUMENT on
 * this model family, so 1 is the practical floor). */
export async function askFast(history: TerminalTurn[], systemPrompt: string): Promise<string> {
  return generate(history, {
    model: FAST_MODEL,
    systemPrompt,
    maxOutputTokens: 1024,
    thinkingBudget: 1,
  });
}

/** Background agent planning/analysis loop. Higher-compute model, no human waiting -
 * slower replies are fine, quality of reasoning is what matters. `systemPrompt` is the
 * agent's persona (see agents/personas.ts), not a fixed constant, since each agent
 * needs different framing. */
export async function askAgent(history: TerminalTurn[], systemPrompt: string): Promise<string> {
  return generate(history, {
    model: THINKING_MODEL,
    systemPrompt,
    maxOutputTokens: 1536,
  });
}
