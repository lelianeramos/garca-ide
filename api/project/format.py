"""Correção conservadora de Python colado e de nomes oficiais do Pybricks."""
from __future__ import annotations

import ast
from difflib import get_close_matches
from http.server import BaseHTTPRequestHandler
import io
import json
from pathlib import Path
import re
import tokenize
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CATALOG_PATH = ROOT / "pybricks-api.json"
BLOCK_PREFIXES = (
    "if ", "elif ", "else", "for ", "while ", "def ", "async def ",
    "class ", "try", "except", "finally", "with ", "async with ",
    "match ", "case ",
)
BRANCH_PREFIXES = ("elif ", "else", "except", "finally", "case ")


def load_catalog() -> dict[str, Any]:
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def syntax(source: str):
    try:
        return ast.parse(source), None
    except SyntaxError as exc:
        return None, {"line": exc.lineno or 1, "column": exc.offset or 1, "message": exc.msg}


def apply_positions(source: str, edits: list[tuple[int, int, int, int, str]]) -> str:
    lines = source.splitlines(keepends=True)
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line))
    replacements = []
    for sl, sc, el, ec, value in edits:
        replacements.append((offsets[sl - 1] + sc, offsets[el - 1] + ec, value))
    for start, end, value in sorted(replacements, reverse=True):
        source = source[:start] + value + source[end:]
    return source


def normalize(source: str):
    changes = []
    source = source.replace("\r\n", "\n").replace("\r", "\n")
    for old, new in {"“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "\u00a0": " ", "\u200b": ""}.items():
        if old in source:
            source = source.replace(old, new)
            changes.append("Caracteres tipográficos convertidos para Python.")
    lines, tabs = [], False
    for line in source.split("\n"):
        leading = len(line) - len(line.lstrip(" \t"))
        tabs |= "\t" in line[:leading]
        lines.aame: path.replace(/^\//, "").replace(/\.py$/, "").replaceAll("/", "."),
    content, blocks: [], symbols: [], imports: [], dependencies: [], checksum: "",
    modified: false, gitStatus: "novo", diagnostics: [] };
}
