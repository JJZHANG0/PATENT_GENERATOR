#!/bin/zsh
set -e
cd -- "${0:A:h}"
printf '康莱德工坊 · 本机 Codex 模式\n'
if [[ ! -x .local-codex-venv/bin/python ]]; then
  python3 -m venv .local-codex-venv
fi
if ! .local-codex-venv/bin/python -c 'import pymupdf' 2>/dev/null; then
  printf '首次启动：正在安装 PDF 读取组件…\n'
  .local-codex-venv/bin/python -m pip install -r scripts/local-codex-requirements.txt
fi
if curl --silent --max-time 1 http://127.0.0.1:8765/ | /usr/bin/grep -q 'PATENT_LOCAL_CODEX'; then
  open 'http://127.0.0.1:8765/'
  exit 0
fi
exec .local-codex-venv/bin/python scripts/local_codex.py --open-browser
