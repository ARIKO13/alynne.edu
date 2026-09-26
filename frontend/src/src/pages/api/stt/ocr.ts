import type { APIRoute } from 'astro';

const GATEWAY_BASE = 'https://gateway.polyvorlabs.com';
const OCR_SYSTEM_PROMPT = `Extract ALL text visible in this screen capture image. Rules:
1. Extract every single word/line of text you can see
2. Keep the original language (Indonesian, English, etc.)
3. Do NOT summarize, paraphrase, or add any text
4. Do NOT add bullet points or formatting unless it appears in the image
5. If there is no readable text, respond with exactly: NO_TEXT
6. Output ONLY the extracted text, nothing else`;

function extractTextFromResponse(raw: string): string {
  const cleaned = raw.replace(/^[\uFEFF]+/, '').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  let data: any;
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    data = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
  } else {
    data = JSON.parse(cleaned);
  }
  return (data.choices?.[0]?.message?.content || data.response || data.content || data.text || '').trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();
}

// ── Gateway helper ──
async function ocrViaGatewayModel(image: string, gatewayKey: string, model: string): Promise<string | null> {
  try {
    const res = await fetch(`${GATEWAY_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: [
            { type: 'text', text: OCR_SYSTEM_PROMPT },
            { type: 'image_url', image_url: { url: image } },
          ]},
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });
    if (!res.ok) {
      console.error(`OCR Gateway [${model}] error:`, res.status);
      return null;
    }
    const text = extractTextFromResponse(await res.text());
    if (!text || text === 'NO_TEXT') return '';
    return text;
  } catch (e) {
    console.error(`OCR Gateway [${model}] exception:`, e);
    return null;
  }
}


export const POST: APIRoute = async ({ request }) => {
  try {
    const { image } = await request.json();
    if (!image) {
      return Response.json({ error: 'Image data is required' }, { status: 400 });
    }

    let text: string | null = null;
    let source = '';

    // 1) Try Gateway models in order of reliability
    const gatewayKey = process.env.GATEWAY_API_KEY;
    if (gatewayKey) {
      for (const model of ['th/gemini-3.7-flash', 'th/mimo-v2.5:free', 'vy/nemotron-vision']) {
        text = await ocrViaGatewayModel(image, gatewayKey, model);
        if (text !== null) { source = `gateway:${model}`; break; }
      }
    }

    if (text === null) {
      return Response.json({ error: 'No OCR API available' }, { status: 500 });
    }

    console.log(`OCR success via ${source}: ${text.slice(0, 60)}...`);
    return Response.json({ text: text || '' });
  } catch (error) {
    console.error('OCR route error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
};
