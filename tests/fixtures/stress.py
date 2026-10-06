from pybricks.tools import wait

KP_STRAIGHT = 1.8
KP_TURN = 3.2
KP_CURVE = 2.4


def _angle_error(target, current):
    error = target - current

    while error > 180:
        error -= 360

    while error < -180:
        error += 360

    return error


def _smoothstep(progress):
    if progress <= 0:
        return 0.0

    if progress >= 1:
        return 1.0

    return progress * progress * (3 - 2 * progress)


def gb_move(gb, hub, distancia, velocidade=300):
    if distancia == 0:
        gb.stop()
        return

    velocidade = abs(velocidade)

    if velocidade == 0:
        velocidade = 1

    gb.reset()

    heading_alvo = hub.imu.heading()

    direcao = 1 if distancia >= 0 else -1
    distancia_alvo = abs(distancia)

    while abs(gb.distance()) < distancia_alvo:
        erro = _angle_error(
            heading_alvo,
            hub.imu.heading()
        )

        correcao = erro * KP_STRAIGHT

        gb.drive(
            velocidade * direcao,
            correcao
        )

        wait(10)

    passo = max(
        1,
        int(velocidade / 5)
    )

    for velocidade_atual in range(
        int(velocidade),
        0,
        -passo
    ):
        erro = _angle_error(
            heading_alvo,
            hub.imu.heading()
        )

        correcao = erro * KP_STRAIGHT

        gb.drive(
            velocidade_atual * direcao,
            correcao
        )

        wait(10)

    gb.stop()


def gb_turn(
    gb,
    hub,
    angulo,
    velocidade_giro=500,
    tolerancia=1
):
    if angulo == 0:
        gb.stop()
        return

    velocidade_giro = abs(velocidade_giro)
    tolerancia = abs(tolerancia)

    if velocidade_giro == 0:
        velocidade_giro = 1

    heading_alvo = (
        hub.imu.heading()
        + angulo
    )

    contador = 0
    max_loops = 1000

    while contador < max_loops:
        erro = _angle_error(
            heading_alvo,
            hub.imu.heading()
        )

        if abs(erro) <= tolerancia:
            break

        velocidade_atual = (
            erro * KP_TURN
        )

        if velocidade_atual > velocidade_giro:
            velocidade_atual = velocidade_giro

        elif velocidade_atual < -velocidade_giro:
            velocidade_atual = -velocidade_giro

        gb.drive(
            0,
            velocidade_atual
        )

        wait(10)

        contador += 1

    gb.stop()


def gb_curve(
    gb,
    hub,
    distancia,
    angulo,
    velocidade=300,
    tolerancia_final=1,
    suavizacao=True,
    timeout_extra_ms=1500
):
    velocidade = abs(velocidade)
    tolerancia_final = abs(tolerancia_final)

    if velocidade == 0:
        velocidade = 1

    gb.reset()

    heading_inicial = hub.imu.heading()
    heading_final = heading_inicial + angulo

    direcao = 1 if distancia >= 0 else -1
    distancia_alvo = abs(distancia)

    if distancia_alvo == 0:
        gb_turn(
            gb,
            hub,
            angulo,
            velocidade_giro=velocidade,
            tolerancia=tolerancia_final
        )
        return

    tempo_estimado_ms = (
        distancia_alvo
        / velocidade
    ) * 1000

    timeout_ms = (
        tempo_estimado_ms * 3
        + max(0, timeout_extra_ms)
    )

    max_loops_curva = max(
        50,
        int(timeout_ms / 10)
    )

    zona_frenagem = max(
        distancia_alvo * 0.25,
        1
    )

    velocidade_minima = max(
        velocidade * 0.3,
        50
    )

    velocidade_minima = min(
        velocidade_minima,
        velocidade
    )

    contador_loops = 0

    while (
        abs(gb.distance()) < distancia_alvo
        and contador_loops < max_loops_curva
    ):
        distancia_atual = abs(
            gb.distance()
        )

        progresso = min(
            distancia_atual
            / distancia_alvo,
            1.0
        )

        if suavizacao:
            progresso_efetivo = (
                _smoothstep(progresso)
            )
        else:
            progresso_efetivo = progresso

        heading_alvo = (
            heading_inicial
            + angulo * progresso_efetivo
        )

        erro = _angle_error(
            heading_alvo,
            hub.imu.heading()
        )

        correcao = erro * KP_CURVE

        distancia_restante = max(
            distancia_alvo
            - distancia_atual,
            0
        )

        if distancia_restante < zona_frenagem:
            fator = (
                distancia_restante
                / zona_frenagem
            )

            velocidade_atual = (
                velocidade_minima
                + (
                    velocidade
                    - velocidade_minima
                ) * fator
            )
        else:
            velocidade_atual = velocidade

        gb.drive(
            velocidade_atual * direcao,
            correcao
        )

        wait(10)

        contador_loops += 1

    gb.stop()

    contador_ajuste = 0
    max_loops_ajuste = 150

    while contador_ajuste < max_loops_ajuste:
        erro = _angle_error(
            heading_final,
            hub.imu.heading()
        )

        if abs(erro) <= tolerancia_final:
            break

        velocidade_final = (
            erro * KP_TURN
        )

        if velocidade_final > velocidade:
            velocidade_final = velocidade

        elif velocidade_final < -velocidade:
            velocidade_final = -velocidade

        gb.drive(
            0,
            velocidade_final
        )

        wait(10)

        contador_ajuste += 1

    gb.stop()
