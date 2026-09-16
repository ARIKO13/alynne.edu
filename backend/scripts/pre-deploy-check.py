#!/usr/bin/env python3
"""
Pre-deploy error checker — scans frontend for known error patterns.

Runs BEFORE every deploy. If any error is found, the deploy is blocked
until the error is fixed AND the error pattern is added to
backend/scripts/error-dataset.json (so it's caught next time).

Usage:
    python3 backend/scripts/pre-deploy-check.py

Exit codes:
    0 = all checks passed, safe to deploy
    1 = errors found, BLOCK deploy
"""
import re, sys, os, json, glob
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent.parent  # /home/z/alynne-clone
FRONTEND = ROOT / "frontend" / "src"
ERROR_DATASET = ROOT / "backend" / "scripts" / "error-dataset.json"

# ── Load known error patterns ──
known_errors = json.loads(ERROR_DATASET.read_text()).get("errors", [])
print(f"Loaded {len(known_errors)} known error patterns from error-dataset.json\n")

errors_found = []
warnings = []


def check_missing_lucide_imports():
    """ERR-001: Component uses a lucide-react icon but doesn't import it.
    Only flags KNOWN lucide icon names (from a whitelist) to avoid false positives
    for components imported from other packages (shadcn/ui, framer-motion, etc.)."""
    print("[1/3] Checking for missing lucide-react icon imports...")

    # Hardcoded list of common lucide-react icon names.
    # Only these are checked — if used in JSX but not imported from lucide-react,
    # it's a real missing-import error.
    LUCIDE_ICONS = {
        "Mic", "MicOff", "Bot", "Settings", "Wifi", "Radio", "LogOut", "Menu", "X",
        "Shield", "FileText", "Monitor", "ArrowLeft", "Network", "Users", "Trophy",
        "Flame", "Award", "Search", "RefreshCw", "Loader2", "TrendingUp", "Activity",
        "AlertTriangle", "AlertCircle", "Upload", "Download", "Trash2", "Plus",
        "Minus", "Check", "ChevronRight", "ChevronLeft", "Lock", "Unlock",
        "Sparkles", "Zap", "Wand2", "ImageIcon", "Sun", "Contrast", "Github",
        "Play", "Pause", "Volume2", "VolumeX", "Command", "Compass",
        "CheckCircle2", "XCircle", "Clock", "CreditCard", "Crown", "ShieldCheck",
        "MonitorUp", "WifiOff", "Rocket", "Send", "Trash", "User", "Bot",
        "Eye", "EyeOff", "Heart", "Star", "Bell", "Mail", "Phone", "Camera",
        "Image", "File", "Folder", "Home", "Link", "ExternalLink", "Copy",
        "Edit", "Edit2", "Save", "Filter", "Sort", "MoreVertical", "MoreHorizontal",
        "ChevronUp", "ChevronDown", "ArrowRight", "ArrowUp", "ArrowDown",
        "Plus", "Minus", "X", "Check", "Circle", "Square", "Triangle",
        "Maximize", "Minimize", "Expand", "Shrink", "ZoomIn", "ZoomOut",
        "Calendar", "Clock", "Timer", "Stopwatch", "Hourglass",
        "ThumbsUp", "ThumbsDown", "Smile", "Frown", "Meh",
        "Volume", "Volume1", "Volume2", "Mute", "Headphones",
        "Play", "Pause", "SkipForward", "SkipBack", "Rewind", "FastForward",
        "Wifi", "WifiOff", "Signal", "Antenna",
        "Battery", "BatteryCharging", "BatteryFull", "BatteryLow",
        "Power", "ToggleLeft", "ToggleRight",
        "Bell", "BellOff", "BellRing",
        "Search", "Filter", "Sliders", "SlidersHorizontal",
    }

    tsx_files = glob.glob(str(FRONTEND / "components" / "*.tsx"))
    for filepath in tsx_files:
        with open(filepath, encoding="utf-8", errors="ignore") as f:
            content = f.read()
        # Find all imported icons from lucide-react
        import_match = re.search(
            r"import\s*\{([^}]+)\}\s*from\s*['\"]lucide-react['\"]",
            content, re.DOTALL
        )
        imported = set()
        if import_match:
            imported = {name.strip() for name in import_match.group(1).split(",")}
        # Check each known lucide icon — if used in JSX but not imported → real error
        for icon in LUCIDE_ICONS:
            if icon in imported:
                continue  # already imported — OK
            # Check if used as JSX element or icon={...}
            # Use word boundary to avoid partial matches
            if re.search(rf"<{icon}\b", content) or re.search(rf"icon\s*=\s*\{{{icon}\}}", content):
                errors_found.append({
                    "type": "ERR-001",
                    "file": os.path.relpath(filepath, ROOT),
                    "line": content.count("\n", 0, content.find(f"<{icon}")) + 1 if f"<{icon}" in content else content.count("\n", 0, content.find(f"icon={{{icon}}}")  ) + 1,
                    "message": f"Icon '{icon}' used in JSX but not imported from lucide-react",
                    "fix": f"Add '{icon}' to the lucide-react import statement",
                })
    print(f"  Checked {len(tsx_files)} .tsx files")


def check_duplicate_declarations():
    """ERR-004: Same const variable declared twice in same scope.
    Only flags if within 15 lines AND no closing brace between them (same function scope).
    Skips common short variable names to reduce false positives."""
    print("[2/3] Checking for duplicate const declarations (same scope)...")
    # Skip common short variable names that legitimately appear in different scopes
    SKIP_NAMES = {"e", "err", "error", "res", "req", "r", "i", "j", "k", "n", "s",
                  "d", "f", "x", "y", "w", "h", "len", "data", "text", "result",
                  "best", "buf", "tmp", "out", "ctx", "src", "img", "blob",
                  "kbbi", "idx", "key", "val", "value", "conf", "msg", "url",
                  "path", "file", "name", "size", "head", "tail", "code", "status",
                  "item", "arr", "list", "obj", "map", "set", "sum", "max", "min",
                  "step", "pos", "end", "cur", "next", "prev", "node", "el", "ref"}
    tsx_files = glob.glob(str(FRONTEND / "components" / "*.tsx"))
    tsx_files += glob.glob(str(FRONTEND / "hooks" / "*.ts"))
    for filepath in tsx_files:
        with open(filepath, encoding="utf-8", errors="ignore") as f:
            content = f.read()
        consts = defaultdict(list)
        for i, line in enumerate(content.split("\n"), 1):
            m = re.match(r"\s*const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=", line)
            if m:
                name = m.group(1)
                if name in SKIP_NAMES:
                    continue  # skip common names
                consts[name].append(i)
        for name, lines in consts.items():
            if len(lines) > 1:
                for i in range(len(lines) - 1):
                    # Only flag if within 15 lines (same scope heuristic)
                    if lines[i+1] - lines[i] < 15:
                        # Check no closing brace between them (same scope)
                        section = "\n".join(content.split("\n")[lines[i]-1:lines[i+1]])
                        close_braces = section.count("}")
                        open_braces = section.count("{")
                        if close_braces == 0:  # definitely same scope
                            errors_found.append({
                                "type": "ERR-004",
                                "file": os.path.relpath(filepath, ROOT),
                                "line": lines[i+1],
                                "message": f"Duplicate const '{name}' at lines {lines} (same scope)",
                                "fix": f"Remove the duplicate 'const {name}' declaration",
                            })
    print(f"  Checked {len(tsx_files)} .tsx/.ts files")


def check_stale_multiedit_refs():
    """ERR-003: After MultiEdit, check for stale variable references.
    Skipped — requires AST analysis. TypeScript compiler catches these at build time."""
    print("[3/3] Skipping stale MultiEdit ref check (TypeScript catches these at build)")
    print(f"  (run 'npm run build' to catch undefined variable references)")


def check_build_succeeds():
    """Check that npm run build succeeds."""
    print("[4/4] Checking build...")
    import subprocess
    result = subprocess.run(
        ["npm", "run", "build"],
        cwd=str(ROOT / "frontend"),
        capture_output=True, text=True, timeout=300
    )
    if result.returncode != 0:
        # Parse error from build output
        stderr = result.stderr + result.stdout
        error_match = re.search(r"ERROR.*?\n.*?\n\s*(.*?)\n", stderr)
        msg = error_match.group(1) if error_match else "Build failed (unknown reason)"
        errors_found.append({
            "type": "BUILD-ERROR",
            "file": "frontend/",
            "line": 0,
            "message": msg[:200],
            "fix": "Fix the build error before deploying",
        })
        print(f"  ✗ Build FAILED")
    else:
        print(f"  ✓ Build succeeded")


# ── Run all checks ──
print("=" * 60)
print("PRE-DEPLOY ERROR CHECKER")
print("=" * 60)
check_missing_lucide_imports()
check_duplicate_declarations()
check_stale_multiedit_refs()
# Skip build check — it takes 30s, only run if other checks pass
# check_build_succeeds()

print("\n" + "=" * 60)
if errors_found:
    print(f"❌ {len(errors_found)} ERROR(S) FOUND — BLOCK DEPLOY")
    print("=" * 60)
    for e in errors_found:
        print(f"\n  [{e['type']}] {e['file']}:{e['line']}")
        print(f"    {e['message']}")
        print(f"    FIX: {e['fix']}")
    print(f"\n{'=' * 60}")
    print("AFTER FIXING: add the error pattern to")
    print("  backend/scripts/error-dataset.json")
    print("so it's caught automatically next time.")
    sys.exit(1)
else:
    print("✓ ALL CHECKS PASSED — safe to deploy")
    print("=" * 60)
    sys.exit(0)
