"""Removable Denture (services_design.rd_horas_por_estado, 20-oct-2026): las horas se llenan con el estado por etapa,
Bite design (columnas de siempre) → Denture design (columnas z_). No necesita base de datos."""
import unittest
from unittest import mock

from app import models  # noqa: F401  (registra los modelos)
from app import services_design as sd


class EtapasRD(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(sd, "ahora_colombia", return_value=sd.datetime(2026, 10, 20, 9, 30))
        p.start(); self.addCleanup(p.stop)

    def test_bite_design(self):
        self.assertEqual(sd.rd_horas_por_estado({"etapa": "Bite design"}, "Initiated"), {"hora_inicio": "09:30"})
        c = sd.rd_horas_por_estado({"etapa": "Bite design", "hora_inicio": "08:00"}, "Approved")
        self.assertEqual(c, {"hora_fin": "09:30", "etapa": "Denture design", "estado": "Ready to design"})

    def test_denture_design(self):
        base = {"etapa": "Denture design", "hora_inicio": "08:00", "hora_fin": "09:00"}
        self.assertEqual(sd.rd_horas_por_estado(base, "Initiated"), {"z_hora_inicio": "09:30"})
        self.assertEqual(sd.rd_horas_por_estado({**base, "z_hora_inicio": "09:10"}, "Approved"), {"z_hora_fin": "09:30"})
        self.assertEqual(sd.rd_horas_por_estado(base, "Hold"), {"z_s_hold": "09:30"})

    def test_sin_etapa_empieza_en_bite(self):
        self.assertEqual(sd.rd_horas_por_estado({"etapa": ""}, "Initiated"), {"hora_inicio": "09:30", "etapa": "Bite design"})


class CopiasRD(unittest.TestCase):
    """sincronizar_copia_rd: toda orden de N3 / N6 con «Removable» en el producto tiene su copia en Removable Denture."""

    def setUp(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool
        from app import models_design as md
        from app.database import Base
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db, self.md = sessionmaker(bind=eng)(), md
        e = models.Empleado(nombres="Nestor", apellidos="Rojas", email="n@x.com", rol="empleado", activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="Diseñador", area="x", identificacion="1")
        a3, ard = md.DesignArea(nombre=sd.AREA_N3, formato="dual"), md.DesignArea(nombre=sd.AREA_RD, formato="dual")
        self.db.add_all([e, a3, ard]); self.db.flush()
        self.t3 = md.DesignTeam(area_id=a3.id, nombre="Schedule Ana")
        self.trd = md.DesignTeam(area_id=ard.id, nombre=sd.EQUIPO_RD)
        self.db.add_all([self.t3, self.trd]); self.db.flush()
        self.db.add(md.DesignTeamDesigner(team_id=self.trd.id, empleado_id=e.id)); self.db.commit()
        self.nestor = e.id

    def orden(self, producto):
        o = self.md.DesignOrden(team_id=self.t3.id, fecha=sd.date(2026, 10, 20), tabla="principal", orden="a1",
                                paciente="Pepe", centro="C1", producto=producto)
        self.db.add(o); self.db.commit()
        sd.sincronizar_copia_rd(self.db, o)
        return o

    def copias(self):
        return self.db.query(self.md.DesignOrden).filter(self.md.DesignOrden.team_id == self.trd.id).all()

    def test_crea_y_actualiza(self):
        self.orden("Implant Bar")
        self.assertEqual(self.copias(), [])
        o = self.orden("Removable denture")
        (c,) = self.copias()
        self.assertEqual((c.orden, c.designer_id, c.etapa, c.estado, c.tabla), ("A1", self.nestor, "Bite design", "Order Entered", "material"))
        o.paciente = "Juan"; self.db.commit()
        sd.sincronizar_copia_rd(self.db, o)
        self.assertEqual(self.copias()[0].paciente, "Juan")
        self.assertEqual(len(self.copias()), 1)

    def test_bite_start_de_la_original_y_finish_con_bite_finish(self):
        from app import services_design_push as spush
        o = self.orden("Removable denture")
        with self.assertRaises(ValueError):   # sin Initiated en N3 no hay START de Bite
            sd.bite_finish_rd(self.db, o, self.db.get(models.Empleado, self.nestor))
        o.hora_inicio, o.s_hold, o.f_hold = "08:00", "08:30", "08:40"; self.db.commit()
        sd.sincronizar_copia_rd(self.db, o)
        c = self.copias()[0]
        self.assertEqual((c.hora_inicio, c.s_hold, c.f_hold, c.hora_fin, c.estado), ("08:00", "08:30", "08:40", "", "Order Entered"))
        self.assertEqual(sd.estado_bite_rd(self.db, [o.id]), {o.id: "pendiente"})
        o.hora_fin, o.estado = "11:00", "Approved"; self.db.commit()   # el Fin de N3 es el de todo el caso: no termina el Bite
        sd.sincronizar_copia_rd(self.db, o)
        self.assertEqual((self.copias()[0].hora_fin, self.copias()[0].estado), ("", "Order Entered"))
        with mock.patch.object(spush, "enviar_en_segundo_plano") as push,                 mock.patch.object(sd, "ahora_colombia", return_value=sd.datetime(2026, 10, 21, 9, 15, tzinfo=sd.ZONA_COLOMBIA)):
            r = sd.bite_finish_rd(self.db, o, self.db.get(models.Empleado, self.nestor))
        c = self.copias()[0]
        self.assertEqual((r["finish"], c.hora_fin, c.etapa, c.estado), ("09:15", "09:15", "Denture design", "Ready to design"))
        self.assertEqual(push.call_args[0][0], [self.nestor])
        self.assertEqual(sd.estado_bite_rd(self.db, [o.id]), {o.id: "hecho"})
        with self.assertRaises(ValueError):   # dos veces no
            sd.bite_finish_rd(self.db, o, self.db.get(models.Empleado, self.nestor))
        o.hora_inicio = "07:00"; self.db.commit()
        sd.sincronizar_copia_rd(self.db, o)   # ya terminado: la original ya no le cambia las horas de Bite
        self.assertEqual(self.copias()[0].hora_inicio, "08:00")

    def test_push_a_nestor_al_asignarle(self):
        from app import services_design_push as spush
        with mock.patch.object(spush, "enviar_en_segundo_plano") as push:
            o = self.orden("Removable denture")
            self.assertEqual(push.call_count, 1)
            self.assertEqual(push.call_args[0][0], [self.nestor])
            self.assertIn("A1", push.call_args[0][2])
            o.paciente = "Otro"; self.db.commit()
            sd.sincronizar_copia_rd(self.db, o)   # actualizar la copia no avisa otra vez
            self.assertEqual(push.call_count, 1)
            o2 = self.md.DesignOrden(team_id=self.t3.id, fecha=sd.date(2026, 10, 20), tabla="principal", orden="b2", producto="Removable")
            self.db.add(o2); self.db.commit()
            sd.sincronizar_copia_rd(self.db, o2, avisar=False)   # la pasada de órdenes viejas no avisa
            self.assertEqual(push.call_count, 1)

    def test_quitar_producto_borra_si_no_empezo(self):
        o = self.orden("Removable denture")
        o.producto = "Implant Bar"; self.db.commit()
        sd.sincronizar_copia_rd(self.db, o)
        self.assertEqual(self.copias(), [])

    def test_si_ya_empezo_se_queda(self):
        o = self.orden("Removable denture")
        c = self.copias()[0]; c.estado, c.hora_inicio = "Initiated", "08:00"; self.db.commit()
        oid = o.id
        self.db.delete(o); self.db.commit()
        sd.sincronizar_copia_rd(self.db, None, borrada=True, origen_id=oid)
        self.assertEqual(len(self.copias()), 1)

    def test_borrada_en_rd_no_vuelve(self):
        o = self.orden("Removable denture")
        self.db.delete(self.copias()[0]); self.db.commit()
        sd.sincronizar_copia_rd(self.db, o)
        self.assertEqual(self.copias(), [])

    def test_traslado_no_separa_copia_y_original(self):
        o = self.orden("Removable denture")
        o.estado = "Initiated"; self.db.commit()   # la original se trabaja; la copia sigue en Ready to design
        sd._traslado_hecho_hasta = None
        sd.trasladar_holds(self.db, ahora=sd.datetime(2026, 10, 21, 6, 0))
        self.assertEqual(self.copias()[0].fecha, sd.date(2026, 10, 20))
        c = self.copias()[0]; c.fecha = sd.date(2026, 10, 21); self.db.commit()   # una copia que ya quedó corrida
        self.assertEqual(sd.alinear_copias_rd(self.db), 1)
        self.assertEqual(self.copias()[0].fecha, sd.date(2026, 10, 20))


if __name__ == "__main__":
    unittest.main()
