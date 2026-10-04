"""Validação sintática real usando a AST nativa do Python.

Na Vercel, este arquivo é publicado como /api/validate. O código nunca é
executado: ast.parse() apenas cria a árvore sintática.
"""
from http.server import BaseHTTPRequestHandler
import ast
import json


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 500_000:
                return self._send(413, {"valid": False, "error": {"line": 1, "offset": 1, "message": "O arquivo excede 500 KB."}})
            data = json.loads(self.rfile.read(size) or b"{}")
            code = data.get("code", "")
            if not isinstance(code, str):
                return self._send(400, {"valid": False, "error": {"line": 1, "offset": 1, "message": "Código inválido."}})
            ast.parse(code, filename="saida.py", mode="exec")
            self._send(200, {"valid": True, "error": None})
        except SyntaxError as exc:
            self._send(200, {
                "valid": False,
                "error": {
                    "line": exc.lineno or 1,
                    "endLine": exc.end_lineno or exc.lineno or 1,
                    "offset": exc.offset or 1,
                    "endOffset": exc.end_offset or exc.offset or 1,
                    "message": self._friendly(exc.msg),
                    "technical": exc.msg,
                },
            })
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send(400, {"valid": False, "error": {"line": 1, "offset": 1, "message": "Requisição inválida."}})
        except Exception:
            self._send(500, {"valid": False, "error": {"line": 1, "offset": 1, "message": "Não foi possível analisar o código."}})

    @staticmethod
    def _friendly(message: str) -> str:
        text = message.lower()
        translations = [
            ("expected ':'", "Falta “:” no final da instrução."),
            ("unexpected indent", "Esta linha tem uma indentação inesperada."),
            ("unindent does not match", "A indentação desta linha não corresponde ao bloco anterior."),
            ("was never closed", "Há um parêntese, colchete ou chave que não foi fechado."),
            ("unterminated string", "O texto entre aspas não foi fechado."),
            ("invalid syntax", "A instrução está incompleta ou foi escrita em uma ordem inválida."),
            ("expected an indented block", "Adicione uma linha indentada dentro deste bloco."),
        ]
        for needle, translated in translations:
            if needle in text:
                return translated
        return f"Erro de sintaxe: {message}"
