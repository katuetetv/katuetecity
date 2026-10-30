/**
 * ============================================================
 * KatueteCity — La Ciudad de la Integración
 * Firebase Authentication + Three.js + Economía en Oikos
 * ============================================================
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* ============================================================
   1. INICIALIZACIÓN DE FIREBASE AUTHENTICATION
   ============================================================ */
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

/* ============================================================
   2. ESTADO DEL JUGADOR Y DE LA CIUDAD
   ============================================================ */
let usuarioFirebase = null;

const jugadorLocal = {
  uid: null,
  nombre: 'Ciudadano',
  email: '',
  esAdmin: false,
  oikos: 1000,
  trabajando: false,
  tiempoTurnoRestante: 0,
  duracionTurnoTotal: 10,
  casasAlquiladas: []
};

const TAMANHO_GRADE = 400; // Mapa 10x más grande (1.6 km x 1.6 km)
const TAMANHO_CELULA = 4;
const CHUNK_SIZE = 20;     // 20x20 celdas por chunk = 20x20 chunks = 400 chunks
const TOTAL_CHUNKS_EIXO = TAMANHO_GRADE / CHUNK_SIZE; // 20 chunks
const RAIO_CHUNKS = 2;     // Radio de carga alrededor de la cámara (5x5 chunks = 25 chunks activos)
const MAX_CHUNKS_POR_FRAME = 2; // Carga gradual sin tirones

const COSTO_ALQUILER_CICLO = 150;
const SALARIO_TURNO_OIKOS = 350;

const COSTOS_CONSTRUCCION = {
  estrada: 0,
  casa: 400,
  sobrado: 900,
  predio: 2200,
  loja: 1100,
  posto: 1800,
  parque: 600,
  usina: 2800,
  caixaDAgua: 2000
};

const estado = {
  ferramentaAtiva: 'ponteiro',
  rotacaoAtual: 0,
  celulaSelecionada: null,
  grade: [], // [z][x] -> { tipo, rot, mesh, inquilino, autor }
  arrastandoEstrada: false,
  inicioArrasto: null
};

for (let z = 0; z < TAMANHO_GRADE; z++) {
  estado.grade[z] = new Array(TAMANHO_GRADE).fill(null);
}

/* ============================================================
   SISTEMA DE GESTIÓN Y CARGA GRADUAL DE CHUNKS
   ============================================================ */
const chunkManager = {
  chunksCarregados: new Map(), // "cx_cz" -> { cx, cz, grupo }
  filaCarregamento: [],        // [ { cx, cz, dist } ]
  ultimoChunkCam: { cx: -999, cz: -999 }
};

function celulaParaChunk(gx, gz) {
  return {
    cx: Math.floor(gx / CHUNK_SIZE),
    cz: Math.floor(gz / CHUNK_SIZE)
  };
}

function obtenerIdChunk(cx, cz) {
  return `${cx}_${cz}`;
}

/* ============================================================
   3. SISTEMA DE AUDIO SINTETIZADO (Web Audio API)
   ============================================================ */
let audioCtx = null;
function obtenerAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function tocarSonido(tipo) {
  try {
    const ctx = obtenerAudioContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    if (tipo === 'construir') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(540, t + 0.12);
      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    } else if (tipo === 'demolir') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    } else if (tipo === 'monedas') {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.06);
        gain.gain.setValueAtTime(0.12, t + i * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.005, t + i * 0.06 + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + i * 0.06);
        osc.stop(t + i * 0.06 + 0.15);
      });
    } else if (tipo === 'error') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.setValueAtTime(130, t + 0.08);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch (e) { }
}

/* ============================================================
   4. EVENTOS DE AUTENTICACIÓN Y MODAL DE LOGIN MINIMALISTA
   ============================================================ */
const modalLogin = document.getElementById('modal-login');
const btnAbrirLogin = document.getElementById('btn-abrir-login');
const btnCerrarLogin = document.getElementById('btn-cerrar-modal-login');

const formLogin = document.getElementById('form-login');
const campoEmail = document.getElementById('campo-email');
const campoSenha = document.getElementById('campo-senha');
const btnRegistrarse = document.getElementById('btn-registrarse');
const btnGoogle = document.getElementById('btn-google');
const msgErro = document.getElementById('msg-erro');

// Abrir y Cerrar Modal de Login
if (btnAbrirLogin && modalLogin) {
  btnAbrirLogin.addEventListener('click', () => {
    modalLogin.style.display = 'flex';
    msgErro.textContent = '';
    campoEmail.focus();
  });
}

if (btnCerrarLogin && modalLogin) {
  btnCerrarLogin.addEventListener('click', () => {
    modalLogin.style.display = 'none';
  });
}

// 4.1 BOTÓN CREAR CUENTA (PRIMERO)
btnRegistrarse.addEventListener('click', async () => {
  msgErro.textContent = '';
  const email = campoEmail.value.trim();
  const password = campoSenha.value;

  if (!email || !password) {
    msgErro.textContent = 'Ingresa correo y contraseña (mínimo 6 caracteres).';
    return;
  }

  try {
    obtenerAudioContext();
    await createUserWithEmailAndPassword(auth, email, password);
    mostrarNotificacion('🎉 ¡Cuenta creada con éxito en KatueteCity!');
    modalLogin.style.display = 'none';
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4.2 BOTÓN INICIAR SESIÓN (SEGUNDO)
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgErro.textContent = '';
  const email = campoEmail.value.trim().toLowerCase();
  const password = campoSenha.value;

  // Reconocimiento directo para Alcalde / Admin
  if (email === 'katuetecity@katuete.com' && password === 'juniorceo0905') {
    obtenerAudioContext();
    iniciarSesionComoAdmin(email);
    modalLogin.style.display = 'none';
    return;
  }

  try {
    obtenerAudioContext();
    await signInWithEmailAndPassword(auth, email, password);
    modalLogin.style.display = 'none';
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4.3 Iniciar Sesión con Google
btnGoogle.addEventListener('click', async () => {
  msgErro.textContent = '';
  try {
    obtenerAudioContext();
    await signInWithPopup(auth, googleProvider);
    modalLogin.style.display = 'none';
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4.4 Cerrar Sesión
document.getElementById('btn-desconectar').addEventListener('click', async () => {
  try {
    await signOut(auth);
    jugadorLocal.uid = null;
    jugadorLocal.nombre = 'Visitante';
    jugadorLocal.email = '';
    jugadorLocal.esAdmin = false;
    actualizarHUD();
    mostrarNotificacion('👋 Has cerrado sesión.');
  } catch (error) {
    console.error('Error al cerrar sesión:', error);
  }
});

// 4.5 Observador del Estado de Autenticación (Auto-Login)
onAuthStateChanged(auth, (user) => {
  if (user) {
    usuarioFirebase = user;
    const emailNormalizado = (user.email || '').toLowerCase();

    // Reconocimiento universal: si el correo es de Alcaldía, entra como Administrador
    if (emailNormalizado === 'katuetecity@katuete.com') {
      iniciarSesionComoAdmin(user.email);
    } else {
      const nombreExtraido = user.displayName || user.email.split('@')[0];
      iniciarSesionCiudadano(user.uid, nombreExtraido, user.email);
    }

    if (modalLogin) modalLogin.style.display = 'none';
  } else {
    // Modo Visitante (el mapa sigue 100% visible y jugable)
    jugadorLocal.uid = null;
    jugadorLocal.nombre = 'Visitante';
    jugadorLocal.email = '';
    jugadorLocal.esAdmin = false;
    actualizarHUD();
  }
});

function mostrarErrorAuth(codigo, mensajeOriginal) {
  tocarSonido('error');
  console.error('Error Firebase:', codigo, mensajeOriginal);

  switch (codigo) {
    case 'auth/unauthorized-domain':
      msgErro.innerHTML = `⚠️ <strong>Dominio no autorizado:</strong> Agrega tu dominio <code>${window.location.hostname}</code> en Firebase Console &gt; Authentication &gt; Settings &gt; Authorized domains.`;
      break;
    case 'auth/operation-not-allowed':
      msgErro.innerHTML = '⚠️ <strong>Método inhabilitado:</strong> Activa "Correo/Contraseña" en Firebase Console &gt; Authentication &gt; Sign-in method.';
      break;
    case 'auth/invalid-email':
      msgErro.textContent = 'El formato del correo electrónico no es válido.';
      break;
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      msgErro.textContent = 'Correo o contraseña incorrectos.';
      break;
    case 'auth/email-already-in-use':
      msgErro.textContent = 'Este correo ya tiene una cuenta registrada.';
      break;
    case 'auth/weak-password':
      msgErro.textContent = 'La contraseña debe tener al menos 6 caracteres.';
      break;
    case 'auth/popup-closed-by-user':
      msgErro.textContent = 'Inicio de sesión con Google cancelado.';
      break;
    case 'auth/network-request-failed':
      msgErro.textContent = 'Error de conexión. Verifica tu conexión a internet o adblocker.';
      break;
    default:
      msgErro.textContent = `Error (${codigo || 'desconocido'}). ${mensajeOriginal || 'Verifica la consola.'}`;
      break;
  }
}

// 4.6 Botón de Ingreso como Invitado (Modo Autónomo de Respaldo)
const btnInvitado = document.getElementById('btn-invitado');
if (btnInvitado) {
  btnInvitado.addEventListener('click', () => {
    const emailInvitado = campoEmail.value.trim();
    const nombreInvitado = emailInvitado ? emailInvitado.split('@')[0] : `Invitado_${Math.floor(Math.random() * 900 + 100)}`;
    obtenerAudioContext();
    iniciarSesionCiudadano(`invitado_${Date.now()}`, nombreInvitado, 'invitado@katuetecity.local');
    mostrarNotificacion(`👋 Has ingresado como ${nombreInvitado} (Modo Local)`);
  });
}

/* ============================================================
   5. INICIALIZACIÓN DEL JUGADOR Y LA CIUDAD
   ============================================================ */
function iniciarSesionCiudadano(uid, nombre, email) {
  jugadorLocal.uid = uid;
  jugadorLocal.nombre = nombre;
  jugadorLocal.email = email;
  jugadorLocal.esAdmin = false;

  // Cargar progreso del usuario
  recuperarCiudadGuardada();
  actualizarHUD();

  if (!renderizador) {
    iniciarMotor3D();
  }
  actualizarChunksCamara(true);

  // Generar la ciudad si la celda central está vacía
  const centro = Math.floor(TAMANHO_GRADE / 2);
  if (estado.grade[centro][centro] === null) {
    generarCiudadBase();
  }

  // Lista de ciudadanos para la interfaz
  const ciudadanos = [
    { nombre: jugadorLocal.nombre, oikos: jugadorLocal.oikos },
    { nombre: 'Alcalde_Katuete', oikos: 15400 },
    { nombre: 'Ingeniero_Itaipu', oikos: 8200 },
    { nombre: 'Agricultor_Canindeyu', oikos: 4900 }
  ];
  actualizarListaCiudadanos(ciudadanos);
  document.getElementById('stat-jugadores-online').textContent = ciudadanos.length;

  iniciarCicloAlquilerLocal();
  desenharMiniMapa();
  tocarSonido('monedas');
  mostrarNotificacion(`🎉 ¡Bienvenido a KatueteCity, ${jugadorLocal.nombre}!`);
}

function iniciarSesionComoAdmin(usuario) {
  jugadorLocal.uid = 'admin_master';
  jugadorLocal.nombre = 'ALCALDE';
  jugadorLocal.email = 'katuetecity@katuete.com';
  jugadorLocal.esAdmin = true;
  jugadorLocal.oikos = 9999999; // Fondos ilimitados

  recuperarCiudadGuardada();
  actualizarHUD();

  if (!renderizador) {
    iniciarMotor3D();
  }
  actualizarChunksCamara(true);

  const centro = Math.floor(TAMANHO_GRADE / 2);
  if (estado.grade[centro][centro] === null) {
    generarCiudadBase();
  }

  iniciarCicloAlquilerLocal();
  desenharMiniMapa();
  tocarSonido('monedas');
  mostrarNotificacion(`👑 ¡Sesión iniciada como ALCALDE MUNICIPAL! (Modo Dios Activo)`);
}

function generarCiudadBase() {
  const c = Math.floor(TAMANHO_GRADE / 2); // 200 en mapa de 400

  // Avenidas centrales cruzadas
  for (let x = c - 16; x <= c + 16; x++) instanciarObjetoLocal('estrada', x, c, 0, null, 'Municipio');
  for (let z = c - 16; z <= c + 16; z++) instanciarObjetoLocal('estrada', c, z, 0, null, 'Municipio');

  // Calles conectoras de cuadrículas
  for (let x = c - 16; x <= c + 16; x++) {
    instanciarObjetoLocal('estrada', x, c - 8, 0, null, 'Municipio');
    instanciarObjetoLocal('estrada', x, c + 8, 0, null, 'Municipio');
  }
  for (let z = c - 16; z <= c + 16; z++) {
    instanciarObjetoLocal('estrada', c - 8, z, 0, null, 'Municipio');
    instanciarObjetoLocal('estrada', c + 8, z, 0, null, 'Municipio');
  }

  // Viviendas iniciales en los cuatro cuadrantes
  instanciarObjetoLocal('casa', c - 3, c - 3, 0, null, 'Municipio');
  instanciarObjetoLocal('casa', c - 5, c - 3, 0, null, 'Municipio');
  instanciarObjetoLocal('sobrado', c - 3, c + 3, 0, null, 'Municipio');
  instanciarObjetoLocal('sobrado', c - 5, c + 3, 0, null, 'Municipio');
  instanciarObjetoLocal('casa', c + 3, c - 3, 0, null, 'Municipio');
  instanciarObjetoLocal('casa', c + 5, c - 3, 0, null, 'Municipio');
  instanciarObjetoLocal('predio', c + 3, c + 3, 0, null, 'Municipio');
  instanciarObjetoLocal('predio', c + 5, c + 3, 0, null, 'Municipio');

  // Servicios, comercios y reservas públicas
  instanciarObjetoLocal('loja', c - 4, c - 5, 0, null, 'Municipio');
  instanciarObjetoLocal('loja', c + 4, c - 5, 0, null, 'Municipio');
  instanciarObjetoLocal('posto', c + 4, c + 5, 0, null, 'Municipio');
  instanciarObjetoLocal('parque', c + 3, c - 11, 0, null, 'Municipio');
  instanciarObjetoLocal('parque', c - 3, c - 11, 0, null, 'Municipio');
  instanciarObjetoLocal('usina', c - 11, c + 11, 0, null, 'Municipio');
  instanciarObjetoLocal('caixaDAgua', c + 11, c + 11, 0, null, 'Municipio');
}

/* ============================================================
   6. MOTOR 3D THREE.JS
   ============================================================ */
let cena, camera, renderizador, controles;
let planoChaoInvisivel;
let fantasmaObjeto = null;
let grupoPreviewEstrada = null;
let gridHelper = null;
let luzSol = null;

function iniciarMotor3D() {
  const canvas = document.getElementById('canvas-jogo');

  renderizador = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderizador.setSize(window.innerWidth, window.innerHeight);
  renderizador.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderizador.shadowMap.enabled = true;
  renderizador.shadowMap.type = THREE.PCFSoftShadowMap;
  renderizador.setClearColor(0x82b1ff);

  cena = new THREE.Scene();
  cena.fog = new THREE.Fog(0x82b1ff, 200, 520);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 3000);
  camera.position.set(65, 80, 85);

  configurarIluminacao();
  criarTerreno();

  const total = TAMANHO_GRADE * TAMANHO_CELULA;
  const geoPlano = new THREE.PlaneGeometry(total * 2.5, total * 2.5);
  planoChaoInvisivel = new THREE.Mesh(geoPlano, new THREE.MeshBasicMaterial({ visible: false }));
  planoChaoInvisivel.rotation.x = -Math.PI / 2;
  cena.add(planoChaoInvisivel);

  controles = new THREE.OrbitControls(camera, canvas);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.screenSpacePanning = true;
  controles.minDistance = 10;
  controles.maxDistance = 500;
  controles.maxPolarAngle = Math.PI / 2.15;
  controles.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  controles.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };

  configurarEventosInteraccion();
  animar();
}

function configurarIluminacao() {
  const luzAmbiente = new THREE.AmbientLight(0xffffff, 0.65);
  cena.add(luzAmbiente);

  luzSol = new THREE.DirectionalLight(0xfff5e6, 1.15);
  luzSol.position.set(80, 130, 70);
  luzSol.castShadow = true;
  luzSol.shadow.mapSize.width = 2048;
  luzSol.shadow.mapSize.height = 2048;
  luzSol.shadow.camera.near = 10;
  luzSol.shadow.camera.far = 450;
  const d = 140;
  luzSol.shadow.camera.left = -d;
  luzSol.shadow.camera.right = d;
  luzSol.shadow.camera.top = d;
  luzSol.shadow.camera.bottom = -d;
  luzSol.shadow.bias = -0.0008;
  cena.add(luzSol);
  cena.add(luzSol.target);

  const hemi = new THREE.HemisphereLight(0x90caf9, 0x43a047, 0.35);
  cena.add(hemi);
}

function criarTerreno() {
  const total = TAMANHO_GRADE * TAMANHO_CELULA;

  // Terreno exterior verde
  const geoGramaFora = new THREE.PlaneGeometry(total * 2.5, total * 2.5);
  const matGramaFora = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
  const meshFora = new THREE.Mesh(geoGramaFora, matGramaFora);
  meshFora.rotation.x = -Math.PI / 2;
  meshFora.position.y = -0.08;
  meshFora.receiveShadow = true;
  cena.add(meshFora);

  // Terreno central de la ciudad
  const geoChao = new THREE.PlaneGeometry(total, total);
  const matChao = new THREE.MeshLambertMaterial({ color: 0x43a047 });
  const chao = new THREE.Mesh(geoChao, matChao);
  chao.rotation.x = -Math.PI / 2;
  chao.position.y = -0.02;
  chao.receiveShadow = true;
  cena.add(chao);

  // Cuadrícula dinámica de construcción que sigue a la cámara
  const tamanhoGradeVisivel = 160;
  const divisoes = 40;
  gridHelper = new THREE.GridHelper(tamanhoGradeVisivel, divisoes, 0x1b5e20, 0x2e7d32);
  gridHelper.position.y = 0.04;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.35;
  cena.add(gridHelper);
}

function mundoParaGrade(wx, wz) {
  const total = TAMANHO_GRADE * TAMANHO_CELULA;
  const gx = Math.floor((wx + total / 2) / TAMANHO_CELULA);
  const gz = Math.floor((wz + total / 2) / TAMANHO_CELULA);
  return { gx, gz };
}

function gradeParaMundo(gx, gz) {
  const total = TAMANHO_GRADE * TAMANHO_CELULA;
  const wx = gx * TAMANHO_CELULA - total / 2 + TAMANHO_CELULA / 2;
  const wz = gz * TAMANHO_CELULA - total / 2 + TAMANHO_CELULA / 2;
  return { x: wx, z: wz };
}

function celulaValida(gx, gz) {
  return gx >= 0 && gz >= 0 && gx < TAMANHO_GRADE && gz < TAMANHO_GRADE;
}

/* ============================================================
   7. MODELADO PROCEDURAL 3D
   ============================================================ */
function criarCasa(rot) {
  const grupo = new THREE.Group();
  const parede = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.8, 2.6), new THREE.MeshLambertMaterial({ color: 0xfff3e0 }));
  parede.position.y = 0.9;
  parede.castShadow = true;
  parede.receiveShadow = true;
  grupo.add(parede);

  const telhado = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.2, 4), new THREE.MeshLambertMaterial({ color: 0xd84315 }));
  telhado.position.y = 2.4;
  telhado.rotation.y = Math.PI / 4;
  telhado.castShadow = true;
  grupo.add(telhado);

  const porta = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.08), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
  porta.position.set(0, 0.45, 1.32);
  grupo.add(porta);

  grupo.rotation.y = rot;
  return grupo;
}

function criarSobrado(rot) {
  const grupo = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.8, 3.0), new THREE.MeshLambertMaterial({ color: 0xefebe9 }));
  p1.position.y = 0.9;
  p1.castShadow = true;
  grupo.add(p1);

  const p2 = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.6, 2.7), new THREE.MeshLambertMaterial({ color: 0x0288d1 }));
  p2.position.y = 2.6;
  p2.castShadow = true;
  grupo.add(p2);

  const telhado = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.2, 2.9), new THREE.MeshLambertMaterial({ color: 0x37474f }));
  telhado.position.y = 3.5;
  telhado.castShadow = true;
  grupo.add(telhado);

  grupo.rotation.y = rot;
  return grupo;
}

function criarPredio(rot) {
  const grupo = new THREE.Group();
  const altura = 7.5;
  const corpo = new THREE.Mesh(new THREE.BoxGeometry(3.2, altura, 3.2), new THREE.MeshLambertMaterial({ color: 0x546e7a }));
  corpo.position.y = altura / 2;
  corpo.castShadow = true;
  grupo.add(corpo);

  const matVidro = new THREE.MeshLambertMaterial({ color: 0xb3e5fc });
  for (let y = 1.2; y < altura - 0.5; y += 1.4) {
    [-0.8, 0.8].forEach(x => {
      const jFront = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.05), matVidro);
      jFront.position.set(x, y, 1.62);
      grupo.add(jFront);
    });
  }

  grupo.rotation.y = rot;
  return grupo;
}

function criarLoja(rot) {
  const grupo = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3.4), new THREE.MeshLambertMaterial({ color: 0xffb300 }));
  base.position.y = 1.2;
  base.castShadow = true;
  grupo.add(base);

  const marquise = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.25, 1.2), new THREE.MeshLambertMaterial({ color: 0xd32f2f }));
  marquise.position.set(0, 1.9, 1.8);
  marquise.castShadow = true;
  grupo.add(marquise);

  grupo.rotation.y = rot;
  return grupo;
}

function criarPosto(rot) {
  const grupo = new THREE.Group();
  const piso = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.1, 3.8), new THREE.MeshLambertMaterial({ color: 0x78909c }));
  piso.position.y = 0.05;
  grupo.add(piso);

  const cobertura = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.2, 2.6), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
  cobertura.position.set(0, 2.8, 0.2);
  cobertura.castShadow = true;
  grupo.add(cobertura);

  [-1.3, 1.3].forEach(cx => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.8, 8), new THREE.MeshLambertMaterial({ color: 0xcfcfcf }));
    col.position.set(cx, 1.4, 0.2);
    grupo.add(col);
  });

  grupo.rotation.y = rot;
  return grupo;
}

function criarParque() {
  const grupo = new THREE.Group();
  const piso = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.08, 3.8), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
  piso.position.y = 0.04;
  grupo.add(piso);

  const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
  tronco.position.set(0, 0.6, 0);
  grupo.add(tronco);

  const copa = new THREE.Mesh(new THREE.SphereGeometry(0.8, 7, 7), new THREE.MeshLambertMaterial({ color: 0x388e3c }));
  copa.position.set(0, 1.6, 0);
  grupo.add(copa);

  return grupo;
}

function criarUsina(rot) {
  const grupo = new THREE.Group();
  const galpao = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 3.2), new THREE.MeshLambertMaterial({ color: 0x37474f }));
  galpao.position.y = 1.1;
  galpao.castShadow = true;
  grupo.add(galpao);

  [-0.8, 0.8].forEach(cx => {
    const chamine = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 4.2, 10), new THREE.MeshLambertMaterial({ color: 0xc62828 }));
    chamine.position.set(cx, 2.1, -0.6);
    grupo.add(chamine);
  });

  grupo.rotation.y = rot;
  return grupo;
}

function criarCaixaDAgua() {
  const grupo = new THREE.Group();
  const tanque = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.0, 16), new THREE.MeshLambertMaterial({ color: 0x0288d1 }));
  tanque.position.y = 5.2;
  grupo.add(tanque);

  const matFerro = new THREE.MeshLambertMaterial({ color: 0x455a64 });
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([px, pz]) => {
    const perna = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.5, 6), matFerro);
    perna.position.set(px, 2.25, pz);
    grupo.add(perna);
  });

  return grupo;
}

function criarEstradaMesh(gx, gz) {
  const grupo = new THREE.Group();
  const w = TAMANHO_CELULA;

  const geoAsfalto = new THREE.BoxGeometry(w, 0.12, w);
  const matAsfalto = new THREE.MeshLambertMaterial({ color: 0x263238 });
  const asfalto = new THREE.Mesh(geoAsfalto, matAsfalto);
  asfalto.position.y = 0.06;
  asfalto.receiveShadow = true;
  grupo.add(asfalto);

  const matCalcada = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.4), matCalcada);
  c1.position.set(0, 0.07, (w / 2) - 0.2);
  grupo.add(c1);

  const c2 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.4), matCalcada);
  c2.position.set(0, 0.07, -(w / 2) + 0.2);
  grupo.add(c2);

  const faixa = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.01, 0.18), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  faixa.position.y = 0.13;
  grupo.add(faixa);

  const { x, z } = gradeParaMundo(gx, gz);
  grupo.position.set(x, 0, z);
  return grupo;
}

/* ============================================================
   8. GESTIÓN DEL MAPA Y RENDERIZADO DE CHUNKS
   ============================================================ */
function criarMeshParaTipo(tipo, rotRad, gx, gz, inquilino = null, autor = 'Municipio') {
  let mesh = null;
  const { x, z } = gradeParaMundo(gx, gz);

  switch (tipo) {
    case 'estrada': mesh = criarEstradaMesh(gx, gz); break;
    case 'casa': mesh = criarCasa(rotRad); break;
    case 'sobrado': mesh = criarSobrado(rotRad); break;
    case 'predio': mesh = criarPredio(rotRad); break;
    case 'loja': mesh = criarLoja(rotRad); break;
    case 'posto': mesh = criarPosto(rotRad); break;
    case 'parque': mesh = criarParque(); break;
    case 'usina': mesh = criarUsina(rotRad); break;
    case 'caixaDAgua': mesh = criarCaixaDAgua(); break;
    default: return null;
  }

  if (tipo !== 'estrada' && mesh) {
    mesh.position.set(x, 0, z);
  }

  if (mesh) {
    mesh.userData = { tipo, gx, gz, rot: (rotRad * 180) / Math.PI, inquilino, autor };
  }
  return mesh;
}

function carregarChunk(cx, cz) {
  const id = obtenerIdChunk(cx, cz);
  if (chunkManager.chunksCarregados.has(id)) return;
  if (cx < 0 || cz < 0 || cx >= TOTAL_CHUNKS_EIXO || cz >= TOTAL_CHUNKS_EIXO) return;

  const grupo = new THREE.Group();
  const startX = cx * CHUNK_SIZE;
  const endX = Math.min(TAMANHO_GRADE, startX + CHUNK_SIZE);
  const startZ = cz * CHUNK_SIZE;
  const endZ = Math.min(TAMANHO_GRADE, startZ + CHUNK_SIZE);

  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      const item = estado.grade[z]?.[x];
      if (item) {
        const rotRad = ((item.rot || 0) * Math.PI) / 180;
        const mesh = criarMeshParaTipo(item.tipo, rotRad, x, z, item.inquilino, item.autor);
        if (mesh) {
          item.mesh = mesh;
          grupo.add(mesh);
        }
      }
    }
  }

  cena.add(grupo);
  chunkManager.chunksCarregados.set(id, { cx, cz, grupo });
}

function descarregarChunk(cx, cz) {
  const id = obtenerIdChunk(cx, cz);
  const ch = chunkManager.chunksCarregados.get(id);
  if (!ch) return;

  if (ch.grupo && ch.grupo.parent) {
    ch.grupo.parent.remove(ch.grupo);
  }

  const startX = cx * CHUNK_SIZE;
  const endX = Math.min(TAMANHO_GRADE, startX + CHUNK_SIZE);
  const startZ = cz * CHUNK_SIZE;
  const endZ = Math.min(TAMANHO_GRADE, startZ + CHUNK_SIZE);

  for (let z = startZ; z < endZ; z++) {
    for (let x = startX; x < endX; x++) {
      if (estado.grade[z]?.[x]) {
        estado.grade[z][x].mesh = null;
      }
    }
  }

  chunkManager.chunksCarregados.delete(id);
}

function actualizarChunksCamara(inmediato = false) {
  if (!controles || !cena) return;
  const foco = controles.target;
  const { gx, gz } = mundoParaGrade(foco.x, foco.z);
  const { cx, cz } = celulaParaChunk(gx, gz);

  if (!inmediato && cx === chunkManager.ultimoChunkCam.cx && cz === chunkManager.ultimoChunkCam.cz) {
    return;
  }
  chunkManager.ultimoChunkCam = { cx, cz };

  const desiredSet = new Set();
  const novosChunksParaFila = [];

  for (let dz = -RAIO_CHUNKS; dz <= RAIO_CHUNKS; dz++) {
    for (let dx = -RAIO_CHUNKS; dx <= RAIO_CHUNKS; dx++) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx >= 0 && ncx < TOTAL_CHUNKS_EIXO && ncz >= 0 && ncz < TOTAL_CHUNKS_EIXO) {
        const id = obtenerIdChunk(ncx, ncz);
        desiredSet.add(id);
        if (!chunkManager.chunksCarregados.has(id)) {
          const distSq = dx * dx + dz * dz;
          novosChunksParaFila.push({ cx: ncx, cz: ncz, dist: distSq });
        }
      }
    }
  }

  for (const [id, ch] of chunkManager.chunksCarregados.entries()) {
    if (!desiredSet.has(id)) {
      descarregarChunk(ch.cx, ch.cz);
    }
  }

  novosChunksParaFila.sort((a, b) => a.dist - b.dist);

  if (inmediato) {
    while (novosChunksParaFila.length > 0) {
      const proximo = novosChunksParaFila.shift();
      carregarChunk(proximo.cx, proximo.cz);
    }
    chunkManager.filaCarregamento = [];
  } else {
    chunkManager.filaCarregamento = novosChunksParaFila;
  }
}

function procesarFilaChunks() {
  if (chunkManager.filaCarregamento.length === 0) return;
  for (let i = 0; i < MAX_CHUNKS_POR_FRAME && chunkManager.filaCarregamento.length > 0; i++) {
    const proximo = chunkManager.filaCarregamento.shift();
    carregarChunk(proximo.cx, proximo.cz);
  }
}

function instanciarObjetoLocal(tipo, gx, gz, rot = 0, inquilino = null, autor = 'Municipio') {
  if (!celulaValida(gx, gz)) return;
  eliminarObjetoLocal(gx, gz);

  const rotRad = (rot * Math.PI) / 180;
  estado.grade[gz][gx] = { tipo, rot, mesh: null, inquilino, autor };

  const { cx, cz } = celulaParaChunk(gx, gz);
  const ch = chunkManager.chunksCarregados.get(obtenerIdChunk(cx, cz));
  if (ch) {
    const mesh = criarMeshParaTipo(tipo, rotRad, gx, gz, inquilino, autor);
    if (mesh) {
      estado.grade[gz][gx].mesh = mesh;
      ch.grupo.add(mesh);
    }
  }
}

function eliminarObjetoLocal(gx, gz) {
  if (!celulaValida(gx, gz)) return;
  const celda = estado.grade[gz]?.[gx];
  if (celda) {
    if (celda.mesh && celda.mesh.parent) {
      celda.mesh.parent.remove(celda.mesh);
    }
    estado.grade[gz][gx] = null;
  }
}

/* ============================================================
   9. INTERACCIÓN Y CONSTRUCCIÓN (MÓVIL TOUCH & RATÓN DESKTOP)
   ============================================================ */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerDownX = 0;
let pointerDownY = 0;
const DISTANCIA_CLIQUE_MAX_PX = 8;

function rotarHerramienta() {
  estado.rotacaoAtual = (estado.rotacaoAtual + 90) % 360;
  const texto = `${estado.rotacaoAtual}°`;
  const elRot = document.getElementById('valor-rotacao');
  if (elRot) elRot.textContent = texto;
  const elRotTouch = document.getElementById('valor-rotacao-touch');
  if (elRotTouch) elRotTouch.textContent = texto;
  tocarSonido('construir');
}

function recentrarCamara() {
  if (controles) {
    controles.target.set(0, 0, 0);
    camera.position.set(65, 80, 85);
    controles.update();
    tocarSonido('monedas');
    mostrarNotificacion('🎯 Vista recentrada en el núcleo de la ciudad');
  }
}

function zoomCamara(delta) {
  if (!camera || !controles) return;
  const dir = new THREE.Vector3().subVectors(camera.position, controles.target).normalize();
  const dist = camera.position.distanceTo(controles.target);
  const nuevaDist = Math.max(controles.minDistance, Math.min(controles.maxDistance, dist + delta));
  camera.position.copy(controles.target).addScaledVector(dir, nuevaDist);
  controles.update();
}

function configurarEventosInteraccion() {
  const canvas = document.getElementById('canvas-jogo');

  function actualizarCoordenadasMouse(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function actualizarCoordenadasPorPixel(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function obtenerInterseccionChao() {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(planoChaoInvisivel);
    return hits.length > 0 ? hits[0].point : null;
  }

  // --- CONTROL TÁCTIL MÓVIL OPTIMIZADO ---
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let touchArrastrado = false;
  let esMultiTouch = false;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      esMultiTouch = true;
      limparFantasma();
    } else if (e.touches.length === 1) {
      esMultiTouch = false;
      touchArrastrado = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      actualizarCoordenadasPorPixel(touchStartX, touchStartY);
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      esMultiTouch = true;
      limparFantasma();
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      if (Math.hypot(dx, dy) > 12) {
        touchArrastrado = true;
      }
      actualizarCoordenadasPorPixel(e.touches[0].clientX, e.touches[0].clientY);
      const pt = obtenerInterseccionChao();
      if (pt && !touchArrastrado && estado.ferramentaAtiva !== 'ponteiro' && estado.ferramentaAtiva !== 'demolir') {
        const { gx, gz } = mundoParaGrade(pt.x, pt.z);
        actualizarPreviewFantasma(gx, gz);
      }
    }
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (!esMultiTouch && !touchArrastrado && (Date.now() - touchStartTime) < 380) {
      actualizarCoordenadasPorPixel(touchStartX, touchStartY);
      const pt = obtenerInterseccionChao();
      if (pt) {
        const { gx, gz } = mundoParaGrade(pt.x, pt.z);
        procesarClicEnGrilla(gx, gz);
      }
    }
    limparFantasma();
  });

  // --- CONTROL CON RATÓN (DESKTOP) ---
  canvas.addEventListener('mousemove', (e) => {
    actualizarCoordenadasMouse(e);
    const pt = obtenerInterseccionChao();
    if (!pt) {
      limparFantasma();
      return;
    }

    const { gx, gz } = mundoParaGrade(pt.x, pt.z);

    if (estado.arrastandoEstrada && estado.inicioArrasto) {
      const camino = obtenerCaminoL(estado.inicioArrasto, { gx, gz });
      actualizarPreviewLinhaEstrada(camino);
    } else {
      actualizarPreviewFantasma(gx, gz);
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // Procesado por eventos táctiles
    if (e.button === 0) {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      actualizarCoordenadasMouse(e);
      const pt = obtenerInterseccionChao();
      if (pt && estado.ferramentaAtiva === 'estrada') {
        estado.arrastandoEstrada = true;
        estado.inicioArrasto = mundoParaGrade(pt.x, pt.z);
      }
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    const dx = e.clientX - pointerDownX;
    const dy = e.clientY - pointerDownY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    actualizarCoordenadasMouse(e);
    const pt = obtenerInterseccionChao();

    if (estado.arrastandoEstrada && estado.inicioArrasto && pt) {
      const destino = mundoParaGrade(pt.x, pt.z);
      const camino = obtenerCaminoL(estado.inicioArrasto, destino);
      camino.forEach(c => {
        if (celulaValida(c.gx, c.gz) && estado.grade[c.gz][c.gx] === null) {
          instanciarObjetoLocal('estrada', c.gx, c.gz, 0, null, jugadorLocal.nombre);
        }
      });
      tocarSonido('construir');
      limparPreviewLinhaEstrada();
      estado.arrastandoEstrada = false;
      estado.inicioArrasto = null;
      desenharMiniMapa();
      return;
    }

    if (dist < DISTANCIA_CLIQUE_MAX_PX && pt) {
      const { gx, gz } = mundoParaGrade(pt.x, pt.z);
      procesarClicEnGrilla(gx, gz);
    }
  });

  // Botones de cámara y rotación
  document.getElementById('btn-rotar-touch')?.addEventListener('click', rotarHerramienta);
  document.getElementById('indicador-rotacao')?.addEventListener('click', rotarHerramienta);
  document.getElementById('btn-cam-recentrar')?.addEventListener('click', recentrarCamara);
  document.getElementById('btn-cam-zoom-in')?.addEventListener('click', () => zoomCamara(-30));
  document.getElementById('btn-cam-zoom-out')?.addEventListener('click', () => zoomCamara(30));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      rotarHerramienta();
    } else if (e.key === 'Escape') {
      seleccionarHerramienta('ponteiro');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (estado.celulaSelecionada) {
        eliminarObjetoLocal(estado.celulaSelecionada.gx, estado.celulaSelecionada.gz);
        tocarSonido('demolir');
        desenharMiniMapa();
        mostrarNotificacion('💥 Edificio demolido.');
      }
    }
  });

  // Menús Flotantes del Dock
  const menuConstruccion = document.getElementById('menu-construccion');
  const menuTrabajo = document.getElementById('menu-trabajo');
  const menuCiudad = document.getElementById('menu-ciudad');
  const cardInspeccion = document.getElementById('card-inspeccion');

  function cerrarTodosLosMenus() {
    if (menuConstruccion) menuConstruccion.style.display = 'none';
    if (menuTrabajo) menuTrabajo.style.display = 'none';
    if (menuCiudad) menuCiudad.style.display = 'none';
  }

  // Botones de cierre (X)
  document.querySelectorAll('.btn-cerrar-menu').forEach(btn => {
    btn.addEventListener('click', () => {
      const idMenu = btn.dataset.cerrar;
      const el = document.getElementById(idMenu);
      if (el) el.style.display = 'none';
    });
  });

  document.getElementById('btn-cerrar-card')?.addEventListener('click', () => {
    if (cardInspeccion) cardInspeccion.style.display = 'none';
  });

  // Dock: Botón Puntero
  document.getElementById('dock-btn-puntero')?.addEventListener('click', () => {
    cerrarTodosLosMenus();
    seleccionarHerramienta('ponteiro');
    actualizarDockActivo('dock-btn-puntero');
  });

  // Dock: Botón Construir
  document.getElementById('dock-btn-construir')?.addEventListener('click', () => {
    const visible = menuConstruccion.style.display === 'block';
    cerrarTodosLosMenus();
    if (!visible) {
      menuConstruccion.style.display = 'block';
      actualizarDockActivo('dock-btn-construir');
    }
  });

  // Dock: Botón Empleo
  document.getElementById('dock-btn-trabajar')?.addEventListener('click', () => {
    const visible = menuTrabajo.style.display === 'block';
    cerrarTodosLosMenus();
    if (!visible) {
      menuTrabajo.style.display = 'block';
      actualizarDockActivo('dock-btn-trabajar');
    }
  });

  // Dock: Botón Ciudad / Mapa
  document.getElementById('dock-btn-ciudad')?.addEventListener('click', () => {
    const visible = menuCiudad.style.display === 'block';
    cerrarTodosLosMenus();
    if (!visible) {
      menuCiudad.style.display = 'block';
      desenharMiniMapa();
      actualizarDockActivo('dock-btn-ciudad');
    }
  });

  // Dock: Botón Demoler
  document.getElementById('dock-btn-demoler')?.addEventListener('click', () => {
    cerrarTodosLosMenus();
    seleccionarHerramienta('demolir');
    actualizarDockActivo('dock-btn-demoler');
  });

  // Sub-Pestañas de Categorías de Construcción
  document.querySelectorAll('.tab-cat').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-cat').forEach(t => t.classList.remove('activa'));
      tab.classList.add('activa');
      const cat = tab.dataset.cat;
      document.querySelectorAll('.seccion-cat').forEach(sec => {
        sec.style.display = sec.classList.contains(`cat-${cat}`) ? 'block' : 'none';
      });
    });
  });

  // Selección de Item del Catálogo de Construcción
  document.querySelectorAll('.btn-ferramenta').forEach(btn => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.ferramenta;
      seleccionarHerramienta(tipo);
      // Cierra el menú al elegir para ver el mapa 3D libre
      if (menuConstruccion) menuConstruccion.style.display = 'none';
      actualizarDockActivo('dock-btn-construir');
    });
  });

  // Botón de Trabajo
  const btnTrabajar = document.getElementById('btn-trabajar');
  btnTrabajar.addEventListener('click', () => {
    if (!jugadorLocal.trabajando) {
      iniciarTurnoTrabajoLocal();
    }
  });

  // Botones de Alquiler / Desalojo
  document.getElementById('btn-alquilar-casa')?.addEventListener('click', () => {
    if (estado.celulaSelecionada) {
      alquilarCasaLocal(estado.celulaSelecionada.gx, estado.celulaSelecionada.gz);
    }
  });

  document.getElementById('btn-desalojar-casa')?.addEventListener('click', () => {
    if (estado.celulaSelecionada) {
      desalojarCasaLocal(estado.celulaSelecionada.gx, estado.celulaSelecionada.gz);
    }
  });

  // Guardar Local
  document.getElementById('btn-guardar-local')?.addEventListener('click', guardarCiudadEnStorage);

  window.addEventListener('resize', () => {
    if (camera && renderizador) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderizador.setSize(window.innerWidth, window.innerHeight);
    }
  });
}

function procesarClicEnGrilla(gx, gz) {
  if (!celulaValida(gx, gz)) return;
  const ferr = estado.ferramentaAtiva;

  if (ferr === 'ponteiro') {
    estado.celulaSelecionada = { gx, gz };
    mostrarDetallesCelula(gx, gz);
  } else if (ferr === 'demolir') {
    eliminarObjetoLocal(gx, gz);
    tocarSonido('demolir');
    desenharMiniMapa();
    mostrarNotificacion('💥 Edificio demolido.');
  } else {
    const costo = jugadorLocal.esAdmin ? 0 : (COSTOS_CONSTRUCCION[ferr] || 0);
    if (!jugadorLocal.esAdmin && jugadorLocal.oikos < costo) {
      mostrarNotificacion(`❌ Saldo insuficiente (${costo} Oikos necesarios).`);
      tocarSonido('error');
      return;
    }

    if (estado.grade[gz][gx] !== null) {
      mostrarNotificacion('⚠️ Terreno ya ocupado.');
      return;
    }

    if (!jugadorLocal.esAdmin) {
      jugadorLocal.oikos -= costo;
    }
    instanciarObjetoLocal(ferr, gx, gz, estado.rotacaoAtual, null, jugadorLocal.esAdmin ? 'Municipio (Alcalde)' : jugadorLocal.nombre);
    actualizarHUD();
    tocarSonido('construir');
    desenharMiniMapa();
    mostrarNotificacion(`🔨 ${ferr.toUpperCase()} construido con éxito.`);
  }
}

/* ============================================================
   10. TRABAJO Y ALQUILER LOCAL
   ============================================================ */
function iniciarTurnoTrabajoLocal() {
  jugadorLocal.trabajando = true;
  jugadorLocal.duracionTurnoTotal = 10;
  jugadorLocal.tiempoTurnoRestante = 10;
  actualizarEstadoTrabajoUI();
  mostrarNotificacion('💼 Turno de trabajo iniciado (10s).');

  const timer = setInterval(() => {
    jugadorLocal.tiempoTurnoRestante--;
    actualizarEstadoTrabajoUI();

    if (jugadorLocal.tiempoTurnoRestante <= 0) {
      clearInterval(timer);
      jugadorLocal.trabajando = false;
      jugadorLocal.oikos += SALARIO_TURNO_OIKOS;
      actualizarEstadoTrabajoUI();
      actualizarHUD();
      guardarCiudadEnStorage(false);
      tocarSonido('monedas');
      mostrarNotificacion(`💰 ¡Turno cumplido! Recibiste tu salario de +${SALARIO_TURNO_OIKOS} Oikos.`);
    }
  }, 1000);
}

function alquilarCasaLocal(gx, gz) {
  const celda = estado.grade[gz]?.[gx];
  if (!celda || !['casa', 'sobrado', 'predio'].includes(celda.tipo)) return;

  if (celda.inquilino !== null) {
    mostrarNotificacion('⚠️ Esta vivienda ya se encuentra alquilada.');
    return;
  }

  if (jugadorLocal.oikos < COSTO_ALQUILER_CICLO) {
    mostrarNotificacion(`❌ Saldo insuficiente (${COSTO_ALQUILER_CICLO} Oikos requeridos).`);
    tocarSonido('error');
    return;
  }

  jugadorLocal.oikos -= COSTO_ALQUILER_CICLO;
  celda.inquilino = jugadorLocal.nombre;
  jugadorLocal.casasAlquiladas.push({ gx, gz });

  actualizarHUD();
  mostrarDetallesCelula(gx, gz);
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`🔑 ¡Has alquilado la vivienda en (${gx}, ${gz})!`);
}

function desalojarCasaLocal(gx, gz) {
  const celda = estado.grade[gz]?.[gx];
  if (!celda || celda.inquilino !== jugadorLocal.nombre) return;

  celda.inquilino = null;
  jugadorLocal.casasAlquiladas = jugadorLocal.casasAlquiladas.filter(c => !(c.gx === gx && c.gz === gz));

  mostrarDetallesCelula(gx, gz);
  guardarCiudadEnStorage(false);
  mostrarNotificacion('🚪 Has entregado las llaves de la vivienda.');
}

function iniciarCicloAlquilerLocal() {
  setInterval(() => {
    if (jugadorLocal.casasAlquiladas.length === 0) return;

    const totalCobro = jugadorLocal.casasAlquiladas.length * COSTO_ALQUILER_CICLO;
    if (jugadorLocal.oikos >= totalCobro) {
      jugadorLocal.oikos -= totalCobro;
      actualizarHUD();
      guardarCiudadEnStorage(false);
      mostrarNotificacion(`🏠 Pago periódico de alquiler: -${totalCobro} Oikos (${jugadorLocal.casasAlquiladas.length} casas).`);
    } else {
      mostrarNotificacion('⚠️ Saldo insuficiente para pagar el alquiler. Tus contratos han sido cancelados.');
      jugadorLocal.casasAlquiladas.forEach(({ gx, gz }) => {
        if (estado.grade[gz]?.[gx]) estado.grade[gz][gx].inquilino = null;
      });
      jugadorLocal.casasAlquiladas = [];
      guardarCiudadEnStorage(false);
      if (estado.celulaSelecionada) mostrarDetallesCelula(estado.celulaSelecionada.gx, estado.celulaSelecionada.gz);
    }
  }, 45000);
}

/* ============================================================
   11. PERSISTENCIA VINCULADA AL USUARIO DE FIREBASE
   ============================================================ */
function guardarCiudadEnStorage(notificar = true) {
  if (!jugadorLocal.uid) return;
  const clave = `katuete_save_${jugadorLocal.uid}`;

  const guardado = {
    nombre: jugadorLocal.nombre,
    oikos: jugadorLocal.oikos,
    casasAlquiladas: jugadorLocal.casasAlquiladas,
    mapa: []
  };

  for (let z = 0; z < TAMANHO_GRADE; z++) {
    for (let x = 0; x < TAMANHO_GRADE; x++) {
      const c = estado.grade[z][x];
      if (c) {
        guardado.mapa.push({ x, z, tipo: c.tipo, rot: c.rot, inquilino: c.inquilino, autor: c.autor });
      }
    }
  }

  localStorage.setItem(clave, JSON.stringify(guardado));
  if (notificar) {
    tocarSonido('monedas');
    mostrarNotificacion('💾 ¡Progreso guardado con éxito en tu cuenta!');
  }
}

function recuperarCiudadGuardada() {
  if (!jugadorLocal.uid) return false;
  const clave = `katuete_save_${jugadorLocal.uid}`;
  const data = localStorage.getItem(clave);
  if (!data) return false;

  try {
    const parse = JSON.parse(data);
    jugadorLocal.oikos = parse.oikos ?? 1000;
    jugadorLocal.casasAlquiladas = parse.casasAlquiladas || [];

    parse.mapa.forEach(item => {
      instanciarObjetoLocal(item.tipo, item.x, item.z, item.rot || 0, item.inquilino, item.autor);
    });

    actualizarHUD();
    return true;
  } catch (e) {
    return false;
  }
}

/* ============================================================
   12. INTERFAZ Y DETALLES (CARD DE INSPECCIÓN)
   ============================================================ */
function actualizarDockActivo(idBoton) {
  document.querySelectorAll('.btn-dock').forEach(b => b.classList.remove('activo'));
  const btn = document.getElementById(idBoton);
  if (btn) btn.classList.add('activo');
}

function mostrarDetallesCelula(gx, gz) {
  const celda = estado.grade[gz]?.[gx];
  const card = document.getElementById('card-inspeccion');
  const titulo = document.getElementById('card-titulo-edificio');
  const detalles = document.getElementById('card-detalles-edificio');
  const zonaAcciones = document.getElementById('zona-acciones-inmueble');
  const btnAlquilar = document.getElementById('btn-alquilar-casa');
  const btnDesalojar = document.getElementById('btn-desalojar-casa');

  if (!card) return;

  zonaAcciones.style.display = 'none';
  btnAlquilar.style.display = 'none';
  btnDesalojar.style.display = 'none';

  if (!celda) {
    titulo.textContent = '🌿 Terreno Libre';
    detalles.innerHTML = `Sector: (${gx}, ${gz})<br/><small>Selecciona 'Construir' en el menú inferior para edificar.</small>`;
    card.style.display = 'block';
    return;
  }

  const esVivienda = ['casa', 'sobrado', 'predio'].includes(celda.tipo);
  const estadoAlquiler = celda.inquilino
    ? `<span style="color:#ffb74d">Inquilino: <strong>${celda.inquilino}</strong></span>`
    : `<span style="color:#81c784">Disponible para Alquiler</span>`;

  titulo.textContent = `${celda.tipo === 'casa' ? '🏠 Casa' : celda.tipo === 'sobrado' ? '🏡 Sobrado' : celda.tipo === 'predio' ? '🏢 Edificio' : celda.tipo === 'estrada' ? '🛣️ Calle' : celda.tipo.toUpperCase()}`;
  
  detalles.innerHTML = `
    Ubicación: Sector (${gx}, ${gz})<br/>
    Constructor: <em>${celda.autor || 'Municipio'}</em><br/>
    ${esVivienda ? `Estado: ${estadoAlquiler}<br/><small>Alquiler: 150 Oikos / ciclo</small>` : ''}
  `;

  card.style.display = 'block';

  if (esVivienda) {
    zonaAcciones.style.display = 'block';
    if (!celda.inquilino) {
      btnAlquilar.style.display = 'block';
    } else if (celda.inquilino === jugadorLocal.nombre || jugadorLocal.esAdmin) {
      btnDesalojar.style.display = 'block';
    }
  }
}

function seleccionarHerramienta(nome) {
  estado.ferramentaAtiva = nome;
  limparFantasma();
  limparPreviewLinhaEstrada();

  document.querySelectorAll('.btn-ferramenta').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.ferramenta === nome);
  });

  const indRot = document.getElementById('indicador-rotacao');
  const btnRotarTouch = document.getElementById('btn-rotar-touch');
  const precisaRot = ['casa', 'sobrado', 'predio', 'loja', 'posto', 'usina'].includes(nome);
  if (indRot) indRot.classList.toggle('visivel', precisaRot);
  if (btnRotarTouch) btnRotarTouch.style.display = precisaRot ? 'flex' : 'none';

  const canvas = document.getElementById('canvas-jogo');
  if (canvas) {
    canvas.classList.toggle('modo-construir', nome !== 'ponteiro' && nome !== 'demolir');
    canvas.classList.toggle('modo-demolir', nome === 'demolir');
  }

  // Si selecciona puntero o demoler, actualiza el dock
  if (nome === 'ponteiro') actualizarDockActivo('dock-btn-puntero');
  if (nome === 'demolir') actualizarDockActivo('dock-btn-demoler');
}

function actualizarPreviewFantasma(gx, gz) {
  limparFantasma();
  const ferr = estado.ferramentaAtiva;
  if (ferr === 'ponteiro' || ferr === 'demolir') return;

  const { x, z } = gradeParaMundo(gx, gz);
  const livre = celulaValida(gx, gz) && estado.grade[gz][gx] === null;

  const geo = new THREE.BoxGeometry(TAMANHO_CELULA * 0.85, 2.0, TAMANHO_CELULA * 0.85);
  const cor = livre ? 0x66bb6a : 0xef5350;
  fantasmaObjeto = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.45 }));
  fantasmaObjeto.position.set(x, 1.0, z);
  fantasmaObjeto.rotation.y = (estado.rotacaoAtual * Math.PI) / 180;
  cena.add(fantasmaObjeto);
}

function limparFantasma() {
  if (fantasmaObjeto) {
    cena.remove(fantasmaObjeto);
    fantasmaObjeto = null;
  }
}

function obtenerCaminoL(origem, destino) {
  const camino = [];
  const x0 = origem.gx, z0 = origem.gz;
  const x1 = destino.gx, z1 = destino.gz;
  const passoX = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + passoX; x += passoX) {
    camino.push({ gx: x, gz: z0 });
  }
  const passoZ = z1 >= z0 ? 1 : -1;
  for (let z = z0 + passoZ; z !== z1 + passoZ; z += passoZ) {
    camino.push({ gx: x1, gz: z });
  }
  return camino;
}

function actualizarPreviewLinhaEstrada(camino) {
  limparPreviewLinhaEstrada();
  grupoPreviewEstrada = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.55 });

  camino.forEach(c => {
    if (celulaValida(c.gx, c.gz)) {
      const { x, z } = gradeParaMundo(c.gx, c.gz);
      const b = new THREE.Mesh(new THREE.BoxGeometry(TAMANHO_CELULA * 0.95, 0.15, TAMANHO_CELULA * 0.95), mat);
      b.position.set(x, 0.1, z);
      grupoPreviewEstrada.add(b);
    }
  });
  cena.add(grupoPreviewEstrada);
}

function limparPreviewLinhaEstrada() {
  if (grupoPreviewEstrada) {
    cena.remove(grupoPreviewEstrada);
    grupoPreviewEstrada = null;
  }
}

function actualizarHUD() {
  const badgeNombre = document.getElementById('stat-jugador-nombre');
  const badgeUsuarioContenedor = badgeNombre ? badgeNombre.closest('.user-badge') : null;
  const saldoTexto = document.getElementById('stat-oikos-saldo');
  const btnAdmin = document.getElementById('btn-panel-admin');
  const btnAbrirLogin = document.getElementById('btn-abrir-login');
  const btnDesconectar = document.getElementById('btn-desconectar');

  if (jugadorLocal.esAdmin) {
    if (badgeNombre) badgeNombre.textContent = `👑 Alcalde`;
    badgeUsuarioContenedor?.classList.add('admin');
    if (saldoTexto) saldoTexto.textContent = '∞';
    if (btnAdmin) btnAdmin.style.display = 'inline-flex';
    if (btnAbrirLogin) btnAbrirLogin.style.display = 'none';
    if (btnDesconectar) btnDesconectar.style.display = 'inline-block';
  } else if (jugadorLocal.uid) {
    if (badgeNombre) badgeNombre.textContent = jugadorLocal.nombre;
    badgeUsuarioContenedor?.classList.remove('admin');
    if (saldoTexto) saldoTexto.textContent = Number(jugadorLocal.oikos).toLocaleString('es-PY');
    if (btnAdmin) btnAdmin.style.display = 'none';
    if (btnAbrirLogin) btnAbrirLogin.style.display = 'none';
    if (btnDesconectar) btnDesconectar.style.display = 'inline-block';
  } else {
    // Visitante (no ha iniciado sesión todavía)
    if (badgeNombre) badgeNombre.textContent = 'Visitante';
    badgeUsuarioContenedor?.classList.remove('admin');
    if (saldoTexto) saldoTexto.textContent = Number(jugadorLocal.oikos).toLocaleString('es-PY');
    if (btnAdmin) btnAdmin.style.display = 'none';
    if (btnAbrirLogin) btnAbrirLogin.style.display = 'inline-block';
    if (btnDesconectar) btnDesconectar.style.display = 'none';
  }
}

/* ============================================================
   13. PANEL DE ADMINISTRACIÓN (ALCALDÍA MUNICIPAL)
   ============================================================ */
const modalAdmin = document.getElementById('modal-admin');
const btnAbrirAdmin = document.getElementById('btn-panel-admin');
const btnCerrarAdmin = document.getElementById('admin-cerrar-modal');

if (btnAbrirAdmin && modalAdmin) {
  btnAbrirAdmin.addEventListener('click', () => {
    modalAdmin.style.display = 'flex';
  });
}

if (btnCerrarAdmin && modalAdmin) {
  btnCerrarAdmin.addEventListener('click', () => {
    modalAdmin.style.display = 'none';
  });
}

// Acciones Administrativas
document.getElementById('admin-dar-oikos')?.addEventListener('click', () => {
  jugadorLocal.oikos += 100000;
  actualizarHUD();
  tocarSonido('monedas');
  mostrarNotificacion('💰 +100,000 Oikos inyectados al tesoro municipal.');
});

document.getElementById('admin-limpiar-ciudad')?.addEventListener('click', () => {
  if (confirm('¿Estás seguro de demoler toda la ciudad y dejar el terreno limpio?')) {
    for (let z = 0; z < TAMANHO_GRADE; z++) {
      for (let x = 0; x < TAMANHO_GRADE; x++) {
        eliminarObjetoLocal(x, z);
      }
    }
    tocarSonido('demolir');
    actualizarChunksCamara(true);
    desenharMiniMapa();
    guardarCiudadEnStorage(false);
    modalAdmin.style.display = 'none';
    mostrarNotificacion('🧹 Toda la ciudad ha sido demolida por decreto municipal.');
  }
});

document.getElementById('admin-desalojar-todos')?.addEventListener('click', () => {
  let liberadas = 0;
  for (let z = 0; z < TAMANHO_GRADE; z++) {
    for (let x = 0; x < TAMANHO_GRADE; x++) {
      const c = estado.grade[z][x];
      if (c && c.inquilino) {
        c.inquilino = null;
        liberadas++;
      }
    }
  }
  tocarSonido('monedas');
  guardarCiudadEnStorage(false);
  modalAdmin.style.display = 'none';
  mostrarNotificacion(`🚪 Se han liberado ${liberadas} viviendas.`);
});

document.getElementById('admin-regenerar-base')?.addEventListener('click', () => {
  if (confirm('¿Restaurar el trazado urbano modelo original de KatueteCity?')) {
    for (let z = 0; z < TAMANHO_GRADE; z++) {
      for (let x = 0; x < TAMANHO_GRADE; x++) {
        eliminarObjetoLocal(x, z);
      }
    }
    generarCiudadBase();
    actualizarChunksCamara(true);
    tocarSonido('construir');
    desenharMiniMapa();
    guardarCiudadEnStorage(false);
    modalAdmin.style.display = 'none';
    mostrarNotificacion('🏙️ Ciudad modelo original restaurada con éxito.');
  }
});

function actualizarEstadoTrabajoUI() {
  const btn = document.getElementById('btn-trabajar');
  const barra = document.getElementById('barra-progreso-trabajo');
  const texto = document.getElementById('texto-progreso-trabajo');

  if (jugadorLocal.trabajando) {
    btn.disabled = true;
    const porcentaje = Math.max(0, Math.min(100, ((jugadorLocal.duracionTurnoTotal - jugadorLocal.tiempoTurnoRestante) / jugadorLocal.duracionTurnoTotal) * 100));
    barra.style.width = `${porcentaje}%`;
    texto.textContent = `${jugadorLocal.tiempoTurnoRestante}s restantes`;
  } else {
    btn.disabled = false;
    barra.style.width = '0%';
    texto.textContent = 'Listo para turno';
  }
}

function actualizarListaCiudadanos(lista) {
  const cont = document.getElementById('lista-usuarios-conectados');
  if (!cont) return;
  cont.innerHTML = '';

  lista.forEach(u => {
    const item = document.createElement('div');
    item.className = 'ciudadano-item';
    item.innerHTML = `
      <span>👤 <strong>${u.nombre}</strong></span>
      <span class="oikos-num">${Number(u.oikos).toLocaleString('es-PY')} Ø</span>
    `;
    cont.appendChild(item);
  });
}

let timerToast = null;
function mostrarNotificacion(txt) {
  const el = document.getElementById('notificacao');
  el.textContent = txt;
  el.classList.add('visivel');
  if (timerToast) clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('visivel'), 3000);
}

function desenharMiniMapa() {
  const canvas = document.getElementById('mini-mapa');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const px = w / TAMANHO_GRADE;

  ctx.fillStyle = '#1b5e20';
  ctx.fillRect(0, 0, w, h);

  const colores = {
    estrada: '#37474f',
    casa: '#ffb74d',
    sobrado: '#0288d1',
    predio: '#90a4ae',
    loja: '#fbc02d',
    posto: '#e53935',
    parque: '#2e7d32',
    usina: '#546e7a',
    caixaDAgua: '#00acc1'
  };

  for (let z = 0; z < TAMANHO_GRADE; z++) {
    for (let x = 0; x < TAMANHO_GRADE; x++) {
      const item = estado.grade[z]?.[x];
      if (item && colores[item.tipo]) {
        ctx.fillStyle = colores[item.tipo];
        ctx.fillRect(
          Math.floor(x * px),
          Math.floor(z * px),
          Math.max(1, Math.ceil(px * 2)),
          Math.max(1, Math.ceil(px * 2))
        );
      }
    }
  }

  // Cuadro indicador de visión de la cámara en el mapa 10x
  if (controles) {
    const { gx, gz } = mundoParaGrade(controles.target.x, controles.target.z);
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    const viewSize = Math.max(8, Math.floor((CHUNK_SIZE * RAIO_CHUNKS * 2) * px));
    ctx.strokeRect(
      Math.floor(gx * px - viewSize / 2),
      Math.floor(gz * px - viewSize / 2),
      viewSize,
      viewSize
    );
  }
}

// Navegación rápida tocando en el minimapa
const miniMapaCanvas = document.getElementById('mini-mapa');
if (miniMapaCanvas) {
  const navegarMinimapa = (e) => {
    const rect = miniMapaCanvas.getBoundingClientRect();
    const clickX = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
    const clickY = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
    const gx = Math.floor((clickX / miniMapaCanvas.width) * TAMANHO_GRADE);
    const gz = Math.floor((clickY / miniMapaCanvas.height) * TAMANHO_GRADE);
    if (celulaValida(gx, gz) && controles) {
      const { x, z } = gradeParaMundo(gx, gz);
      controles.target.set(x, 0, z);
      camera.position.set(x + 65, 80, z + 85);
      controles.update();
      desenharMiniMapa();
      tocarSonido('monedas');
    }
  };
  miniMapaCanvas.addEventListener('click', navegarMinimapa);
}

function animar() {
  requestAnimationFrame(animar);
  if (controles) controles.update();

  if (controles && gridHelper) {
    gridHelper.position.x = Math.floor(controles.target.x / TAMANHO_CELULA) * TAMANHO_CELULA;
    gridHelper.position.z = Math.floor(controles.target.z / TAMANHO_CELULA) * TAMANHO_CELULA;
  }

  if (controles && luzSol) {
    luzSol.position.set(controles.target.x + 80, 130, controles.target.z + 70);
    luzSol.target.position.set(controles.target.x, 0, controles.target.z);
    luzSol.target.updateMatrixWorld();
  }

  actualizarChunksCamara();
  procesarFilaChunks();

  if (renderizador && cena && camera) {
    renderizador.render(cena, camera);
  }
}

/* ============================================================
   14. AUTO-INICIALIZACIÓN INMEDIATA DEL MAPA 3D
   ============================================================ */
// Se ejecuta de inmediato al cargar el script para que el visitante
// vea el mapa 3D y la ciudad sin tener que pasar por ninguna pantalla previa.
recuperarCiudadGuardada();

const centroInicial = Math.floor(TAMANHO_GRADE / 2);
if (estado.grade[centroInicial][centroInicial] === null) {
  generarCiudadBase();
}

iniciarMotor3D();
actualizarChunksCamara(true); // Carga inmediata de los chunks iniciales
iniciarCicloAlquilerLocal();
actualizarHUD();
desenharMiniMapa();
