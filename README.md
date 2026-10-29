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

## 🎮 Interfaz y Menú Principal (Diseño Limpio)

La interfaz se ha rediseñado con un **Dock Inferior Central** (estilo SimCity / Cities Skylines) para mantener la vista 3D completamente despejada:

* 🖱️ **Inspeccionar (Puntero):** Al tocar cualquier edificio, aparece una tarjeta compacta con sus datos y botones de alquiler.
* 🔨 **Construir:** Abre el catálogo clasificado en 4 pestañas:
  * 🛣️ **Vialidad:** Calles asfaltadas (arrastre libre).
  * 🏠 **Viviendas:** Casas familiares (400 Ø), Sobrados (900 Ø), Edificios departamentales (2.2k Ø).
  * 🏪 **Comercio:** Tiendas comerciales (1.1k Ø), Estaciones de servicio (1.8k Ø).
  * ⚡ **Servicios:** Parques ecológicos (600 Ø), Usinas eléctricas (2.8k Ø), Tanques de agua (2.0k Ø).
* 💼 **Empleo:** Abre el centro de trabajo para cumplir turnos y cobrar salario de +350 Oikos.
* 🗺️ **Ciudad:** Despliega el plano urbano (Mini-Mapa) y los ciudadanos en línea.
* 💥 **Demoler:** Activa el modo demolición.
* 👑 **Alcaldía (Exclusivo Admin):** Acceso al panel de control municipal para inyectar fondos o restaurar la ciudad.

---

## 👑 Sistema de Roles: Administrador vs Ciudadano

La pantalla de ingreso cuenta ahora con selector de roles:

### 1. 👤 Modo Ciudadano (Jugador Normal)
* Registro libre mediante **Firebase Authentication** (Correo/Contraseña, Google o Invitado).
* Inicia con **1,000 Oikos**.
* Debe trabajar cumpliendo turnos para ganar salarios y pagar alquileres.

### 2. 👑 Modo Administrador (Alcalde Municipal)
* Pestaña exclusiva **Administrador**.
* Credenciales Oficiales de Alcaldía:
  * **Correo:** `katuetecity@katuete.com`
  * **Contraseña:** `juniorceo0905`
* **Poderes de Alcalde:**
  * **Oikos Ilimitados (`∞`)** y construcciones gratuitas a costo cero.
  * Botón exclusivo **👑 Panel Admin** en el HUD.
  * Opciones del panel: Inyectar +100.000 Oikos, Demoler toda la ciudad, Liberar todas las viviendas y Restaurar el trazado urbano inicial.

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
