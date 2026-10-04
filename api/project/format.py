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
        lines.append(line[:leading].expandtabs(4) + line[leading:].rstrip())
    if tabs:
        changes.append("Tabulações convertidas em quatro espaços.")
    source = "\n".join(lines).strip("\n")
    return (source + "\n" if source else ""), list(dict.fromkeys(changes))


def fix_literals(source: str):
    changes, edits = [], []
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError):
        return source, changes
    aliases = {"true": "True", "false": "False", "null": "None"}
    for token in tokens:
        if token.type == tokenize.NAME and token.string in aliases:
            edits.append((*token.start, *token.end, aliases[token.string]))
    if edits:
        source = apply_positions(source, edits)
        changes.append("Literais true, false e null convertidos para Python.")
    return source, changes


def add_colons(source: str):
    lines, changed = source.splitlines(), 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.endswith(":"):
            continue
        if stripped.lower().startswith(BLOCK_PREFIXES) and not re.search(r"[\[{(]$", stripped):
            statement, marker, comment = line.partition(" #")
            lines[index] = statement.rstrip() + ":" + (marker + comment if marker else "")
            changed += 1
    output = "\n".join(lines) + ("\n" if source.endswith("\n") else "")
    return output, ([f"{changed} dois-pontos ausente(s) adicionado(s)."] if changed else [])


def repair_indentation(source: str):
    repaired, expected, previous, changed = [], False, 0, 0
    for line in source.splitlines():
        if not line.strip():
            repaired.append("")
            continue
        stripped = line.lstrip()
        original = len(line) - len(stripped)
        indent = original - original % 4
        branch = stripped.lower().startswith(BRANCH_PREFIXES)
        if branch and indent >= previous and previous >= 4:
            indent = previous - 4
        elif expected and indent <= previous and not branch:
            indent = previous + 4
        changed += indent != original
        repaired.append(" " * max(0, indent) + stripped)
        previous = max(0, indent)
        expected = stripped.rstrip().endswith(":")
    output = "\n".join(repaired) + ("\n" if source.endswith("\n") else "")
    return output, ([f"Indentação corrigida em {changed} linha(s)."] if changed else [])


def catalog_maps(catalog):
    modules, classes = {}, {}
    for module, details in catalog["modules"].items():
        modules[module] = set(details.get("functions", {})) | set(details.get("classes", {}))
        classes.update(details.get("classes", {}))
    return modules, classes


def nearest(value: str, options: set[str]):
    if value in options or len(value) < 3:
        return None
    matches = get_close_matches(value, sorted(options), n=1, cutoff=0.84)
    return matches[0] if matches else None


def correct_pybricks(source: str, tree: ast.Module, catalog):
    modules, classes = catalog_maps(catalog)
    components = {name: set(values) for name, values in catalog.get("componentTypes", {}).items()}
    variables, imports, edits, changes = {}, {}, [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in modules:
            for alias in node.names:
                replacement = nearest(alias.name, modules[node.module])
                if replacement:
                    edits.append((alias.lineno, alias.col_offset, alias.lineno, alias.col_offset + len(alias.name), replacement))
                    changes.append(f"Import Pybricks: {alias.name} → {replacement}.")
                else:
                    imports[alias.asname or alias.name] = alias.name
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) and node.targets else node.target
            value = node.value
            if isinstance(target, ast.Name) and isinstance(value, ast.Call) and isinstance(value.func, ast.Name):
                class_name = imports.get(value.func.id, value.func.id)
                if class_name in classes:
                    variables[target.id] = class_name
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        options = None
        if isinstance(node.value, ast.Name):
            owner = node.value.id
            if owner in variables:
                info = classes[variables[owner]]
                options = set(info.get("methods", [])) | set(info.get("properties", []))
            elif owner in {"hub", "prime_hub", "inventor_hub"}:
                options = {"battery", "ble", "buttons", "display", "imu", "light", "speaker", "system"}
            elif owner in classes:
                options = set(classes[owner].get("constants", []))
        elif isinstance(node.value, ast.Attribute):
            options = components.get(node.value.attr)
        replacement = nearest(node.attr, options) if options else None
        if replacement:
            line, end = node.end_lineno or node.lineno, node.end_col_offset or 0
            edits.append((line, end - len(node.attr), line, end, replacement))
            changes.append(f"API Pybricks: {node.attr} → {replacement}.")
    return (apply_positions(source, edits), changes) if edits else (source, [])


def format_python(source: str):
    original = source
    source, changes = normalize(source)
    source, current = fix_literals(source)
    changes.extend(current)
    tree, error = syntax(source)
    if tree is None:
        source, current = add_colons(source)
        changes.extend(current)
        tree, error = syntax(source)
    if tree is None and error and any(word in error["message"].lower() for word in ("indent", "unindent", "expected an indented block")):
        source, current = repair_indentation(source)
        changes.extend(current)
        tree, error = syntax(source)
    if tree is not None:
        source, current = correct_pybricks(source, tree, load_catalog())
        changes.extend(current)
        tree, error = syntax(source)
    return {"ok": True, "code": source, "changed": source != original, "changes": list(dict.fromkeys(changes)), "valid": tree is not None, "error": error}


def handler_payload(data):
    code = data.get("code", "")
    if not isinstance(code, str):
        return {"ok": False, "error": "Código inválido."}
    if len(code) > 500_000:
        return {"ok": False, "error": "O arquivo excede 500 KB."}
    return format_python(code)


class handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size) or b"{}")
            result = handler_payload(data)
            self.send_json(200 if result.get("ok") else 400, result)
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": f"Não foi possível corrigir: {exc}"})
