"""Avisa si schedule.min.js no corresponde a schedule.js (B11). Si falla: python scripts/minificar_design.py"""
import subprocess
import sys
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


class MinificadoAlDia(unittest.TestCase):
    def test_schedule_min_al_dia(self):
        r = subprocess.run([sys.executable, str(RAIZ / "scripts" / "minificar_design.py"), "--check"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
