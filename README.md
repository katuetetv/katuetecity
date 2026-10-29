# 🏙️ KatueteCity — La Ciudad de la Integración

Juego 3D en el navegador de construcción de ciudades y simulación económica con la moneda local **Oikos**, desarrollado con **Three.js**, **WebGL** y **WebSockets (Socket.io)**.

---

## 🚀 Cómo Hospedar en GitHub Pages (Paso a Paso)

Este proyecto está 100% optimizado para funcionar como sitio web estático en **GitHub Pages**.

### Paso 1: Crear un nuevo repositorio en GitHub
1. Ingresa a tu cuenta de [GitHub](https://github.com).
2. Haz clic en **New repository** (Nuevo repositorio).
3. Nómbralo por ejemplo: `KatueteCity`.
4. Elige que sea **Público** y haz clic en **Create repository**.

### Paso 2: Subir los archivos
Abre tu terminal en la carpeta del proyecto (`c:\Users\59598\Downloads\KatueteCity`) y ejecuta:

```bash
git init
git add .
git commit -m "Lanzamiento KatueteCity con economia Oikos"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/KatueteCity.git
git push -u origin main
```
*(Reemplaza `TU_USUARIO` con tu nombre de usuario de GitHub)*

### Paso 3: Activar GitHub Pages
1. En tu repositorio de GitHub, ve a la pestaña **Settings** (Configuración).
2. En el menú de la izquierda, haz clic en **Pages**.
3. En **Branch** (Rama), selecciona `main` y la carpeta `/(root)`.
4. Haz clic en **Save** (Guardar).
5. Espera unos segundos y GitHub te proporcionará el enlace público de tu juego:
   `https://TU_USUARIO.github.io/KatueteCity/`

---

## 🎮 Mecánicas del Juego

* **🪙 Economía en Oikos:** Inicias con 1,000 Oikos de capital.
* **💼 Sistema de Trabajo:** Haz clic en **Trabajar (+350 Oikos)** para cumplir turnos laborales y cobrar tu salario.
* **🔑 Alquiler de Viviendas:** Selecciona casas familiares, sobrados o edificios departamentales y haz clic en **Alquilar Vivienda** por 150 Oikos/ciclo.
* **🔨 Construcción Libre:** Traza calles arrastrando con el ratón y construye casas, tiendas, estaciones de servicio, usinas y tanques de agua potable.
* **🔄 Rotación de Edificios:** Pulsa la tecla <kbd>R</kbd> antes de colocar cualquier edificio.
* **💾 Guardado en el Navegador:** Guarda el estado de tu ciudad en cualquier momento con el botón **Guardar**.

