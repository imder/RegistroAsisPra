# Configurar la sincronización (una sola vez, ~10 minutos, gratis)

Los datos se guardan en tu propio proyecto de Firebase (Google), protegidos con tu cuenta de Google. Solo tú puedes leerlos.

## 1. Crear el proyecto
1. Entra a https://console.firebase.google.com con tu cuenta de Google.
2. **Agregar proyecto** → ponle un nombre (ej. `registro-escolar`) → desactiva Google Analytics → **Crear proyecto**.

## 2. Activar el inicio de sesión con Google
1. Menú **Compilación → Authentication → Comenzar**.
2. Pestaña **Sign-in method** → **Google** → *Habilitar* → elige tu correo de asistencia → **Guardar**.
3. Pestaña **Settings → Dominios autorizados → Agregar dominio** y escribe tu dominio de GitHub Pages, por ejemplo `tuusuario.github.io` (solo el dominio, sin `https://` ni la ruta).

## 3. Crear la base de datos
1. **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: elige `southamerica-east1` (São Paulo) u otra cercana → **Siguiente** → modo **producción** → **Habilitar**.
3. Pestaña **Reglas**: borra todo, pega esto y pulsa **Publicar**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 4. Copiar la configuración a la app
1. Engranaje ⚙ → **Configuración del proyecto** → sección **Tus apps** → icono web `</>` → ponle un nombre → **Registrar app**.
2. Copia los valores de `firebaseConfig` y pégalos en el archivo **`firebase-config.js`** (reemplazando los de ejemplo).
3. Sube a tu repositorio de GitHub los archivos de esta carpeta (reemplazando los anteriores) y espera 1–2 minutos a que GitHub Pages publique.

> Esos valores no son secretos: lo que protege tus datos son las reglas del paso 3 y tu inicio de sesión.

## 5. Usar en cada dispositivo
1. Abre la app (con internet la primera vez) → toca el icono **☁** → **Iniciar sesión con Google**. Usa **la misma cuenta** en celular y computadora.
2. El punto del icono ☁ indica el estado: verde = sincronizado, amarillo = subiendo / sin conexión, rojo = error, blanco = sin sesión, gris = sin configurar.
3. En el dispositivo que ya tiene tus datos, inicia sesión primero: se suben solos. En los demás, al iniciar sesión se descargan.

## Cómo funciona
- Funciona sin internet; los cambios se suben cuando vuelve la conexión.
- La sincronización es **por curso**: si el mismo curso se modifica en dos dispositivos a la vez sin conexión, se queda la versión editada más recientemente. Para evitar pérdidas, deja que el celular sincronice (punto verde) antes de editar en la computadora.
- Eliminar un curso lo elimina en todos tus dispositivos.
- Sigue disponible **⋮ → Copia de seguridad (.json)** como respaldo adicional.
- Si no inicias sesión, la app sigue funcionando solo con datos locales.
