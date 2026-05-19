from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(r"E:\GitHub\Plan-Forge\pforge-mcp")
SERVER = ROOT / "server.mjs"


def read_server() -> str:
    return SERVER.read_text(encoding="utf-8")


def write_server(text: str) -> None:
    SERVER.write_text(text, encoding="utf-8", newline="\n")


def extract_block(text: str, start_marker: str, end_marker: str) -> tuple[str, str]:
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[start:end], text[:start] + text[end:]


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise RuntimeError(f"Pattern not found: {old[:80]}")
    return text.replace(old, new, 1)


def s0() -> None:
    text = read_server()
    start = text.index('  // REST API: POST /api/tool/:name — invoke forge tool\n')
    end = text.index('  app.post("/api/tool/:name", async (req, res) => {', start)
    block = text[start:end]
    hoisted = block.replace('  ', '', 1).replace('\n  ', '\n')
    text = text[:start] + text[end:]
    banner = '// ─── Express App + REST API  ─────────────────────────────\n'
    text = replace_once(text, banner, hoisted + '\n' + banner)
    start_banner = '\n// ─── Start ────────────────────────────────────────────────────────────\n'
    surface = '''
export function buildServerSurface() {
  const tools = [...TOOLS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

  const restRoutes = Array.from(
    createExpressApp
      .toString()
      .matchAll(/app\.(get|post|put|delete|patch)\(\s*["'`](.*?) ["'`]/g),
    ([, method, path]) => ({ method: method.toUpperCase(), path }),
  ).sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));

  return {
    tools,
    restRoutes,
    mcpOnlyTools: [...MCP_ONLY_TOOLS].sort(),
  };
}
'''
    # fix regex literal after triple-quote escaping
    surface = surface.replace('(.*?) ["\'`]', '([^"\'`]+)["\'`]')
    text = replace_once(text, start_banner, '\n' + surface + start_banner)
    write_server(text)


if __name__ == '__main__':
    getattr(sys.modules[__name__], sys.argv[1])()
