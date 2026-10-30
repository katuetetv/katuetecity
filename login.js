/**
 * ============================================================
 * KatueteCity — Módulo de Login & Registro Independiente
 * Redirige de vuelta a index.html tras autenticarse con éxito
 * ============================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyABCa1xFEbq-kvV6FKP4LYnlOcBdrAvWdk",
  authDomain: "katuetecity.firebaseapp.com",
  projectId: "katuetecity",
  storageBucket: "katuetecity.firebasestorage.app",
  messagingSenderId: "165967285440",
  appId: "1:165967285440:web:86e49e298ec05027933125",
  measurementId: "G-57RW0C425G"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const formLogin = document.getElementById('form-login');
const campoEmail = document.getElementById('campo-email');
const campoSenha = document.getElementById('campo-senha');
const btnRegistrarse = document.getElementById('btn-registrarse');
const btnGoogle = document.getElementById('btn-google');
const btnVolver = document.getElementById('btn-volver-juego');
const msgErro = document.getElementById('msg-erro');

function guardarSesionYRedirigir(datos) {
  try {
    localStorage.setItem('katuete_session', JSON.stringify(datos));
  } catch (e) {
    console.error('Error al guardar sesión:', e);
  }
  msgErro.style.color = '#81c784';
  msgErro.textContent = '✅ ¡Acceso concedido! Redirigiendo a KatueteCity...';
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 450);
}

// 1. BOTÓN CREAR CUENTA (PRIMERO)
btnRegistrarse?.addEventListener('click', async () => {
  msgErro.style.color = '#ff8a80';
  msgErro.textContent = '';
  const email = campoEmail.value.trim();
  const password = campoSenha.value;

  if (!email || !password) {
    msgErro.textContent = 'Ingresa correo y contraseña (mínimo 6 caracteres).';
    return;
  }

  btnRegistrarse.disabled = true;
  btnRegistrarse.textContent = 'Creando cuenta...';

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const esAdmin = email.toLowerCase() === 'katuetecity@katuete.com';
    guardarSesionYRedirigir({
      uid: user.uid,
      nombre: email.split('@')[0],
      email: user.email,
      esAdmin,
      oikos: esAdmin ? 9999999 : 1000
    });
  } catch (error) {
    btnRegistrarse.disabled = false;
    btnRegistrarse.textContent = 'Crear Cuenta';
    mostrarErrorAuth(error.code, error.message);
  }
});

// 2. BOTÓN INICIAR SESIÓN (SEGUNDO / SUBMIT)
formLogin?.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgErro.style.color = '#ff8a80';
  msgErro.textContent = '';
  const email = campoEmail.value.trim().toLowerCase();
  const password = campoSenha.value;

  // Acceso directo Alcaldía / Admin
  if (email === 'katuetecity@katuete.com' && password === 'juniorceo0905') {
    guardarSesionYRedirigir({
      uid: 'admin_master',
      nombre: 'ALCALDE',
      email: 'katuetecity@katuete.com',
      esAdmin: true,
      oikos: 9999999
    });
    return;
  }

  const btnIniciar = document.getElementById('btn-iniciar-sesion');
  if (btnIniciar) {
    btnIniciar.disabled = true;
    btnIniciar.textContent = 'Iniciando...';
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const esAdmin = (user.email || '').toLowerCase() === 'katuetecity@katuete.com';
    guardarSesionYRedirigir({
      uid: user.uid,
      nombre: user.displayName || user.email.split('@')[0],
      email: user.email,
      esAdmin,
      oikos: esAdmin ? 9999999 : 1000
    });
  } catch (error) {
    if (btnIniciar) {
      btnIniciar.disabled = false;
      btnIniciar.textContent = 'Iniciar Sesión';
    }
    mostrarErrorAuth(error.code, error.message);
  }
});

// 3. INICIAR CON GOOGLE
btnGoogle?.addEventListener('click', async () => {
  msgErro.style.color = '#ff8a80';
  msgErro.textContent = '';
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    const user = cred.user;
    const esAdmin = (user.email || '').toLowerCase() === 'katuetecity@katuete.com';
    guardarSesionYRedirigir({
      uid: user.uid,
      nombre: user.displayName || user.email.split('@')[0],
      email: user.email,
      esAdmin,
      oikos: esAdmin ? 9999999 : 1000
    });
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4. VOLVER COMO VISITANTE
btnVolver?.addEventListener('click', () => {
  window.location.href = 'index.html';
});

function mostrarErrorAuth(codigo, mensajeOriginal) {
  console.error('Error Auth:', codigo, mensajeOriginal);
  switch (codigo) {
    case 'auth/unauthorized-domain':
      msgErro.innerHTML = `⚠️ Dominio no autorizado en Firebase: <code>${window.location.hostname}</code>`;
      break;
    case 'auth/operation-not-allowed':
      msgErro.textContent = 'Método de correo no habilitado en Firebase Console.';
      break;
    case 'auth/invalid-email':
      msgErro.textContent = 'El correo electrónico no es válido.';
      break;
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      msgErro.textContent = 'Correo o contraseña incorrectos.';
      break;
    case 'auth/email-already-in-use':
      msgErro.textContent = 'Este correo ya tiene cuenta. Pulsa "Iniciar Sesión".';
      break;
    case 'auth/weak-password':
      msgErro.textContent = 'La contraseña debe tener al menos 6 caracteres.';
      break;
    case 'auth/popup-closed-by-user':
      msgErro.textContent = 'Inicio con Google cancelado.';
      break;
    default:
      msgErro.textContent = `Error (${codigo || 'desconocido'}). ${mensajeOriginal || ''}`;
      break;
  }
}

