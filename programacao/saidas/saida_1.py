from pybricks.pupdevices import Motor
from pybricks.robotics import DriveBase
from pybricks.parameters import Port
from pybricks.tools import StopWatch
import movimentos
def main():
    # inicia o cronômetro quando o progrma é iniciado
    timer = StopWatch()
    #Drive base com os dois motores de tração
    robot = DriveBase(motor_a, motor_b, 62.4, 148)
    
    robot.settings(straight_speed=300)
    motor_a.settings(acceleration=400, deceleration=400)
    motor_b.settings(acceleration=400, deceleration=400)
    #vai para frente por 40 cm
    robot.straight (400)
   # faz um giro por 50 no próprio eixo
   #desfaz o próprio giro por em alguns graus

main()
