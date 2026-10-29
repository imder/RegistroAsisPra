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
- **Asistencia:** *+ Fecha*, luego toca cada celda para marcar ✓. Toca el título de la fecha para cambiarla, marcar todos presentes o eliminarla.
- **Prácticas:** *+ Práctica* / *+ Investigación*; toca una celda y elige 100, 90, 70, P, P1… o escribe otra nota. Activa *Pasar al siguiente estudiante* para llenar una columna rápido.
- **⋮ → Exportar a Excel:** genera un .xlsx con el formato de tu planilla (una hoja por curso).

## Pasar datos entre celular y computadora
En el dispositivo origen: **⋮ → Copia de seguridad (.json)**. En el destino: **⋮ → Restaurar copia de seguridad**. (Reemplaza los datos de ese dispositivo.)

## Importante
Los datos viven en el navegador de cada dispositivo. Si borras los datos del navegador o desinstalas la app, se pierden: haz copias de seguridad con frecuencia.
