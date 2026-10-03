from http.server import BaseHTTPRequestHandler
import ast, json, math, re

DEFAULT_WHEEL_DIAMETER_MM = 62.4
DEFAULT_WHEEL_CIRCUMFERENCE_MM = math.pi * DEFAULT_WHEEL_DIAMETER_MM

DEVICE_INIT = {"PrimeHub", "Motor", "DriveBase", "ColorSensor", "UltrasonicSensor", "ForceSensor", "StopWatch"}

def value(node):
    if isinstance(node, ast.Constant): return node.value
    if isinstance(node, ast.Name): return {"identifier": node.id}
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and isinstance(node.operand, ast.Constant): return -node.operand.value
    try: return {"source": ast.unparse(node)}
    except Exception: return None

def number(node, default=0):
    result=value(node)
    return float(result) if isinstance(result,(int,float)) else default

def port_for_name(name):
    match=re.match(r"motor_([a-f])$",name)
    return match.group(1).upper() if match else "A"

def call_name(node):
    if isinstance(node, ast.Name): return node.id
    if isinstance(node, ast.Attribute):
        left=call_name(node.value)
        return f"{left}.{node.attr}" if left else node.attr
    return ""

def pt_number(number_value):
    if float(number_value).is_integer(): return str(int(number_value))
    return (f"{number_value:.4f}".rstrip("0").rstrip(".")).replace(".", ",")

def make(schema, category, params, source, line):
    return {"schema":schema,"category":category,"params":params,"source":source,"line":line}

def parse_statement(node, source, local_functions):
    segment=ast.get_source_segment(source,node) or ast.unparse(node)
    if isinstance(node, ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
        target=node.targets[0].id
        if isinstance(node.value,ast.Call) and call_name(node.value.func).split('.')[-1] in DEVICE_INIT:return None
        if target.startswith("motor_") and target.endswith("_speed"):
            return make("motor_speed","motors",{"port":target[6].upper(),"percent":number(node.value)/10},segment,node.lineno)
        return make("variable_set","variables",{"name":target,"value":value(node.value)},segment,node.lineno)
    if isinstance(node, ast.AugAssign) and isinstance(node.target,ast.Name) and isinstance(node.op,ast.Add):
        return make("variable_change","variables",{"name":node.target.id,"value":value(node.value)},segment,node.lineno)
    if isinstance(node, ast.For) and isinstance(node.iter,ast.Call) and call_name(node.iter.func)=="range":
        amount=number(node.iter.args[-1],10) if node.iter.args else 10
        return make("repeat","control",{"times":amount},segment,node.lineno)
    if isinstance(node, ast.While):return make("forever","control",{},segment,node.lineno)
    if isinstance(node, ast.If):return make("if","control",{"condition":ast.unparse(node.test)},segment,node.lineno)
    if not isinstance(node, ast.Expr) or not isinstance(node.value, ast.Call): return None
    call=node.value; name=call_name(call.func); args=call.args; kwargs={k.arg:value(k.value) for k in call.keywords if k.arg}
    motor=re.match(r"motor_([a-f])\.(run_angle|run_target|run|stop|brake|hold)$",name)
    if motor:
        port=motor.group(1).upper();method=motor.group(2)
        if method=="run_angle":
            speed=number(args[0],500) if args else 500;angle=number(args[1],360) if len(args)>1 else 360
            return make("motor_run_angle","motors",{"port":port,"speed":abs(speed),"rotations":abs(angle)/360,"direction":"ccw" if angle<0 or speed<0 else "cw"},segment,node.lineno)
        if method=="run_target":return make("motor_run_target","motors",{"port":port,"speed":abs(number(args[0],500)),"target":number(args[1],0) if len(args)>1 else 0},segment,node.lineno)
        if method=="run":
            speed=number(args[0],500) if args else 500
            return make("motor_run","motors",{"port":port,"speed":abs(speed),"direction":"ccw" if speed<0 else "cw"},segment,node.lineno)
        return make(f"motor_{method}","motors",{"port":port},segment,node.lineno)
    if name=="robot.straight":
        distance=number(args[0],0) if args else 0
        return make("movement_straight","movement",{"distance_mm":abs(distance),"rotations":abs(distance)/DEFAULT_WHEEL_CIRCUMFERENCE_MM,"direction":"backward" if distance<0 else "forward"},segment,node.lineno)
    if name=="robot.drive":
        speed=number(args[0],200) if args else 200;turn=number(args[1],0) if len(args)>1 else 0
        return make("movement_drive","movement",{"speed":abs(speed),"turn_rate":turn,"direction":"backward" if speed<0 else "forward"},segment,node.lineno)
    if name=="robot.stop":return make("movement_stop","movement",{},segment,node.lineno)
    if name=="robot.settings":
        straight=kwargs.get("straight_speed",750);straight=straight if isinstance(straight,(int,float)) else 750
        return make("movement_speed","movement",{"percent":straight/10},segment,node.lineno)
    if name=="wait":return make("wait","control",{"seconds":number(args[0],1000)/1000 if args else 1},segment,node.lineno)
    if name=="hub.speaker.beep":return make("beep","sound",{"frequency":number(args[0],500) if args else 500,"seconds":number(args[1],500)/1000 if len(args)>1 else .5},segment,node.lineno)
    if name=="hub.speaker.volume" and args:return make("volume","sound",{"percent":number(args[0],75)},segment,node.lineno)
    if name=="hub.display.char" and args:return make("display_char","light",{"text":value(args[0])},segment,node.lineno)
    if name=="hub.display.off":return make("display_off","light",{},segment,node.lineno)
    if name.endswith(".reset") and name.startswith("timer"):return make("timer_reset","sensors",{},segment,node.lineno)
    short=name.split('.')[-1]
    if short in local_functions:
        params={}
        for index,arg in enumerate(args):params[f"arg{index+1}"]=value(arg)
        params.update(kwargs)
        return make("library_call","libraries",{"function":short,"module":local_functions[short],"arguments":params},segment,node.lineno)
    return None

def blockify(code, symbols=None):
    try: tree=ast.parse(code)
    except SyntaxError as error:return {"ok":False,"error":{"line":error.lineno or 1,"column":error.offset or 1,"message":error.msg}}
    local_functions={}
    for module,names in (symbols or {}).items():
        for name in names:local_functions[name]=module
    blocks=[];represented=set()
    for node in tree.body:
        if isinstance(node,(ast.Import,ast.ImportFrom,ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):continue
        item=parse_statement(node,code,local_functions)
        if item:blocks.append(item);represented.update(range(getattr(node,'lineno',1),getattr(node,'end_lineno',getattr(node,'lineno',1))+1))
    ignored=set();preserved=[];preserved_lines=set()
    for node in tree.body:
        is_import=isinstance(node,(ast.Import,ast.ImportFrom));is_device=isinstance(node,ast.Assign) and isinstance(node.value,ast.Call) and call_name(node.value.func).split('.')[-1] in DEVICE_INIT
        if is_import or is_device:ignored.update(range(node.lineno,getattr(node,'end_lineno',node.lineno)+1))
        elif not any(line in represented for line in range(node.lineno,getattr(node,'end_lineno',node.lineno)+1)):
            preserved.append({"source":ast.get_source_segment(code,node) or ast.unparse(node),"line":node.lineno});preserved_lines.update(range(node.lineno,getattr(node,'end_lineno',node.lineno)+1))
    lines=code.splitlines();unknown=[i for i,line in enumerate(lines,1) if line.strip() and not line.lstrip().startswith('#') and i not in represented and i not in ignored]
    for i,line in enumerate(lines,1):
        if i not in preserved_lines and line.lstrip().startswith('#') and not line.lstrip().startswith(('# Programa criado com blocos','# Dispositivos usados pelo programa','# Trechos mantidos somente em Python')):preserved.append({"source":line,"line":i})
    preserved.sort(key=lambda item:item['line'])
    return {"ok":True,"blocks":blocks,"unknownLines":unknown,"preserved":preserved}

class handler(BaseHTTPRequestHandler):
    def send_json(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        try:
            size=int(self.headers.get('Content-Length','0'));data=json.loads(self.rfile.read(size) or b'{}');result=blockify(data.get('code',''),data.get('symbols',{}));self.send_json(200 if result.get('ok') else 400,result)
        except Exception as error:self.send_json(400,{"ok":False,"error":{"line":1,"column":1,"message":str(error)}})
