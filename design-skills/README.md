# design-skills — perkakas audit anti-slop alynne.edu

Dipakai sesuai `frontend/DESIGN.md` §8: scan sebelum & sesudah setiap
perubahan UI. Target: P0 = 0 (avoid-ai-design).

| Folder | Sumber | Fungsi |
|---|---|---|
| `kill-ai-slop/` | github.com/yetone/kill-ai-slop | scanner 35 tells (MIT) |
| `avoid-ai-design/` | github.com/funboy322/avoid-ai-design | scanner P0/P1/P2 (MIT) |

```bash
node design-skills/kill-ai-slop/skill/scripts/scan.mjs frontend/src
node design-skills/avoid-ai-design/scripts/detect.mjs frontend/src
```

Skill lain yang jadi rujukan kontrak (tidak disimpan di sini):
- taste-skill (Leonxlnx/taste-skill) — aturan art direction & app-screens
- hallmark (Nutlope/hallmark) — lantai non-negotiable
- zero-slop (Eid0lon/zero-slop), frontend-design (anthropics/claude-plugins-official)
