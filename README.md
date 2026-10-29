# 🏙️ KatueteCity — La Ciudad de la Integración

Juego 3D en el navegador de construcción de ciudades y simulación económica con la moneda local **Oikos**, desarrollado con **Three.js**, **WebGL** y **Firebase Authentication**.

---

## 🔐 Autenticación con Google Firebase

El juego cuenta con un sistema de cuentas seguro y persistente gracias a **Firebase Authentication**:
* **Iniciar Sesión / Crear Cuenta con Correo y Contraseña.**
* **Iniciar Sesión con Google (un solo clic).**
* **Auto-Login:** Si cierras la pestaña o recargas, tu sesión se mantiene abierta.
* **Persistencia por Usuario:** Tus Oikos y tus casas alquiladas se asocian de forma única a tu `User ID` de Firebase.

---

## ⚙️ Pasos Finales en tu Consola de Firebase

Para que el inicio de sesión funcione tanto en tu computadora (`localhost`) como en **GitHub Pages**:

1. Ingresa a [Firebase Console](https://console.firebase.google.com/) y abre tu proyecto **`katuetecity`**.
2. Ve a **Authentication** ➔ pestaña **Sign-in method**:
   * Asegúrate de habilitar **Correo electrónico / Contraseña**.
   * Habilita **Google** (si deseas permitir inicio de sesión con Google).
3. Ve a la pestaña **Settings** (Ajustes de Authentication) ➔ **Authorized domains** (Dominios autorizados):
   * Verifica que esté `localhost`.
   * Agrega el dominio de tu GitHub Pages: **`TU_USUARIO.github.io`** (sin `https://`).

---

## 🚀 Cómo Hospedar en GitHub Pages

1. Abre tu terminal en la carpeta del proyecto:
   ```bash
   git add .
   git commit -m "Integracion completa de Firebase Authentication en KatueteCity"
   git push origin main
   ```
2. En tu repositorio de GitHub, ve a **Settings** ➔ **Pages**.
3. En **Branch**, selecciona `main` y guarda.
4. Tu juego estará disponible públicamente en:
   👉 **`https://TU_USUARIO.github.io/KatueteCity/`**
