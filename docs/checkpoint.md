# Checkpoint

Dónde quedó el trabajo, para retomarlo sin releer la conversación. Se reescribe al cerrar cada sesión; el detalle de
cada cambio está en [`arreglos.md`](arreglos.md), con su commit.

## 2026-10-12, al cerrar

**En producción: `53693f6`.** Lo subió el usuario en la tarde y se revisó en `/_salud`:

| Qué | Estado |
|---|---|
| Versión | `53693f6`, Node 24 |
| Procesos | confia, dunor, hrc y consola vivos, sin caídas |
| Páginas | portada, consola y los tres tableros en 200 |
| `pnpm test` | 1.865 comprobaciones, cero fallos |

**Qué entró hoy.**

- **Mañana:** guardas contra inyección, tope de gasto por cliente, sedes, el «¿por qué?» de cada respuesta, claves
  tapadas, retención automática (apagada) y sedes en el alta.
- **Tarde:** el orden de un CRM tipo Attio en el tablero (próximo paso, valor, historia con notas, «3 de 23»,
  fijados, listas), la consola con la piel del tablero y su color a gusto de cada quien, y la portada con la mitad
  del texto.

**Para mirar.**

- `/_salud` avisa que DUNOR no recibe mensajes hace 3 días y HRC hace 17. Viene de antes del despliegue. Si DUNOR
  está atendiendo, conviene revisar su WhatsApp.
- La clave de OpenAI del `.env` de la raíz de este Mac da 401. La buena termina en «MMA».
- La retención sigue apagada en todos. Encenderla, con cuántos días y en qué clientes, lo decide el usuario.
- «Míos» y los fijados van por el nombre con el que firma cada quien. Dos con el mismo nombre los comparten.

**Cómo retomar.**

```bash
pnpm test                                        # todo, sin modelo
curl -s https://aiva.hrctechnologies.com/_salud  # qué corre y si está bien
pnpm paquete                                     # el ZIP para Hostinger
```
