"""Desempeño › Selección asistida (21-oct-2026): percentiles por área, suavizado de tasas, ausencias y categorías."""
import unittest
from datetime import date, datetime, timedelta
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import models_design as md
from app import services_design as sd
from app import services_design_seleccion as ssel
from app.database import Base


class Seleccion(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        p = mock.patch.object(sd, "ahora_colombia", return_value=datetime(2026, 11, 5, 10, 0)); p.start(); self.addCleanup(p.stop)

    def emp(self, nombre, rol="empleado"):
        e = models.Empleado(nombres=nombre, apellidos="X", email=f"{nombre}@x.com", rol=rol, activo=True,
                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=nombre)
        self.db.add(e); self.db.commit()
        return e

    def equipo(self, area, nombre, manager, miembros):
        a = self.db.query(md.DesignArea).filter_by(nombre=area).first()
        if not a:
            a = md.DesignArea(nombre=area, formato="n3"); self.db.add(a); self.db.commit()
        t = md.DesignTeam(area_id=a.id, nombre=nombre, manager_id=manager.id, orden=1, activo=1); self.db.add(t); self.db.commit()
        for m in miembros:
            self.db.add(md.DesignTeamDesigner(team_id=t.id, empleado_id=m.id))
        self.db.commit()
        return t

    def casos(self, t, e, n, hallazgos=0, inicio=0):
        dias = [date(2026, 10, 1) + timedelta(days=i) for i in range(31) if (date(2026, 10, 1) + timedelta(days=i)).weekday() < 5]
        for i in range(n):
            self.db.add(md.DesignOrden(team_id=t.id, fecha=dias[i % len(dias)], tabla="principal", orden=f"{e.nombres}{inicio + i}",
                                       centro="C", producto="Crown", designer_id=e.id, estado="Approved",
                                       qc=True, qc_reporte="Hallazgo" if i < hallazgos else "", orden_visual=i))
        self.db.commit()

    def test_categorias_y_reglas(self):
        admin = self.emp("Admin", "admin")
        luisa, paula, sofi = self.emp("Luisa", "aprobador"), self.emp("Paula", "aprobador"), self.emp("Sofi", "aprobador")
        a, b, c, d = self.emp("Ana"), self.emp("Beto"), self.emp("Caro"), self.emp("Dani")
        f1, f2, poco = self.emp("Fede"), self.emp("Gina"), self.emp("Poco")
        t3 = self.equipo("N3 Prosthetic", "Eq Luisa", luisa, [a, b, poco])
        t6 = self.equipo("N6 Material Changes", "Eq Paula", paula, [c, d])
        tf = self.equipo("Face Design", "Eq Sofi", sofi, [f1, f2])
        self.casos(t3, a, 60)                 # mucho y sin hallazgos
        self.casos(t3, b, 40, hallazgos=8)
        self.casos(t3, poco, 4)               # no llega al mínimo de casos
        self.casos(t6, c, 30, hallazgos=0)
        self.casos(t6, d, 30, hallazgos=6)
        self.casos(tf, f1, 25, hallazgos=0)
        self.casos(tf, f2, 50)
        r = ssel.analizar(self.db, 2026, 10)
        cat = {x["clave"]: x for x in r["categorias"]}
        self.assertEqual(r["habiles"], 22)
        self.assertEqual(cat["n3n6"]["candidatos"][0]["nombre"], "Ana X")
        self.assertIn(cat["n3n6b"]["candidatos"][0]["nombre"], ("Caro X",))
        self.assertEqual(cat["n2face"]["candidatos"][0]["nombre"], "Gina X")
        self.assertEqual({x["nombre"] for x in r["noCompiten"]}, {"Poco X", "Beto X", "Dani X"})   # con hallazgos de QC: fuera
        self.assertIn("hallazgos de QC", next(x for x in r["noCompiten"] if x["nombre"] == "Beto X")["motivo"])
        self.assertTrue(all(x["area"] in ("N3 Prosthetic", "N6 Material Changes") for x in cat["n3n6"]["candidatos"]))
        self.assertEqual([m["nombre"] for m in cat["manager"]["candidatos"]][:3].__len__(), 3)
        ganadores = [cat[k]["candidatos"][0]["id"] for k in ("n2face", "n3n6", "n3n6b", "mvp")]
        self.assertEqual(len(set(ganadores)), 4)   # nadie se repite
        self.assertEqual(cat["mvp"]["candidatos"][0]["nombre"], "Fede X")
        todos = [f["id"] for k in ("n2face", "n3n6", "n3n6b", "mvp") for f in cat[k]["candidatos"]]
        self.assertEqual(len(todos), len(set(todos)))   # ni en «Siguientes» se repite un nombre
        g = cat["n2face"]["candidatos"][0]
        self.assertTrue(g["porQue"]["fuertes"])
        self.assertIn("Evaluación del líder", g["faltan"])   # no hay hojas de Desempeño: el peso se reparte

    def test_ausencias_no_castigan(self):
        self.emp("Admin", "admin")
        m = self.emp("Luisa", "aprobador")
        a, b = self.emp("Ana"), self.emp("Beto")
        t = self.equipo("N3 Prosthetic", "Eq", m, [a, b])
        vac = models.TipoPermiso(nombre="Vacaciones", es_vacaciones=1); self.db.add(vac); self.db.commit()
        self.db.add(models.Solicitud(empleado_id=b.id, tipo_id=vac.id, fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 10, 9),
                                     dias=7, estado="aprobada")); self.db.commit()
        self.casos(t, a, 44)          # 22 días: 2 por día
        self.casos(t, b, 33)          # 15 días disponibles: 2,2 por día → más productivo aunque hizo menos
        r = ssel.analizar(self.db, 2026, 10)
        p = {x["nombre"]: x["percentiles"]["productividad"] for c in r["categorias"] if c["tipo"] == "disenador" for x in c["candidatos"]}
        self.assertGreater(p["Beto X"], p["Ana X"])

    def test_mes_anterior_y_suavizado(self):
        self.assertEqual(ssel.mes_anterior(date(2026, 11, 3)), (2026, 10))
        self.assertEqual(ssel.mes_anterior(date(2027, 1, 15)), (2026, 12))
        # 0 hallazgos en 3 casos no es mejor que 2 en 80 cuando el área tiene 5 %
        self.assertGreater(ssel._suavizada(0, 3, 0.05), ssel._suavizada(2, 80, 0.05) - 0.03)
        self.assertEqual(ssel._indice_mes(["Ene 2026", "Oct 2026", "Nov 2026"], 2026, 10), 1)
        self.assertEqual(ssel._indice_mes(["Septiembre", "Octubre"], 2026, 10), 1)
        self.assertIsNone(ssel._indice_mes(["Oct 2025"], 2026, 10))


    def test_lider_generoso_no_favorece_y_destacado_suma(self):
        """El líder A califica ALTO a todos; el líder B distingue (SOBRESALIENTE / MEDIO). Con la evaluación relativa a cada
        líder, los dos de A quedan en la mitad y el mejor de B arriba. Y el destacado de su manager en Selección suma."""
        import json as _json
        self.emp("Admin", "admin")
        la, lb = self.emp("Lia", "aprobador"), self.emp("Leo", "aprobador")
        a1, a2, b1, b2 = self.emp("Ana"), self.emp("Abel"), self.emp("Bea"), self.emp("Bruno")
        ta = self.equipo("N3 Prosthetic", "Eq Lia", la, [a1, a2])
        tb = self.equipo("N3 Prosthetic", "Eq Leo", lb, [b1, b2])
        for t, e in ((ta, a1), (ta, a2), (tb, b1), (tb, b2)):
            self.casos(t, e, 30)
        crit = md.DesignPerfCriterio(nombre="Calidad", orden=1); self.db.add(crit); self.db.commit()
        for nombre, notas in (("N3 Lia", {"Ana X": "ALTO", "Abel X": "ALTO"}), ("N3 Leo", {"Bea X": "SOBRESALIENTE", "Bruno X": "MEDIO"})):
            h = md.DesignPerfSheet(nombre=nombre, tipo="eval", meses=_json.dumps(["Sep 2026", "Oct 2026"]), orden=1); self.db.add(h); self.db.commit()
            for k, (persona, nivel) in enumerate(notas.items()):
                f = md.DesignPerfEmpleado(sheet_id=h.id, nombre=persona, orden=k); self.db.add(f); self.db.commit()
                self.db.add(md.DesignPerfCelda(empleado_id=f.id, criterio_id=crit.id, mes_indice=1, nivel=nivel))
        sel = md.DesignPerfSheet(nombre="SELECCION 2026", tipo="seleccion", meses=_json.dumps(["Sep 2026", "Oct 2026"]), orden=9)
        self.db.add(sel); self.db.commit()
        fila = md.DesignPerfSeleccionFila(sheet_id=sel.id, evaluador="Leo", orden=1); self.db.add(fila); self.db.commit()
        self.db.add(md.DesignPerfSeleccionCelda(fila_id=fila.id, mes_indice=1, persona="Bruno X", puntaje="9"))
        self.db.commit()
        r = ssel.analizar(self.db, 2026, 10)
        todos = {x["nombre"]: x for c in r["categorias"] if c["tipo"] == "disenador" for x in c["candidatos"]}
        self.assertEqual((todos["Ana X"]["percentiles"]["evaluacion"], todos["Abel X"]["percentiles"]["evaluacion"]), (50.0, 50.0))
        self.assertEqual((todos["Bea X"]["percentiles"]["evaluacion"], todos["Bruno X"]["percentiles"]["evaluacion"]), (100.0, 0.0))
        self.assertEqual(todos["Bruno X"]["percentiles"]["destacado"], 100.0)
        self.assertEqual(todos["Ana X"]["percentiles"]["destacado"], 0.0)
        self.assertNotIn("cambios", todos["Ana X"]["percentiles"])


    def test_carga_compensa_la_complejidad_entre_areas(self):
        """Face hace el doble de casos que N3, pero los de N3 valen más minutos estándar: el manager de N3 no queda abajo
        solo por tener menos volumen (sin tiempos registrados se usa el factor de respaldo de cada área)."""
        self.emp("Admin", "admin")
        mf, mn = self.emp("Fabi", "aprobador"), self.emp("Nico", "aprobador")
        f1, f2, n1, n2 = self.emp("Fer"), self.emp("Flor"), self.emp("Nadia"), self.emp("Noel")
        tf = self.equipo("Face Design", "Eq Fabi", mf, [f1, f2])
        tn = self.equipo("N3 Prosthetic", "Eq Nico", mn, [n1, n2])
        for e in (f1, f2):
            self.casos(tf, e, 40)
        for e in (n1, n2):
            self.casos(tn, e, 20)
        r = ssel.analizar(self.db, 2026, 10)
        man = {m["nombre"]: m for m in next(c for c in r["categorias"] if c["clave"] == "manager")["candidatos"]}
        self.assertGreater(man["Nico X"]["percentiles"]["productividad"], man["Fabi X"]["percentiles"]["productividad"])
        comp = {c["area"]: c["minutos"] for c in r["complejidad"]}
        self.assertGreater(comp["N3 Prosthetic"], comp["Face Design"])


    def test_configuracion_de_porcentajes(self):
        admin = self.emp("Admin", "admin")
        self.assertEqual(ssel.pesos(self.db), (ssel.PESOS_DISENADOR, ssel.PESOS_MANAGER))   # sin guardar: los de fábrica
        with self.assertRaises(ValueError):   # no suma 100
            ssel.guardar_pesos(self.db, {"disenador": {"productividad": 50, "evaluacion": 10, "destacado": 10, "eficiencia": 10, "puntualidad": 0},
                                         "manager": ssel.PESOS_MANAGER}, admin)
        with self.assertRaises(ValueError):   # fuera de rango
            ssel.guardar_pesos(self.db, {"disenador": {"productividad": 120, "evaluacion": -20, "destacado": 0, "eficiencia": 0, "puntualidad": 0},
                                         "manager": ssel.PESOS_MANAGER}, admin)
        nuevos = {"productividad": 60, "evaluacion": 40, "destacado": 0, "eficiencia": 0, "puntualidad": 0}
        c = ssel.guardar_pesos(self.db, {"disenador": nuevos, "manager": ssel.PESOS_MANAGER}, admin)
        self.assertEqual(c["disenador"], nuevos)
        self.assertEqual(ssel.pesos(self.db)[0], nuevos)
        # el análisis usa lo guardado y un criterio en 0 % no sale como «sin dato»
        m = self.emp("Lia", "aprobador"); a1, a2 = self.emp("Ana"), self.emp("Abel")
        t = self.equipo("N3 Prosthetic", "Eq", m, [a1, a2])
        self.casos(t, a1, 40); self.casos(t, a2, 20, inicio=500)
        r = ssel.analizar(self.db, 2026, 10)
        self.assertEqual(r["pesos"]["disenador"], nuevos)
        g = next(c for c in r["categorias"] if c["clave"] == "n3n6")["candidatos"][0]
        self.assertNotIn("Destacado por su manager", g["faltan"])
        self.assertNotIn("Eficiencia", g["faltan"])


    def test_puntualidad_de_geovictoria(self):
        from app import services_design_geovictoria as gv
        admin = self.emp("Admin", "admin")
        m = self.emp("Lia", "aprobador")
        a1, a2 = self.emp("Ana"), self.emp("Abel")
        for e, ced in ((a1, "11"), (a2, "22"), (m, "33")):
            e.identificacion = ced
        self.db.commit()
        t = self.equipo("N3 Prosthetic", "Eq", m, [a1, a2])
        self.casos(t, a1, 30); self.casos(t, a2, 30, inicio=500)
        gv.guardar(self.db, {"key": "k", "secret": "s", "avisos": False, "tolerancia": 10}, admin)
        gv._usuarios.update(t=0.0, lista=[])
        def api(c, ruta, cuerpo):
            if ruta == "/User/List":
                return [{"Identifier": x, "Enabled": "1"} for x in ("11", "22", "33")]
            if ruta == "/Consolidated/Extended":
                return [{"Identifier": x, "PaidDays": {"WorkedDays": 20}} for x in cuerpo["UserIds"].split(",")]
            tarde = {"11": 0, "22": 5, "33": 2}
            return [{"Identifier": x, "SpecialDays": [{"Date": f"202610{d + 1:02d}000000", "HasDelay": "True", "Delay": "00:10"} for d in range(tarde[x])]}
                    for x in cuerpo["UserIds"].split(",")]
        with mock.patch.object(gv, "_post", side_effect=api):
            r = ssel.analizar(self.db, 2026, 10)
        todos = {x["nombre"]: x for c in r["categorias"] if c["tipo"] == "disenador" for x in c["candidatos"]}
        self.assertGreater(todos["Ana X"]["percentiles"]["puntualidad"], todos["Abel X"]["percentiles"]["puntualidad"])
        self.assertIn("a tiempo los 20 días", " ".join(todos["Ana X"]["porQue"]["fuertes"]))
        man = next(c for c in r["categorias"] if c["clave"] == "manager")["candidatos"][0]
        self.assertEqual(man["puntualidad"], {"dias": 20, "tarde": 2, "minutos": 20})


if __name__ == "__main__":
    unittest.main()
