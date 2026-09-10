import { useAppStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  FileText,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function ModeSelector() {
  const {
    transcript,
    selectedMode,
    setSelectedMode,
    generatedContent,
    setGeneratedContent,
    isGenerating,
    setIsGenerating,
    selectedModel,
    addAiMessage,
  } = useAppStore();

  const [copied, setCopied] = useState(false);

  const hasTranscript = transcript.trim().length > 0;

  const handleGenerate = async (mode: 'pdf') => {
    if (!hasTranscript) return;

    setSelectedMode(mode);
    setIsGenerating(true);
    setGeneratedContent('');

    const systemPrompt = `Kamu adalah ahli pembuatan modul pembelajaran PDF. Berdasarkan transkrip yang diberikan, buatlah modul pembelajaran yang terstruktur dengan format markdown. Modul harus mencakup:
1. Judul Modul
2. Tujuan Pembelajaran
3. Materi Utama (dibagi sub-bab)
4. Ringkasan
5. Latihan Soal

Gunakan format markdown yang rapi dan terstruktur.`;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: `Berikut transkrip yang perlu diproses:\n\n${transcript}` },
          ],
          model: selectedModel,
          systemPrompt,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setGeneratedContent(data.content);
      addAiMessage({
        role: 'assistant',
        content: data.content,
        model: selectedModel,
      });
      toast.success('Modul PDF berhasil dibuat!');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Gagal generate konten';
      toast.error(msg);
      setGeneratedContent(`Error: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedContent) return;
    await navigator.clipboard.writeText(generatedContent);
    setCopied(true);
    toast.success('Disalin ke clipboard!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setSelectedMode(null);
    setGeneratedContent('');
  };

  return (
    <div className="space-y-4">
      {/* Mode Selection - shown when transcript exists and no mode selected yet */}
      {!selectedMode && !generatedContent && (
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">
              Pilih Mode Output
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasTranscript ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <ArrowRight className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Transkrip dulu audio kamu di tab Speech to Text
                </p>
              </div>
            ) : (
              <div className="flex justify-center">
                <button
                  onClick={() => handleGenerate('pdf')}
                  className="group relative flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-muted-foreground/25 p-6 px-12 transition-all hover:border-violet-300 hover:bg-emerald-50/50 hover:shadow-md"
                >
                  <div className="rounded-full bg-emerald-100 p-3 transition-colors group-hover:bg-emerald-200">
                    <FileText className="h-6 w-6 text-violet-500" />
                  </div>
                  <div className="text-center">
                    <h3 className="font-semibold">Modul PDF</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Buat modul pembelajaran terstruktur dari transkrip
                    </p>
                  </div>
                  <Sparkles className="absolute top-3 right-3 h-4 w-4 text-violet-300 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Generated Content Display */}
      {(selectedMode || generatedContent) && (
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-violet-500" />
                <CardTitle className="text-lg font-semibold">
                  Modul Pembelajaran
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleCopy}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  disabled={!generatedContent || isGenerating}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  onClick={handleReset}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  disabled={isGenerating}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Sedang membuat modul pembelajaran...
                </p>
              </div>
            ) : generatedContent ? (
              <ScrollArea className="h-[400px]">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <GeneratedMarkdown content={generatedContent} />
                </div>
              </ScrollArea>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Simple markdown renderer component
function GeneratedMarkdown({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="mt-4 mb-2 text-base font-semibold">
          {line.slice(4)}
        </h3>
      );
      i++;
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="mt-5 mb-2 text-lg font-semibold">
          {line.slice(3)}
        </h2>
      );
      i++;
    } else if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="mt-4 mb-2 text-xl font-bold">
          {line.slice(2)}
        </h1>
      );
      i++;
    }
    // List items
    else if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="ml-4 list-decimal space-y-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm">
              {renderInlineFormatting(item)}
            </li>
          ))}
        </ol>
      );
    }
    // Bullet list
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].replace(/^[-*]\s/, ''));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="ml-4 list-disc space-y-1">
          {items.map((item, j) => (
            <li key={j} className="text-sm">
              {renderInlineFormatting(item)}
            </li>
          ))}
        </ul>
      );
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
      i++;
    }
    // Paragraph
    else {
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('#') && !lines[i].match(/^\d+\.\s/) && !lines[i].startsWith('- ') && !lines[i].startsWith('* ')) {
        paraLines.push(lines[i]);
        i++;
      }
      elements.push(
        <p key={`p-${i}`} className="text-sm leading-relaxed">
          {renderInlineFormatting(paraLines.join(' '))}
        </p>
      );
    }
  }

  return <>{elements}</>;
}

function renderInlineFormatting(text: string) {
  // Handle bold **text**
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
