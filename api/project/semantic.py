"""Análise semântica autoritativa — AST tolerante -> IR genérica.

Endpoint (Parte 9.1):
    POST /api/project/semantic
    -> { ok, valid, partial, ir, symbols, categories, flat, diagnostics }

Regras:
    S08 — ast.parse() apenas ANALISA; o código do usuário nunca é executado.
    9.4 — parser tolerante: se o programa inteiro falha, divide em unidades de
          nível superior e analisa cada uma isoladamente. As unidades válidas
          entram na IR (partial=True); as inválidas viram diagnóstico com
          linha/coluna. Um erro nunca quebra a conversão inteira (B14).
    9.3 — span obrigatório em todo nó e em todo argumento.
"""
from __future__ import annotations

import ast
import json
from http.server import BaseHTTPRequestHandler

MAX_BYTES = 500_000

# Nó da IR -> nome canônico (Parte 9.2)
NODE_KIND = {
    ast.Import: "import",
    ast.ImportFrom: "importFrom",
    ast.Assign: "assignment",
    ast.AugAssign: "augmentedAssignment",
    ast.AnnAssign: "annotatedAssignment",
    ast.Name: "variableReference",
    ast.Constant: "literal",
    ast.Attribute: "attribute",
    ast.Call: "callExpression",
    ast.BinOp: "binaryOperation",
    ast.Compare: "comparison",
    ast.BoolOp: "booleanOperation",
    ast.UnaryOp: "unaryOperation",
    ast.If: "condition",
    ast.For: "loop",
    ast.While: "loop",
    ast.Break: "break",
    ast.Continue: "continue",
    ast.FunctionDef: "function",
    ast.AsyncFunctionDef: "function",
    ast.Return: "return",
    ast.Try: "tryStatement",
    ast.List: "list",
    ast.Tuple: "tuple",
    ast.Dict: "dict",
    ast.Subscript: "subscript",
    ast.With: "withStatement",
    ast.AsyncWith: "withStatement",
    ast.ClassDef: "classDefinition",
}

OPERATORS = {
    ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/", ast.FloorDiv: "//",
    ast.Mod: "%", ast.Pow: "**", ast.BitAnd: "&", ast.BitOr: "|", ast.BitXor: "^",
    ast.LShift: "<<", ast.RShift: ">>", ast.MatMult: "@",
    ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">",
    ast.GtE: ">=", ast.Is: "is", ast.IsNot: "is not", ast.In: "in", ast.NotIn: "not in",
    ast.And: "and", ast.Or: "or", ast.Not: "not", ast.USub: "-", ast.UAdd: "+",
    ast.Invert: "~",
}

# Construtores conhecidos -> tipo inferido (Parte 9.5)
KNOWN_TYPES = {
    "PrimeHub": "PrimeHub", "InventorHub": "InventorHub", "TechnicHub": "TechnicHub",
    "CityHub": "CityHub", "MoveHub": "MoveHub", "EssentialHub": "EssentialHub",
    "Motor": "Motor", "DCMotor": "DCMotor", "ColorSensor": "ColorSensor",
    "UltrasonicSensor": "UltrasonicSensor", "ForceSensor": "ForceSensor",
    "ColorDistanceSensor": "ColorDistanceSensor", "TiltSensor": "TiltSensor",
    "InfraredSensor": "InfraredSensor", "Light": "Light",
    "ColorLightMatrix": "ColorLightMatrix", "Remote": "Remote",
    "DriveBase": "DriveBase", "Car": "Car", "StopWatch": "StopWatch",
    "Matrix": "Matrix", "PUPDevice": "PUPDevice", "AnalogSensor": "AnalogSensor",
    "I2CDevice": "I2CDevice", "UARTDevice": "UARTDevice", "LWP3Device": "LWP3Device",
}


def span(node) -> dict:
    """Span obrigatório (Parte 9.3). Sem span não há patch cirúrgico."""
    return {
        "startLine": getattr(node, "lineno", 1),
        "startColumn": getattr(node, "col_offset", 0),
        "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 1)) or getattr(node, "lineno", 1),
        "endColumn": getattr(node, "end_col_offset", 0) or 0,
    }


def dotted(node) -> str:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


class IRBuilder(ast.NodeVisitor):
    def __init__(self):
        self.counter = 0
        self.flat = []

    def next_id(self) -> str:
        self.counter += 1
        return f"node_{self.counter:04d}"

    def base(self, node, node_type, **extra):
        """Cria um nó da IR.

        `node_type` é o nome canônico da Parte 9.2 ("loop", "condition"...).
        O parâmetro NÃO se chama `kind` porque `kind` é um campo de payload
        ("for"/"while"/"if") — a colisão de nomes causava
        "got multiple values for argument 'kind'".
        """
        payload = {"id": self.next_id(), "type": node_type, "source": span(node)}
        payload.update(extra)
        self.flat.append(payload)
        return payload

    def value(self, node):
        if node is None:
            return None
        method = getattr(self, f"value_{type(node).__name__}", None)
        if method:
            return method(node)
        try:
            return self.base(node, "pythonExpression", text=ast.unparse(node))
        except Exception:
            return self.base(node, "pythonExpression", text="")

    def value_Constant(self, node):
        kind = "number" if isinstance(node.value, (int, float)) and not isinstance(node.value, bool) else \
               "boolean" if isinstance(node.value, bool) else \
               "string" if isinstance(node.value, str) else \
               "none" if node.value is None else "literal"
        return self.base(node, "literal", value=node.value, literalKind=kind)

    def value_Name(self, node):
        return self.base(node, "variableReference", name=node.id)

    def value_Attribute(self, node):
        return self.base(node, "attribute", object=self.value(node.value), attribute=node.attr,
                         text=dotted(node))

    def value_Call(self, node):
        return self.base(
            node, "callExpression",
            callee=self.value(node.func),
            calleeText=dotted(node.func) if isinstance(node.func, (ast.Name, ast.Attribute)) else "",
            arguments=[self.value(arg) for arg in node.args],
            keywords=[{"name": kw.arg, "value": self.value(kw.value), "source": span(kw)} for kw in node.keywords],
        )

    def value_BinOp(self, node):
        return self.base(node, "binaryOperation", operator=OPERATORS.get(type(node.op), "?"),
                         left=self.value(node.left), right=self.value(node.right))

    def value_Compare(self, node):
        return self.base(node, "comparison", operator=OPERATORS.get(type(node.ops[0]), "?"),
                         left=self.value(node.left), right=self.value(node.comparators[0]))

    def value_BoolOp(self, node):
        return self.base(node, "booleanOperation", operator=OPERATORS.get(type(node.op), "and"),
                         left=self.value(node.values[0]),
                         right=self.value(node.values[1]) if len(node.values) > 1 else None)

    def value_UnaryOp(self, node):
        return self.base(node, "unaryOperation", operator=OPERATORS.get(type(node.op), "not"),
                         operand=self.value(node.operand))

    def value_List(self, node):
        return self.base(node, "list", items=[self.value(item) for item in node.elts])

    def value_Tuple(self, node):
        return self.base(node, "tuple", items=[self.value(item) for item in node.elts])

    def value_Dict(self, node):
        return self.base(node, "dict", entries=[
            {"key": self.value(k), "value": self.value(v)} for k, v in zip(node.keys, node.values)
        ])

    def value_Subscript(self, node):
        return self.base(node, "subscript", object=self.value(node.value), index=self.value(node.slice))

    # ---------- statements ----------

    def statement(self, node, depth=0):
        method = getattr(self, f"stmt_{type(node).__name__}", None)
        if method:
            result = method(node)
            if isinstance(result, dict):
                result["depth"] = depth
            return result
        try:
            return self.base(node, "pythonExpression", text=ast.unparse(node), depth=depth)
        except Exception:
            return self.base(node, "pythonExpression", text="", depth=depth)

    def stmt_Import(self, node):
        return self.base(node, "import", names=[
            {"name": alias.name, "alias": alias.asname, "source": span(node)} for alias in node.names
        ])

    def stmt_ImportFrom(self, node):
        return self.base(node, "importFrom", module=node.module or "", names=[
            {"name": alias.name, "alias": alias.asname, "source": span(node)} for alias in node.names
        ])

    def stmt_Assign(self, node):
        return self.base(node, "assignment",
                         targets=[self.value(target) for target in node.targets],
                         value=self.value(node.value))

    def stmt_AugAssign(self, node):
        return self.base(node, "augmentedAssignment", operator=OPERATORS.get(type(node.op), "+") + "=",
                         target=self.value(node.target), value=self.value(node.value))

    def stmt_AnnAssign(self, node):
        return self.base(node, "annotatedAssignment", target=self.value(node.target),
                         annotation=self.value(node.annotation), value=self.value(node.value))

    def stmt_Expr(self, node):
        return self.base(node, "expressionStatement", expression=self.value(node.value))

    def stmt_If(self, node):
        return self.base(node, "condition", kind="if", test=self.value(node.test),
                         block=True, body=[self.statement(child) for child in node.body],
                         elseBody=[self.statement(child) for child in node.orelse])

    def stmt_For(self, node):
        targets = [t.id for t in node.target.elts] if isinstance(node.target, ast.Tuple) else \
                  [node.target.id] if isinstance(node.target, ast.Name) else []
        return self.base(node, "loop", kind="for", targets=targets, iterable=self.value(node.iter),
                         block=True, body=[self.statement(child) for child in node.body])

    def stmt_While(self, node):
        return self.base(node, "loop", kind="while", test=self.value(node.test),
                         block=True, body=[self.statement(child) for child in node.body])

    def stmt_FunctionDef(self, node):
        return self.base(node, "function", name=node.name, block=True,
                         params=[{"name": arg.arg, "source": span(arg)} for arg in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)],
                         body=[self.statement(child) for child in node.body])

    stmt_AsyncFunctionDef = stmt_FunctionDef

    def stmt_ClassDef(self, node):
        return self.base(node, "classDefinition", name=node.name, block=True,
                         body=[self.statement(child) for child in node.body])

    def stmt_Return(self, node):
        return self.base(node, "return", value=self.value(node.value))

    def stmt_Break(self, node):
        return self.base(node, "break")

    def stmt_Continue(self, node):
        return self.base(node, "continue")

    def stmt_Pass(self, node):
        return self.base(node, "pass")

    def stmt_Raise(self, node):
        return self.base(node, "raise", value=self.value(node.exc))

    def stmt_Try(self, node):
        return self.base(node, "tryStatement", block=True,
                         body=[self.statement(child) for child in node.body],
                         handlers=[{"exception": self.value(h.type), "alias": h.name,
                                    "body": [self.statement(c) for c in h.body]} for h in node.handlers],
                         finalbody=[self.statement(child) for child in node.finalbody])

    def stmt_With(self, node):
        return self.base(node, "withStatement", block=True,
                         items=[self.value(item.context_expr) for item in node.items],
                         body=[self.statement(child) for child in node.body])

    stmt_AsyncWith = stmt_With

    def stmt_Delete(self, node):
        return self.base(node, "delete", targets=[self.value(t) for t in node.targets])

    def stmt_Global(self, node):
        return self.base(node, "global", names=list(node.names))

    def stmt_Nonlocal(self, node):
        return self.base(node, "nonlocal", names=list(node.names))


def split_top_level_units(source: str):
    """9.4: divide em unidades de nível superior (blocos de indentação zero)."""
    units = []
    current = []
    start_line = 1
    for index, line in enumerate(source.split("\n"), start=1):
        is_top = line.strip() and not line[:1].isspace()
        if is_top and current:
            units.append(("\n".join(current), start_line))
            current = []
        if not current:
            start_line = index
        if line.strip():
            current.append(line)
    if current:
        units.append(("\n".join(current), start_line))
    return units


def syntax_error_payload(error: SyntaxError, offset: int = 0) -> dict:
    return {
        "severity": "error",
        "line": (error.lineno or 1) + offset,
        "column": error.offset or 1,
        "message": error.msg or "invalid syntax",
        "code": error.msg or "invalid syntax",
    }


def analyze_source(source: str) -> dict:
    """AST tolerante -> IR + símbolos + categorias + diagnósticos."""
    builder = IRBuilder()
    diagnostics = []
    body = []
    valid = True
    partial = False

    try:
        tree = ast.parse(source)
        body = [builder.statement(node) for node in tree.body]
    except SyntaxError as error:
        valid = False
        diagnostics.append(syntax_error_payload(error))
        # 9.4: recupera o que for possível
        for unit, offset in split_top_level_units(source):
            if not unit.strip():
                continue
            try:
                unit_tree = ast.parse(unit)
            except SyntaxError as unit_error:
                diagnostics.append(syntax_error_payload(unit_error, offset - 1))
                continue
            for node in unit_tree.body:
                statement = builder.statement(node)
                # desloca os spans para a linha real no arquivo
                shift(statement, offset - 1)
                body.append(statement)
        if body:
            partial = True

    ir = {"type": "program", "body": body,
          "source": {"startLine": 1, "startColumn": 0,
                     "endLine": max(1, len(source.split("\n"))), "endColumn": 0}}

    symbols = collect_symbols(source)
    return {
        "ok": True,
        "valid": valid,
        "partial": partial or not valid and bool(body),
        "ir": ir,
        "flat": builder.flat,
        "symbols": symbols,
        "categories": dynamic_categories(source, symbols),
        "diagnostics": dedupe(diagnostics),
    }


def shift(node, delta):
    if not isinstance(node, dict) or delta == 0:
        return
    source = node.get("source")
    if isinstance(source, dict):
        source["startLine"] = source.get("startLine", 1) + delta
        source["endLine"] = source.get("endLine", source.get("startLine", 1)) + delta
    for value in node.values():
        if isinstance(value, list):
            for item in value:
                shift(item, delta)
        elif isinstance(value, dict):
            shift(value, delta)


def dedupe(diagnostics):
    seen = set()
    out = []
    for item in sorted(diagnostics, key=lambda d: (d["line"], d["column"])):
        key = (item["line"], item["column"], item["message"])
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def collect_symbols(source: str) -> dict:
    symbols = {"functions": [], "classes": [], "variables": [], "imports": [], "aliases": {}, "types": {}}
    try:
        tree = ast.parse(source)
    except SyntaxError:
        # ainda assim tenta recuperar símbolos das unidades válidas
        for unit, offset in split_top_level_units(source):
            try:
                unit_tree = ast.parse(unit)
            except SyntaxError:
                continue
            for node in ast.walk(unit_tree):
                collect_node(node, symbols, offset - 1)
        return symbols

    for node in ast.walk(tree):
        collect_node(node, symbols, 0)
    return symbols


def collect_node(node, symbols, offset=0):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        symbols["functions"].append({
            "name": node.name,
            "args": [a.arg for a in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)],
            "line": node.lineno + offset,
        })
    elif isinstance(node, ast.ClassDef):
        symbols["classes"].append({"name": node.name, "line": node.lineno + offset})
    elif isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name):
                symbols["variables"].append({"name": target.id, "line": node.lineno + offset})
                inferred = infer_type(node.value)
                if inferred:
                    symbols["types"][target.id] = inferred
    elif isinstance(node, ast.Import):
        for alias in node.names:
            symbols["imports"].append({"kind": "import", "module": alias.name, "alias": alias.asname, "line": node.lineno + offset})
            symbols["aliases"][alias.asname or alias.name.split(".")[0]] = alias.name
    elif isinstance(node, ast.ImportFrom):
        for alias in node.names:
            symbols["imports"].append({"kind": "from", "module": node.module, "name": alias.name,
                                       "alias": alias.asname, "line": node.lineno + offset})
            symbols["aliases"][alias.asname or alias.name] = f"{node.module}.{alias.name}"
            if alias.name in KNOWN_TYPES and not alias.asname:
                symbols["types"][alias.name] = KNOWN_TYPES[alias.name]


def infer_type(value_node):
    """Parte 9.5: motor = Motor(Port.A) -> motor : Motor"""
    if isinstance(value_node, ast.Call):
        name = dotted(value_node.func) if isinstance(value_node.func, (ast.Name, ast.Attribute)) else ""
        short = name.split(".")[-1]
        return KNOWN_TYPES.get(short)
    return None


CATEGORY_SIGNALS = {
    "motors": [r"\bMotor\(", r"\.run_angle\(", r"\.run_target\(", r"\.run\(", r"\.brake\(", r"\.hold\("],
    "movement": [r"\bDriveBase\(", r"\.straight\(", r"\.turn\(", r"\.curve\(", r"\.drive\("],
    "sensors": [r"ColorSensor", r"UltrasonicSensor", r"ForceSensor", r"\.color\(", r"\.distance\(", r"\.pressed\(", r"imu\."],
    "sound": [r"speaker\.", r"\.beep\(", r"play_notes"],
    "light": [r"display\.", r"light\.", r"\bIcon\."],
    "control": [r"\bwait\(", r"\bwhile\b", r"\bfor\b", r"\bif\b", r"StopWatch"],
    "operators": [r"[+\-*/%]", r"\brand\b", r"\bor\b", r"\bnot\b", r"randint"],
    "variables": [r"^\s*\w+\s*=", r"\bprint\("],
    "events": [r"buttons\.pressed", r"mailbox", r"quando"],
    "hub": [r"PrimeHub", r"InventorHub", r"TechnicHub", r"hub\."],
    "myblocks": [r"^\s*def\s+\w+"],
}


def dynamic_categories(source: str, symbols: dict) -> list:
    """
    9.6: a barra lateral prioriza o que EXISTE no código.
    O código decide a interface — o usuário nunca informa o que está programando.
    """
    import re
    scores = {}
    lines = source.split("\n")
    for category, patterns in CATEGORY_SIGNALS.items():
        score = 0
        for pattern in patterns:
            flags = re.MULTILINE if pattern.startswith("^") else 0
            score += len(re.findall(pattern, source, flags))
        if score:
            scores[category] = score
    if symbols.get("functions"):
        scores["myblocks"] = scores.get("myblocks", 0) + len(symbols["functions"]) * 2
    ordered = [name for name, _ in sorted(scores.items(), key=lambda item: -item[1])]
    return ordered


def handler_payload(data: dict) -> dict:
    code = data.get("code", "")
    if not isinstance(code, str):
        return {"ok": False, "error": "Código inválido."}
    if len(code) > MAX_BYTES:
        return {"ok": False, "error": "O arquivo excede 500 KB."}
    return analyze_source(code)


class handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self) -> None:  # noqa: N802 — convenção Vercel
        try:
            size = int(self.headers.get("Content-Length", "0") or 0)
            if size > MAX_BYTES:
                return self.send_json(413, {"ok": False, "error": "O arquivo excede 500 KB."})
            data = json.loads(self.rfile.read(size) or b"{}")
            result = handler_payload(data)
            self.send_json(200 if result.get("ok") else 400, result)
        except Exception as exc:  # nunca derruba a função
            self.send_json(500, {"ok": False, "error": f"Falha na análise semântica: {exc}"})

    def log_message(self, *args) -> None:  # silencia o log padrão
        return
