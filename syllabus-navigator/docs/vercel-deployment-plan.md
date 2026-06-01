# Guía de Despliegue: Frontend en Vercel y Backend en la Nube

Esta guía detalla los pasos necesarios para desplegar el proyecto **Syllabus Navigator**, separando el frontend (Next.js) que vivirá en **Vercel**, y el backend (FastAPI, Postgres, Chroma) que requiere un entorno de contenedores en la nube.

## 1. Entendiendo la Arquitectura de Despliegue

Actualmente, el proyecto usa `docker-compose` para correr todo en tu computadora. Sin embargo, Vercel es una plataforma *Serverless* diseñada exclusivamente para frontends y funciones ligeras. Vercel **no puede** ejecutar contenedores Docker persistentes (como PostgreSQL o ChromaDB).

Por lo tanto, la arquitectura en producción se divide en dos:
1.  **Frontend (Next.js):** Alojado en **Vercel**.
2.  **Backend & Base de Datos:** Alojado en un proveedor cloud (ej. **Render**, **Railway**, o un **VPS** como DigitalOcean).

---

## 2. Requisitos Previos (Cuentas a crear)

Para hacer esto posible, necesitarás tener o crear cuentas gratuitas en las siguientes plataformas:
- [ ] **GitHub** (Para alojar tu código fuente).
- [ ] **Vercel** (Para alojar el Frontend).
- [ ] **Render** o **Railway** (Para alojar el Backend de FastAPI y las bases de datos).

---

## 3. Paso a Paso: Despliegue del Frontend (Vercel)

1.  **Sube tu código a GitHub:**
    *   Crea un repositorio en GitHub.
    *   Sube el proyecto `syllabus-navigator` completo.
2.  **Conecta Vercel a GitHub:**
    *   Inicia sesión en Vercel (con tu cuenta de GitHub).
    *   Haz clic en "Add New Project" y selecciona tu repositorio de GitHub.
3.  **Configura el Framework y Directorio:**
    *   Vercel detectará automáticamente que es un proyecto de Next.js.
    *   **Root Directory:** usa exactamente una de estas rutas (sin duplicar `frontend`):
        *   Repositorio **Navigator** (raíz con carpeta `syllabus-navigator/`): `syllabus-navigator/frontend`
        *   Repositorio cuya raíz **es** `syllabus-navigator/`: `frontend`
    *   **Build Command:** dejar el default de Vercel o `npm run build` (el `package.json` del front también expone `vercel-build`).
    *   **Output Directory:** dejar vacío (Next.js en Vercel no usa `out/` salvo export estático).
4.  **Variables de Entorno (Environment Variables):**
    *   En Vercel, deberás agregar la variable `NEXT_PUBLIC_API_URL`.
    *   *Nota:* Al principio, mientras pruebas, esta variable puede apuntar a un túnel temporal hacia tu backend local (usando ngrok). Más adelante, apuntará a la URL definitiva de tu backend en producción (ej. `https://mi-backend.render.com`).
5.  **Desplegar (Deploy):** Haz clic en Deploy y Vercel te dará una URL pública (ej. `https://syllabus-nav.vercel.app`).

---

## 4. Paso a Paso: Despliegue del Backend

Para que Vercel pueda comunicarse con el backend, el backend debe estar expuesto a internet.

**Opción A: Prueba Rápida con Ngrok (Tu PC como Servidor Temporal)**
Si solo quieres ver el frontend de Vercel funcionando rápido sin configurar servidores en la nube:
1. Descarga [ngrok](https://ngrok.com/) e inicia un túnel al puerto de tu backend (8000): `ngrok http 8000`
2. Copia la URL pública que te da ngrok (ej. `https://abcd-123.ngrok.app`).
3. Pon esa URL en Vercel como `NEXT_PUBLIC_API_URL`.

**Opción B: Despliegue real (Recomendado: Railway o Render)**
1.  **Railway/Render:** Ambas plataformas permiten desplegar aplicaciones basadas en Docker (tu proyecto ya usa Docker).
2.  Despliega una instancia administrada de **PostgreSQL** en la plataforma elegida y copia la URL de la base de datos a tus variables de entorno.
3.  Despliega el servicio **FastAPI** apuntando a esa base de datos.
4.  Para **ChromaDB**, al ser un servicio que guarda archivos localmente, lo ideal es usar un volumen persistente (disponible en Render y Railway) para que los vectores de tus sílabos no se borren cuando el servidor se reinicie.

---

## 5. Cambios requeridos en el Código (CORS)

Para que los navegadores web permitan que tu página alojada en Vercel haga peticiones a tu servidor FastAPI, debemos permitir el dominio de Vercel en la configuración de CORS.

Una vez que tengas tu URL de Vercel (ej. `https://syllabus-nav.vercel.app`), debes ir al archivo `backend/main.py` y actualizar la lista de orígenes permitidos:

```python
# Ejemplo en backend/main.py
from fastapi.middleware.cors import CORSMiddleware

# ...

origins = [
    "http://localhost:3000",             # Desarrollo local
    "https://syllabus-nav.vercel.app",   # URL real de Vercel (Reemplazar)
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 6. Resumen de Acciones Inmediatas
1. Crea tu repositorio en GitHub y sube el proyecto.
2. Crea tu cuenta en Vercel e importa el proyecto apuntando al directorio `frontend`.
3. Actualiza los CORS en el backend cuando tengas el dominio de Vercel.