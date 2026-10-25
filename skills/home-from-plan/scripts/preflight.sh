#!/usr/bin/env bash
# What the home-from-plan skill can use on this machine. Prints one line per requirement; never installs anything.
cd "$(dirname "$0")/../../.." || exit 1
ok() { printf '  ✓ %s\n' "$1"; }; no() { printf '  ✗ %s — %s\n' "$1" "$2"; }
echo "home-from-plan preflight"
command -v node >/dev/null && ok "node $(node --version)" || no node "install Node.js ≥ 22.12"
[ -d node_modules ] && ok "node_modules" || no "node_modules" "run: npm install"
PY=.venv/bin/python; [ -x "$PY" ] || PY=python3
if "$PY" -c 'import PIL, numpy' 2>/dev/null; then ok "python image tools ($PY)"; else no "python image tools" "python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt (only for plan images, PDF and CAD)"; fi
"$PY" -c 'import ezdxf, shapely' 2>/dev/null && ok "python CAD tools (ezdxf, shapely)" || no "python CAD tools" "pip install -r tools/requirements.txt (only for DXF / DWG)"
command -v pdftotext >/dev/null && ok "poppler (pdftotext, pdftocairo)" || no "poppler" "apt install poppler-utils / brew install poppler (only for PDF sheets)"
[ -n "$ODA_FILE_CONVERTER" ] || ls ~/.local/opt/oda* >/dev/null 2>&1 || command -v ODAFileConverter >/dev/null && ok "ODA File Converter" || no "ODA File Converter" "only for DWG: install it and set ODA_FILE_CONVERTER"
command -v google-chrome >/dev/null || command -v chromium >/dev/null || [ -n "$CHROME" ] && ok "Chrome / Chromium (previews)" || no "Chrome" "install Chrome or set CHROME=/path/to/chrome (needed by npm run project:preview)"
