"""Solicitar ayuda en N3, N2 y Face (28-oct-2026): mismas condiciones en las tres; cada área pide solo a los otros equipos de
SU misma área (no se mezclan)."""
import unittest
from datetime import timedelta
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_ayuda as say
from app.database import Base


class AyudaPorArea(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        sd._DELEG_CACHE["v"] = None
        self.addCleanup(lambda: sd._DELEG_CACHE.update(v=None))
        mk = lambda n, rol="empleado": models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                                       empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.p = {n: mk(n, "aprobador" if n.startswith("M") else "empleado")
                  for n in ("M3a", "M3b", "M2a", "M2b", "MFa", "MFb", "D3a", "D3b", "D2a", "D2b", "DFa", "DFb")}
        self.db.add_all(self.p.values()); self.db.commit()
        self.area = {}
        for nombre, fmt in (("N3 Prosthetic", "dual"), ("N2 Demodenture", "n2"), ("Face Design", "single")):
            a = md.DesignArea(nombre=nombre, formato=fmt); self.db.add(a); self.area[nombre[:2]] = a
        self.db.commit()
        self.t = {}
        for clave, area in (("3", "N3"), ("2", "N2"), ("F", "Fa")):
            for suf in ("a", "b"):
                t = md.DesignTeam(area_id=self.area[area].id, nombre=f"Eq{clave}{suf}", manager_id=self.p[f"M{clave}{suf}"].id, orden=1, activo=1)
                self.db.add(t); self.db.commit()
                self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=self.p[f"D{clave}{suf}"].id)); self.db.commit()
                self.t[f"{clave}{suf}"] = t
        self.hoy = sd.ahora_colombia().date()

    def orden(self, clave, num="O1", **kw):
        o = md.DesignOrden(team_id=self.t[clave].id, fecha=self.hoy, tabla="principal", orden=num, paciente="P", centro="Atlanta",
                           producto="Full arch", designer_id=self.p["D" + clave].id, estado="Ready to design", **kw)
        self.db.add(o); self.db.commit()
        return o

    def test_aparece_para_el_manager_de_n2_y_face_hoy(self):
        for clave in ("3a", "2a", "Fa"):
            m = self.p["M" + clave]
            self.assertTrue(say.puede_pedir_en_orden(self.db, m, self.t[clave].id, self.hoy), clave)
            self.assertFalse(say.puede_pedir_en_orden(self.db, m, self.t[clave].id, self.hoy - timedelta(days=1)), clave + " ayer")
            self.assertFalse(say.puede_pedir_en_orden(self.db, m, self.t[clave[0] + "b"].id, self.hoy), clave + " otro equipo")
            self.assertFalse(say.puede_pedir_en_orden(self.db, self.p["D" + clave], self.t[clave].id, self.hoy), clave + " diseñador")

    def test_cada_area_pide_solo_a_los_de_su_area(self):
        self.assertEqual([x["nombre"] for x in say.libres_n3(self.db, excluir_equipo_id=self.t["2a"].id, area_id=self.area["N2"].id)], ["D2b X"])
        self.assertEqual([x["nombre"] for x in say.libres_n3(self.db, excluir_equipo_id=self.t["Fa"].id, area_id=self.area["Fa"].id)], ["DFb X"])
        self.assertEqual([x["nombre"] for x in say.libres_n3(self.db, excluir_equipo_id=self.t["3a"].id, area_id=self.area["N3"].id)], ["D3b X"])

    def test_solicitar_en_n2_llega_solo_al_manager_del_otro_equipo_de_n2(self):
        o = self.orden("2a")
        with mock.patch.object(say, "_avisar") as av:
            r = say.solicitar(self.db, self.p["M2a"], o.id)
        self.assertEqual(r["estado"], "abierta")
        self.assertEqual(av.call_args[0][0], [self.p["M2b"].id])         # ni N3 ni Face
        s = self.db.get(md.DesignAyudaSolicitud, r["id"])
        self.assertEqual(s.area_id, self.area["N2"].id)

    def test_sin_libres_en_su_area_dice_que_contacte_al_manager_general(self):
        # el único compañero libre de Face está ocupado (caso iniciado): no hay a quién pedirle, aunque N3 y N2 tengan libres
        ocupado = self.orden("Fb", "OF2"); ocupado.estado = "Initiated"; self.db.commit()
        o = self.orden("Fa", "OF1")
        with mock.patch.object(say, "_avisar") as av:
            r = say.solicitar(self.db, self.p["MFa"], o.id)
        self.assertEqual((r["estado"], r["mensaje"]), ("sin_disponibles", say.MSG_SIN_DISPONIBLES))
        av.assert_not_called()

    def test_no_se_pide_ayuda_para_ordenes_de_otro_equipo_ni_con_otra_area(self):
        o = self.orden("2b", "OX")
        with self.assertRaises(PermissionError):
            say.solicitar(self.db, self.p["M2a"], o.id)                   # orden del equipo de otro manager
        with self.assertRaises(PermissionError):
            say.solicitar(self.db, self.p["D2a"], o.id)                   # un diseñador no pide

    def test_elegir_asigna_la_orden_al_disenador_de_la_misma_area(self):
        o = self.orden("Fa", "OF9")
        with mock.patch.object(say, "_avisar"):
            r = say.solicitar(self.db, self.p["MFa"], o.id)
            say.elegir(self.db, self.p["MFb"], r["id"], self.p["DFb"].id)
        self.db.refresh(o)
        self.assertEqual(o.designer_id, self.p["DFb"].id)

    def test_el_reporte_filtra_por_area_y_trae_el_area(self):
        with mock.patch.object(say, "_avisar"):
            say.solicitar(self.db, self.p["M2a"], self.orden("2a", "R2").id)
            say.solicitar(self.db, self.p["MFa"], self.orden("Fa", "RF").id)
            say.solicitar(self.db, self.p["M3a"], self.orden("3a", "R3").id)
        todo = say.reporte(self.db, self.hoy, self.hoy)
        self.assertEqual(sorted(x["area"] for x in todo["items"]), ["Face Design", "N2 Demodenture", "N3 Prosthetic"])
        solo = say.reporte(self.db, self.hoy, self.hoy, self.area["N2"].id)
        self.assertEqual([(x["area"], x["orden"]) for x in solo["items"]], [("N2 Demodenture", "R2")])


if __name__ == "__main__":
    unittest.main()
