import unittest

from api.project.semantic import analyze


class SemanticTests(unittest.TestCase):
    def test_registry_visual_block_round_trip(self):
        result=analyze('hub.imu.reset_heading(90)')
        self.assertTrue(result['valid'])
        self.assertEqual(result['flat'][0]['schema'],'imu_reset_heading')
        self.assertEqual(result['flat'][0]['params']['angle'],90)

    def test_motor_variable_and_loop(self):
        code = """from pybricks.pupdevices import Motor
from pybricks.parameters import Port
motor = Motor(Port.A)
velocidade = 300
for i in range(3):
    motor.run(velocidade)
"""
        result = analyze(code)
        self.assertTrue(result["valid"])
        self.assertIn("motor", result["symbols"])
        self.assertEqual(result["symbols"]["motor"]["inferredType"], "Motor")
        self.assertIn("control", result["categories"])
        self.assertIn("motors", result["categories"])
        self.assertTrue(all("source" in node for node in result["ir"]))

    def test_tolerates_one_broken_unit(self):
        code = "motor = Motor(Port.A)\nmotor.run(300)\nif velocidade > 200\n    motor.run(100)\n"
        result = analyze(code)
        self.assertFalse(result["valid"])
        self.assertTrue(result["partial"])
        self.assertTrue(result["diagnostics"])
        self.assertTrue(any(item["category"] == "motors" for item in result["flat"]))

    def test_generic_python_without_robotics(self):
        result = analyze("x = 10\ny = x + 5\nif y > 10:\n    print(y)\n")
        self.assertTrue(result["valid"])
        self.assertIn("variables", result["categories"])
        self.assertIn("control", result["categories"])
        self.assertIn("operators", result["categories"])
        self.assertIn("text", result["categories"])


if __name__ == "__main__":
    unittest.main()
