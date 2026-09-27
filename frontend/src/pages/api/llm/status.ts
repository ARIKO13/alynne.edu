import type { APIRoute } from 'astro';

export const GET: APIRoute = async () => {
  const providers: any[] = [];

  // Check Groq
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'groq',
      type: 'external',
      model: 'qwen/qwen3.8-27b',
      available: true,
      latency: 'fast',
    });
  }

  // Check Qwen local
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('http://localhost:8000/llm/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      providers.push({
        name: 'qwen-local',
        type: 'local',
        model: 'qwen2.5-3b-instruct',
        available: data.available === true,
        latency: 'slow',
      });
    }
  } catch {}

  // Client-side WebLLM is always potentially available (browser-dependent)
  providers.push({
    name: 'webllm',
    type: 'client-side',
    model: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    available: 'browser-dependent',
    latency: 'fast-after-load',
    note: 'Loaded in browser, no server cost',
  });

  return Response.json({
    providers,
    recommended: providers.find(p => p.name === 'webllm')?.available === 'browser-dependent'
      ? 'webllm'
      : providers.find(p => p.name === 'groq')?.available
        ? 'groq'
        : 'qwen-local',
  });
};
