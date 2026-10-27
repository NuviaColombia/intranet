"""Development (services_design_dev): quién entra y las reglas que el servidor hace cumplir. SQLite en memoria."""
import io
import unittest
from datetime import date, timedelta
from types import SimpleNamespace

from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app import models_design  # noqa: F401
from app import services_design_dev as sdv
from app.database import Base
from app.models import EMPRESA_DESIGN, Empleado


def png() -> bytes:
    b = io.BytesIO(); Image.new("RGB", (40, 30), (0, 90, 200)).save(b, "PNG"); return b.getvalue()


class Dev(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        self.yo = Empleado(nombres="Luis Felipe", apellidos="Blaschke", email="luisblaschke@nuviasmiles.com", rol="empleado",
                           activo=True, empresa=EMPRESA_DESIGN, cargo="x", area="x", identificacion="1")
        self.db.add(self.yo); self.db.commit()
        hoy = date.today()
        self.p = sdv.crear(self.db, self.yo, {"name": "Portal", "type": "Desarrollo", "ownerId": str(self.yo.id),
                                              "priority": "alta", "startDate": hoy.isoformat(),
                                              "dueDate": (hoy + timedelta(days=30)).isoformat()})
        self.pid = self.p["id"]

    def err(self, fn, *a):
        with self.assertRaises(sdv.ErrorDev) as c:
            fn(*a)
        return c.exception

    def test_acceso(self):
        u = lambda email, rol="empleado": SimpleNamespace(email=email, rol=rol, activo=1)
        self.assertFalse(sdv.tiene_acceso(u("x@y.com", "admin")))           # de los admins, solo Rosember (27-oct-2026)
        self.assertTrue(sdv.tiene_acceso(u("Rosember@nuviasmiles.com", "admin")))
        self.assertTrue(sdv.tiene_acceso(u("Paul.Andion@nuviasmiles.com")))
        self.assertTrue(sdv.tiene_acceso(u("luisblaschke@nuviasmiles.com")))
        self.assertFalse(sdv.tiene_acceso(u("otra@nuviasmiles.com")))
        self.assertFalse(sdv.tiene_acceso(None))

    def test_crear_valida(self):
        self.assertEqual(self.p["code"], "PRJ-001")
        e = self.err(sdv.crear, self.db, self.yo, {"name": "ab", "type": "Protocolo", "priority": "x", "startDate": "2026-10-10",
                                                   "dueDate": "2026-10-01"})
        self.assertEqual(e.status, 422)
        self.assertTrue(any("responsable" in d for d in e.details))
        self.assertTrue(any("anterior al inicio" in d for d in e.details))
        self.assertTrue(any("Protocolo" in d for d in e.details))

    def test_etapas_y_controles(self):
        e = self.err(sdv.cambiar_etapa, self.db, self.yo, self.pid, "aprobado", "")
        self.assertEqual(e.status, 409)
        self.assertIn("Aprobado: Al menos 1 riesgo identificado", e.details)
        for k in ("obj", "alc", "sponsor"):
            sdv.marcar_control(self.db, self.yo, self.pid, k, True)
        sdv.guardar_riesgo(self.db, self.yo, self.pid, {"title": "Caída", "prob": 2, "impact": 2, "status": "abierto",
                                                        "ownerId": str(self.yo.id)})
        p = sdv.cambiar_etapa(self.db, self.yo, self.pid, "aprobado", "")
        self.assertEqual(p["status"], "aprobado")
        self.assertEqual(self.err(sdv.marcar_control, self.db, self.yo, self.pid, "obj", False).status, 409)
        self.assertEqual(self.err(sdv.cambiar_etapa, self.db, self.yo, self.pid, "propuesta", "no").status, 422)
        self.assertEqual(sdv.cambiar_etapa(self.db, self.yo, self.pid, "pausado", "Sin servidor")["status"], "pausado")
        self.assertIn("Motivo: Sin servidor", sdv.uno(self.db, int(self.pid))["log"][-1]["msg"])

    def test_riesgos(self):
        e = self.err(sdv.guardar_riesgo, self.db, self.yo, self.pid, {"title": "Grave", "prob": 5, "impact": 3, "status": "abierto",
                                                                      "ownerId": str(self.yo.id)})
        self.assertIn("Los riesgos críticos (≥15) requieren plan de mitigación", e.details)
        p = sdv.guardar_riesgo(self.db, self.yo, self.pid, {"title": "Grave", "prob": 5, "impact": 3, "status": "abierto",
                                                            "mitigation": "Plan", "ownerId": str(self.yo.id)})
        rid = p["risks"][0]["id"]
        self.assertEqual(self.err(sdv.eliminar_riesgo, self.db, self.yo, self.pid, rid).status, 409)

    def test_evidencias(self):
        self.assertEqual(self.err(sdv.marcar_control, self.db, self.yo, self.pid, "tests", True).status, 409)
        meta = [{"stage": "qa", "gate": "tests", "caption": "CI verde", "w": 40, "h": 30, "name": "ci.png"}]
        e = self.err(sdv.agregar_evidencias, self.db, self.yo, self.pid, [b"no es imagen"], meta)
        self.assertTrue(any("archivo inválido" in d for d in e.details))
        e = self.err(sdv.agregar_evidencias, self.db, self.yo, self.pid, [png()], [{**meta[0], "gate": "obj"}])
        self.assertTrue(any("no pertenece" in d for d in e.details))
        e = self.err(sdv.agregar_evidencias, self.db, self.yo, self.pid, [png() + b"0" * sdv.MAX_EVIDENCIA], meta)
        self.assertTrue(any("1 MB" in d for d in e.details))
        p = sdv.agregar_evidencias(self.db, self.yo, self.pid, [png()], meta)
        self.assertEqual(p["evidence"][0]["mime"], "image/png")
        sdv.marcar_control(self.db, self.yo, self.pid, "tests", True)
        ev = p["evidence"][0]["id"]
        self.assertEqual(self.err(sdv.eliminar_evidencia, self.db, self.yo, self.pid, ev).status, 409)
        self.assertEqual(self.err(sdv.editar_evidencia, self.db, self.yo, self.pid, ev,
                                  {"stage": "qa", "gate": "cr", "caption": "CI verde"}).status, 409)
        muchas = [png()] * (sdv.MAX_EVIDENCIAS_PROYECTO)
        e = self.err(sdv.agregar_evidencias, self.db, self.yo, self.pid, muchas, meta * len(muchas))
        self.assertTrue(any("Máximo" in d for d in e.details))

    def test_apoyo(self):
        otra = Empleado(nombres="eva", apellidos="ruiz", email="eva@x.com", rol="empleado", activo=True,
                        empresa=EMPRESA_DESIGN, cargo="x", area="x", identificacion="2")
        fuera = Empleado(nombres="Ana", apellidos="Smiles", email="ana@x.com", rol="empleado", activo=True,
                         empresa="Nuvia Smiles Colombia SAS", cargo="x", area="x", identificacion="3")
        self.db.add_all([otra, fuera]); self.db.commit()
        ids = [str(otra.id), str(otra.id), str(self.yo.id), str(fuera.id)]   # repetida, el principal y otra empresa: fuera
        p = sdv.editar(self.db, self.yo, self.pid, {"supportIds": ids})
        self.assertEqual(p["support"], [{"id": str(otra.id), "name": "Eva Ruiz"}])
        self.assertIn("Apoyo: — → Eva Ruiz", p["log"][-1]["msg"])
        e = self.err(sdv.editar, self.db, self.yo, self.pid, {"supportIds": [str(otra.id)] * 11})
        self.assertIn("Máximo 10 personas de apoyo", e.details)
        p = sdv.guardar_riesgo(self.db, self.yo, self.pid, {"title": "Caída", "prob": 2, "impact": 2, "status": "cerrado",
                                                            "ownerId": str(self.yo.id), "supportIds": [str(otra.id)]})
        self.assertEqual(p["risks"][0]["support"][0]["name"], "Eva Ruiz")
        sdv.eliminar_riesgo(self.db, self.yo, self.pid, p["risks"][0]["id"])
        sdv.eliminar(self.db, self.yo, self.pid)
        self.assertEqual(self.db.query(models_design.DesignDevApoyo).count(), 0)

    def test_ingles(self):
        self.assertEqual(sdv.traducir("Datos inválidos"), "Invalid data")
        self.assertEqual(sdv.traducir('No se puede pasar a "Lanzado": faltan controles'), 'Can\'t move to "Launched": checks missing')
        self.assertEqual(sdv.traducir("En pruebas (QA): Code review aprobado"), "In testing (QA): Code review approved")
        self.assertEqual(sdv.traducir("Imagen 3: supera 1 MB después de optimizar"), "Image 3: over 1 MB after optimizing")
        self.assertEqual(sdv.traducir("Algo nuevo"), "Algo nuevo")
        # todos los mensajes fijos del servicio tienen traducción
        import inspect, re as _re
        fuente = inspect.getsource(sdv)
        fijos = set(_re.findall(r'(?:ErrorDev\(\d+, |errores\.append\()"([^"{]+)"', fuente))
        self.assertEqual(sorted(m for m in fijos if sdv.traducir(m) == m), [])

    def test_eliminar_y_posts(self):
        post = sdv.guardar_post(self.db, self.yo, {"title": "Guía", "body": "Texto de más de diez", "category": "guia",
                                                   "projectId": self.pid, "links": [{"label": "", "url": "https://www.nuvia.com/x"}]})
        self.assertEqual(post["links"][0]["label"], "nuvia.com")
        e = self.err(sdv.guardar_post, self.db, self.yo, {"title": "Mal", "body": "Texto de más de diez", "category": "guia",
                                                          "links": [{"label": "x", "url": "javascript:alert(1)"}]})
        self.assertTrue(any("http" in d for d in e.details))
        sdv.marcar_post(self.db, self.yo, post["id"], "util", True)
        self.assertEqual(sdv.listar_posts(self.db, self.yo)[0]["useful"], 1)
        sdv.eliminar(self.db, self.yo, self.pid)   # en Propuesta sí se puede
        self.assertEqual(sdv.listar(self.db), [])
        self.assertEqual(sdv.listar_posts(self.db, self.yo)[0]["projectId"], "")


if __name__ == "__main__":
    unittest.main()


class SoloRosemberEntreAdmins(unittest.TestCase):
    """27-oct-2026: de los admins, solo Rosember ve Training (Plataforma y Pizarrón) y Development."""

    def test_training(self):
        from app import services_design_training as st
        u = lambda email, rol: SimpleNamespace(email=email, rol=rol, activo=1)
        self.assertTrue(st.puede_ver(u("rosember@nuviasmiles.com", "admin")))
        self.assertFalse(st.puede_ver(u("otro.admin@nuviasmiles.com", "admin")))
        self.assertFalse(st.puede_ver(u("rosember@nuviasmiles.com", "empleado")))
