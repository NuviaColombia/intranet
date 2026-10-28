"""Accounts Payable (dentro de Pagos): cuentas por pagar de Smiles y Design, con el mismo flujo que
ya usaban en Excel -- Pendiente → Aprobado → Pagado -- ver docs/wiki/caja_menor.md, sección Pagos."""
from datetime import date, datetime
from sqlalchemy import String, Date, DateTime, Float, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base

EMPRESAS_AP = [("Smiles", "Nuvia Smiles"), ("Design", "Nuvia Design")]

ESTADO_PENDIENTE = "PENDIENTE"
ESTADO_APROBADO = "APROBADO"
ESTADO_PAGADO = "PAGADO"
ESTADO_OTRO = "OTRO"   # casos del histórico que no entran en el flujo normal (Rejected, Postponed, Credit, Quote, "-"...)
ESTADOS_AP = (ESTADO_PENDIENTE, ESTADO_APROBADO, ESTADO_PAGADO, ESTADO_OTRO)


class CuentaPorPagar(Base):
    __tablename__ = "pagos_cuentas_por_pagar"

    id: Mapped[int] = mapped_column(primary_key=True)
    empresa: Mapped[str] = mapped_column(String(20))  # "Smiles" | "Design"
    fecha: Mapped[date | None] = mapped_column(Date, nullable=True)
    proveedor_nit: Mapped[str] = mapped_column(String(30), default="")
    proveedor_nombre: Mapped[str] = mapped_column(String(200), default="")
    categoria: Mapped[str] = mapped_column(String(100), default="")
    detalle: Mapped[str] = mapped_column(Text, default="")
    documento: Mapped[str] = mapped_column(String(100), default="")
    valor: Mapped[float] = mapped_column(Float, default=0)
    valor_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    fecha_vencimiento: Mapped[date | None] = mapped_column(Date, nullable=True)
    estado: Mapped[str] = mapped_column(String(20), default=ESTADO_PENDIENTE)
    estado_original: Mapped[str] = mapped_column(String(40), default="")  # texto crudo del Excel para los "OTRO"
    aprobado_por: Mapped[str] = mapped_column(String(100), default="")  # "Leslie" | "Oscar" | nombre de quien aprobó
    fecha_aprobacion: Mapped[date | None] = mapped_column(Date, nullable=True)
    fecha_pago: Mapped[date | None] = mapped_column(Date, nullable=True)
    comentarios: Mapped[str] = mapped_column(Text, default="")
    creado_por_id: Mapped[int | None] = mapped_column(ForeignKey("empleados.id"), nullable=True)
    creado_en: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    importado_de_excel: Mapped[bool] = mapped_column(Boolean, default=False)
