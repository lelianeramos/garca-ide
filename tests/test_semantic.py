"""Testes da análise semântica tolerante — api/project/semantic.py.

Cobre a Parte 9 e os casos de teste T21–T34 que dependem do parser AST.
O ponto central é B14: um erro de sintaxe NUNCA derruba a conversão inteira.
"""
from __future__ import annotations

import unittest

from api.project.semantic import (
    analyze_source,
    collect_symbols,
    dynamic_categories,
    handler_payload,
    split_top_level_units,
)


class TesteProgramaValido(unittest.TestCase):
    codigo = """from pybricks.hub import PrimeHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction

hub = PrimeHub()
motor_a = Motor(Port.A, Direction.CLOCKWISE)
motor_a.run_target(500, 90)
"""

    def setUp(self):
        self.result = analyze_source(self.codigo)

    def test_programa_valido_nao_e_parcial(self):
        self.assertTrue(self.result["valid"])
        self.assertFalse(self.result["partial"])
        self.assertEqual(self.result["diagnostics"], [])

    def test_ir_tem_os_nos_esperados(self):
        tipos = [node["type"] for node in self.result["ir"]["body"]]
        self.assertIn("importFrom", tipos)
        self.assertIn("assignment", tipos)
        self.assertIn("expressionStatement", tipos)

    def test_todo_no_tem_span(self):
        """9.3: sem span não existe patch cirúrgico."""
        for node in self.result["flat"]:
            self.assertIn("source", node)
            self.assertIn("startLine", node["source"])
            self.assertIn("endLine", node["source"])

    def test_chamada_metodo_vira_call_com_callee_text(self):
        calls = [n for n in self.result["flat"] if n["type"] == "callExpression"]
        texts = [c.get("calleeText") for c in calls]
        self.assertIn("Motor", texts)
        self.assertIn("motor_a.run_target", texts)

    def test_argumentos_preservam_ordem_e_span(self):
        motor = next(n for n in self.result["flat"]
                     if n["type"] == "callExpression" and n.get("calleeText") == "Motor")
        self.assertEqual(len(motor["arguments"]), 2)
        for arg in motor["arguments"]:
            self.assertIn("source", arg)

    def test_simbolos_indexados(self):
        symbols = self.result["symbols"]
        self.assertIn("hub", [v["name"] for v in symbols["variables"]])
        self.assertIn("motor_a", [v["name"] for v in symbols["variables"]])
        self.assertEqual(symbols["types"].get("hub"), "PrimeHub")
        self.assertEqual(symbols["types"].get("motor_a"), "Motor")

    def test_inferencia_de_tipo_por_construtor(self):
        """9.5: motor = Motor(Port.A) -> motor : Motor"""
        self.assertEqual(self.result["symbols"]["types"]["motor_a"], "Motor")

    def test_aliases_de_import(self):
        aliases = self.result["symbols"]["aliases"]
        self.assertEqual(aliases.get("PrimeHub"), "pybricks.hub.PrimeHub")


class TesteParserTolerante(unittest.TestCase):
    """9.4 / B14: o erro não derruba as linhas válidas."""

    def test_linha_invalida_nao_derruba_as_validas(self):
        codigo = """hub = PrimeHub()
motor.run_target(500 90)
motor_a.run(1000)
"""
        result = analyze_source(codigo)
        self.assertFalse(result["valid"])
        self.assertTrue(result["partial"])
        self.assertTrue(result["ir"]["body"], "as unidades válidas precisam entrar na IR")
        self.assertTrue(result["diagnostics"])

    def test_diagnostico_aponta_linha_e_coluna(self):
        result = analyze_source("x = 1\ny = (2 +\nz = 3\n")
        self.assertFalse(result["valid"])
        first = result["diagnostics"][0]
        self.assertIn("line", first)
        self.assertIn("column", first)
        self.assertIn("message", first)

    def test_programa_totalmente_valido_nao_gera_diagnostico(self):
        result = analyze_source("x = 1\nprint(x)\n")
        self.assertTrue(result["valid"])
        self.assertEqual(result["diagnostics"], [])

    def test_span_deslocado_para_a_linha_real(self):
        """As unidades recuperadas precisam apontar a linha certa no arquivo."""
        codigo = """hub = PrimeHub()
isto não é python válido
motor.run(500)
"""
        result = analyze_source(codigo)
        linhas = [node["source"]["startLine"] for node in result["ir"]["body"]]
        # o erro está na linha 2; motor.run(500) está na linha 3
        self.assertIn(3, linhas)

    def test_divisao_em_unidades_de_nivel_superior(self):
        codigo = "hub = PrimeHub()\nmotor.run(500)\nfor i in range(3):\n    wait(100)\n"
        units = split_top_level_units(codigo)
        cabecas = [line for line, _ in units]
        self.assertIn("hub = PrimeHub()", cabecas)
        self.assertTrue(any(u.startswith("for i in range(3)") for u in cabecas))


class TesteEstruturasDeControle(unittest.TestCase):
    def test_if_else_com_bloco(self):
        result = analyze_source("if motor.angle() > 90:\n    motor.stop()\nelse:\n    motor.run(200)\n")
        conditions = [n for n in result["flat"] if n["type"] == "condition"]
        self.assertTrue(conditions)
        self.assertTrue(conditions[0]["block"])
        self.assertTrue(conditions[0]["body"])
        self.assertTrue(conditions[0]["elseBody"])

    def test_laco_for_guarda_os_dois_alvos(self):
        """T30: for x, y in pairs(hubs.items()) -> dois alvos no mesmo laço."""
        result = analyze_source("for x, y in pairs(hubs.items()):\n    y.light.on()\n")
        loops = [n for n in result["flat"] if n["type"] == "loop"]
        self.assertEqual(loops[0]["kind"], "for")
        self.assertEqual(loops[0]["targets"], ["x", "y"])

    def test_laco_while(self):
        result = analyze_source("while hub.buttons.pressed():\n    wait(10)\n")
        loops = [n for n in result["flat"] if n["type"] == "loop"]
        self.assertEqual(loops[0]["kind"], "while")
        self.assertIsNotNone(loops[0]["test"])

    def test_funcao_com_parametros(self):
        result = analyze_source("def gyro_move(robot, hub, distance, speed=300):\n    robot.straight(distance)\n")
        functions = [n for n in result["flat"] if n["type"] == "function"]
        self.assertEqual(functions[0]["name"], "gyro_move")
        nomes = [p["name"] for p in functions[0]["params"]]
        self.assertEqual(nomes, ["robot", "hub", "distance", "speed"])

    def test_palavras_reservadas_nao_viram_variaveis(self):
        """T21: if/while/for/else nunca entram na lista de variáveis."""
        codigo = "if x > 1:\n    wait(10)\nwhile y:\n    pass\nfor i in range(3):\n    pass\nelse_var = 2\n"
        symbols = collect_symbols(codigo)
        nomes = [v["name"] for v in symbols["variables"]]
        for reservada in ("if", "while", "for", "else", "pass"):
            self.assertNotIn(reservada, nomes)
        self.assertIn("else_var", nomes)


class TesteExpressoes(unittest.TestCase):
    def test_operador_binario(self):
        result = analyze_source("z = 75 / 100 * 360\n")
        ops = [n for n in result["flat"] if n["type"] == "binaryOperation"]
        self.assertTrue(ops)
        operadores = {o["operator"] for o in ops}
        self.assertEqual(operadores, {"/", "*"})

    def test_unario_negativo(self):
        """T31: motor.run(-500) preserva o sinal negativo."""
        result = analyze_source("motor.run(-500)\n")
        unarios = [n for n in result["flat"] if n["type"] == "unaryOperation"]
        self.assertTrue(unarios)
        self.assertEqual(unarios[0]["operator"], "-")

    def test_numero_em_notacao_cientifica(self):
        """T32: 1e-5 mantém sinal e expoente."""
        result = analyze_source("tolerancia = 1e-5\n")
        literals = [n for n in result["flat"] if n["type"] == "literal"]
        valores = [l["value"] for l in literals]
        self.assertIn(1e-5, valores)

    def test_argumento_nomeado(self):
        result = analyze_source("robot.straight(500, then=Stop.COAST)\n")
        calls = [n for n in result["flat"] if n["type"] == "callExpression"]
        alvo = next(c for c in calls if c.get("calleeText") == "robot.straight")
        self.assertEqual(len(alvo["arguments"]), 1)
        self.assertEqual(alvo["keywords"][0]["name"], "then")

    def test_subscript(self):
        result = analyze_source("cores = [Color.RED, Color.BLUE]\nprimeira = cores[0]\n")
        subs = [n for n in result["flat"] if n["type"] == "subscript"]
        self.assertTrue(subs)

    def test_lista(self):
        result = analyze_source("sequencia = [100, 200, 300]\n")
        listas = [n for n in result["flat"] if n["type"] == "list"]
        self.assertEqual(len(listas[0]["items"]), 3)


class TesteCategoriasDinamicas(unittest.TestCase):
    """9.6: o código decide a interface — o usuário nunca informa nada."""

    def test_codigo_com_motor_prioriza_motores(self):
        codigo = "motor_a = Motor(Port.A)\nmotor_a.run_target(500, 90)\n"
        categorias = dynamic_categories(codigo, collect_symbols(codigo))
        self.assertIn("motors", categorias)
        self.assertEqual(categorias[0], "motors")

    def test_codigo_com_drivebase_prioriza_movimento(self):
        codigo = "robot = DriveBase(motor_a, motor_b, 56, 112)\nrobot.straight(500)\nrobot.turn(90)\n"
        categorias = dynamic_categories(codigo, collect_symbols(codigo))
        self.assertIn("movement", categorias)

    def test_codigo_com_sensores_detecta_sensores(self):
        codigo = "sensor = ColorSensor(Port.C)\nif sensor.color() == Color.RED:\n    wait(10)\n"
        categorias = dynamic_categories(codigo, collect_symbols(codigo))
        self.assertIn("sensors", categorias)

    def test_codigo_com_def_prioriza_meus_blocos(self):
        codigo = "def gyro_move(robot, distance):\n    robot.straight(distance)\n"
        categorias = dynamic_categories(codigo, collect_symbols(codigo))
        self.assertIn("myblocks", categorias)

    def test_arquivo_vazio_nao_prioriza_nada(self):
        self.assertEqual(dynamic_categories("", collect_symbols("")), [])


class TesteHandler(unittest.TestCase):
    def test_payload_valido(self):
        result = handler_payload({"code": "x = 1\n"})
        self.assertTrue(result["ok"])
        self.assertTrue(result["valid"])

    def test_codigo_invalido_retorna_erro_descritivo(self):
        result = handler_payload({"code": "def (\n"})
        self.assertFalse(result["valid"])
        self.assertTrue(result["diagnostics"])

    def test_codigo_vazio_e_ok(self):
        """B16: arquivo novo começa vazio e não pode virar erro."""
        result = handler_payload({"code": ""})
        self.assertTrue(result["ok"])
        self.assertTrue(result["valid"])
        self.assertEqual(result["diagnostics"], [])

    def test_codigo_maior_que_500kb_e_rejeitado(self):
        result = handler_payload({"code": "x = 1\n" * 200_000})
        self.assertFalse(result["ok"])

    def test_codigo_nao_string_e_rejeitado(self):
        result = handler_payload({"code": 123})
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
