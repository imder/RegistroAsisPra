# Registro Escolar (Android + Escritorio)

App web instalable (PWA): un solo código que funciona en Android, Windows, Mac y Linux. Los datos se guardan en el propio dispositivo y funciona sin internet.

## Cómo publicarla (una sola vez)
La instalación como app requiere abrirla desde una dirección https. La forma más fácil y gratuita:

1. Entra a https://app.netlify.com/drop (o usa GitHub Pages / Cloudflare Pages).
2. Arrastra la carpeta `registro-escolar` descomprimida.
3. Te da un enlace, por ejemplo `https://algo.netlify.app`.

## Instalar
- **Android:** abre el enlace en Chrome → menú ⋮ → *Instalar aplicación* (o *Agregar a pantalla de inicio*).
- **Escritorio (Windows/Mac):** abre el enlace en Chrome o Edge → icono de instalar en la barra de direcciones → *Instalar*.

## Uso
- **⋮ → Datos del curso:** unidad, profesor, área, grado, paralelo, nivel, trimestre.
- **Estudiantes:** agrega uno por uno o *Pegar lista* (copia la columna de nombres desde Excel). Marca *Retirado* desde *Editar*.
- **Asistencia:** *+ Fecha*, luego **un toque** en una celda marca ✓ (otro toque lo borra). **Doble toque** abre un panel para elegir **L** (licencia), **B** (banda), ✓ o borrar. Toca el título de la fecha para cambiarla, marcar todos presentes o eliminarla.
- **Prácticas:** *+ Actividad* (eliges si es práctica o investigación; las prácticas muestran un icono 🖥️ antes del nombre). Un toque en una celda abre abajo un panel compacto con 100, 90, 80, 70, 60, 50 y ⌫ para borrar; activa *Siguiente* para pasar al siguiente estudiante. **Doble toque en una celda** para escribir otra nota directamente en ella: Enter guarda y baja al siguiente estudiante, Esc cancela, y vaciar la celda borra la nota.
- **Estudiante resaltado:** la fila del estudiante que estás marcando o calificando se pinta de amarillo con su nombre en negrita. Al calificar, el panel de notas aparece abajo y deja ver la tabla.
- **Ordenar columnas:** botón *Ordenar* en Asistencia y en Prácticas. Mueve cada fecha o actividad con ⤒ ▲ ▼ ⤓ (las fechas ya no se reordenan solas; *Ordenar por fecha* lo hace si lo quieres). El Excel exportado sigue ese orden.
- **Pegar de Excel:** botón *Pegar de Excel* (o Ctrl+V sobre la tabla en computadora). Copia las celdas en Excel y pégalas en el cuadro: empieza en la última celda que tocaste (puedes cambiar estudiante y columna). Si copiaste también N° y nombres, ubica a cada estudiante por nombre aunque el orden sea distinto. En Asistencia reconoce ✓, 1, Sí, P como presente; L como licencia; B como banda; y 0, F, Falta como ausente. Muestra una vista previa y *Deshacer pegado* revierte.
- **⋮ → Exportar a Excel:** genera un .xlsx con el formato de tu planilla (una hoja por curso).

## Sincronización entre celular y computadora
Ver **SINCRONIZACION.md** (Firebase, gratis, inicio de sesión con Google). Una vez configurada, el icono ☁ de la app muestra el estado.

## Copia manual entre dispositivos
En el dispositivo origen: **⋮ → Copia de seguridad (.json)**. En el destino: **⋮ → Restaurar copia de seguridad**. (Reemplaza los datos de ese dispositivo.)

## Importante
Los datos viven en el navegador de cada dispositivo. Si borras los datos del navegador o desinstalas la app, se pierden: haz copias de seguridad con frecuencia.
