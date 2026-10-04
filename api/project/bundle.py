from http.server import BaseHTTPRequestHandler
import ast, json, re

RUNTIME_MODULES=('pybricks','urandom','micropython','ujson','ustruct','math','sys','time','random')

def module_name(path): return re.sub(r'\.py$','',path.strip('/')).replace('/','.')

class InternalImportTransformer(ast.NodeTransformer):
    def __init__(self, internal): self.internal=internal; self.aliases={}
    def visit_ImportFrom(self,node):
        if node.module in self.internal: return None
        return node
    def visit_Import(self,node):
        kept=[]
        for alias in node.names:
            if alias.name in self.internal:self.aliases[alias.asname or alias.name.split('.')[0]]=alias.name
            else:kept.append(alias)
        node.names=kept;return node if kept else None
    def visit_Attribute(self,node):
        def dotted(value):
            parts=[]
            while isinstance(value,ast.Attribute):parts.append(value.attr);value=value.value
            if isinstance(value,ast.Name):parts.append(value.id);return '.'.join(reversed(parts))
        full=dotted(node)
        for alias,module in self.aliases.items():
            if full and (full.startswith(alias+'.') or full.startswith(module+'.')):
                return ast.copy_location(ast.Name(id=full.split('.')[-1],ctx=node.ctx),node)
        return self.generic_visit(node)

def bundle(files,entry_id):
    modules={module_name(f['path']):f for f in files if f['path'].endswith('.py')}; by_id={f['id']:f for f in files}; entry=by_id.get(entry_id)
    if not entry:return {'ok':False,'error':'Arquivo de entrada não encontrado'}
    trees={}
    try:
        for module,f in modules.items():trees[module]=ast.parse(f.get('content',''),filename=f['path'])
    except SyntaxError as e:return {'ok':False,'error':f'{e.filename}, linha {e.lineno}: {e.msg}'}
    order=[];visiting=set();visited=set()
    def visit(module):
        if module in visiting:raise ValueError(f'Dependência circular envolvendo {module}')
        if module in visited:return
        visiting.add(module)
        for node in ast.walk(trees[module]):
            names=[]
            if isinstance(node,ast.ImportFrom) and node.module:names=[node.module]
            elif isinstance(node,ast.Import):names=[a.name for a in node.names]
            for name in names:
                if name in modules:visit(name)
                elif not name.startswith(RUNTIME_MODULES):raise ValueError(f'Módulo não encontrado: {name}')
        visiting.remove(module);visited.add(module);order.append(module)
    entry_module=module_name(entry['path'])
    try:visit(entry_module)
    except ValueError as e:return {'ok':False,'error':str(e)}
    bodies=[];defined={}
    for module in order:
        transformer=InternalImportTransformer(set(modules));tree=transformer.visit(trees[module]);ast.fix_missing_locations(tree)
        if module!=entry_module:
            for node in tree.body:
                name=getattr(node,'name',None)
                if name and name in defined:return {'ok':False,'error':f'Conflito de símbolo: {name} existe em {defined[name]} e {module}.'}
                if name:defined[name]=module
        code=ast.unparse(tree).strip()
        if code:bodies.append(f'# --- módulo: {module} ---\n{code}')
    return {'ok':True,'code':'\n\n'.join(bodies)+'\n','modules':order}

class handler(BaseHTTPRequestHandler):
    def send_json(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        try:
            size=int(self.headers.get('Content-Length','0'));d=json.loads(self.rfile.read(size) or b'{}');result=bundle(d.get('files',[]),d.get('entryId'));self.send_json(200 if result.get('ok') else 400,result)
        except Exception as e:self.send_json(400,{'ok':False,'error':str(e)})
