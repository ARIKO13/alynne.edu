/**
 * YouTubeTranscript - Input YouTube URL → get transcript instantly
 * No whisper, no LLM - just YouTube captions API
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Youtube, Loader2, AlertCircle, CheckCircle2, Trash2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface YouTubeTranscriptProps {
  onTranscript: (text: string, meta: { duration: number; segments: number; videoId: string }) => void;
  disabled?: boolean;
}

export function YouTubeTranscript({ onTranscript, disabled }: YouTubeTranscriptProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ videoId: string; duration_min: number; segments: number; chars: number } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || disabled || loading) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/youtube/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Gagal mengambil transkrip");
        return;
      }

      if (data.text) {
        onTranscript(data.text, {
          duration: data.duration || 0,
          segments: data.segments || 0,
          videoId: data.videoId,
        });
        setResult({
          videoId: data.videoId,
          duration_min: data.duration_min || 0,
          segments: data.segments || 0,
          chars: data.text.length,
        });
        toast.success(`Transkrip YouTube: ${data.text.length} karakter (${data.duration_min} menit)`);
      } else {
        toast.error("Tidak ada teks transkrip");
      }
    } catch (e) {
      console.error("[YouTubeTranscript] Error:", e);
      toast.error("Gagal mengambil transkrip. Cek URL YouTube.");
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setUrl("");
    setResult(null);
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Youtube className="h-4 w-4 text-red-500" />
        <p className="text-sm font-medium text-zinc-200">YouTube Transkrip</p>
        <span className="text-[10px] text-zinc-600 ml-auto">Instant • No processing</span>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube URL..."
            disabled={disabled || loading}
            className={cn(
              "w-full rounded-lg border border-white/[0.08] bg-white/[0.02] py-2 pl-9 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600",
              "focus:border-[#7C3AED]/40 focus:bg-white/[0.04] focus:outline-none",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={!url.trim() || disabled || loading}
          className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/20"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Ambil"}
        </Button>
      </form>

      {result && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.03] p-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-emerald-300/80">
              {result.chars} karakter • {result.duration_min} menit • {result.segments} segmen
            </p>
          </div>
          <button onClick={clear} className="text-zinc-600 hover:text-red-400">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      <p className="text-[9px] text-zinc-600 leading-relaxed">
        Hanya untuk video yang memiliki subtitle/caption. Untuk video lebih dari 30 menit, gunakan ini sebagai pengganti upload file.
      </p>
    </div>
  );
}
