from http.server import BaseHTTPRequestHandler
import ast, json

def position(lines, line, col): return sum(len(x)+1 for x in lines[:line-1])+col

def dotted(node):
    parts=[]
    while isinstance(node,ast.Attribute):parts.append(node.attr);node=node.value
    if isinstance(node,ast.Name):parts.append(node.id);return '.'.join(reversed(parts))

def refactor(files, old_module, new_module):
    changed=[]
    for f in files:
        source=f.get('content','');lines=source.split('\n');edits=[];plain_import=False
        try:tree=ast.parse(source)
        except SyntaxError:continue
        for node in ast.walk(tree):
            if isinstance(node,ast.ImportFrom) and node.module==old_module:
                line=lines[node.lineno-1];start=line.find(old_module,node.col_offset)
                if start>=0:edits.append((position(lines,node.lineno,start),position(lines,node.lineno,start+len(old_module)),new_module))
            elif isinstance(node,ast.Import):
                for alias in node.names:
                    if alias.name==old_module:
                        line=lines[node.lineno-1];start=line.find(old_module,node.col_offset)
                        if start>=0:edits.append((position(lines,node.lineno,start),position(lines,node.lineno,start+len(old_module)),new_module))
                        if alias.asname is None:plain_import=True
        if plain_import:
            for node in ast.walk(tree):
                full=dotted(node) if isinstance(node,ast.Attribute) else None
                if full and full.startswith(old_module+'.'):
                    start=position(lines,node.lineno,node.col_offset);edits.append((start,start+len(old_module),new_module))
                elif isinstance(node,ast.Name) and node.id==old_module and not isinstance(node.ctx,ast.Store):
                    start=position(lines,node.lineno,node.col_offset);edits.append((start,position(lines,node.end_lineno,node.end_col_offset),new_module))
        if edits:
            # Remove duplicate and nested-overlapping edits, then apply backwards.
            accepted=[]
            for edit in sorted(set(edits),key=lambda x:(x[0],-(x[1]-x[0]))):
                if not any(edit[0]>=a[0] and edit[1]<=a[1] for a in accepted):accepted.append(edit)
            for start,end,text in sorted(accepted,reverse=True):source=source[:start]+text+source[end:]
            changed.append({'id':f['id'],'content':source})
    return {'files':changed}

class handler(BaseHTTPRequestHandler):
    def send_json(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        try:
            size=int(self.headers.get('Content-Length','0'));d=json.loads(self.rfile.read(size) or b'{}');self.send_json(200,refactor(d.get('files',[]),d['oldModule'],d['newModule']))
        except Exception as e:self.send_json(400,{'error':str(e)})
