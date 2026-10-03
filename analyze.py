from http.server import BaseHTTPRequestHandler
import ast, json, re

PYBRICKS_PREFIXES = ("pybricks", "urandom", "micropython", "ujson", "ustruct")
EXTERNAL_MODULES = {"math", "sys", "time", "random", "collections", "itertools", "functools", "json", "re", "struct", "typing"}

def module_name(path):
    value = re.sub(r"\.py$", "", path.strip("/"))
    return value[:-9].replace("/", ".") if value.endswith("/__init__") else value.replace("/", ".")

def symbol_data(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        args = [a.arg for a in (*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs)]
        return {"name": node.name, "kind": "function", "args": args, "line": node.lineno}
    if isinstance(node, ast.ClassDef): return {"name": node.name, "kind": "class", "args": [], "line": node.lineno}
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        names = [t.id for t in targets if isinstance(t, ast.Name)]
        return [{"name": n, "kind": "variable", "args": [], "line": node.lineno} for n in names]
    return None

def analyze(files):
    modules = {module_name(f["path"]): f for f in files if f["path"].endswith(".py")}
    output, graph, reverse = {}, {f["id"]: [] for f in files}, {f["id"]: [] for f in files}
    trees = {}
    for f in files:
        info = {"path": f["path"], "module": module_name(f["path"]), "symbols": [], "imports": [], "diagnostics": []}
        try:
            tree = ast.parse(f.get("content", ""), filename=f["path"]); trees[f["id"]] = tree
            for node in tree.body:
                item = symbol_data(node)
                if isinstance(item, list): info["symbols"].extend(item)
                elif item: info["symbols"].append(item)
        except SyntaxError as e:
            info["diagnostics"].append({"severity":"error","code":"SYNTAX_ERROR","line":e.lineno or 1,"column":e.offset or 1,"message":f"Erro de sintaxe: {e.msg}"})
        output[f["id"]] = info
    for f in files:
        tree = trees.get(f["id"]); info = output[f["id"]]
        if not tree: continue
        for node in ast.walk(tree):
            specs=[]
            if isinstance(node, ast.ImportFrom) and node.module:
                specs=[(node.module, [{"name":a.name,"alias":a.asname} for a in node.names], None)]
            elif isinstance(node, ast.Import):
                specs=[(a.name, [], a.asname) for a in node.names]
            for module, names, alias in specs:
                target=modules.get(module)
                if target:
                    status="RESOLVED"; target_id=target["id"]
                    if target_id not in graph[f["id"]]: graph[f["id"]].append(target_id)
                    if f["id"] not in reverse[target_id]: reverse[target_id].append(f["id"])
                    available={s["name"] for s in output[target_id]["symbols"]}
                    for imported in names:
                        if imported["name"]!="*" and imported["name"] not in available:
                            info["diagnostics"].append({"severity":"error","code":"SYMBOL_NOT_FOUND","line":node.lineno,"column":node.col_offset+1,"message":f"O módulo {module} existe, mas não exporta {imported['name']}."})
                elif module.startswith(PYBRICKS_PREFIXES): status="PYBRICKS_MODULE"; target_id=None
                elif module.split('.')[0] in EXTERNAL_MODULES: status="EXTERNAL_MODULE"; target_id=None
                else:
                    status="MODULE_NOT_FOUND"; target_id=None
                    info["diagnostics"].append({"severity":"error","code":"MODULE_NOT_FOUND","line":node.lineno,"column":node.col_offset+1,"message":f"Módulo interno não encontrado: {module}."})
                info["imports"].append({"module":module,"names":names,"alias":alias,"status":status,"targetId":target_id,"line":node.lineno})
    return {"files":output,"graph":graph,"reverse":reverse,"modules":{m:f["id"] for m,f in modules.items()}}

class handler(BaseHTTPRequestHandler):
    def send_json(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        try:
            size=int(self.headers.get("Content-Length","0")); data=json.loads(self.rfile.read(size) or b"{}"); files=data.get("files",[])
            if len(files)>500: return self.send_json(413,{"error":"Projeto muito grande"})
            self.send_json(200,analyze(files))
        except Exception as e: self.send_json(400,{"error":str(e)})
