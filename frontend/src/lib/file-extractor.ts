/**
 * Client-side file text extraction — NO API calls, everything runs in browser.
 * Supports: TXT (native), PDF (pdf.js from CDN).
 */

export type ExtractableType = 'pdf' | 'docx' | 'pptx' | 'txt' | 'other';

function detectFileType(file: File): ExtractableType {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = file.type;
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'pptx' || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (ext === 'txt' || mime === 'text/plain' || mime === 'text/csv') return 'txt';
  if (ext === 'md' || ext === 'json' || ext === 'csv' || ext === 'html' || ext === 'htm') return 'txt';
  return 'other';
}

/** Read file as ArrayBuffer */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsArrayBuffer(file);
  });
}

/** Read file as text (for TXT, MD, CSV, JSON, HTML) */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsText(file, 'utf-8');
  });
}

/** Load pdf.js from CDN if not already loaded */
async function loadPdfJs(): Promise<any> {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const lib = (window as any).pdfjsLib;
      if (lib) {
        lib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(lib);
      } else {
        reject(new Error('pdf.js gagal dimuat'));
      }
    };
    script.onerror = () => reject(new Error('Gagal memuat pdf.js dari CDN'));
    document.head.appendChild(script);
  });
}

/** Extract text from PDF using pdf.js */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();
  const data = await readFileAsArrayBuffer(file);
  const pdf = await pdfjs.getDocument({ data }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (pageText) pages.push(pageText);
  }

  return pages.join('\n\n');
}

/** Extract text from DOCX using mammoth.js from CDN */
async function loadMammoth(): Promise<any> {
  if ((window as any).mammoth) return (window as any).mammoth;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    script.onload = () => {
      if ((window as any).mammoth) resolve((window as any).mammoth);
      else reject(new Error('mammoth.js gagal dimuat'));
    };
    script.onerror = () => reject(new Error('Gagal memuat mammoth.js dari CDN'));
    document.head.appendChild(script);
  });
}

/** Extract text from DOCX */
async function extractDocxText(file: File): Promise<string> {
  const mammoth = await loadMammoth();
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

/** Extract text from PPTX — basic XML text extraction via JSZip */
async function extractPptxText(file: File): Promise<string> {
  // Load JSZip from CDN
  if (!(window as any).JSZip) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Gagal memuat JSZip'));
      document.head.appendChild(script);
    });
  }

  const JSZip = (window as any).JSZip;
  const data = await readFileAsArrayBuffer(file);
  const zip = await JSZip.loadAsync(data);

  const slides: string[] = [];
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.match(/ppt\/slides\/slide\d+\.xml$/))
    .sort();

  for (const fileName of slideFiles) {
    const xml = await zip.files[fileName].async('text');
    // Extract text from <a:t> tags
    const texts: string[] = [];
    const regex = /<a:t>([^<]*)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      if (match[1].trim()) texts.push(match[1].trim());
    }
    if (texts.length > 0) {
      slides.push(`--- Slide ${slides.length + 1} ---\n${texts.join(' ')}`);
    }
  }

  return slides.join('\n\n');
}

/**
 * Main extraction function — detects file type and extracts text.
 * Returns extracted text string.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const type = detectFileType(file);

  switch (type) {
    case 'txt':
      return readFileAsText(file);
    case 'pdf':
      return extractPdfText(file);
    case 'docx':
      return extractDocxText(file);
    case 'pptx':
      return extractPptxText(file);
    default:
      // Try reading as text as fallback
      try {
        return await readFileAsText(file);
      } catch {
        throw new Error(`Format file '${file.name.split('.').pop()}' belum didukung. Gunakan PDF, DOCX, PPTX, atau TXT.`);
      }
  }
}

export { detectFileType };
