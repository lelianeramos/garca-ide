import json
from pathlib import Path
import unittest

from api.project.format import format_python, load_catalog


class FormatTests(unittest.TestCase):
    def test_repairs_missing_colon_and_indentation(self):
        result = format_python('if True\nprint("ok")')
        self.assertTrue(result["valid"])
        self.assertEqual(result["code"], 'if True:\n    print("ok")\n')
        self.assertTrue(result["changed"])

    def test_normalizes_tabs_quotes_and_literals(self):
        result = format_python('if true:\n\tprint(“ok”)\n')
        self.assertTrue(result["valid"])
        self.assertIn('if True:', result["code"])
        self.assertIn('    print("ok")', result["code"])

    def test_corrects_known_pybricks_method(self):
        source = (
            "from pybricks.pupdevices import Motor\n"
            "from pybricks.parameters import Port\n"
            "motor = Motor(Port.A)\n"
            "motor.run_angl(500, 360)\n"
        )
        result = format_python(source)
        self.assertTrue(result["valid"])
        self.assertIn("motor.run_angle(500, 360)", result["code"])
        self.assertTrue(any("run_angl" in item for item in result["changes"]))

    def test_does_not_rewrite_user_api(self):
        source = "robot_personalizado.run_angl(500, 360)\n"
        result = format_python(source)
        self.assertEqual(result["code"], source)

    def test_catalog_has_main_official_modules(self):
        catalog = load_catalog()
        modules = catalog["modules"]
        for name in (
            "pybricks.hubs",
            "pybricks.pupdevices",
            "pybricks.iodevices",
            "pybricks.parameters",
            "pybricks.robotics",
            "pybricks.tools",
            "pybricks.messaging",
        ):
            self.assertIn(name, modules)
        self.assertIn("Motor", modules["pybricks.pupdevices"]["classes"])
        self.assertIn("DriveBase", modules["pybricks.robotics"]["classes"])


if __name__ == "__main__":
    unittest.main()
