/**
 * WebLLM helper - Client-side LLM using @mlc-ai/web-llm
 * Loads model in browser via WebGPU, no server cost.
 *
 * Usage:
 *   import { initWebLLM, chat } from "@/lib/webllm";
 *   await initWebLLM(); // load model (1-time, ~1GB download cached)
 *   const response = await chat([{role: "user", content: "Hello"}]);
 */

// Lazy-load WebLLM only when needed (avoid bundle bloat)
let engine: any = null;
let loadingPromise: Promise<any> | null = null;

const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f32_1-MLC"; // Small enough for browser
const MODEL_ID_FALLBACK = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

export interface WebLLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function isWebLLMSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  // @ts-ignore - navigator.gpu is WebGPU
  return !!navigator.gpu;
}

export async function initWebLLM(onProgress?: (p: number, text: string) => void): Promise<any> {
  if (engine) return engine;
  if (loadingPromise) return loadingPromise;

  if (!isWebLLMSupported()) {
    throw new Error("WebGPU not supported. Use Chrome/Edge 113+ or enable WebGPU flag.");
  }

  loadingPromise = (async () => {
    // Dynamic import to avoid loading WebLLM in unsupported browsers
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");

    const initProgressCallback = (report: any) => {
      const pct = Math.round((report.progress || 0) * 100);
      const text = report.text || `Loading ${pct}%`;
      onProgress?.(pct, text);
    };

    try {
      engine = await CreateMLCEngine(
        MODEL_ID,
        { initProgressCallback }
      );
    } catch (e) {
      console.warn("[WebLLM] Primary model failed, trying fallback:", e);
      engine = await CreateMLCEngine(
        MODEL_ID_FALLBACK,
        { initProgressCallback }
      );
    }
    return engine;
  })();

  return loadingPromise;
}

export async function chat(
  messages: WebLLMMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  if (!engine) {
    throw new Error("WebLLM not initialized. Call initWebLLM() first.");
  }
  const response = await engine.chat.completions.create({
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 1024,
  });
  return response.choices[0]?.message?.content || "";
}

export async function* chatStream(
  messages: WebLLMMessage[],
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<string> {
  if (!engine) {
    throw new Error("WebLLM not initialized. Call initWebLLM() first.");
  }
  const chunks = await engine.chat.completions.create({
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 1024,
    stream: true,
  });
  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta?.content || "";
    if (delta) yield delta;
  }
}

export function isEngineLoaded(): boolean {
  return engine !== null;
}

// Smart provider selection - try client first, then server fallback
export async function smartChat(
  messages: WebLLMMessage[],
  options?: { temperature?: number; maxTokens?: number; onProgress?: (s: string) => void }
): Promise<{ text: string; provider: string }> {
  // Try WebLLM first if supported and initialized
  if (isWebLLMSupported()) {
    try {
      if (!engine && !loadingPromise) {
        options?.onProgress?.("Loading WebLLM model...");
        await initWebLLM((p, t) => options?.onProgress?.(`${t} (${p}%)`));
      }
      options?.onProgress?.("Generating with WebLLM...");
      const text = await chat(messages, options);
      return { text, provider: "webllm" };
    } catch (e) {
      console.warn("[smartChat] WebLLM failed, falling back to server:", e);
      options?.onProgress?.("WebLLM failed, using server...");
    }
  }

  // Fallback to /api/ai/chat (which has its own Groq → Qwen fallback)
  options?.onProgress?.("Calling server API...");
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`Server API ${res.status}`);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    provider: data.provider || "server",
  };
}
