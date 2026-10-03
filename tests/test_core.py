import unittest
import math
from api.project.blocks import blockify
from api.project.analyze import analyze
from api.project.refactor import refactor
from api.project.bundle import bundle

class CoreTests(unittest.TestCase):
    def test_motor_parameters(self):
        data=blockify('motor_c.run_angle(300, -720)')
        block=data['blocks'][0]
        self.assertEqual(block['schema'],'motor_run_angle')
        self.assertEqual(block['params'],{'port':'C','speed':300,'rotations':2,'direction':'ccw'})

    def test_movement_speed_decimal(self):
        block=blockify('robot.settings(straight_speed=755)')['blocks'][0]
        self.assertEqual(block['schema'],'movement_speed')
        self.assertEqual(block['params']['percent'],75.5)

    def test_default_wheel_is_62_4_mm(self):
        block=blockify(f'robot.straight({math.pi * 62.4})')['blocks'][0]
        self.assertEqual(block['schema'],'movement_straight')
        self.assertAlmostEqual(block['params']['rotations'],1)

    def test_wait_decimal(self):
        block=blockify('wait(75500)')['blocks'][0]
        self.assertEqual(block['params']['seconds'],75.5)

    def test_unknown_is_preserved_without_fake_block(self):
        data=blockify('motor_a.stop()\ncontrole_pid()')
        self.assertEqual(len(data['blocks']),1)
        self.assertEqual(data['unknownLines'],[2])
        self.assertEqual(data['preserved'][0]['source'],'controle_pid()')

    def test_import_resolution_and_symbols(self):
        files=[
          {'id':'main','path':'main.py','content':'from movements import gyro_move\ngyro_move(None,None,10)'},
          {'id':'mov','path':'movements.py','content':'def gyro_move(robot,hub,distance,speed=300):\n    pass'}]
        result=analyze(files)
        self.assertEqual(result['files']['main']['imports'][0]['status'],'RESOLVED')
        self.assertEqual(result['graph']['main'],['mov'])

    def test_semantic_rename(self):
        files=[{'id':'main','path':'main.py','content':'from movements import gyro_move\nprint("movements")'}]
        content=refactor(files,'movements','drivetrain')['files'][0]['content']
        self.assertIn('from drivetrain import gyro_move',content)
        self.assertIn('"movements"',content)

    def test_bundle_internal_library(self):
        files=[
          {'id':'main','path':'main.py','content':'import movements\nmovements.gyro_move(10)'},
          {'id':'mov','path':'movements.py','content':'def gyro_move(distance):\n    return distance'}]
        result=bundle(files,'main')
        self.assertTrue(result['ok'])
        self.assertNotIn('import movements',result['code'])
        self.assertIn('gyro_move(10)',result['code'])

if __name__=='__main__': unittest.main()
