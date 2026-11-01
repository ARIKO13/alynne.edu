import { useAppStore } from '@/lib/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { User, Loader2, Check } from 'lucide-react';
import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, user, setUser } = useAppStore();
  const [displayName, setDisplayName] = useState(user?.name || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = displayName.trim();
    if (trimmed.length < 2) {
      toast.error('Username minimal 2 karakter');
      return;
    }
    if (trimmed.length > 30) {
      toast.error('Username maksimal 30 karakter');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/user/username', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setUser({ ...user!, name: trimmed });
        setSettingsOpen(false);
        toast.success('Username berhasil diubah!');
      }
    } catch {
      toast.error('Gagal menyimpan username');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) setDisplayName(user?.name || '');
    setSettingsOpen(open);
  }, [user, setSettingsOpen]);

  return (
    <Dialog open={settingsOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md border-white/[0.06] bg-[#161618] p-0 overflow-hidden">
        <div className="px-6 pt-6 pb-2">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-[#7C3AED]" />
              <DialogTitle className="text-zinc-100">Profil</DialogTitle>
            </div>
            <DialogDescription className="text-zinc-500">
              Nama ini akan tampil di profil, sertifikat, dan leaderboard kamu.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="display-name" className="text-sm font-medium text-zinc-300">
              Username
            </Label>
            <Input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Masukkan username kamu..."
              maxLength={30}
              className="border-white/[0.08] bg-[#111113] text-zinc-200 placeholder:text-zinc-600"
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-zinc-600">
                {displayName.trim().length}/30 karakter
              </p>
              {user?.email && (
                <p className="text-[11px] text-zinc-600">{user.email}</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-[#111113] p-3 space-y-1.5">
            <p className="text-[11px] font-medium text-zinc-400">Info</p>
            <ul className="text-[11px] text-zinc-500 space-y-0.5">
              <li>- Bisa diubah kapan saja, sebanyak apa pun</li>
              <li>- Minimal 2, maksimal 30 karakter</li>
              <li>- Hindari pakai email, NIS/NIP, atau data pribadi</li>
              <li>- Spasi dan huruf/angka diperbolehkan</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 pb-6">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="border-white/[0.08] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06]">
            Batal
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || displayName.trim().length < 2}
            className="bg-[#7C3AED] hover:bg-[#d14e1c] text-white rounded-lg gap-2 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Simpan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
