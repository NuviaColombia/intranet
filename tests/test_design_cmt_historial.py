"""Comments N3 (28-oct-2026, Rosember): cada persona ve y borra solo su historial, también managers y admins."""
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import services_design as sd
from app.database import Base


class HistorialPorPersona(unittest.TestCase):
    def setUp(self):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(eng)
        self.db = sessionmaker(bind=eng)()
        mk = lambda n, rol: models.Empleado(nombres=n, apellidos="X", email=f"{n}@x.com", rol=rol, activo=True,
                                            empresa=models.EMPRESA_DESIGN, cargo="x", area="x", identificacion=n)
        self.ana, self.mgr, self.adm = mk("Ana", "empleado"), mk("Mgr", "aprobador"), mk("Adm", "admin")
        self.db.add_all([self.ana, self.mgr, self.adm]); self.db.commit()
        for u in (self.ana, self.mgr, self.adm):
            sd.guardar_historial_comentario(self.db, u, f"Paciente {u.nombres}", "O1", {"b4": u.nombres})

    def test_cada_uno_ve_solo_lo_suyo(self):
        for u in (self.ana, self.mgr, self.adm):
            self.assertEqual([h["paciente"] for h in sd.historial_comentarios(self.db, u)], [f"Paciente {u.nombres}"], u.nombres)

    def test_no_se_borra_lo_de_otro(self):
        h_ana = sd.historial_comentarios(self.db, self.ana)[0]["id"]
        self.assertFalse(sd.eliminar_historial_comentario(self.db, self.adm, h_ana))
        self.assertEqual(len(sd.historial_comentarios(self.db, self.ana)), 1)
        self.assertTrue(sd.eliminar_historial_comentario(self.db, self.ana, h_ana))
        self.assertEqual(sd.historial_comentarios(self.db, self.ana), [])


if __name__ == "__main__":
    unittest.main()
