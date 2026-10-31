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
let socket = null;

function inicializarConexionSocket() {
  if (typeof io === 'undefined') return;

  let urlServidor = window.KATUETE_SERVER_URL || localStorage.getItem('katuete_server_url');
  const esServidorPropio = window.location.hostname.includes('onrender.com') ||
                           window.location.hostname.includes('railway.app') ||
                           window.location.hostname === 'localhost' ||
                           window.location.hostname === '127.0.0.1' ||
                           window.location.port === '3000';

  if (!urlServidor && esServidorPropio) {
    urlServidor = window.location.origin;
  }

  const inpUrl = document.getElementById('input-url-servidor');
  const txtEstado = document.getElementById('estado-conexion-texto');
  if (inpUrl && urlServidor) inpUrl.value = urlServidor;

  if (!urlServidor && !esServidorPropio) {
    console.log('ℹ️ KatueteCity en modo local (GitHub Pages). Para multijugador en vivo, conecta tu URL de Render.');
    if (txtEstado) {
      txtEstado.textContent = '⚠️ Sin conexión (Render)';
      txtEstado.style.color = '#ffb74d';
    }
    const badgeOnline = document.getElementById('badge-online');
    if (badgeOnline) {
      badgeOnline.style.cursor = 'pointer';
      badgeOnline.title = 'Haz clic para conectar a tu servidor multijugador Render';
    }
    return;
  }

  try {
    if (socket) {
      try { socket.disconnect(); } catch (e) {}
    }

    if (txtEstado) {
      txtEstado.textContent = '🟡 Conectando...';
      txtEstado.style.color = '#fff176';
    }

    socket = io(urlServidor, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 25,
      reconnectionDelay: 2000
    });

    socket.on('connect', () => {
      console.log('🔌 Conectado exitosamente al servidor multijugador KatueteCity. ID:', socket.id);
      socket.emit('iniciar_sesion', {
        nombre: jugadorLocal.nombre,
        uid: jugadorLocal.uid,
        esAdmin: jugadorLocal.esAdmin,
        oikos: jugadorLocal.oikos
      });
      mostrarNotificacion('🌐 ¡Conectado al servidor multijugador en vivo!');
      const badgeOnline = document.getElementById('badge-online');
      if (badgeOnline) {
        badgeOnline.style.borderColor = '#81c784';
        badgeOnline.style.boxShadow = '0 0 10px rgba(129, 199, 132, 0.5)';
      }
      if (txtEstado) {
        txtEstado.textContent = '🟢 En línea (' + (socket.id ? socket.id.substring(0, 4) : 'OK') + ')';
        txtEstado.style.color = '#81c784';
      }
    });

    // 1. Carga inicial del mapa sincronizado desde el servidor
    socket.on('bienvenida', (datos) => {
      console.log('📦 Mapa compartido recibido del servidor:', datos?.mapa?.length || 0, 'edificios');
      if (datos?.mapa && Array.isArray(datos.mapa) && datos.mapa.length > 0) {
        datos.mapa.forEach(item => {
          instanciarObjetoLocal(item.tipo, item.x, item.z, item.rot || 0, item.inquilino, item.autor);
          const c = estado.grade[item.z]?.[item.x];
          if (c) {
            c.alquilerExpira = item.alquilerExpira || null;
            c.precioAlquiler = item.precioAlquiler || 150;
            c.duracionAlquilerSegundos = item.duracionAlquilerSegundos || 180;
          }
        });
        desenharMiniMapa();
      }
      if (datos?.jugadoresOnline) {
        actualizarListaCiudadanos(datos.jugadoresOnline);
        const elOnline = document.getElementById('stat-jugadores-online');
        if (elOnline) elOnline.textContent = datos.jugadoresOnline.length;
      }
    });

    // 2. Construcción replicada en tiempo real de otro jugador
    socket.on('objeto_construido', (datos) => {
      const celdaExistente = estado.grade[datos.gz]?.[datos.gx];
      // Si el autor es el jugador local y la celda ya tiene el tipo correcto, omitir re-creación para evitar parpadeos
      if (celdaExistente && celdaExistente.tipo === datos.tipo && datos.autor === jugadorLocal.nombre) {
        return;
      }
      instanciarObjetoLocal(datos.tipo, datos.gx, datos.gz, datos.rot || 0, datos.inquilino, datos.autor);
      desenharMiniMapa();
      if (datos.autor && datos.autor !== jugadorLocal.nombre) {
        mostrarNotificacion(`🔨 ${datos.autor} construyó ${datos.tipo.toUpperCase()} en (${datos.gx}, ${datos.gz}).`);
        tocarSonido('construir');
      }
    });

    // 3. Demolición replicada en tiempo real
    socket.on('objeto_demolido', (datos) => {
      eliminarObjetoLocal(datos.gx, datos.gz);
      desenharMiniMapa();
      if (datos.demolidoPor && datos.demolidoPor !== jugadorLocal.nombre) {
        mostrarNotificacion(`💥 ${datos.demolidoPor} demolió un edificio en (${datos.gx}, ${datos.gz}).`);
        tocarSonido('demolir');
      }
    });

    // 4. Mejora vial replicada
    socket.on('calle_mejorada', (datos) => {
      const celda = estado.grade[datos.gz]?.[datos.gx];
      if (celda) {
        celda.tipo = datos.nuevoTipo;
        actualizarMeshCelda(datos.gx, datos.gz);
        actualizarVecinosEstrada(datos.gx, datos.gz);
        desenharMiniMapa();
      }
    });

    // 5. Movimiento de construcción replicado
    socket.on('objeto_movido', (datos) => {
      eliminarObjetoLocal(datos.origenGx, datos.origenGz);
      instanciarObjetoLocal(datos.tipo, datos.destinoGx, datos.destinoGz, datos.rot || 0, null, 'Municipio');
      desenharMiniMapa();
    });

    // 6. Alquileres replicados en tiempo real
    socket.on('casa_actualizada', (datos) => {
      let celda = estado.grade[datos.gz]?.[datos.gx];
      if (celda) {
        if (celda.esHijo) celda = estado.grade[celda.rootZ]?.[celda.rootX];
        if (celda) {
          celda.inquilino = datos.inquilino;
          celda.alquilerExpira = datos.alquilerExpira || null;
          if (datos.precioAlquiler) celda.precioAlquiler = datos.precioAlquiler;
          if (datos.duracionAlquilerSegundos) celda.duracionAlquilerSegundos = datos.duracionAlquilerSegundos;
          actualizarMeshCelda(datos.gx, datos.gz);
          if (estado.celulaSelecionada && estado.celulaSelecionada.gx === datos.gx && estado.celulaSelecionada.gz === datos.gz) {
            mostrarDetallesCelula(datos.gx, datos.gz);
          }
        }
      }
    });

    // 6.1 Rotación replicada en tiempo real
    socket.on('objeto_rotado', (datos) => {
      let celda = estado.grade[datos.gz]?.[datos.gx];
      if (celda) {
        if (celda.esHijo) celda = estado.grade[celda.rootZ]?.[celda.rootX];
        if (celda) {
          celda.rot = datos.rot;
          actualizarMeshCelda(datos.gx, datos.gz);
          desenharMiniMapa();
          if (estado.celulaSelecionada && estado.celulaSelecionada.gx === datos.gx && estado.celulaSelecionada.gz === datos.gz) {
            mostrarDetallesCelula(datos.gx, datos.gz);
          }
        }
      }
    });

    // 7. Lista de jugadores
    socket.on('actualizar_lista_jugadores', (lista) => {
      actualizarListaCiudadanos(lista);
      const elOnline = document.getElementById('stat-jugadores-online');
      if (elOnline) elOnline.textContent = lista.length;
    });

    socket.on('jugador_conectado', (datos) => {
      mostrarNotificacion(`👤 ${datos.nombre} ingresó a la ciudad.`);
    });

    socket.on('disconnect', () => {
      console.log('⚠️ Desconectado del servidor multijugador.');
      const badgeOnline = document.getElementById('badge-online');
      if (badgeOnline) {
        badgeOnline.style.borderColor = '#ef5350';
        badgeOnline.style.boxShadow = 'none';
      }
      if (txtEstado) {
        txtEstado.textContent = '🔴 Desconectado';
        txtEstado.style.color = '#ef5350';
      }
    });
  } catch (err) {
    console.error('Error al iniciar socket multijugador:', err);
    if (txtEstado) {
      txtEstado.textContent = '❌ Error de conexión';
      txtEstado.style.color = '#ef5350';
    }
  }
}

window.conectarAServidorMultijugador = function(url) {
  if (url) {
    url = url.trim().replace(/\/$/, '');
    localStorage.setItem('katuete_server_url', url);
  }
  inicializarConexionSocket();
};

// Listeners de interfaz para conexión multijugador
document.getElementById('btn-conectar-servidor')?.addEventListener('click', () => {
  const inp = document.getElementById('input-url-servidor');
  if (inp && inp.value) {
    window.conectarAServidorMultijugador(inp.value);
    mostrarNotificacion('🔄 Intentando conectar a: ' + inp.value);
  }
});

document.getElementById('badge-online')?.addEventListener('click', () => {
  const menu = document.getElementById('menu-ciudad');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
});

const jugadorLocal = {
  uid: null,
  nombre: 'Ciudadano',
  email: '',
  esAdmin: false,
  oikos: 1000,
  saldoBanco: 0,
  deudaPrestamo: 0,
  trabajando: false,
  tiempoTurnoRestante: 0,
  duracionTurnoTotal: 10,
  casasAlquiladas: [],
  inventario: [], // [ { id, nombre, icono, desc, cantidad, precioVenta, tipo } ]
  garagem: [],    // [ { id, nombre, icono, velocidad } ]
  empleoEspecializado: null // { id, titulo, empresa, salario, duracion }
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
  estrada_terra: 0,
  estrada_empedrado: 120,
  estrada: 0, // Exclusivo Alcalde
  casa: 400,
  sobrado: 900,
  predio: 2200,
  loja: 1100,
  padaria: 1200,
  mercado: 2000,
  loja_roupa: 1500,
  restaurante: 1600,
  posto: 1800,
  loja_veiculos: 3200, // 2x2
  banco: 4000,         // 2x2
  parque: 600,         // Exclusivo Alcalde (3x3)
  usina: 2800,         // Exclusivo Alcalde (2x2)
  caixaDAgua: 2000,    // Exclusivo Alcalde
  municipalidad: 5000   // Exclusivo Alcalde (3x3)
};

// Obras reservadas exclusivamente para el Alcalde (Admin)
const CONSTRUCCIONES_EXCLUSIVAS_ALCALDE = [
  'parque',
  'usina',
  'caixaDAgua',
  'estrada',
  'municipalidad'
];

// Dimensiones de huella en la grilla para construcciones de múltiples celdas
const DIMENSIONES_OBJETOS = {
  parque: { w: 3, h: 3 },
  usina: { w: 2, h: 2 },
  municipalidad: { w: 3, h: 3 },
  loja_veiculos: { w: 2, h: 2 },
  banco: { w: 2, h: 2 }
};

function obtenerDimensionesObjeto(tipo) {
  return DIMENSIONES_OBJETOS[tipo] || { w: 1, h: 1 };
}

/* ============================================================
   CATÁLOGO DE PRODUCTOS Y EMPLEOS POR COMERCIO
   ============================================================ */
const CATALOGO_COMERCIOS = {
  loja: {
    titulo: '🏪 Tienda de Abastecimiento General',
    subtitulo: 'Herramientas, provisiones y artículos esenciales',
    articulos: [
      { id: 'herramientas', nombre: 'Caja de Herramientas', icono: '🧰', desc: 'Permite reparar y equipar', precio: 180, precioVenta: 90, tipo: 'herramienta' },
      { id: 'linterna', nombre: 'Linterna Eléctrica', icono: '🔦', desc: 'Accesorio de exploración', precio: 75, precioVenta: 35, tipo: 'accesorio' },
      { id: 'mochila_cuero', nombre: 'Mochila de Explorador', icono: '🎒', desc: 'Aumenta tu capacidad', precio: 300, precioVenta: 150, tipo: 'accesorio' }
    ],
    empleo: { id: 'dependiente_tienda', titulo: 'Dependiente de Mostrador', empresa: 'Tienda Comercial', salario: 380, duracion: 10, desc: 'Atención al cliente y reposición de provisiones.' }
  },
  padaria: {
    titulo: '🥖 Panadería Katueté',
    subtitulo: 'Panes recién horneados, café expreso y repostería',
    articulos: [
      { id: 'pan_frances', nombre: 'Cesta de Pan Caliente', icono: '🥖', desc: 'Alimento diario reconstituyente', precio: 25, precioVenta: 12, tipo: 'alimento' },
      { id: 'chipa_tradicional', nombre: 'Chipá Tradicional', icono: '🥯', desc: 'Especialidad típica paraguaya', precio: 35, precioVenta: 18, tipo: 'alimento' },
      { id: 'cafe_expreso', nombre: 'Café Expreso Caliente', icono: '☕', desc: 'Energía para turnos de trabajo', precio: 20, precioVenta: 10, tipo: 'alimento' },
      { id: 'torta_miel', nombre: 'Torta Dulce de Miel', icono: '🍰', desc: 'Postre artesanal delicioso', precio: 65, precioVenta: 30, tipo: 'alimento' }
    ],
    empleo: { id: 'panadero', titulo: 'Maestro Panadero y Pastelero', empresa: 'Panadería Katueté', salario: 420, duracion: 12, desc: 'Elaboración de chipás tradicionales y panes artesanales.' }
  },
  mercado: {
    titulo: '🛒 Supermercado Municipal Katueté',
    subtitulo: 'Víveres, canastas familiares y alimentos frescos',
    articulos: [
      { id: 'canasta_familiar', nombre: 'Canasta Básica Familiar', icono: '🧺', desc: 'Alimentos completos para el hogar', precio: 120, precioVenta: 60, tipo: 'alimento' },
      { id: 'leche_fresca', nombre: 'Pack de Leche Entera', icono: '🥛', desc: 'Nutrición matinal para la familia', precio: 40, precioVenta: 20, tipo: 'alimento' },
      { id: 'carne_selecta', nombre: 'Corte de Carne Vacuna', icono: '🥩', desc: 'Proteína fresca de primera', precio: 95, precioVenta: 45, tipo: 'alimento' },
      { id: 'aceite_cocina', nombre: 'Botella de Aceite Puro', icono: '🫒', desc: 'Insumo culinario esencial', precio: 50, precioVenta: 25, tipo: 'alimento' }
    ],
    empleo: { id: 'cajero_mercado', titulo: 'Cajero y Repositor', empresa: 'Supermercado Municipal', salario: 450, duracion: 11, desc: 'Cobro en cajas rápidas y acomodación de góndolas de alimentos.' }
  },
  loja_roupa: {
    titulo: '👕 Boutique & Tienda de Modas',
    subtitulo: 'Indumentaria urbana, atuendos formales y accesorios',
    articulos: [
      { id: 'traje_formal', nombre: 'Traje de Gala Ejecutivo', icono: '👔', desc: 'Viste con distinción cívica', precio: 380, precioVenta: 190, tipo: 'prenda' },
      { id: 'sombrero_piri', nombre: 'Sombrero Pirí Tradicional', icono: '👒', desc: 'Protección con estilo regional', precio: 90, precioVenta: 45, tipo: 'prenda' },
      { id: 'camisa_campestre', nombre: 'Camisa Campestre de Lino', icono: '👕', desc: 'Comodidad para el día a día', precio: 140, precioVenta: 70, tipo: 'prenda' },
      { id: 'botas_cuero', nombre: 'Botas de Cuero Curtido', icono: '👢', desc: 'Calzado resistente para la ciudad', precio: 220, precioVenta: 110, tipo: 'prenda' }
    ],
    empleo: { id: 'asesor_moda', titulo: 'Asesor de Imagen y Ventas', empresa: 'Boutique de Modas', salario: 460, duracion: 14, desc: 'Confección y recomendación de atuendos para ciudadanos.' }
  },
  restaurante: {
    titulo: '🍽️ Restaurante Tradicional Katueté',
    subtitulo: 'Gastronomía regional, asados criollos y banquetes',
    articulos: [
      { id: 'asado_mandioca', nombre: 'Asado con Mandioca', icono: '🍖', desc: 'Plato festivo por excelencia', precio: 110, precioVenta: 50, tipo: 'alimento' },
      { id: 'sopa_paraguaya', nombre: 'Sopa Paraguaya Auténtica', icono: '🥧', desc: 'Torta salada de queso y maíz', precio: 55, precioVenta: 25, tipo: 'alimento' },
      { id: 'empanadas_carne', nombre: 'Docena de Empanadas', icono: '🥟', desc: 'Almuerzo rápido y sabroso', precio: 60, precioVenta: 30, tipo: 'alimento' }
    ],
    empleo: { id: 'chef_cocina', titulo: 'Jefe de Cocina y Parrillero', empresa: 'Restaurante Tradicional', salario: 480, duracion: 13, desc: 'Preparación de asados tradicionales y platos típicos de Katueté.' }
  },
  posto: {
    titulo: '⛽ Estación de Servicios y Combustibles',
    subtitulo: 'Abastecimiento de vehículos, lubricantes y accesorios viales',
    articulos: [
      { id: 'bidon_nafta', nombre: 'Bidón de Nafta Súper', icono: '⛽', desc: 'Combustible de alta pureza', precio: 150, precioVenta: 75, tipo: 'suministro' },
      { id: 'aceite_motor', nombre: 'Lubricante Sintético', icono: '🛢️', desc: 'Mantenimiento preventivo', precio: 110, precioVenta: 55, tipo: 'suministro' }
    ],
    empleo: { id: 'operario_pista', titulo: 'Operario de Pista', empresa: 'Estación de Servicios', salario: 410, duracion: 10, desc: 'Carga de combustible y revisión de fluidos a vehículos.' }
  },
  loja_veiculos: {
    titulo: '🚗 Concesionaria Central de Vehículos',
    subtitulo: 'Adquisición de vehículos particulares y comerciales',
    articulos: [
      { id: 'bicicleta_urbana', nombre: 'Bicicleta Urbana Liviana', icono: '🚲', desc: 'Transporte ecológico y veloz', precio: 160, precioVenta: 80, tipo: 'vehiculo', velocidad: 1.15 },
      { id: 'moto_150cc', nombre: 'Motocicleta 150cc Street', icono: '🏍️', desc: 'Gran agilidad en el tráfico urbano', precio: 950, precioVenta: 480, tipo: 'vehiculo', velocidad: 1.35 },
      { id: 'auto_popular', nombre: 'Automóvil Sedán Familiar', icono: '🚗', desc: 'Confort y velocidad para la ciudad', precio: 2600, precioVenta: 1300, tipo: 'vehiculo', velocidad: 1.45 },
      { id: 'camioneta_4x4', nombre: 'Camioneta Pickup 4x4', icono: '🚙', desc: 'Fuerza todoterreno para todo Katueté', precio: 4800, precioVenta: 2400, tipo: 'vehiculo', velocidad: 1.55 }
    ],
    empleo: { id: 'mecanico_concesionaria', titulo: 'Técnico Automotriz y Ventas', empresa: 'Concesionaria Central', salario: 650, duracion: 18, desc: 'Ajuste mecánico y demostración de rodados a compradores.' }
  }
};

const estado = {
  ferramentaAtiva: 'ponteiro',
  rotacaoAtual: 0,
  celulaSelecionada: null,
  grade: [], // [z][x] -> { tipo, rot, mesh, inquilino, autor, w, h, esRaiz, rootX, rootZ, esHijo }
  bairros: [], // [ { id, nome, tipo, cor, x1, z1, x2, z2 } ]
  seleccionBairroInicio: null,
  meshPreviewSeleccionBairro: null,
  barrioEditandoId: null,
  arrastandoEstrada: false,
  inicioArrasto: null,
  objetoMoviendo: null // { tipo, rot, inquilino, autor, w, h, origenGx, origenGz }
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

// Redirección a la página dedicada de Login / Registro
if (btnAbrirLogin) {
  btnAbrirLogin.addEventListener('click', () => {
    window.location.href = 'login.html';
  });
}

if (btnCerrarLogin && modalLogin) {
  btnCerrarLogin.addEventListener('click', () => {
    modalLogin.style.display = 'none';
  });
}

// 4.1 BOTÓN CREAR CUENTA (PRIMERO)
btnRegistrarse?.addEventListener('click', async () => {
  msgErro.textContent = '';
  const email = campoEmail.value.trim();
  const password = campoSenha.value;

  if (!email || !password) {
    msgErro.textContent = 'Ingresa correo y contraseña (mínimo 6 caracteres).';
    return;
  }

  try {
    obtenerAudioContext();
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const esAdmin = email.toLowerCase() === 'katuetecity@katuete.com';
    try {
      localStorage.setItem('katuete_session', JSON.stringify({
        uid: user.uid,
        nombre: email.split('@')[0],
        email: user.email,
        esAdmin,
        oikos: esAdmin ? 9999999 : 1000
      }));
    } catch (e) {}
    mostrarNotificacion('🎉 ¡Cuenta creada con éxito en KatueteCity!');
    if (modalLogin) modalLogin.style.display = 'none';
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4.2 BOTÓN INICIAR SESIÓN (SEGUNDO)
formLogin?.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgErro.textContent = '';
  const email = campoEmail.value.trim().toLowerCase();
  const password = campoSenha.value;

  // Reconocimiento directo para Alcalde / Admin
  if (email === 'katuetecity@katuete.com' && password === 'juniorceo0905') {
    obtenerAudioContext();
    try {
      localStorage.setItem('katuete_session', JSON.stringify({
        uid: 'admin_master',
        nombre: 'ALCALDE',
        email: 'katuetecity@katuete.com',
        esAdmin: true,
        oikos: 9999999
      }));
    } catch (err) {}
    iniciarSesionComoAdmin(email);
    if (modalLogin) modalLogin.style.display = 'none';
    return;
  }

  try {
    obtenerAudioContext();
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    const esAdmin = (user.email || '').toLowerCase() === 'katuetecity@katuete.com';
    try {
      localStorage.setItem('katuete_session', JSON.stringify({
        uid: user.uid,
        nombre: user.displayName || user.email.split('@')[0],
        email: user.email,
        esAdmin,
        oikos: esAdmin ? 9999999 : 1000
      }));
    } catch (err) {}
    if (modalLogin) modalLogin.style.display = 'none';
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4.3 Iniciar Sesión con Google
btnGoogle?.addEventListener('click', async () => {
  msgErro.textContent = '';
  try {
    obtenerAudioContext();
    const cred = await signInWithPopup(auth, googleProvider);
    const user = cred.user;
    const esAdmin = (user.email || '').toLowerCase() === 'katuetecity@katuete.com';
    try {
      localStorage.setItem('katuete_session', JSON.stringify({
        uid: user.uid,
        nombre: user.displayName || user.email.split('@')[0],
        email: user.email,
        esAdmin,
        oikos: esAdmin ? 9999999 : 1000
      }));
    } catch (err) {}
    if (modalLogin) modalLogin.style.display = 'none';
  } catch (error) {
    mostrarErrorAuth(error.code, error.message);
  }
});

// 4.4 Cerrar Sesión
document.getElementById('btn-desconectar')?.addEventListener('click', async () => {
  try {
    localStorage.removeItem('katuete_session');
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
    // Si no hay usuario Firebase pero hay sesión de Alcalde guardada
    const sesion = localStorage.getItem('katuete_session');
    if (sesion) {
      try {
        const s = JSON.parse(sesion);
        if (s && s.uid === 'admin_master') {
          iniciarSesionComoAdmin(s.email);
          return;
        }
      } catch (e) {}
    }

    // Modo Visitante (el mapa sigue 100% visible y explorable)
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
  instanciarObjetoLocal('municipalidad', c - 7, c - 6, 0, null, 'Municipio'); // 3x3 Palacio Municipal
  instanciarObjetoLocal('parque', c + 2, c - 13, 0, null, 'Municipio');       // 3x3 Parque Ecológico
  instanciarObjetoLocal('usina', c - 12, c + 10, 0, null, 'Municipio');       // 2x2 Usina Eléctrica
  instanciarObjetoLocal('caixaDAgua', c + 11, c + 11, 0, null, 'Municipio');

  // Distrito inicial predeterminado
  if (!estado.bairros || estado.bairros.length === 0) {
    estado.bairros = [{
      id: 'barrio_centro',
      nome: 'Centro de Katuete',
      tipo: 'Cívico / Comercial',
      cor: '#2d9e42',
      x1: c - 18, z1: c - 18,
      x2: c + 18, z2: c + 18
    }];
  }
  reconstruirVisualBairros3D();
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
  reconstruirVisualBairros3D();
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

function criarPadaria(rot) {
  const grupo = new THREE.Group();
  const paredes = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.5, 3.4), new THREE.MeshLambertMaterial({ color: 0xfff3e0 }));
  paredes.position.y = 1.25;
  paredes.castShadow = true;
  grupo.add(paredes);

  const toldo = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.28, 1.3), new THREE.MeshLambertMaterial({ color: 0xd84315 }));
  toldo.position.set(0, 2.0, 1.85);
  toldo.rotation.x = 0.15;
  toldo.castShadow = true;
  grupo.add(toldo);

  const vidrio = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x81d4fa, transparent: true, opacity: 0.8 }));
  vidrio.position.set(-0.7, 1.2, 1.72);
  grupo.add(vidrio);

  [-0.9, -0.6, -0.3].forEach(px => {
    const baguette = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.45, 6), new THREE.MeshLambertMaterial({ color: 0xc68a4c }));
    baguette.position.set(px, 1.0, 1.6);
    baguette.rotation.z = Math.PI / 4;
    grupo.add(baguette);
  });

  const puerta = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.7, 0.08), new THREE.MeshLambertMaterial({ color: 0x5d4037 }));
  puerta.position.set(0.9, 0.85, 1.72);
  grupo.add(puerta);

  const chimenea = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.8, 0.45), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  chimenea.position.set(-1.0, 2.8, -0.8);
  grupo.add(chimenea);

  const letrero = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, 0.08), new THREE.MeshLambertMaterial({ color: 0xffb300 }));
  letrero.position.set(0, 2.35, 1.73);
  grupo.add(letrero);

  grupo.rotation.y = rot;
  return grupo;
}

function criarMercado(rot) {
  const grupo = new THREE.Group();
  const nave = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.8, 3.6), new THREE.MeshLambertMaterial({ color: 0xf1f8e9 }));
  nave.position.y = 1.4;
  nave.castShadow = true;
  grupo.add(nave);

  const marquesina = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.4, 1.2), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
  marquesina.position.set(0, 2.3, 1.85);
  marquesina.castShadow = true;
  grupo.add(marquesina);

  const cartelRooftop = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 0.2), new THREE.MeshLambertMaterial({ color: 0x1b5e20 }));
  cartelRooftop.position.set(0, 3.2, 0.5);
  grupo.add(cartelRooftop);

  const logoCartel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.22), new THREE.MeshLambertMaterial({ color: 0xffeb3b }));
  logoCartel.position.set(0, 3.2, 0.52);
  grupo.add(logoCartel);

  const puertas = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.8, 0.1), new THREE.MeshLambertMaterial({ color: 0x80deea, transparent: true, opacity: 0.85 }));
  puertas.position.set(0, 0.9, 1.82);
  grupo.add(puertas);

  const techoCarritos = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.8), new THREE.MeshLambertMaterial({ color: 0x78909c }));
  techoCarritos.position.set(-1.25, 1.1, 1.9);
  grupo.add(techoCarritos);
  [-1.4, -1.1].forEach(cx => {
    const carrito = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.35), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));
    carrito.position.set(cx, 0.25, 1.9);
    grupo.add(carrito);
  });

  grupo.rotation.y = rot;
  return grupo;
}

function criarLojaRoupa(rot) {
  const grupo = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 3.4), new THREE.MeshLambertMaterial({ color: 0x4a148c }));
  base.position.y = 1.3;
  base.castShadow = true;
  grupo.add(base);

  const marco = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.65, 0.3), new THREE.MeshLambertMaterial({ color: 0xad1457 }));
  marco.position.set(0, 1.32, 1.6);
  grupo.add(marco);

  const toldo = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.25, 1.1), new THREE.MeshLambertMaterial({ color: 0x212121 }));
  toldo.position.set(0, 2.15, 1.85);
  toldo.rotation.x = 0.2;
  grupo.add(toldo);

  [-0.9, 0.9].forEach((vx, idx) => {
    const vitrina = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.1), new THREE.MeshLambertMaterial({ color: 0xe1bee7, transparent: true, opacity: 0.8 }));
    vitrina.position.set(vx, 1.1, 1.77);
    grupo.add(vitrina);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.65, 8), new THREE.MeshLambertMaterial({ color: idx === 0 ? 0xff4081 : 0x00e5ff }));
    torso.position.set(vx, 1.1, 1.65);
    grupo.add(torso);

    const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshLambertMaterial({ color: 0xffecb3 }));
    cabeza.position.set(vx, 1.5, 1.65);
    grupo.add(cabeza);
  });

  const puerta = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.8, 0.08), new THREE.MeshLambertMaterial({ color: 0x212121 }));
  puerta.position.set(0, 0.9, 1.77);
  grupo.add(puerta);

  grupo.rotation.y = rot;
  return grupo;
}

function criarRestaurante(rot) {
  const grupo = new THREE.Group();
  const salon = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.5, 2.8), new THREE.MeshLambertMaterial({ color: 0xbf360c }));
  salon.position.set(0, 1.25, -0.3);
  salon.castShadow = true;
  grupo.add(salon);

  const moldura = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 2.9), new THREE.MeshLambertMaterial({ color: 0x3e2723 }));
  moldura.position.set(0, 2.55, -0.3);
  grupo.add(moldura);

  const toldoPatio = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 1.2), new THREE.MeshLambertMaterial({ color: 0xffb300 }));
  toldoPatio.position.set(0, 2.1, 1.1);
  toldoPatio.rotation.x = 0.15;
  grupo.add(toldoPatio);

  const terraza = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.12, 1.3), new THREE.MeshLambertMaterial({ color: 0x8d6e63 }));
  terraza.position.set(0, 0.06, 1.25);
  grupo.add(terraza);

  const mesa = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.45, 12), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  mesa.position.set(-0.8, 0.3, 1.25);
  grupo.add(mesa);

  const paloSombrilla = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), new THREE.MeshLambertMaterial({ color: 0x424242 }));
  paloSombrilla.position.set(-0.8, 0.9, 1.25);
  grupo.add(paloSombrilla);

  const conoSombrilla = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.35, 8), new THREE.MeshLambertMaterial({ color: 0xc62828 }));
  conoSombrilla.position.set(-0.8, 1.55, 1.25);
  grupo.add(conoSombrilla);

  const puerta = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.7, 0.08), new THREE.MeshLambertMaterial({ color: 0x3e2723 }));
  puerta.position.set(0.7, 0.85, 1.12);
  grupo.add(puerta);

  const ventanal = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.08), new THREE.MeshLambertMaterial({ color: 0xffecb3, transparent: true, opacity: 0.8 }));
  ventanal.position.set(-0.5, 1.2, 1.12);
  grupo.add(ventanal);

  grupo.rotation.y = rot;
  return grupo;
}

function criarLojaVeiculos(rot) {
  const grupo = new THREE.Group();
  const tamanho = TAMANHO_CELULA * 2; // 8.0m (Huella 2x2 celdas)

  const podio = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.3, 0.25, tamanho - 0.3), new THREE.MeshLambertMaterial({ color: 0x37474f }));
  podio.position.y = 0.125;
  podio.receiveShadow = true;
  grupo.add(podio);

  const techo = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.2, 0.4, tamanho - 0.2), new THREE.MeshLambertMaterial({ color: 0x212121 }));
  techo.position.y = 3.6;
  techo.castShadow = true;
  grupo.add(techo);

  const neon = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.1, 0.08, tamanho - 0.1), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
  neon.position.y = 3.42;
  grupo.add(neon);

  const matCol = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]].forEach(([cx, cz]) => {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), matCol);
    col.position.set(cx, 1.85, cz);
    col.castShadow = true;
    grupo.add(col);
  });

  const matVidrio = new THREE.MeshLambertMaterial({ color: 0x80deea, transparent: true, opacity: 0.65 });
  const paredFondo = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.2, 0.3), new THREE.MeshLambertMaterial({ color: 0x455a64 }));
  paredFondo.position.set(0, 1.85, -3.6);
  grupo.add(paredFondo);

  const vidrioIzq = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, 7.2), matVidrio);
  vidrioIzq.position.set(-3.6, 1.85, 0);
  grupo.add(vidrioIzq);

  const vidrioDer = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.2, 7.2), matVidrio);
  vidrioDer.position.set(3.6, 1.85, 0);
  grupo.add(vidrioDer);

  const tarima = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.2, 0.25, 24), new THREE.MeshLambertMaterial({ color: 0xe0e0e0 }));
  tarima.position.set(0, 0.35, 0);
  grupo.add(tarima);

  const matAuto = new THREE.MeshLambertMaterial({ color: 0xd50000 });
  const chasis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 2.8), matAuto);
  chasis.position.set(0, 0.7, 0);
  chasis.castShadow = true;
  grupo.add(chasis);

  const cabina = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.4), new THREE.MeshLambertMaterial({ color: 0x212121 }));
  cabina.position.set(0, 1.05, -0.2);
  grupo.add(cabina);

  const parabrisas = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: 0x80deea }));
  parabrisas.position.set(0, 1.0, 0.55);
  parabrisas.rotation.x = -0.3;
  grupo.add(parabrisas);

  const matRueda = new THREE.MeshLambertMaterial({ color: 0x111111 });
  [[-0.85, 0.55, 0.8], [0.85, 0.55, 0.8], [-0.85, 0.55, -0.8], [0.85, 0.55, -0.8]].forEach(([rx, ry, rz]) => {
    const rueda = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.18, 12), matRueda);
    rueda.position.set(rx, ry, rz);
    rueda.rotation.z = Math.PI / 2;
    grupo.add(rueda);
  });

  const mostrador = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.6), new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
  mostrador.position.set(2.2, 0.6, 2.2);
  grupo.add(mostrador);

  grupo.rotation.y = rot;
  return grupo;
}

function criarBanco(rot) {
  const grupo = new THREE.Group();
  const tamanho = TAMANHO_CELULA * 2; // 8.0m (Huella 2x2 celdas)

  const matPodio = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const podio = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.4, 0.55, tamanho - 0.4), matPodio);
  podio.position.y = 0.275;
  podio.receiveShadow = true;
  grupo.add(podio);

  const matEscaleras = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
  [0.35, 0.22, 0.1].forEach((h, idx) => {
    const escalon = new THREE.Mesh(new THREE.BoxGeometry(4.6 + idx * 0.3, 0.12, 0.8 + idx * 0.25), matEscaleras);
    escalon.position.set(0, 0.06 + idx * 0.12, 3.4 - idx * 0.25);
    escalon.receiveShadow = true;
    grupo.add(escalon);
  });

  const matParedes = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4.4, 5.0), matParedes);
  cuerpo.position.set(0, 2.2 + 0.55, -0.6);
  cuerpo.castShadow = true;
  grupo.add(cuerpo);

  const matCol = new THREE.MeshLambertMaterial({ color: 0xffffff });
  [-2.4, -0.8, 0.8, 2.4].forEach(cx => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 4.2, 12), matCol);
    col.position.set(cx, 2.1 + 0.55, 2.2);
    col.castShadow = true;
    grupo.add(col);

    const capitel = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.22, 0.65), matPodio);
    capitel.position.set(cx, 4.2 + 0.55, 2.2);
    grupo.add(capitel);
  });

  const entablamento = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.45, 5.8), matPodio);
  entablamento.position.set(0, 4.5 + 0.55, 0.2);
  grupo.add(entablamento);

  const fronton = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.2, 4), matPodio);
  fronton.position.set(0, 5.3 + 0.55, 2.2);
  fronton.rotation.y = Math.PI / 4;
  fronton.scale.set(1.6, 1.0, 0.4);
  grupo.add(fronton);

  const escudo = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 16), new THREE.MeshLambertMaterial({ color: 0xffd700 }));
  escudo.position.set(0, 5.2 + 0.55, 2.38);
  escudo.rotation.x = Math.PI / 2;
  grupo.add(escudo);

  const matBoveda = new THREE.MeshLambertMaterial({ color: 0xd4af37 });
  const puerta = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.15), matBoveda);
  puerta.position.set(0, 1.3 + 0.55, 1.92);
  grupo.add(puerta);

  const timon = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 16), new THREE.MeshLambertMaterial({ color: 0x424242 }));
  timon.position.set(0, 1.3 + 0.55, 2.02);
  grupo.add(timon);

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
  const tamanho = TAMANHO_CELULA * 3; // 12.0 (Huella 3x3 celdas)

  // 1. Césped base
  const piso = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.2, 0.12, tamanho - 0.2), new THREE.MeshLambertMaterial({ color: 0x2e7d32 }));
  piso.position.y = 0.06;
  piso.receiveShadow = true;
  grupo.add(piso);

  // 2. Caminos peatonales de piedra en cruz
  const matCamino = new THREE.MeshLambertMaterial({ color: 0xd7ccc8 });
  const caminoX = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.4, 0.03, 1.8), matCamino);
  caminoX.position.y = 0.13;
  grupo.add(caminoX);

  const caminoZ = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.03, tamanho - 0.4), matCamino);
  caminoZ.position.y = 0.13;
  grupo.add(caminoZ);

  // Plaza central circular
  const plazaCentral = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.04, 16), matCamino);
  plazaCentral.position.y = 0.135;
  grupo.add(plazaCentral);

  // 3. Fuente ornamental central con agua
  const matBordeFuente = new THREE.MeshLambertMaterial({ color: 0xb0bec5 });
  const baseFuente = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.4, 16), matBordeFuente);
  baseFuente.position.y = 0.35;
  grupo.add(baseFuente);

  const matAgua = new THREE.MeshLambertMaterial({ color: 0x0288d1, transparent: true, opacity: 0.85 });
  const aguaFuente = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.38, 16), matAgua);
  aguaFuente.position.y = 0.38;
  grupo.add(aguaFuente);

  const pilarFuente = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.1, 8), matBordeFuente);
  pilarFuente.position.y = 0.85;
  grupo.add(pilarFuente);

  const platoSuperior = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.5, 0.18, 12), matBordeFuente);
  platoSuperior.position.y = 1.3;
  grupo.add(platoSuperior);

  const chorroAgua = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.7, 8), matAgua);
  chorroAgua.position.y = 1.7;
  grupo.add(chorroAgua);

  // 4. Árboles y vegetación en las 4 esquinas
  const matTronco = new THREE.MeshLambertMaterial({ color: 0x5d4037 });
  const matCopa1 = new THREE.MeshLambertMaterial({ color: 0x388e3c });
  const matCopa2 = new THREE.MeshLambertMaterial({ color: 0x1b5e20 });

  const posicionesArboles = [
    [-3.8, -3.8, 1.2, matCopa1],
    [3.8, -3.8, 1.3, matCopa2],
    [-3.8, 3.8, 1.25, matCopa2],
    [3.8, 3.8, 1.1, matCopa1],
    [-1.6, -3.8, 0.9, matCopa1],
    [1.6, 3.8, 0.95, matCopa2]
  ];

  posicionesArboles.forEach(([ax, az, escala, matCopa]) => {
    const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * escala, 0.22 * escala, 1.7 * escala, 6), matTronco);
    tronco.position.set(ax, 0.85 * escala, az);
    tronco.castShadow = true;
    grupo.add(tronco);

    const copa = new THREE.Mesh(new THREE.SphereGeometry(1.15 * escala, 8, 8), matCopa);
    copa.position.set(ax, 2.2 * escala, az);
    copa.castShadow = true;
    grupo.add(copa);
  });

  // 5. Bancos de parque (madera y soporte)
  const matMadera = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
  [
    [-1.8, 1.6, 0],
    [1.8, -1.6, Math.PI],
    [1.6, 1.8, Math.PI / 2],
    [-1.6, -1.8, -Math.PI / 2]
  ].forEach(([bx, bz, rotY]) => {
    const banco = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.3), matMadera);
    banco.position.set(bx, 0.24, bz);
    banco.rotation.y = rotY;
    grupo.add(banco);
  });

  // 6. Farolas coloniales
  const matFarol = new THREE.MeshLambertMaterial({ color: 0x212121 });
  const matLuz = new THREE.MeshBasicMaterial({ color: 0xfff9c4 });
  [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]].forEach(([lx, lz]) => {
    const poste = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.2, 6), matFarol);
    poste.position.set(lx, 1.1, lz);
    grupo.add(poste);

    const lampara = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), matLuz);
    lampara.position.set(lx, 2.2, lz);
    grupo.add(lampara);
  });

  return grupo;
}

function criarUsina(rot) {
  const grupo = new THREE.Group();
  const tamanho = TAMANHO_CELULA * 2; // 8.0 (Huella 2x2 celdas)

  // 1. Losa de hormigón reforzado
  const base = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.2, 0.18, tamanho - 0.2), new THREE.MeshLambertMaterial({ color: 0x455a64 }));
  base.position.y = 0.09;
  base.receiveShadow = true;
  grupo.add(base);

  // 2. Nave principal de turbinas y generadores
  const matGalpao = new THREE.MeshLambertMaterial({ color: 0x37474f });
  const galpao = new THREE.Mesh(new THREE.BoxGeometry(4.8, 3.0, 3.6), matGalpao);
  galpao.position.set(-1.0, 1.5 + 0.18, 1.2);
  galpao.castShadow = true;
  grupo.add(galpao);

  // Techo industrial a dos aguas
  const matTecho = new THREE.MeshLambertMaterial({ color: 0x263238 });
  const techo = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.2, 4), matTecho);
  techo.position.set(-1.0, 3.6 + 0.18, 1.2);
  techo.rotation.y = Math.PI / 4;
  grupo.add(techo);

  // 3. Dos chimeneas de refrigeración industriales con bandas de seguridad aérea
  const matChamine = new THREE.MeshLambertMaterial({ color: 0xd32f2f });
  const matAnel = new THREE.MeshLambertMaterial({ color: 0xffffff });

  [[-1.8, -2.0], [0.6, -2.0]].forEach(([cx, cz]) => {
    const chamine = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 7.2, 16), matChamine);
    chamine.position.set(cx, 3.6 + 0.18, cz);
    chamine.castShadow = true;
    grupo.add(chamine);

    // Anillo blanco de aviso
    const anel = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.74, 1.1, 16), matAnel);
    anel.position.set(cx, 5.0 + 0.18, cz);
    grupo.add(anel);

    // Boca superior de ventilación
    const boca = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.2, 16), new THREE.MeshLambertMaterial({ color: 0x212121 }));
    boca.position.set(cx, 7.2 + 0.18, cz);
    grupo.add(boca);
  });

  // 4. Subestación transformadora eléctrica
  const matTrafo = new THREE.MeshLambertMaterial({ color: 0x78909c });
  [ [2.4, -0.6], [2.4, 1.3], [2.4, 2.5] ].forEach(([tx, tz]) => {
    const trafo = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.5, 0.8), matTrafo);
    trafo.position.set(tx, 0.75 + 0.18, tz);
    grupo.add(trafo);

    const aislador = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.7, 6), new THREE.MeshLambertMaterial({ color: 0xb0bec5 }));
    aislador.position.set(tx, 1.7 + 0.18, tz);
    grupo.add(aislador);
  });

  // Torre metálica de alta tensión
  const matTorre = new THREE.MeshLambertMaterial({ color: 0x90a4ae });
  const pilarTorre = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 4.8, 4), matTorre);
  pilarTorre.position.set(2.4, 2.4 + 0.18, -2.0);
  grupo.add(pilarTorre);

  const brazoTorre = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.14), matTorre);
  brazoTorre.position.set(2.4, 4.2 + 0.18, -2.0);
  grupo.add(brazoTorre);

  grupo.rotation.y = rot;
  return grupo;
}

function criarMunicipalidad(rot) {
  const grupo = new THREE.Group();
  const tamanho = TAMANHO_CELULA * 3; // 12.0 (Huella 3x3 celdas)

  // 1. Podio / Terraza de mármol cívico
  const matPodio = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const podio = new THREE.Mesh(new THREE.BoxGeometry(tamanho - 0.4, 0.5, tamanho - 0.4), matPodio);
  podio.position.y = 0.25;
  podio.receiveShadow = true;
  grupo.add(podio);

  // Escalinatas ceremoniales de acceso frontal
  const matEscalinata = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
  [0.4, 0.25, 0.12].forEach((h, idx) => {
    const escalon = new THREE.Mesh(new THREE.BoxGeometry(5.2 + idx * 0.4, 0.12, 1.2 + idx * 0.35), matEscalinata);
    escalon.position.set(0, 0.06 + idx * 0.12, 5.1 - idx * 0.35);
    escalon.receiveShadow = true;
    grupo.add(escalon);
  });

  // 2. Cuerpo del edificio principal (Palacio de Gobierno)
  const matParedes = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  const cuerpoPrincipal = new THREE.Mesh(new THREE.BoxGeometry(9.6, 5.0, 6.8), matParedes);
  cuerpoPrincipal.position.set(0, 2.5 + 0.5, -0.6);
  cuerpoPrincipal.castShadow = true;
  grupo.add(cuerpoPrincipal);

  // Cornisas decorativas
  const matCornisa = new THREE.MeshLambertMaterial({ color: 0xd7ccc8 });
  const cornisa1 = new THREE.Mesh(new THREE.BoxGeometry(10.0, 0.3, 7.2), matCornisa);
  cornisa1.position.set(0, 5.1 + 0.5, -0.6);
  grupo.add(cornisa1);

  // 3. Pórtico clásico con 6 columnas jónicas/corintias
  const matColumna = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const posXColumnas = [-3.8, -2.3, -0.8, 0.8, 2.3, 3.8];
  posXColumnas.forEach(cx => {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 4.8, 12), matColumna);
    col.position.set(cx, 2.4 + 0.5, 3.2);
    col.castShadow = true;
    grupo.add(col);

    const capitel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.6), matCornisa);
    capitel.position.set(cx, 4.8 + 0.5, 3.2);
    grupo.add(capitel);
  });

  // Arquitrabe superior del pórtico frontal
  const arquitrabe = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.4, 1.3), matCornisa);
  arquitrabe.position.set(0, 5.1 + 0.5, 3.2);
  grupo.add(arquitrabe);

  // Frontón triangular clásico
  const matFronton = new THREE.MeshLambertMaterial({ color: 0xefebe9 });
  const fronton = new THREE.Mesh(new THREE.ConeGeometry(5.0, 1.6, 4), matFronton);
  fronton.position.set(0, 5.9 + 0.5, 3.2);
  fronton.rotation.y = Math.PI / 4;
  fronton.scale.set(1.0, 1.0, 0.26);
  grupo.add(fronton);

  // Escudo municipal dorado en el frontón
  const matEscudo = new THREE.MeshLambertMaterial({ color: 0xffd700 });
  const escudo = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 12), matEscudo);
  escudo.position.set(0, 5.6 + 0.5, 3.42);
  escudo.rotation.x = Math.PI / 2;
  grupo.add(escudo);

  // 4. Torre central del Reloj Municipal
  const torreReloj = new THREE.Mesh(new THREE.BoxGeometry(2.8, 4.2, 2.8), matParedes);
  torreReloj.position.set(0, 7.3 + 0.5, -0.6);
  torreReloj.castShadow = true;
  grupo.add(torreReloj);

  // Reloj municipal en las 4 caras
  const matReloj = new THREE.MeshBasicMaterial({ color: 0xffffff });
  [
    [0, 8.2 + 0.5, 0.85, 0],
    [0, 8.2 + 0.5, -2.05, Math.PI],
    [-1.45, 8.2 + 0.5, -0.6, -Math.PI / 2],
    [1.45, 8.2 + 0.5, -0.6, Math.PI / 2]
  ].forEach(([rx, ry, rz, rotY]) => {
    const esfera = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.04, 16), matReloj);
    esfera.position.set(rx, ry, rz);
    esfera.rotation.x = Math.PI / 2;
    esfera.rotation.y = rotY;
    grupo.add(esfera);
  });

  // Cúpula neoclásica de bronce / cobre verdoso
  const matCupula = new THREE.MeshLambertMaterial({ color: 0x00796b });
  const cupula = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), matCupula);
  cupula.position.set(0, 9.4 + 0.5, -0.6);
  grupo.add(cupula);

  // Mástil de bandera
  const matAsta = new THREE.MeshLambertMaterial({ color: 0xffd700 });
  const asta = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.0, 6), matAsta);
  asta.position.set(0, 11.2 + 0.5, -0.6);
  grupo.add(asta);

  // Bandera municipal de Katueté
  const matBandera = new THREE.MeshLambertMaterial({ color: 0x2e7d32 });
  const bandera = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.02), matBandera);
  bandera.position.set(0.48, 11.8 + 0.5, -0.6);
  grupo.add(bandera);

  // Puerta de entrada ceremonial
  const matPuerta = new THREE.MeshLambertMaterial({ color: 0x4e342e });
  const puerta = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, 0.2), matPuerta);
  puerta.position.set(0, 1.4 + 0.5, 2.82);
  grupo.add(puerta);

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

function isQualquerEstrada(x, z) {
  if (!celulaValida(x, z)) return false;
  const tipo = estado.grade[z]?.[x]?.tipo;
  return tipo === 'estrada' || tipo === 'estrada_empedrado' || tipo === 'estrada_terra';
}

function isEstrada(x, z) {
  return isQualquerEstrada(x, z);
}

function criarEstradaMesh(gx, gz) {
  const grupo = new THREE.Group();
  const w = TAMANHO_CELULA; // 4.0
  const hw = w / 2;         // 2.0
  const cw = 0.4;           // Ancho del bordillo/acera
  const hcw = cw / 2;       // 0.2
  const midLen = w - cw * 2;// 3.2

  // Detección de calles vecinas ortogonales
  const n = isQualquerEstrada(gx, gz - 1);
  const s = isQualquerEstrada(gx, gz + 1);
  const e = isQualquerEstrada(gx + 1, gz);
  const wst = isQualquerEstrada(gx - 1, gz);

  // 1. Asfalto base
  const geoAsfalto = new THREE.BoxGeometry(w, 0.12, w);
  const matAsfalto = new THREE.MeshLambertMaterial({ color: 0x263238 });
  const asfalto = new THREE.Mesh(geoAsfalto, matAsfalto);
  asfalto.position.y = 0.06;
  asfalto.receiveShadow = true;
  grupo.add(asfalto);

  // 2. Aceras y bordillos adaptativos
  const matCalcada = new THREE.MeshLambertMaterial({ color: 0x90a4ae });

  // 4 Esquinas fijas de bordillo
  const geoCanto = new THREE.BoxGeometry(cw, 0.14, cw);
  const cNW = new THREE.Mesh(geoCanto, matCalcada);
  cNW.position.set(-hw + hcw, 0.07, -hw + hcw);
  grupo.add(cNW);

  const cNE = new THREE.Mesh(geoCanto, matCalcada);
  cNE.position.set(hw - hcw, 0.07, -hw + hcw);
  grupo.add(cNE);

  const cSW = new THREE.Mesh(geoCanto, matCalcada);
  cSW.position.set(-hw + hcw, 0.07, hw - hcw);
  grupo.add(cSW);

  const cSE = new THREE.Mesh(geoCanto, matCalcada);
  cSE.position.set(hw - hcw, 0.07, hw - hcw);
  grupo.add(cSE);

  // Tramos rectos de acera en los laterales donde NO hay calle conectada
  if (!n) {
    const bN = new THREE.Mesh(new THREE.BoxGeometry(midLen, 0.14, cw), matCalcada);
    bN.position.set(0, 0.07, -hw + hcw);
    grupo.add(bN);
  }
  if (!s) {
    const bS = new THREE.Mesh(new THREE.BoxGeometry(midLen, 0.14, cw), matCalcada);
    bS.position.set(0, 0.07, hw - hcw);
    grupo.add(bS);
  }
  if (!wst) {
    const bW = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.14, midLen), matCalcada);
    bW.position.set(-hw + hcw, 0.07, 0);
    grupo.add(bW);
  }
  if (!e) {
    const bE = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.14, midLen), matCalcada);
    bE.position.set(hw - hcw, 0.07, 0);
    grupo.add(bE);
  }

  // 3. Pintura de señalización vial blanca adaptable al sentido
  const matFaixa = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const esp = 0.16;
  const totalConex = (n ? 1 : 0) + (s ? 1 : 0) + (e ? 1 : 0) + (wst ? 1 : 0);

  if (totalConex === 0) {
    // Calle aislada: línea estándar horizontal
    const f = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.01, esp), matFaixa);
    f.position.y = 0.13;
    grupo.add(f);
  } else if ((e || wst) && !n && !s) {
    // Recta horizontal continua
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, 0.01, esp), matFaixa);
    f.position.y = 0.13;
    grupo.add(f);
  } else if ((n || s) && !e && !wst) {
    // Recta vertical continua
    const f = new THREE.Mesh(new THREE.BoxGeometry(esp, 0.01, w), matFaixa);
    f.position.y = 0.13;
    grupo.add(f);
  } else {
    // Cruces, rotondas, curvas (L) o cruces en T: líneas ramificadas al centro
    if (n) {
      const fN = new THREE.Mesh(new THREE.BoxGeometry(esp, 0.01, hw), matFaixa);
      fN.position.set(0, 0.13, -hw / 2);
      grupo.add(fN);
    }
    if (s) {
      const fS = new THREE.Mesh(new THREE.BoxGeometry(esp, 0.01, hw), matFaixa);
      fS.position.set(0, 0.13, hw / 2);
      grupo.add(fS);
    }
    if (wst) {
      const fW = new THREE.Mesh(new THREE.BoxGeometry(hw, 0.01, esp), matFaixa);
      fW.position.set(-hw / 2, 0.13, 0);
      grupo.add(fW);
    }
    if (e) {
      const fE = new THREE.Mesh(new THREE.BoxGeometry(hw, 0.01, esp), matFaixa);
      fE.position.set(hw / 2, 0.13, 0);
      grupo.add(fE);
    }
  }

  const { x, z } = gradeParaMundo(gx, gz);
  grupo.position.set(x, 0, z);
  return grupo;
}

function criarEstradaEmpedradoMesh(gx, gz) {
  const grupo = new THREE.Group();
  const w = TAMANHO_CELULA;
  const hw = w / 2;
  const cw = 0.35;
  const hcw = cw / 2;
  const midLen = w - cw * 2;

  const n = isQualquerEstrada(gx, gz - 1);
  const s = isQualquerEstrada(gx, gz + 1);
  const e = isQualquerEstrada(gx + 1, gz);
  const wst = isQualquerEstrada(gx - 1, gz);

  // Base empedrada (piedra de adoquín)
  const geoPedra = new THREE.BoxGeometry(w, 0.11, w);
  const matPedra = new THREE.MeshLambertMaterial({ color: 0x546e7a });
  const base = new THREE.Mesh(geoPedra, matPedra);
  base.position.y = 0.055;
  base.receiveShadow = true;
  grupo.add(base);

  // Adoquines en relieve
  const matAdoquines = new THREE.MeshLambertMaterial({ color: 0x455a64 });
  for (let ix = -1.2; ix <= 1.2; ix += 1.2) {
    for (let iz = -1.2; iz <= 1.2; iz += 1.2) {
      const bloq = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, 0.95), matAdoquines);
      bloq.position.set(ix, 0.115, iz);
      grupo.add(bloq);
    }
  }

  // Bordillos de piedra rústica
  const matCordao = new THREE.MeshLambertMaterial({ color: 0x78909c });
  const geoCanto = new THREE.BoxGeometry(cw, 0.13, cw);
  [[-hw + hcw, -hw + hcw], [hw - hcw, -hw + hcw], [-hw + hcw, hw - hcw], [hw - hcw, hw - hcw]].forEach(([px, pz]) => {
    const c = new THREE.Mesh(geoCanto, matCordao);
    c.position.set(px, 0.065, pz);
    grupo.add(c);
  });

  if (!n) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(midLen, 0.13, cw), matCordao);
    b.position.set(0, 0.065, -hw + hcw);
    grupo.add(b);
  }
  if (!s) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(midLen, 0.13, cw), matCordao);
    b.position.set(0, 0.065, hw - hcw);
    grupo.add(b);
  }
  if (!wst) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.13, midLen), matCordao);
    b.position.set(-hw + hcw, 0.065, 0);
    grupo.add(b);
  }
  if (!e) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.13, midLen), matCordao);
    b.position.set(hw - hcw, 0.065, 0);
    grupo.add(b);
  }

  const { x, z } = gradeParaMundo(gx, gz);
  grupo.position.set(x, 0, z);
  return grupo;
}

function criarEstradaTerraMesh(gx, gz) {
  const grupo = new THREE.Group();
  const w = TAMANHO_CELULA;
  const hw = w / 2;

  const n = isQualquerEstrada(gx, gz - 1);
  const s = isQualquerEstrada(gx, gz + 1);
  const e = isQualquerEstrada(gx + 1, gz);
  const wst = isQualquerEstrada(gx - 1, gz);

  // Capa base de tierra rojiza / arcilla compactada
  const geoTerra = new THREE.BoxGeometry(w, 0.09, w);
  const matTerra = new THREE.MeshLambertMaterial({ color: 0x8d6e63 });
  const terra = new THREE.Mesh(geoTerra, matTerra);
  terra.position.y = 0.045;
  terra.receiveShadow = true;
  grupo.add(terra);

  // Huellas de rodadura de vehículos (marcas oscuras)
  const matHuella = new THREE.MeshLambertMaterial({ color: 0x6d4c41 });
  if ((e || wst) && !n && !s) {
    [-0.6, 0.6].forEach(oz => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(w, 0.015, 0.35), matHuella);
      h.position.set(0, 0.095, oz);
      grupo.add(h);
    });
  } else if ((n || s) && !e && !wst) {
    [-0.6, 0.6].forEach(ox => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.015, w), matHuella);
      h.position.set(ox, 0.095, 0);
      grupo.add(h);
    });
  } else {
    [[-0.8, -0.8], [0.8, -0.6], [-0.5, 0.7], [0.7, 0.8]].forEach(([ox, oz]) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.012, 0.7), matHuella);
      p.position.set(ox, 0.095, oz);
      grupo.add(p);
    });
  }

  // Pequeñas bermas de vegetación en los costados sin empalme
  const matMato = new THREE.MeshLambertMaterial({ color: 0x33691e });
  if (!n) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.08, 0.3), matMato);
    m.position.set(0, 0.07, -hw + 0.2);
    grupo.add(m);
  }
  if (!s) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.08, 0.3), matMato);
    m.position.set(0, 0.07, hw - 0.2);
    grupo.add(m);
  }
  if (!wst) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, w * 0.9), matMato);
    m.position.set(-hw + 0.2, 0.07, 0);
    grupo.add(m);
  }
  if (!e) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, w * 0.9), matMato);
    m.position.set(hw - 0.2, 0.07, 0);
    grupo.add(m);
  }

  const { x, z } = gradeParaMundo(gx, gz);
  grupo.position.set(x, 0, z);
  return grupo;
}

/* ============================================================
   8. GESTIÓN DEL MAPA Y RENDERIZADO DE CHUNKS
   ============================================================ */
function criarEtiquetaEdificio(tipo, inquilino) {
  let textoPrincipal = '';
  let colorFondo = 'rgba(20, 25, 35, 0.88)';
  let colorBorde = '#90caf9';
  let colorTexto = '#ffffff';
  let alturaY = 4.8;

  const esVivienda = ['casa', 'sobrado', 'predio'].includes(tipo);

  if (esVivienda) {
    if (inquilino) {
      textoPrincipal = `🏠 ${inquilino}`;
      colorFondo = 'rgba(13, 71, 161, 0.92)';
      colorBorde = '#64b5f6';
      colorTexto = '#ffffff';
    } else {
      textoPrincipal = '🏷️ Se Alquila';
      colorFondo = 'rgba(230, 81, 0, 0.94)';
      colorBorde = '#ffb74d';
      colorTexto = '#fffde7';
    }
    alturaY = tipo === 'predio' ? 19.5 : (tipo === 'sobrado' ? 8.4 : 4.8);
  } else {
    switch (tipo) {
      case 'loja':
        textoPrincipal = '🏪 Tienda';
        colorFondo = 'rgba(239, 108, 0, 0.9)';
        colorBorde = '#ffd54f';
        alturaY = 5.2;
        break;
      case 'padaria':
        textoPrincipal = '🥖 Panadería';
        colorFondo = 'rgba(216, 67, 21, 0.92)';
        colorBorde = '#ffab91';
        alturaY = 5.2;
        break;
      case 'mercado':
        textoPrincipal = '🛒 Supermercado';
        colorFondo = 'rgba(46, 125, 50, 0.92)';
        colorBorde = '#a5d6a7';
        alturaY = 5.8;
        break;
      case 'loja_roupa':
        textoPrincipal = '👗 Tienda de Ropa';
        colorFondo = 'rgba(106, 27, 154, 0.92)';
        colorBorde = '#ce93d8';
        alturaY = 5.2;
        break;
      case 'restaurante':
        textoPrincipal = '🍽️ Restaurante';
        colorFondo = 'rgba(191, 54, 12, 0.92)';
        colorBorde = '#ffcc80';
        alturaY = 5.4;
        break;
      case 'loja_veiculos':
        textoPrincipal = '🚗 Concesionaria';
        colorFondo = 'rgba(38, 50, 56, 0.94)';
        colorBorde = '#00e5ff';
        alturaY = 6.8;
        break;
      case 'banco':
        textoPrincipal = '🏦 Banco Central';
        colorFondo = 'rgba(13, 71, 161, 0.94)';
        colorBorde = '#ffd700';
        alturaY = 8.5;
        break;
      case 'posto':
        textoPrincipal = '⛽ Gasolinera';
        colorFondo = 'rgba(198, 40, 40, 0.9)';
        colorBorde = '#ef9a9a';
        alturaY = 4.8;
        break;
      case 'usina':
        textoPrincipal = '⚡ Usina';
        colorFondo = 'rgba(38, 50, 56, 0.92)';
        colorBorde = '#b0bec5';
        alturaY = 9.2;
        break;
      case 'caixaDAgua':
        textoPrincipal = '💧 Depósito';
        colorFondo = 'rgba(0, 131, 143, 0.92)';
        colorBorde = '#80deea';
        alturaY = 12.5;
        break;
      case 'parque':
        textoPrincipal = '🌳 Parque';
        colorFondo = 'rgba(46, 125, 50, 0.9)';
        colorBorde = '#a5d6a7';
        alturaY = 4.8;
        break;
      case 'municipalidad':
        textoPrincipal = '🏛️ Alcaldía';
        colorFondo = 'rgba(21, 67, 96, 0.94)';
        colorBorde = '#ffd700';
        alturaY = 14.5;
        break;
      default:
        return null;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 76;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = colorFondo;
  if (ctx.roundRect) {
    ctx.roundRect(6, 6, 244, 64, 16);
  } else {
    ctx.rect(6, 6, 244, 64);
  }
  ctx.fill();

  ctx.strokeStyle = colorBorde;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = colorTexto;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(textoPrincipal, 128, 38);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(6.2, 1.85, 1);
  sprite.position.set(0, alturaY, 0);
  sprite.name = 'etiqueta_edificio';

  return sprite;
}

function criarMeshParaTipo(tipo, rotRad, gx, gz, inquilino = null, autor = 'Municipio') {
  let mesh = null;
  const dims = obtenerDimensionesObjeto(tipo);
  const { x, z } = gradeParaMundo(gx, gz);
  const centroX = x + ((dims.w - 1) * TAMANHO_CELULA) / 2;
  const centroZ = z + ((dims.h - 1) * TAMANHO_CELULA) / 2;

  switch (tipo) {
    case 'estrada': mesh = criarEstradaMesh(gx, gz); break;
    case 'estrada_empedrado': mesh = criarEstradaEmpedradoMesh(gx, gz); break;
    case 'estrada_terra': mesh = criarEstradaTerraMesh(gx, gz); break;
    case 'casa': mesh = criarCasa(rotRad); break;
    case 'sobrado': mesh = criarSobrado(rotRad); break;
    case 'predio': mesh = criarPredio(rotRad); break;
    case 'loja': mesh = criarLoja(rotRad); break;
    case 'padaria': mesh = criarPadaria(rotRad); break;
    case 'mercado': mesh = criarMercado(rotRad); break;
    case 'loja_roupa': mesh = criarLojaRoupa(rotRad); break;
    case 'restaurante': mesh = criarRestaurante(rotRad); break;
    case 'loja_veiculos': mesh = criarLojaVeiculos(rotRad); break;
    case 'banco': mesh = criarBanco(rotRad); break;
    case 'posto': mesh = criarPosto(rotRad); break;
    case 'parque': mesh = criarParque(); break;
    case 'usina': mesh = criarUsina(rotRad); break;
    case 'caixaDAgua': mesh = criarCaixaDAgua(); break;
    case 'municipalidad': mesh = criarMunicipalidad(rotRad); break;
    default: return null;
  }

  const esCalle = ['estrada', 'estrada_empedrado', 'estrada_terra'].includes(tipo);

  if (!esCalle && mesh) {
    mesh.position.set(centroX, 0, centroZ);
    const etiqueta = criarEtiquetaEdificio(tipo, inquilino);
    if (etiqueta) {
      mesh.add(etiqueta);
    }
  }

  if (mesh) {
    mesh.userData = { tipo, gx, gz, rot: (rotRad * 180) / Math.PI, inquilino, autor, w: dims.w, h: dims.h };
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
      if (item && !item.esHijo) {
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

function actualizarMeshCelda(gx, gz) {
  if (!celulaValida(gx, gz)) return;
  let celda = estado.grade[gz]?.[gx];
  if (!celda) return;

  if (celda.esHijo) {
    gx = celda.rootX;
    gz = celda.rootZ;
    celda = estado.grade[gz]?.[gx];
    if (!celda) return;
  }

  const { cx, cz } = celulaParaChunk(gx, gz);
  const ch = chunkManager.chunksCarregados.get(obtenerIdChunk(cx, cz));
  if (ch) {
    if (celda.mesh && celda.mesh.parent) {
      celda.mesh.parent.remove(celda.mesh);
    }
    const rotRad = ((celda.rot || 0) * Math.PI) / 180;
    const nuevoMesh = criarMeshParaTipo(celda.tipo, rotRad, gx, gz, celda.inquilino, celda.autor);
    if (nuevoMesh) {
      celda.mesh = nuevoMesh;
      ch.grupo.add(nuevoMesh);
    }
  }
}

function verificarEspacioDisponible(gx, gz, w = 1, h = 1) {
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = gx + dx;
      const cz = gz + dz;
      if (!celulaValida(cx, cz)) return false;
      if (estado.grade[cz]?.[cx] !== null) return false;
    }
  }
  return true;
}

function actualizarVecinosEstrada(gx, gz) {
  const deltas = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  deltas.forEach(([dx, dz]) => {
    const nx = gx + dx;
    const nz = gz + dz;
    if (isQualquerEstrada(nx, nz)) {
      actualizarMeshCelda(nx, nz);
    }
  });
}

function instanciarObjetoLocal(tipo, gx, gz, rot = 0, inquilino = null, autor = 'Municipio') {
  if (!celulaValida(gx, gz)) return;
  const dims = obtenerDimensionesObjeto(tipo);
  const w = dims.w;
  const h = dims.h;

  // Si ya existía algún elemento en el área de la huella, retirarlo
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      if (estado.grade[gz + dz]?.[gx + dx]) {
        eliminarObjetoLocal(gx + dx, gz + dz);
      }
    }
  }

  const rotRad = (rot * Math.PI) / 180;

  // 1. Registrar celda raíz (contiene datos completos y referencia al mesh)
  estado.grade[gz][gx] = {
    tipo,
    rot,
    mesh: null,
    inquilino,
    autor,
    w,
    h,
    esRaiz: true
  };

  // 2. Registrar celdas hijas vinculadas a la raíz para bloquear el espacio
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      if (dx === 0 && dz === 0) continue;
      estado.grade[gz + dz][gx + dx] = {
        tipo,
        rootX: gx,
        rootZ: gz,
        esHijo: true
      };
    }
  }

  const { cx, cz } = celulaParaChunk(gx, gz);
  const ch = chunkManager.chunksCarregados.get(obtenerIdChunk(cx, cz));
  if (ch) {
    const mesh = criarMeshParaTipo(tipo, rotRad, gx, gz, inquilino, autor);
    if (mesh) {
      estado.grade[gz][gx].mesh = mesh;
      ch.grupo.add(mesh);
    }
  }

  // Si se coloca cualquier tipo de calle, actualizar automáticamente las conexiones de sus vecinas
  if (isQualquerEstrada(gx, gz)) {
    actualizarVecinosEstrada(gx, gz);
  }
}

function eliminarObjetoLocal(gx, gz) {
  if (!celulaValida(gx, gz)) return;
  let celda = estado.grade[gz]?.[gx];
  if (!celda) return;

  // Si se hizo clic en una celda hija de un edificio multi-celda, redirigir a la celda raíz
  if (celda.esHijo) {
    gx = celda.rootX;
    gz = celda.rootZ;
    celda = estado.grade[gz]?.[gx];
    if (!celda) return;
  }

  const w = celda.w || 1;
  const h = celda.h || 1;
  const eraEstrada = isQualquerEstrada(gx, gz);

  if (celda.mesh && celda.mesh.parent) {
    celda.mesh.parent.remove(celda.mesh);
  }

  // Desocupar todas las celdas cubiertas por la huella del edificio
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      if (celulaValida(gx + dx, gz + dz)) {
        estado.grade[gz + dz][gx + dx] = null;
      }
    }
  }

  if (eraEstrada) {
    actualizarVecinosEstrada(gx, gz);
  }
}

/* ============================================================
   8.1 SISTEMA DE DELIMITACIÓN Y VISUALIZACIÓN DE BARRIOS (ALCALDÍA)
   ============================================================ */
let grupoBairros3D = null;
let colorBarrioSeleccionado = '#2d9e42';

function criarSpriteTextoBarrio(texto, tipo, cor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 76;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(10, 25, 15, 0.92)';
  if (ctx.roundRect) {
    ctx.roundRect(6, 6, 244, 64, 16);
  } else {
    ctx.rect(6, 6, 244, 64);
  }
  ctx.fill();

  ctx.strokeStyle = cor || '#2d9e42';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`📍 ${texto}`, 128, 28);

  ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
  ctx.fillStyle = cor || '#81d4fa';
  ctx.fillText(tipo.toUpperCase(), 128, 52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.95 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6.2, 1.85, 1); // Misma escala compacta que las etiquetas de edificios
  return sprite;
}

function reconstruirVisualBairros3D() {
  if (!cena) return;
  if (grupoBairros3D) {
    cena.remove(grupoBairros3D);
    grupoBairros3D = null;
  }

  grupoBairros3D = new THREE.Group();

  estado.bairros.forEach(b => {
    const minGx = Math.min(b.x1, b.x2);
    const maxGx = Math.max(b.x1, b.x2);
    const minGz = Math.min(b.z1, b.z2);
    const maxGz = Math.max(b.z1, b.z2);

    const p1 = gradeParaMundo(minGx, minGz);
    const p2 = gradeParaMundo(maxGx, maxGz);

    const hw = TAMANHO_CELULA / 2;
    const minX = Math.min(p1.x, p2.x) - hw;
    const maxX = Math.max(p1.x, p2.x) + hw;
    const minZ = Math.min(p1.z, p2.z) - hw;
    const maxZ = Math.max(p1.z, p2.z) + hw;

    const centroX = (minX + maxX) / 2;
    const centroZ = (minZ + maxZ) / 2;

    // 1. Líneas perimetrales en el suelo
    const pts = [
      new THREE.Vector3(minX, 0.08, minZ),
      new THREE.Vector3(maxX, 0.08, minZ),
      new THREE.Vector3(maxX, 0.08, maxZ),
      new THREE.Vector3(minX, 0.08, maxZ),
      new THREE.Vector3(minX, 0.08, minZ)
    ];
    const geoLinha = new THREE.BufferGeometry().setFromPoints(pts);
    const matLinha = new THREE.LineBasicMaterial({ color: new THREE.Color(b.cor || '#2d9e42'), linewidth: 2 });
    const borda = new THREE.Line(geoLinha, matLinha);
    grupoBairros3D.add(borda);

    // 2. Cartel flotante 3D sobre el barrio (pequeño y discreto a altura estándar)
    const cartel = criarSpriteTextoBarrio(b.nome, b.tipo || 'Distrito', b.cor);
    cartel.position.set(centroX, 5.5, centroZ);
    grupoBairros3D.add(cartel);
  });

  cena.add(grupoBairros3D);
  desenharMiniMapa();
}

function actualizarPreviewSeleccionBairro(g1, g2) {
  limparPreviewSeleccionBairro();
  if (!g1 || !g2 || !cena) return;

  const minGx = Math.min(g1.gx, g2.gx);
  const maxGx = Math.max(g1.gx, g2.gx);
  const minGz = Math.min(g1.gz, g2.gz);
  const maxGz = Math.max(g1.gz, g2.gz);

  const p1 = gradeParaMundo(minGx, minGz);
  const p2 = gradeParaMundo(maxGx, maxGz);
  const hw = TAMANHO_CELULA / 2;

  const minX = Math.min(p1.x, p2.x) - hw;
  const maxX = Math.max(p1.x, p2.x) + hw;
  const minZ = Math.min(p1.z, p2.z) - hw;
  const maxZ = Math.max(p1.z, p2.z) + hw;

  const ancho = maxX - minX;
  const prof = maxZ - minZ;
  const centroX = (minX + maxX) / 2;
  const centroZ = (minZ + maxZ) / 2;

  const geo = new THREE.PlaneGeometry(ancho, prof);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfbc02d, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
  estado.meshPreviewSeleccionBairro = new THREE.Mesh(geo, mat);
  estado.meshPreviewSeleccionBairro.rotation.x = -Math.PI / 2;
  estado.meshPreviewSeleccionBairro.position.set(centroX, 0.09, centroZ);
  cena.add(estado.meshPreviewSeleccionBairro);
}

function limparPreviewSeleccionBairro() {
  if (estado.meshPreviewSeleccionBairro && cena) {
    cena.remove(estado.meshPreviewSeleccionBairro);
    estado.meshPreviewSeleccionBairro = null;
  }
}

function obtenerBarrioEn(gx, gz) {
  for (const b of estado.bairros) {
    const minX = Math.min(b.x1, b.x2);
    const maxX = Math.max(b.x1, b.x2);
    const minZ = Math.min(b.z1, b.z2);
    const maxZ = Math.max(b.z1, b.z2);
    if (gx >= minX && gx <= maxX && gz >= minZ && gz <= maxZ) {
      return b;
    }
  }
  return null;
}

let ultimoBarrioId = null;
let timerOcultarBadgeBarrio = null;

function actualizarBadgeBarrioActual(forzar = false) {
  if (!controles) return;
  const { gx, gz } = mundoParaGrade(controles.target.x, controles.target.z);
  const b = obtenerBarrioEn(gx, gz);
  const elTxt = document.getElementById('stat-bairro-nombre');
  const badge = document.getElementById('badge-bairro-contenedor');
  if (!badge) return;

  const nuevoId = b ? b.id : null;

  // Si no se fuerza y el foco de cámara sigue dentro del mismo barrio, no reiniciar el timer
  if (!forzar && nuevoId === ultimoBarrioId) {
    return;
  }

  ultimoBarrioId = nuevoId;
  clearTimeout(timerOcultarBadgeBarrio);

  if (b) {
    if (elTxt) elTxt.textContent = b.nome;
    badge.style.borderColor = b.cor || '#0288d1';
    badge.style.color = b.cor || '#81d4fa';
    badge.style.boxShadow = `0 0 16px ${b.cor ? b.cor + '77' : 'rgba(2, 136, 209, 0.45)'}`;

    // Mostrar el badge con fade in
    badge.classList.remove('oculto');
    badge.classList.add('visible');

    // Desvanecer suavemente después de pocos segundos con fade out
    timerOcultarBadgeBarrio = setTimeout(() => {
      badge.classList.remove('visible');
      badge.classList.add('oculto');
    }, 2000);
  } else {
    // Si sale a zona exterior no asignada a ningún barrio, fade out
    badge.classList.remove('visible');
    badge.classList.add('oculto');
  }
}

function cerrarModalBarrio() {
  const modal = document.getElementById('modal-barrio');
  if (modal) modal.style.display = 'none';
  estado.barrioEditandoId = null;
  estado.seleccionBairroInicio = null;
  limparPreviewSeleccionBairro();
  if (controles) controles.enabled = true;
}

function sincronizarInputsCoordsBarrio(x1, z1, ancho, prof, actualizarInputs = true) {
  x1 = Math.max(0, Math.min(TAMANHO_GRADE - 1, parseInt(x1, 10) || 0));
  z1 = Math.max(0, Math.min(TAMANHO_GRADE - 1, parseInt(z1, 10) || 0));
  ancho = Math.max(1, Math.min(TAMANHO_GRADE - x1, parseInt(ancho, 10) || 1));
  prof = Math.max(1, Math.min(TAMANHO_GRADE - z1, parseInt(prof, 10) || 1));

  const x2 = x1 + ancho - 1;
  const z2 = z1 + prof - 1;

  if (actualizarInputs) {
    const inX1 = document.getElementById('campo-barrio-x1');
    const inZ1 = document.getElementById('campo-barrio-z1');
    const inAncho = document.getElementById('campo-barrio-ancho');
    const inProf = document.getElementById('campo-barrio-prof');
    if (inX1) inX1.value = x1;
    if (inZ1) inZ1.value = z1;
    if (inAncho) inAncho.value = ancho;
    if (inProf) inProf.value = prof;
  }

  const txtResumen = document.getElementById('resumen-total-celdas');
  const infoCoords = document.getElementById('info-coords-barrio');
  const modal = document.getElementById('modal-barrio');

  if (txtResumen) {
    txtResumen.textContent = `Total: ${ancho * prof} celdas (${ancho} × ${prof})`;
  }
  if (infoCoords) {
    infoCoords.textContent = `Sector: (${x1}, ${z1}) a (${x2}, ${z2}) — ${ancho * prof} celdas`;
  }

  if (modal) {
    modal.dataset.minGx = x1;
    modal.dataset.minGz = z1;
    modal.dataset.maxGx = x2;
    modal.dataset.maxGz = z2;
  }

  actualizarPreviewSeleccionBairro({ gx: x1, gz: z1 }, { gx: x2, gz: z2 });
}

function abrirModalEditarBarrio(b) {
  if (!b) return;
  const modal = document.getElementById('modal-barrio');
  const titulo = document.getElementById('titulo-modal-barrio');
  const inputNome = document.getElementById('campo-nombre-barrio');
  const selectTipo = document.getElementById('campo-tipo-barrio');
  const btnEliminar = document.getElementById('btn-eliminar-barrio');

  if (!modal) return;

  estado.barrioEditandoId = b.id;
  if (titulo) titulo.textContent = '✏️ Editar Barrio y Coordenadas';

  const minGx = Math.min(b.x1, b.x2);
  const maxGx = Math.max(b.x1, b.x2);
  const minGz = Math.min(b.z1, b.z2);
  const maxGz = Math.max(b.z1, b.z2);
  const ancho = maxGx - minGx + 1;
  const prof = maxGz - minGz + 1;

  sincronizarInputsCoordsBarrio(minGx, minGz, ancho, prof, true);

  if (inputNome) inputNome.value = b.nome;
  if (selectTipo) selectTipo.value = b.tipo || 'Residencial';
  colorBarrioSeleccionado = b.cor || '#2d9e42';

  document.querySelectorAll('.btn-cor-bairro').forEach(btn => {
    btn.classList.toggle('activa', btn.dataset.cor === colorBarrioSeleccionado);
  });

  if (btnEliminar) btnEliminar.style.display = 'block';

  modal.style.display = 'flex';
  if (controles) controles.enabled = false;
  if (inputNome) {
    inputNome.focus();
    inputNome.select();
  }
}

function abrirModalCrearBarrio(g1, g2) {
  const minGx = Math.min(g1.gx, g2.gx);
  const maxGx = Math.max(g1.gx, g2.gx);
  const minGz = Math.min(g1.gz, g2.gz);
  const maxGz = Math.max(g1.gz, g2.gz);

  const modal = document.getElementById('modal-barrio');
  const titulo = document.getElementById('titulo-modal-barrio');
  const inputNome = document.getElementById('campo-nombre-barrio');
  const selectTipo = document.getElementById('campo-tipo-barrio');
  const btnEliminar = document.getElementById('btn-eliminar-barrio');

  if (!modal) return;

  const anchoCeldas = maxGx - minGx + 1;
  const profCeldas = maxGz - minGz + 1;

  sincronizarInputsCoordsBarrio(minGx, minGz, anchoCeldas, profCeldas, true);

  const barrioExistente = estado.bairros.find(b => 
    (minGx >= Math.min(b.x1, b.x2) && maxGx <= Math.max(b.x1, b.x2) && minGz >= Math.min(b.z1, b.z2) && maxGz <= Math.max(b.z1, b.z2)) ||
    (Math.min(b.x1, b.x2) >= minGx && Math.max(b.x1, b.x2) <= maxGx && Math.min(b.z1, b.z2) >= minGz && Math.max(b.z1, b.z2) <= maxGz)
  );

  if (barrioExistente) {
    estado.barrioEditandoId = barrioExistente.id;
    if (titulo) titulo.textContent = '✏️ Editar Barrio y Coordenadas';
    if (inputNome) inputNome.value = barrioExistente.nome;
    if (selectTipo) selectTipo.value = barrioExistente.tipo || 'Residencial';
    colorBarrioSeleccionado = barrioExistente.cor || '#2d9e42';
    if (btnEliminar) btnEliminar.style.display = 'block';
  } else {
    estado.barrioEditandoId = null;
    if (titulo) titulo.textContent = '🏷️ Delimitar y Nombrar Barrio';
    if (inputNome) inputNome.value = `Barrio ${estado.bairros.length + 1}`;
    if (selectTipo) selectTipo.value = 'Residencial';
    colorBarrioSeleccionado = '#2d9e42';
    if (btnEliminar) btnEliminar.style.display = 'none';
  }

  document.querySelectorAll('.btn-cor-bairro').forEach(b => {
    b.classList.toggle('activa', b.dataset.cor === colorBarrioSeleccionado);
  });

  modal.style.display = 'flex';
  if (controles) controles.enabled = false;
  if (inputNome) {
    inputNome.focus();
    inputNome.select();
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

  if (estado.objetoMoviendo) {
    estado.objetoMoviendo.rot = ((estado.objetoMoviendo.rot || 0) + 90) % 360;
  }

  if (fantasmaObjeto) {
    const rotFinal = estado.objetoMoviendo ? estado.objetoMoviendo.rot : estado.rotacaoAtual;
    fantasmaObjeto.rotation.y = (rotFinal * Math.PI) / 180;
  }
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
      if (pt && !touchArrastrado) {
        const { gx, gz } = mundoParaGrade(pt.x, pt.z);
        if (estado.ferramentaAtiva === 'delimitar_bairro' && estado.seleccionBairroInicio) {
          actualizarPreviewSeleccionBairro(gx, gz);
        } else if (estado.ferramentaAtiva !== 'ponteiro' && estado.ferramentaAtiva !== 'demolir' && estado.ferramentaAtiva !== 'delimitar_bairro') {
          actualizarPreviewFantasma(gx, gz);
        }
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

    if (estado.ferramentaAtiva === 'delimitar_bairro') {
      if (estado.seleccionBairroInicio) {
        actualizarPreviewSeleccionBairro(gx, gz);
      }
      return;
    }

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
      if (pt && ['estrada', 'estrada_empedrado', 'estrada_terra'].includes(estado.ferramentaAtiva)) {
        if (estado.ferramentaAtiva === 'estrada' && !jugadorLocal.esAdmin) {
          mostrarNotificacion('🔒 La Calle Asfaltada es exclusiva del Alcalde.');
        } else {
          estado.arrastandoEstrada = true;
          estado.inicioArrasto = mundoParaGrade(pt.x, pt.z);
        }
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
      const tipoCalle = estado.ferramentaAtiva;
      const costoUnidad = jugadorLocal.esAdmin ? 0 : (COSTOS_CONSTRUCCION[tipoCalle] || 0);

      camino.forEach(c => {
        if (celulaValida(c.gx, c.gz) && estado.grade[c.gz][c.gx] === null) {
          if (jugadorLocal.esAdmin || jugadorLocal.oikos >= costoUnidad) {
            if (!jugadorLocal.esAdmin) jugadorLocal.oikos -= costoUnidad;
            instanciarObjetoLocal(tipoCalle, c.gx, c.gz, 0, null, jugadorLocal.esAdmin ? 'Municipio (Alcalde)' : jugadorLocal.nombre);
            if (socket && socket.connected) {
              socket.emit('solicitar_construccion', { tipo: tipoCalle, gx: c.gx, gz: c.gz, rot: 0 });
            }
          }
        }
      });
      actualizarHUD();
      tocarSonido('construir');
      limparPreviewLinhaEstrada();
      estado.arrastandoEstrada = false;
      estado.inicioArrasto = null;
      desenharMiniMapa();
      guardarCiudadEnStorage(false);
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
      if (estado.objetoMoviendo) {
        cancelarMoverObjeto();
      }
      cerrarModalBarrio();
      seleccionarHerramienta('ponteiro');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!jugadorLocal.esAdmin) {
        mostrarNotificacion('🔒 Opción de demolición exclusiva del Alcalde.');
        return;
      }
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
    if (!jugadorLocal.uid) {
      mostrarNotificacion('🔒 Debes iniciar sesión para construir. Redirigiendo a Login...');
      setTimeout(() => { window.location.href = 'login.html'; }, 1000);
      return;
    }
    const visible = menuConstruccion.style.display === 'block';
    cerrarTodosLosMenus();
    if (!visible) {
      menuConstruccion.style.display = 'block';
      actualizarDockActivo('dock-btn-construir');
    }
  });

  // Dock: Botón Empleo
  document.getElementById('dock-btn-trabajar')?.addEventListener('click', () => {
    if (!jugadorLocal.uid) {
      mostrarNotificacion('🔒 Debes iniciar sesión para trabajar y ganar Oikos. Redirigiendo a Login...');
      setTimeout(() => { window.location.href = 'login.html'; }, 1000);
      return;
    }
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

  // Dock: Botón Demoler (Exclusivo Alcalde)
  document.getElementById('dock-btn-demoler')?.addEventListener('click', () => {
    cerrarTodosLosMenus();
    if (!jugadorLocal.esAdmin) {
      mostrarNotificacion('🔒 Opción de demolición exclusiva del Alcalde.');
      return;
    }
    seleccionarHerramienta('demolir');
    actualizarDockActivo('dock-btn-demoler');
  });

  // Dock: Botón Barrios (Exclusivo Alcalde)
  document.getElementById('dock-btn-bairro')?.addEventListener('click', () => {
    cerrarTodosLosMenus();
    if (!jugadorLocal.esAdmin) {
      mostrarNotificacion('🔒 Herramienta exclusiva del Alcalde.');
      return;
    }
    seleccionarHerramienta('delimitar_bairro');
    actualizarDockActivo('dock-btn-bairro');
    mostrarNotificacion('🏷️ Modo Barrios: Haz clic o toca en dos esquinas del mapa para delimitar la región.');
  });

  // Modal de Barrios: Selección de Color
  document.querySelectorAll('.btn-cor-bairro').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-cor-bairro').forEach(b => b.classList.remove('activa'));
      btn.classList.add('activa');
      colorBarrioSeleccionado = btn.dataset.cor || '#2d9e42';
    });
  });

  // Modal de Barrios: Botones Cerrar y Cancelar
  const modalBarrio = document.getElementById('modal-barrio');
  document.getElementById('btn-cerrar-modal-barrio')?.addEventListener('click', cerrarModalBarrio);
  document.getElementById('btn-cancelar-barrio')?.addEventListener('click', cerrarModalBarrio);

  modalBarrio?.addEventListener('click', (e) => {
    if (e.target === modalBarrio) {
      cerrarModalBarrio();
    }
  });

  // Bloqueo total de interacción con el fondo cuando el modal está abierto
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'touchmove', 'wheel'].forEach(evt => {
    modalBarrio?.addEventListener(evt, e => e.stopPropagation());
  });

  // Modal de Barrios: Guardar / Submit
  document.getElementById('form-barrio')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!jugadorLocal.esAdmin) {
      mostrarNotificacion('🔒 Solo el Alcalde puede renombrar o crear barrios.');
      return;
    }
    const inputNome = document.getElementById('campo-nombre-barrio');
    const selectTipo = document.getElementById('campo-tipo-barrio');
    const nome = inputNome ? inputNome.value.trim() : 'Nuevo Barrio';
    const tipo = selectTipo ? selectTipo.value : 'Residencial';

    const inX1 = document.getElementById('campo-barrio-x1');
    const inZ1 = document.getElementById('campo-barrio-z1');
    const inAncho = document.getElementById('campo-barrio-ancho');
    const inProf = document.getElementById('campo-barrio-prof');

    const minGx = Math.max(0, parseInt(inX1 ? inX1.value : modalBarrio?.dataset.minGx, 10) || 0);
    const minGz = Math.max(0, parseInt(inZ1 ? inZ1.value : modalBarrio?.dataset.minGz, 10) || 0);
    const ancho = Math.max(1, parseInt(inAncho ? inAncho.value : '1', 10) || 1);
    const prof = Math.max(1, parseInt(inProf ? inProf.value : '1', 10) || 1);
    const maxGx = Math.min(TAMANHO_GRADE - 1, minGx + ancho - 1);
    const maxGz = Math.min(TAMANHO_GRADE - 1, minGz + prof - 1);

    if (!nome) {
      mostrarNotificacion('⚠️ Introduce un nombre válido para el barrio.');
      return;
    }

    if (estado.barrioEditandoId) {
      const idx = estado.bairros.findIndex(b => b.id === estado.barrioEditandoId);
      if (idx !== -1) {
        estado.bairros[idx].nome = nome;
        estado.bairros[idx].tipo = tipo;
        estado.bairros[idx].cor = colorBarrioSeleccionado;
        estado.bairros[idx].x1 = minGx;
        estado.bairros[idx].x2 = maxGx;
        estado.bairros[idx].z1 = minGz;
        estado.bairros[idx].z2 = maxGz;
      }
    } else {
      estado.bairros.push({
        id: 'barrio_' + Date.now(),
        nome,
        tipo,
        cor: colorBarrioSeleccionado,
        x1: minGx,
        x2: maxGx,
        z1: minGz,
        z2: maxGz
      });
    }

    try {
      localStorage.setItem('katuete_global_bairros', JSON.stringify(estado.bairros));
    } catch(err) {}

    reconstruirVisualBairros3D();
    desenharMiniMapa();
    actualizarBadgeBarrioActual(true);
    guardarCiudadEnStorage(false);

    cerrarModalBarrio();
    tocarSonido('construir');
    mostrarNotificacion(`🏷️ Barrio "${nome}" (${ancho}×${prof} celdas) guardado exitosamente.`);
  });

  // Escuchar cambios numéricos en vivo para previsualizar el barrio
  ['campo-barrio-x1', 'campo-barrio-z1', 'campo-barrio-ancho', 'campo-barrio-prof'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const x1 = parseInt(document.getElementById('campo-barrio-x1')?.value, 10) || 0;
      const z1 = parseInt(document.getElementById('campo-barrio-z1')?.value, 10) || 0;
      const ancho = parseInt(document.getElementById('campo-barrio-ancho')?.value, 10) || 1;
      const prof = parseInt(document.getElementById('campo-barrio-prof')?.value, 10) || 1;
      sincronizarInputsCoordsBarrio(x1, z1, ancho, prof, false);
    });
  });

  // Modal de Barrios: Eliminar Barrio
  document.getElementById('btn-eliminar-barrio')?.addEventListener('click', () => {
    if (!estado.barrioEditandoId) return;
    const b = estado.bairros.find(bar => bar.id === estado.barrioEditandoId);
    const nom = b ? b.nome : 'el barrio';
    if (!confirm(`¿Confirmas que deseas eliminar ${nom}?`)) return;

    estado.bairros = estado.bairros.filter(bar => bar.id !== estado.barrioEditandoId);
    try {
      localStorage.setItem('katuete_global_bairros', JSON.stringify(estado.bairros));
    } catch(err) {}

    reconstruirVisualBairros3D();
    desenharMiniMapa();
    actualizarBadgeBarrioActual(true);
    guardarCiudadEnStorage(false);

    cerrarModalBarrio();
    tocarSonido('demolir');
    mostrarNotificacion(`🗑️ ${nom} ha sido eliminado del plano.`);
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
    btn.addEventListener('click', (e) => {
      const tipo = btn.dataset.ferramenta;
      if (btn.dataset.alcaldeOnly === 'true' && !jugadorLocal.esAdmin) {
        e.stopPropagation();
        mostrarNotificacion('🔒 Esta construcción está reservada exclusivamente para el Alcalde.');
        tocarSonido('error');
        return;
      }
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
  document.getElementById('btn-guardar-local')?.addEventListener('click', () => guardarCiudadEnStorage(true));

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
    return;
  }

  // Visitantes: Bloquear cualquier acción de construcción / modificación
  if (!jugadorLocal.uid) {
    mostrarNotificacion('🔒 Modo visitante: Debes iniciar sesión para construir o modificar la ciudad.');
    setTimeout(() => { window.location.href = 'login.html'; }, 1200);
    return;
  }

  if (ferr === 'mover') {
    if (!estado.objetoMoviendo) {
      estado.ferramentaAtiva = 'ponteiro';
      return;
    }
    const o = estado.objetoMoviendo;
    if (!verificarEspacioDisponible(gx, gz, o.w, o.h)) {
      mostrarNotificacion(`⚠️ Terreno ocupado o espacio insuficiente para huella de (${o.w}×${o.h}).`);
      tocarSonido('error');
      return;
    }
    instanciarObjetoLocal(o.tipo, gx, gz, o.rot, o.inquilino, o.autor);
    if (socket && socket.connected) {
      socket.emit('solicitar_mover', { origenGx: o.origenGx, origenGz: o.origenGz, destinoGx: gx, destinoGz: gz });
    }
    estado.objetoMoviendo = null;
    estado.ferramentaAtiva = 'ponteiro';
    limparFantasma();
    desenharMiniMapa();
    guardarCiudadEnStorage(false);
    tocarSonido('construir');
    mostrarNotificacion(`✅ Construcción trasladada exitosamente a (${gx}, ${gz}).`);
    mostrarDetallesCelula(gx, gz);
    return;
  }

  if (ferr === 'demolir') {
    if (!jugadorLocal.esAdmin) {
      mostrarNotificacion('🔒 Opción de demolición exclusiva del Alcalde.');
      return;
    }
    eliminarObjetoLocal(gx, gz);
    if (socket && socket.connected) {
      socket.emit('solicitar_demolicion', { gx, gz });
      socket.emit('demoler_objeto', { gx, gz });
    }
    tocarSonido('demolir');
    desenharMiniMapa();
    mostrarNotificacion('💥 Edificio demolido.');
  } else if (ferr === 'delimitar_bairro') {
    if (!jugadorLocal.esAdmin) {
      mostrarNotificacion('🔒 Herramienta exclusiva del Alcalde.');
      return;
    }
    if (!estado.seleccionBairroInicio) {
      // Si hace clic sobre un barrio ya existente, lo abre directamente para editarlo o eliminarlo
      const barrioExistente = obtenerBarrioEn(gx, gz);
      if (barrioExistente) {
        abrirModalEditarBarrio(barrioExistente);
        return;
      }

      estado.seleccionBairroInicio = { gx, gz };
      actualizarPreviewSeleccionBairro(gx, gz);
      tocarSonido('construir');
      mostrarNotificacion(`📍 Punto inicial fijado en (${gx}, ${gz}). Haz clic en la esquina opuesta.`);
    } else {
      const p1 = estado.seleccionBairroInicio;
      const p2 = { gx, gz };
      limparPreviewSeleccionBairro();
      estado.seleccionBairroInicio = null;
      abrirModalCrearBarrio(p1, p2);
    }
  } else {
    // Verificación de construcciones reservadas al Alcalde
    if (CONSTRUCCIONES_EXCLUSIVAS_ALCALDE.includes(ferr) && !jugadorLocal.esAdmin) {
      mostrarNotificacion('🔒 Esta construcción está reservada exclusivamente para el Alcalde.');
      tocarSonido('error');
      return;
    }

    const dims = obtenerDimensionesObjeto(ferr);
    if (!verificarEspacioDisponible(gx, gz, dims.w, dims.h)) {
      mostrarNotificacion(`⚠️ Terreno ocupado o espacio insuficiente para huella de (${dims.w}×${dims.h}).`);
      tocarSonido('error');
      return;
    }

    const costo = jugadorLocal.esAdmin ? 0 : (COSTOS_CONSTRUCCION[ferr] || 0);
    if (!jugadorLocal.esAdmin && jugadorLocal.oikos < costo) {
      mostrarNotificacion(`❌ Saldo insuficiente (${costo} Oikos necesarios).`);
      tocarSonido('error');
      return;
    }

    if (!jugadorLocal.esAdmin) {
      jugadorLocal.oikos -= costo;
    }
    instanciarObjetoLocal(ferr, gx, gz, estado.rotacaoAtual, null, jugadorLocal.esAdmin ? 'Municipio (Alcalde)' : jugadorLocal.nombre);
    if (socket && socket.connected) {
      socket.emit('solicitar_construccion', { tipo: ferr, gx, gz, rot: estado.rotacaoAtual });
      socket.emit('construir_objeto', { tipo: ferr, gx, gz, rot: estado.rotacaoAtual });
    }
    actualizarHUD();
    tocarSonido('construir');
    desenharMiniMapa();
    guardarCiudadEnStorage(false);
    mostrarNotificacion(`🔨 ${ferr.toUpperCase()} construido con éxito.`);
  }
}

/* ============================================================
   10. TRABAJO Y ALQUILER LOCAL
   ============================================================ */
function iniciarTurnoTrabajoLocal() {
  if (!jugadorLocal.uid) {
    mostrarNotificacion('🔒 Debes iniciar sesión para trabajar. Redirigiendo a Login...');
    setTimeout(() => { window.location.href = 'login.html'; }, 1000);
    return;
  }

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
  let celda = estado.grade[gz]?.[gx];
  if (celda && celda.esHijo) celda = estado.grade[celda.rootZ]?.[celda.rootX];
  if (!celda || !['casa', 'sobrado', 'predio'].includes(celda.tipo)) return;

  if (celda.autor === jugadorLocal.nombre && !jugadorLocal.esAdmin) {
    mostrarNotificacion('ℹ️ Esta propiedad ya te pertenece. Puedes configurarla en alquiler para que otros ciudadanos te paguen.');
    return;
  }

  if (celda.inquilino !== null) {
    mostrarNotificacion(`⚠️ Esta vivienda ya se encuentra alquilada por ${celda.inquilino}.`);
    return;
  }

  const costo = celda.precioAlquiler || 150;
  const duracion = celda.duracionAlquilerSegundos || 180;
  const duracionMin = Math.round(duracion / 60);

  if (jugadorLocal.oikos < costo) {
    mostrarNotificacion(`❌ Saldo insuficiente (${costo.toLocaleString('es-PY')} Oikos requeridos).`);
    tocarSonido('error');
    return;
  }

  // Descontar cobro al inquilino
  jugadorLocal.oikos -= costo;
  celda.inquilino = jugadorLocal.nombre;
  const tiempoFin = Date.now() + (duracion * 1000);
  celda.alquilerExpira = tiempoFin;
  jugadorLocal.casasAlquiladas.push({ gx, gz, expira: tiempoFin });

  if (socket && socket.connected) {
    socket.emit('alquilar_vivienda', { gx, gz, precio: costo, duracionSegundos: duracion });
  }

  actualizarMeshCelda(gx, gz);
  actualizarHUD();
  mostrarDetallesCelula(gx, gz);
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`🔑 ¡Has alquilado la vivienda en (${gx}, ${gz}) por ${duracionMin} min! (${costo} Ø pagados a ${celda.autor || 'Municipio'})`);
}

function configurarAlquilerLocal(gx, gz, precio, duracionSegundos) {
  let celda = estado.grade[gz]?.[gx];
  if (celda && celda.esHijo) celda = estado.grade[celda.rootZ]?.[celda.rootX];
  if (!celda) return;

  const esDueno = (celda.autor === jugadorLocal.nombre) || jugadorLocal.esAdmin;
  if (!esDueno) {
    mostrarNotificacion('🔒 Solo el propietario que construyó la vivienda puede configurar su alquiler.');
    return;
  }

  celda.precioAlquiler = Math.max(10, Math.floor(precio));
  celda.duracionAlquilerSegundos = Math.max(30, Math.floor(duracionSegundos));

  if (socket && socket.connected) {
    socket.emit('configurar_alquiler', {
      gx, gz,
      precio: celda.precioAlquiler,
      duracionSegundos: celda.duracionAlquilerSegundos
    });
  }

  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`🏷️ Oferta de alquiler guardada: ${celda.precioAlquiler} Ø por ${Math.round(celda.duracionAlquilerSegundos/60)} minutos.`);
  mostrarDetallesCelula(gx, gz);
}

function desalojarCasaLocal(gx, gz) {
  let celda = estado.grade[gz]?.[gx];
  if (celda && celda.esHijo) celda = estado.grade[celda.rootZ]?.[celda.rootX];
  if (!celda) return;

  const esInquilino = celda.inquilino === jugadorLocal.nombre;
  const esDueno = (celda.autor === jugadorLocal.nombre) || jugadorLocal.esAdmin;

  if (!esInquilino && !esDueno) {
    mostrarNotificacion('🔒 No tienes autorización para desalojar esta vivienda.');
    return;
  }

  celda.inquilino = null;
  celda.alquilerExpira = null;
  jugadorLocal.casasAlquiladas = jugadorLocal.casasAlquiladas.filter(c => !(c.gx === gx && c.gz === gz));

  if (socket && socket.connected) {
    socket.emit('desalojar_vivienda', { gx, gz });
  }

  actualizarMeshCelda(gx, gz);
  mostrarDetallesCelula(gx, gz);
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion('🚪 Vivienda desocupada y disponible para nuevos inquilinos.');
}

function iniciarCicloAlquilerLocal() {
  // Comprobación de vencimiento de contratos temporales cada 2 segundos
  setInterval(() => {
    const ahora = Date.now();
    for (let z = 0; z < TAMANHO_GRADE; z++) {
      for (let x = 0; x < TAMANHO_GRADE; x++) {
        const c = estado.grade[z]?.[x];
        if (c && c.inquilino && c.alquilerExpira && ahora >= c.alquilerExpira) {
          const eraInquilino = c.inquilino === jugadorLocal.nombre;
          const eraDueno = c.autor === jugadorLocal.nombre;
          c.inquilino = null;
          c.alquilerExpira = null;
          actualizarMeshCelda(x, z);

          if (eraInquilino) {
            jugadorLocal.casasAlquiladas = jugadorLocal.casasAlquiladas.filter(k => !(k.gx === x && k.gz === z));
            mostrarNotificacion(`⌛ Tu contrato de alquiler en (${x}, ${z}) ha finalizado.`);
            tocarSonido('error');
          }
          if (eraDueno) {
            mostrarNotificacion(`🔔 El alquiler de tu vivienda en (${x}, ${z}) ha terminado y vuelve a estar libre.`);
            tocarSonido('monedas');
          }
          if (estado.celulaSelecionada && estado.celulaSelecionada.gx === x && estado.celulaSelecionada.gz === z) {
            mostrarDetallesCelula(x, z);
          }
        }
      }
    }
  }, 2000);
}

/* ============================================================
   11. PERSISTENCIA VINCULADA AL USUARIO Y AL DISPOSITIVO LOCAL
   ============================================================ */
function guardarCiudadEnStorage(notificar = true) {
  // Asegurar que exista un identificador local si el usuario no ha iniciado sesión con Firebase
  if (!jugadorLocal.uid) {
    let localUid = localStorage.getItem('katuete_local_id');
    if (!localUid) {
      localUid = 'local_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('katuete_local_id', localUid);
    }
    jugadorLocal.uid = localUid;
  }

  const guardado = {
    uid: jugadorLocal.uid,
    nombre: jugadorLocal.nombre,
    oikos: jugadorLocal.oikos,
    saldoBanco: jugadorLocal.saldoBanco || 0,
    deudaPrestamo: jugadorLocal.deudaPrestamo || 0,
    inventario: jugadorLocal.inventario || [],
    garagem: jugadorLocal.garagem || [],
    empleoEspecializado: jugadorLocal.empleoEspecializado || null,
    casasAlquiladas: jugadorLocal.casasAlquiladas || [],
    bairros: estado.bairros || [],
    mapa: []
  };

  for (let z = 0; z < TAMANHO_GRADE; z++) {
    for (let x = 0; x < TAMANHO_GRADE; x++) {
      const c = estado.grade[z]?.[x];
      if (c && !c.esHijo) {
        guardado.mapa.push({ x, z, tipo: c.tipo, rot: c.rot || 0, inquilino: c.inquilino, autor: c.autor });
      }
    }
  }

  const serializado = JSON.stringify(guardado);

  try {
    // 1. Clave de usuario específica
    localStorage.setItem(`katuete_save_${jugadorLocal.uid}`, serializado);
    // 2. Clave maestra global (garantiza que al recargar en GitHub Pages la ciudad persista siempre)
    localStorage.setItem('katuete_ciudad_guardada_master', serializado);
    // 3. Persistir sesión actual
    localStorage.setItem('katuete_session', JSON.stringify({
      uid: jugadorLocal.uid,
      nombre: jugadorLocal.nombre,
      email: jugadorLocal.email,
      esAdmin: jugadorLocal.esAdmin,
      oikos: jugadorLocal.oikos
    }));
    // 4. Persistir barrios
    if (estado.bairros && estado.bairros.length > 0) {
      localStorage.setItem('katuete_global_bairros', JSON.stringify(estado.bairros));
    }
  } catch (err) {
    console.error('Error al guardar en localStorage:', err);
  }

  if (notificar) {
    tocarSonido('monedas');
    mostrarNotificacion('💾 ¡Progreso de la ciudad guardado con éxito!');
  }
}

function recuperarCiudadGuardada() {
  let data = null;
  // Intentar cargar por clave de usuario
  if (jugadorLocal.uid) {
    data = localStorage.getItem(`katuete_save_${jugadorLocal.uid}`);
  }
  // Si no está o no hay sesión de usuario, usar la clave maestra persistente
  if (!data) {
    data = localStorage.getItem('katuete_ciudad_guardada_master');
  }
  if (!data) return false;

  try {
    const parse = JSON.parse(data);
    if (!parse || !parse.mapa || !Array.isArray(parse.mapa) || parse.mapa.length === 0) {
      return false;
    }

    if (parse.uid && !jugadorLocal.uid) {
      jugadorLocal.uid = parse.uid;
    }
    if (parse.nombre && (!jugadorLocal.nombre || jugadorLocal.nombre === 'Visitante')) {
      jugadorLocal.nombre = parse.nombre;
    }

    jugadorLocal.oikos = parse.oikos ?? 1000;
    jugadorLocal.saldoBanco = parse.saldoBanco || 0;
    jugadorLocal.deudaPrestamo = parse.deudaPrestamo || 0;
    jugadorLocal.inventario = Array.isArray(parse.inventario) ? parse.inventario : [];
    jugadorLocal.garagem = Array.isArray(parse.garagem) ? parse.garagem : [];
    jugadorLocal.empleoEspecializado = parse.empleoEspecializado || null;
    jugadorLocal.casasAlquiladas = parse.casasAlquiladas || [];

    if (parse.bairros && Array.isArray(parse.bairros) && parse.bairros.length > 0) {
      estado.bairros = parse.bairros;
    }

    // Limpiar grilla para restaurar los objetos guardados
    for (let z = 0; z < TAMANHO_GRADE; z++) {
      for (let x = 0; x < TAMANHO_GRADE; x++) {
        estado.grade[z][x] = null;
      }
    }

    parse.mapa.forEach(item => {
      instanciarObjetoLocal(item.tipo, item.x, item.z, item.rot || 0, item.inquilino, item.autor);
    });

    actualizarHUD();
    return true;
  } catch (e) {
    console.error('Error al recuperar ciudad guardada:', e);
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

function mejorarCalleLocal(gx, gz, nuevoTipo, costo) {
  if (!jugadorLocal.uid) {
    mostrarNotificacion('🔒 Debes iniciar sesión para mejorar calles.');
    return;
  }
  const celda = estado.grade[gz]?.[gx];
  if (!celda) return;

  if (!jugadorLocal.esAdmin && jugadorLocal.oikos < costo) {
    mostrarNotificacion(`❌ Saldo insuficiente (${costo} Oikos necesarios).`);
    tocarSonido('error');
    return;
  }

  if (!jugadorLocal.esAdmin) {
    jugadorLocal.oikos -= costo;
    actualizarHUD();
  }

  celda.tipo = nuevoTipo;
  actualizarMeshCelda(gx, gz);
  actualizarVecinosEstrada(gx, gz);
  desenharMiniMapa();
  tocarSonido('construir');
  guardarCiudadEnStorage(false);

  if (socket && socket.connected) {
    socket.emit('solicitar_mejora_calle', { gx, gz, nuevoTipo, costo });
  }

  const nombreTipo = nuevoTipo === 'estrada_empedrado' ? 'Calle Empedrada' : 'Calle Asfaltada';
  mostrarNotificacion(`✨ ¡Vía mejorada con éxito a ${nombreTipo}!`);
  mostrarDetallesCelula(gx, gz);
}

function iniciarMoverObjeto(gx, gz) {
  if (!jugadorLocal.esAdmin) {
    mostrarNotificacion('🔒 Solo el Alcalde puede mover construcciones.');
    return;
  }
  let celda = estado.grade[gz]?.[gx];
  if (!celda) return;

  if (celda.esHijo) {
    gx = celda.rootX;
    gz = celda.rootZ;
    celda = estado.grade[gz]?.[gx];
    if (!celda) return;
  }

  const dims = obtenerDimensionesObjeto(celda.tipo);
  estado.objetoMoviendo = {
    tipo: celda.tipo,
    rot: celda.rot || 0,
    inquilino: celda.inquilino,
    autor: celda.autor,
    w: dims.w,
    h: dims.h,
    origenGx: gx,
    origenGz: gz
  };

  // Retirar temporalmente de la grilla
  eliminarObjetoLocal(gx, gz);

  // Cerrar tarjeta de inspección y activar modo mover
  const card = document.getElementById('card-inspeccion');
  if (card) card.style.display = 'none';

  estado.ferramentaAtiva = 'mover';
  actualizarPreviewFantasma(gx, gz);
  tocarSonido('monedas');
  mostrarNotificacion(`🔄 Modo Mover: Haz clic en el nuevo terreno libre para reubicar la construcción (ESC para cancelar).`);
}

function cancelarMoverObjeto() {
  if (!estado.objetoMoviendo) return;
  const o = estado.objetoMoviendo;
  instanciarObjetoLocal(o.tipo, o.origenGx, o.origenGz, o.rot, o.inquilino, o.autor);
  estado.objetoMoviendo = null;
  estado.ferramentaAtiva = 'ponteiro';
  limparFantasma();
  desenharMiniMapa();
  mostrarNotificacion('❌ Movimiento cancelado. Construcción restaurada a su lugar original.');
}

function mostrarDetallesCelula(gx, gz) {
  let celda = estado.grade[gz]?.[gx];
  const card = document.getElementById('card-inspeccion');
  const titulo = document.getElementById('card-titulo-edificio');
  const detalles = document.getElementById('card-detalles-edificio');
  const zonaAcciones = document.getElementById('zona-acciones-inmueble');
  const btnAlquilar = document.getElementById('btn-alquilar-casa');
  const btnDesalojar = document.getElementById('btn-desalojar-casa');
  const btnUpgrade = document.getElementById('btn-upgrade-calle');
  const btnMover = document.getElementById('btn-mover-edificio');
  const btnGirar = document.getElementById('btn-girar-edificio');
  const btnComercio = document.getElementById('btn-entrar-comercio');
  const btnBanco = document.getElementById('btn-entrar-banco');

  if (!card) return;

  zonaAcciones.style.display = 'none';
  btnAlquilar.style.display = 'none';
  btnDesalojar.style.display = 'none';
  if (btnUpgrade) btnUpgrade.style.display = 'none';
  if (btnMover) btnMover.style.display = 'none';
  if (btnGirar) btnGirar.style.display = 'none';
  if (btnComercio) btnComercio.style.display = 'none';
  if (btnBanco) btnBanco.style.display = 'none';

  const barrio = obtenerBarrioEn(gx, gz);
  const infoBarrio = barrio 
    ? `<span style="color:${barrio.cor || '#81d4fa'}">📍 Barrio: <strong>${barrio.nome}</strong> (${barrio.tipo || 'Zona'})</span>${jugadorLocal.esAdmin ? ` <button type="button" class="btn-editar-barrio-inline" style="background:rgba(255,255,255,0.08); border:1px solid ${barrio.cor || '#81d4fa'}; color:${barrio.cor || '#81d4fa'}; border-radius:12px; font-size:10px; padding:2px 7px; cursor:pointer; margin-left:5px;">✏️ Editar</button>` : ''}<br/>`
    : `<span style="color:var(--cor-texto-dim)">📍 Sector sin barrio asignado</span><br/>`;

  if (!celda) {
    titulo.textContent = '🌿 Terreno Libre';
    detalles.innerHTML = `Sector: (${gx}, ${gz})<br/>${infoBarrio}<small>Selecciona 'Construir' en el menú inferior para edificar.</small>`;
    card.style.display = 'block';
    const btnEdit = card.querySelector('.btn-editar-barrio-inline');
    if (btnEdit && barrio) {
      btnEdit.onclick = (e) => {
        e.stopPropagation();
        card.style.display = 'none';
        abrirModalEditarBarrio(barrio);
      };
    }
    return;
  }

  // Si es celda hija de un edificio multi-celda, redirigir a la celda raíz
  if (celda.esHijo) {
    gx = celda.rootX;
    gz = celda.rootZ;
    celda = estado.grade[gz]?.[gx];
    if (!celda) return;
  }

  const esVivienda = ['casa', 'sobrado', 'predio'].includes(celda.tipo);
  const esCalle = isQualquerEstrada(gx, gz);
  const precioAlquiler = celda.precioAlquiler || 150;
  const duracionSegundos = celda.duracionAlquilerSegundos || 180;
  const duracionMin = Math.round(duracionSegundos / 60);

  let textoAlquiler = '';
  if (celda.inquilino) {
    let tiempoRestanteStr = '';
    if (celda.alquilerExpira) {
      const segRest = Math.max(0, Math.floor((celda.alquilerExpira - Date.now()) / 1000));
      const m = Math.floor(segRest / 60);
      const s = segRest % 60;
      tiempoRestanteStr = ` (⏱️ Expira en: <strong id="timer-alquiler-dinamico">${m}m ${s < 10 ? '0' : ''}${s}s</strong>)`;
    }
    textoAlquiler = `<span style="color:#ffb74d">Inquilino: <strong>${celda.inquilino}</strong>${tiempoRestanteStr}</span>`;
  } else {
    textoAlquiler = `<span style="color:#81c784">Disponible para Alquiler (${precioAlquiler} Ø por ${duracionMin} min)</span>`;
  }

  let nombreTipo = celda.tipo.toUpperCase();
  if (celda.tipo === 'casa') nombreTipo = '🏠 Casa Familiar';
  else if (celda.tipo === 'sobrado') nombreTipo = '🏡 Sobrado Duplex';
  else if (celda.tipo === 'predio') nombreTipo = '🏢 Edificio Departamental';
  else if (celda.tipo === 'loja') nombreTipo = '🏪 Tienda General';
  else if (celda.tipo === 'padaria') nombreTipo = '🥖 Panadería Artesanal';
  else if (celda.tipo === 'mercado') nombreTipo = '🛒 Supermercado Municipal';
  else if (celda.tipo === 'loja_roupa') nombreTipo = '👗 Boutique de Modas';
  else if (celda.tipo === 'restaurante') nombreTipo = '🍽️ Restaurante Gourmet';
  else if (celda.tipo === 'loja_veiculos') nombreTipo = '🚗 Concesionaria Katueté (2x2)';
  else if (celda.tipo === 'banco') nombreTipo = '🏦 Banco Central de Katueté (2x2)';
  else if (celda.tipo === 'posto') nombreTipo = '⛽ Estación de Servicios';
  else if (celda.tipo === 'parque') nombreTipo = '🌳 Parque Ecológico (3x3)';
  else if (celda.tipo === 'usina') nombreTipo = '⚡ Usina Eléctrica (2x2)';
  else if (celda.tipo === 'caixaDAgua') nombreTipo = '💧 Tanque de Agua';
  else if (celda.tipo === 'municipalidad') nombreTipo = '🏛️ Palacio Municipal (3x3)';
  else if (celda.tipo === 'estrada_terra') nombreTipo = '🚜 Calle de Tierra';
  else if (celda.tipo === 'estrada_empedrado') nombreTipo = '🧱 Calle Empedrada';
  else if (celda.tipo === 'estrada') nombreTipo = '🛣️ Calle Asfaltada';

  titulo.textContent = nombreTipo;

  detalles.innerHTML = `
    Ubicación: Sector (${gx}, ${gz})${celda.w ? ` [${celda.w}×${celda.h} celdas]` : ''}<br/>
    ${infoBarrio}
    Propietario / Constructor: <strong>${celda.autor || 'Municipio'}</strong><br/>
    ${esVivienda ? `Estado: ${textoAlquiler}<br/><small>Renta fijada: ${precioAlquiler} Oikos / período de ${duracionMin} min</small>` : ''}
    ${celda.tipo === 'estrada_terra' ? `<span style="color:#bcaaa4">Vía rústica de tierra. Puedes mejorarla a empedrado.</span>` : ''}
    ${celda.tipo === 'estrada_empedrado' ? `<span style="color:#90a4ae">Vía empedrada colonial. Puedes mejorarla a asfalto.</span>` : ''}
    ${celda.tipo === 'estrada' ? `<span style="color:#81c784">Vía asfaltada principal de alta velocidad.</span>` : ''}
  `;

  card.style.display = 'block';

  const btnEdit = card.querySelector('.btn-editar-barrio-inline');
  if (btnEdit && barrio) {
    btnEdit.onclick = (e) => {
      e.stopPropagation();
      card.style.display = 'none';
      abrirModalEditarBarrio(barrio);
    };
  }

  // Panel y botones de Alquiler Temporal
  const panelConfigAlquiler = document.getElementById('panel-config-alquiler');
  const btnDesalojarDueno = document.getElementById('btn-desalojar-dueno');
  const inputPrecio = document.getElementById('input-precio-alquiler');
  const selectDuracion = document.getElementById('select-duracion-alquiler');
  const btnGuardarConfig = document.getElementById('btn-guardar-config-alquiler');

  if (panelConfigAlquiler) panelConfigAlquiler.style.display = 'none';
  if (btnDesalojarDueno) btnDesalojarDueno.style.display = 'none';

  if (esVivienda) {
    zonaAcciones.style.display = 'block';
    const esPropietario = (celda.autor === jugadorLocal.nombre) || (celda.autor === 'Municipio' && jugadorLocal.esAdmin);
    const esInquilinoActual = celda.inquilino === jugadorLocal.nombre;

    if (esPropietario) {
      if (panelConfigAlquiler) {
        panelConfigAlquiler.style.display = 'block';
        if (inputPrecio) inputPrecio.value = celda.precioAlquiler || 150;
        if (selectDuracion) selectDuracion.value = celda.duracionAlquilerSegundos || 180;
        if (btnGuardarConfig) {
          btnGuardarConfig.onclick = () => {
            const p = Math.max(10, parseInt(inputPrecio.value) || 150);
            const d = parseInt(selectDuracion.value) || 180;
            configurarAlquilerLocal(gx, gz, p, d);
          };
        }
      }
      if (celda.inquilino && btnDesalojarDueno) {
        btnDesalojarDueno.style.display = 'block';
        btnDesalojarDueno.textContent = `🚪 Desalojar a ${celda.inquilino}`;
        btnDesalojarDueno.onclick = () => desalojarCasaLocal(gx, gz);
      }
    } else {
      if (!celda.inquilino) {
        btnAlquilar.style.display = 'block';
        btnAlquilar.textContent = `🔑 Alquilar Vivienda (${precioAlquiler} Ø por ${duracionMin} min)`;
        btnAlquilar.onclick = () => alquilarCasaLocal(gx, gz);
      } else if (esInquilinoActual) {
        btnDesalojar.style.display = 'block';
        btnDesalojar.textContent = '🚪 Entregar Llaves (Desocupar)';
        btnDesalojar.onclick = () => desalojarCasaLocal(gx, gz);
      }
    }
  }

  // Acciones de Mejora Vial con Dinero
  if (esCalle) {
    if (celda.tipo === 'estrada_terra') {
      zonaAcciones.style.display = 'block';
      if (btnUpgrade) {
        btnUpgrade.textContent = '⬆️ Mejorar a Empedrado (80 Ø)';
        btnUpgrade.style.display = 'block';
        btnUpgrade.onclick = () => mejorarCalleLocal(gx, gz, 'estrada_empedrado', 80);
      }
    } else if (celda.tipo === 'estrada_empedrado') {
      zonaAcciones.style.display = 'block';
      if (btnUpgrade) {
        btnUpgrade.textContent = '⬆️ Mejorar a Asfalto (150 Ø)';
        btnUpgrade.style.display = 'block';
        btnUpgrade.onclick = () => mejorarCalleLocal(gx, gz, 'estrada', 150);
      }
    }
  }

  // Acciones de Comercio y Tiendas
  if (['loja', 'padaria', 'mercado', 'loja_roupa', 'restaurante', 'posto', 'loja_veiculos'].includes(celda.tipo)) {
    zonaAcciones.style.display = 'block';
    if (btnComercio) {
      btnComercio.style.display = 'block';
      btnComercio.onclick = () => abrirModalComercio(celda.tipo);
    }
  }

  // Acciones de Banco Central
  if (celda.tipo === 'banco') {
    zonaAcciones.style.display = 'block';
    if (btnBanco) {
      btnBanco.style.display = 'block';
      btnBanco.onclick = () => abrirModalBanco();
    }
  }

  // Acción: Girar Construcción existente (EXCLUSIVO DEL PROPIETARIO QUE LA CONSTRUYÓ)
  const esPropioGiro = (celda.autor === jugadorLocal.nombre) || jugadorLocal.esAdmin;
  if (!esCalle && btnGirar) {
    if (esPropioGiro) {
      zonaAcciones.style.display = 'block';
      btnGirar.style.display = 'block';
      btnGirar.onclick = () => girarEdificioSeleccionado(gx, gz);
    } else {
      btnGirar.style.display = 'none';
    }
  }

  // Acción Exclusiva del Alcalde: Mover Construcción de Lugar
  if (jugadorLocal.esAdmin && !esCalle && btnMover) {
    zonaAcciones.style.display = 'block';
    btnMover.style.display = 'block';
    btnMover.onclick = () => iniciarMoverObjeto(gx, gz);
  }
}

function girarEdificioSeleccionado(gx, gz) {
  let celda = estado.grade[gz]?.[gx];
  if (!celda) return;
  if (celda.esHijo) {
    gx = celda.rootX;
    gz = celda.rootZ;
    celda = estado.grade[gz]?.[gx];
    if (!celda) return;
  }
  if (isQualquerEstrada(gx, gz)) {
    mostrarNotificacion('ℹ️ Las calles se adaptan automáticamente a las conexiones de la red.');
    return;
  }

  const esPropietario = (celda.autor === jugadorLocal.nombre) || jugadorLocal.esAdmin;
  if (!esPropietario) {
    mostrarNotificacion('🔒 Solo puedes girar las propiedades que tú mismo construiste.');
    tocarSonido('error');
    return;
  }

  celda.rot = ((celda.rot || 0) + 90) % 360;
  actualizarMeshCelda(gx, gz);
  desenharMiniMapa();
  guardarCiudadEnStorage(false);
  tocarSonido('construir');
  mostrarNotificacion(`🔄 Construcción orientada a ${celda.rot}°.`);
  mostrarDetallesCelula(gx, gz);

  if (socket && socket.connected) {
    socket.emit('solicitar_rotar', { gx, gz, rot: celda.rot });
  }
}

function seleccionarHerramienta(nome) {
  if (nome === 'demolir' && !jugadorLocal.esAdmin) {
    mostrarNotificacion('🔒 Opción de demolición exclusiva del Alcalde.');
    return;
  }

  if (estado.objetoMoviendo && nome !== 'mover') {
    cancelarMoverObjeto();
  }

  if (estado.ferramentaAtiva === 'delimitar_bairro' && nome !== 'delimitar_bairro') {
    estado.seleccionBairroInicio = null;
    limparPreviewSeleccionBairro();
  }

  estado.ferramentaAtiva = nome;
  limparFantasma();
  limparPreviewLinhaEstrada();

  document.querySelectorAll('.btn-ferramenta').forEach(btn => {
    btn.classList.toggle('ativo', btn.dataset.ferramenta === nome);
  });

  const indRot = document.getElementById('indicador-rotacao');
  const btnRotarTouch = document.getElementById('btn-rotar-touch');
  const precisaRot = [
    'casa', 'sobrado', 'predio', 'loja', 'padaria', 'mercado',
    'loja_roupa', 'restaurante', 'loja_veiculos', 'banco',
    'posto', 'usina', 'municipalidad', 'mover'
  ].includes(nome);
  if (indRot) indRot.classList.toggle('visivel', precisaRot);
  if (btnRotarTouch) btnRotarTouch.style.display = precisaRot ? 'flex' : 'none';

  const canvas = document.getElementById('canvas-jogo');
  if (canvas) {
    canvas.classList.toggle('modo-construir', nome !== 'ponteiro' && nome !== 'demolir' && nome !== 'delimitar_bairro');
    canvas.classList.toggle('modo-demolir', nome === 'demolir');
  }

  // Actualiza selección en el dock
  if (nome === 'ponteiro') actualizarDockActivo('dock-btn-puntero');
  if (nome === 'demolir') actualizarDockActivo('dock-btn-demoler');
  if (nome === 'delimitar_bairro') actualizarDockActivo('dock-btn-bairro');
}

function actualizarPreviewFantasma(gx, gz) {
  limparFantasma();
  const ferr = estado.ferramentaAtiva;
  if (ferr === 'ponteiro' || ferr === 'demolir' || ferr === 'delimitar_bairro') return;

  let w = 1;
  let h = 1;

  if (ferr === 'mover' && estado.objetoMoviendo) {
    w = estado.objetoMoviendo.w || 1;
    h = estado.objetoMoviendo.h || 1;
  } else {
    const dims = obtenerDimensionesObjeto(ferr);
    w = dims.w;
    h = dims.h;
  }

  const libre = verificarEspacioDisponible(gx, gz, w, h);
  const { x, z } = gradeParaMundo(gx, gz);
  const centroX = x + ((w - 1) * TAMANHO_CELULA) / 2;
  const centroZ = z + ((h - 1) * TAMANHO_CELULA) / 2;

  const geo = new THREE.BoxGeometry(w * TAMANHO_CELULA * 0.9, 2.0, h * TAMANHO_CELULA * 0.9);
  const cor = libre ? 0x66bb6a : 0xef5350;
  fantasmaObjeto = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cor, transparent: true, opacity: 0.45 }));
  fantasmaObjeto.position.set(centroX, 1.0, centroZ);
  const rotFinal = (ferr === 'mover' && estado.objetoMoviendo) ? (estado.objetoMoviendo.rot || 0) : estado.rotacaoAtual;
  fantasmaObjeto.rotation.y = (rotFinal * Math.PI) / 180;
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
  const btnDockBairro = document.getElementById('dock-btn-bairro');
  const btnDockDemoler = document.getElementById('dock-btn-demoler');
  const btnAbrirLogin = document.getElementById('btn-abrir-login');
  const btnDesconectar = document.getElementById('btn-desconectar');

  if (jugadorLocal.esAdmin) {
    if (badgeNombre) badgeNombre.textContent = `👑 Alcalde`;
    badgeUsuarioContenedor?.classList.add('admin');
    if (saldoTexto) saldoTexto.textContent = '∞';
    if (btnAdmin) btnAdmin.style.display = 'inline-flex';
    if (btnDockBairro) btnDockBairro.style.display = 'inline-flex';
    if (btnDockDemoler) btnDockDemoler.style.display = 'inline-flex';
    if (btnAbrirLogin) btnAbrirLogin.style.display = 'none';
    if (btnDesconectar) btnDesconectar.style.display = 'inline-block';
  } else if (jugadorLocal.uid) {
    if (badgeNombre) badgeNombre.textContent = jugadorLocal.nombre;
    badgeUsuarioContenedor?.classList.remove('admin');
    if (saldoTexto) saldoTexto.textContent = Number(jugadorLocal.oikos).toLocaleString('es-PY');
    if (btnAdmin) btnAdmin.style.display = 'none';
    if (btnDockBairro) btnDockBairro.style.display = 'none';
    if (btnDockDemoler) btnDockDemoler.style.display = 'none';
    if (btnAbrirLogin) btnAbrirLogin.style.display = 'none';
    if (btnDesconectar) btnDesconectar.style.display = 'inline-block';
  } else {
    // Visitante (no ha iniciado sesión todavía)
    if (badgeNombre) badgeNombre.textContent = 'Visitante';
    badgeUsuarioContenedor?.classList.remove('admin');
    if (saldoTexto) saldoTexto.textContent = Number(jugadorLocal.oikos).toLocaleString('es-PY');
    if (btnAdmin) btnAdmin.style.display = 'none';
    if (btnDockBairro) btnDockBairro.style.display = 'none';
    if (btnDockDemoler) btnDockDemoler.style.display = 'none';
    if (btnAbrirLogin) btnAbrirLogin.style.display = 'inline-block';
    if (btnDesconectar) btnDesconectar.style.display = 'none';
  }

  // Reflejar visualmente en el catálogo si las obras de Alcalde están desbloqueadas
  document.querySelectorAll('.solo-alcalde-item').forEach(el => {
    el.classList.toggle('bloqueado-ciudadano', !jugadorLocal.esAdmin);
  });

  actualizarBadgeBarrioActual();
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
    if (controles) controles.enabled = false;
  });
}

if (btnCerrarAdmin && modalAdmin) {
  btnCerrarAdmin.addEventListener('click', () => {
    modalAdmin.style.display = 'none';
    if (controles) controles.enabled = true;
  });
}

modalAdmin?.addEventListener('click', (e) => {
  if (e.target === modalAdmin) {
    modalAdmin.style.display = 'none';
    if (controles) controles.enabled = true;
  }
});

['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'touchmove', 'wheel'].forEach(evt => {
  modalAdmin?.addEventListener(evt, e => e.stopPropagation());
});

// Acciones Administrativas
document.getElementById('admin-activar-bairros')?.addEventListener('click', () => {
  if (modalAdmin) modalAdmin.style.display = 'none';
  seleccionarHerramienta('delimitar_bairro');
  actualizarDockActivo('dock-btn-bairro');
  mostrarNotificacion('🏷️ Modo Barrios: Haz clic o toca en dos esquinas para delimitar una región.');
});

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
        actualizarMeshCelda(x, z);
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

  // Dibujar polígonos/rectángulos de Barrios delimitados
  if (estado.bairros && estado.bairros.length > 0) {
    estado.bairros.forEach(b => {
      const minX = Math.min(b.x1, b.x2) * px;
      const minZ = Math.min(b.z1, b.z2) * px;
      const bw = (Math.abs(b.x2 - b.x1) + 1) * px;
      const bh = (Math.abs(b.z2 - b.z1) + 1) * px;

      ctx.fillStyle = b.cor ? `${b.cor}33` : 'rgba(45, 158, 66, 0.2)';
      ctx.fillRect(minX, minZ, bw, bh);

      ctx.strokeStyle = b.cor || '#2d9e42';
      ctx.lineWidth = 1;
      ctx.strokeRect(minX, minZ, bw, bh);

      if (bw > 25 && bh > 12) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(b.nome, minX + bw / 2, minZ + bh / 2 + 3);
      }
    });
  }

  const colores = {
    estrada: '#37474f',
    estrada_terra: '#8d6e63',
    estrada_empedrado: '#78909c',
    casa: '#ffb74d',
    sobrado: '#0288d1',
    predio: '#90a4ae',
    loja: '#fbc02d',
    posto: '#e53935',
    parque: '#2e7d32',
    usina: '#546e7a',
    caixaDAgua: '#00acc1',
    municipalidad: '#ffd700'
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

let frameContadorAnim = 0;
function animar() {
  requestAnimationFrame(animar);
  if (controles) controles.update();

  frameContadorAnim++;
  if (frameContadorAnim % 12 === 0) {
    // Reflejar visualmente en el catálogo si las obras de Alcalde están desbloqueadas
  document.querySelectorAll('.solo-alcalde-item').forEach(el => {
    el.classList.toggle('bloqueado-ciudadano', !jugadorLocal.esAdmin);
  });

    actualizarBadgeBarrioActual();

    // Actualizar segundero en vivo del alquiler en la tarjeta de inspección abierta
    if (estado.celulaSelecionada) {
      const card = document.getElementById('card-inspeccion');
      if (card && card.style.display !== 'none') {
        const { gx, gz } = estado.celulaSelecionada;
        const c = estado.grade[gz]?.[gx];
        if (c && c.alquilerExpira) {
          const segRest = Math.max(0, Math.floor((c.alquilerExpira - Date.now()) / 1000));
          const m = Math.floor(segRest / 60);
          const s = segRest % 60;
          const elTimer = document.getElementById('timer-alquiler-dinamico');
          if (elTimer) elTimer.textContent = `${m}m ${s < 10 ? '0' : ''}${s}s`;
        }
      }
    }
  }

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
   13. SISTEMA DE COMERCIO, TRABAJOS ESPECIALIZADOS, BANCO E INVENTARIO
   ============================================================ */
let comercioActualTipo = 'mercado';

function abrirModalComercio(tipoComercio) {
  const modal = document.getElementById('modal-comercio');
  if (!modal) return;
  comercioActualTipo = tipoComercio || 'mercado';

  const select = document.getElementById('select-comercio-activo');
  if (select) select.value = comercioActualTipo;

  const infoComercio = CATALOGO_COMERCIOS[comercioActualTipo] || CATALOGO_COMERCIOS.mercado;

  const titulo = document.getElementById('comercio-titulo');
  if (titulo) {
    titulo.textContent = infoComercio.titulo;
  }
  const subtitulo = document.getElementById('comercio-subtitulo');
  if (subtitulo) {
    subtitulo.textContent = infoComercio.subtitulo;
  }

  cambiarTabComercio('comprar');
  renderizarArticulosComercio(comercioActualTipo);
  renderizarArticulosVenta();
  actualizarInfoEmpleoComercio(comercioActualTipo);

  modal.style.display = 'flex';
  if (controles) controles.enabled = false;
}

function cerrarModalComercio() {
  const modal = document.getElementById('modal-comercio');
  if (modal) modal.style.display = 'none';
  if (controles) controles.enabled = true;
}

function cambiarTabComercio(nombreSeccion) {
  document.querySelectorAll('.tab-comercio-btn').forEach(btn => {
    btn.classList.toggle('activa', btn.dataset.seccion === nombreSeccion);
  });
  const secComprar = document.getElementById('seccion-comercio-comprar');
  const secVender = document.getElementById('seccion-comercio-vender');
  const secEmpleo = document.getElementById('seccion-comercio-empleo');

  if (secComprar) secComprar.style.display = (nombreSeccion === 'comprar') ? 'block' : 'none';
  if (secVender) secVender.style.display = (nombreSeccion === 'vender') ? 'block' : 'none';
  if (secEmpleo) secEmpleo.style.display = (nombreSeccion === 'empleo') ? 'block' : 'none';
}

function renderizarArticulosComercio(tipoComercio) {
  const cont = document.getElementById('lista-articulos-comprar');
  if (!cont) return;
  cont.innerHTML = '';

  const datos = CATALOGO_COMERCIOS[tipoComercio];
  if (!datos || !datos.articulos || datos.articulos.length === 0) {
    cont.innerHTML = '<p style="color:var(--cor-texto-dim); text-align:center; padding: 20px;">No hay artículos disponibles en este establecimiento.</p>';
    return;
  }

  datos.articulos.forEach(art => {
    const card = document.createElement('div');
    card.className = 'item-tienda-tarjeta';
    card.innerHTML = `
      <div class="item-icono-lado">${art.icono || '📦'}</div>
      <div class="item-detalles-centro">
        <span class="item-nombre">${art.nombre}</span>
        <span class="item-desc">${art.desc || ''}</span>
        <span class="item-precio-badge">${art.precio.toLocaleString('es-PY')} Ø</span>
      </div>
      <button type="button" class="btn-comprar-item" data-id="${art.id}">Comprar</button>
    `;
    card.querySelector('.btn-comprar-item').addEventListener('click', () => {
      comprarArticuloComercio(art.id, tipoComercio);
    });
    cont.appendChild(card);
  });
}

function comprarArticuloComercio(idItem, tipoComercio) {
  const datos = CATALOGO_COMERCIOS[tipoComercio];
  if (!datos) return;
  const art = datos.articulos.find(a => a.id === idItem);
  if (!art) return;

  if (jugadorLocal.oikos < art.precio) {
    tocarSonido('error');
    mostrarNotificacion(`❌ Saldo insuficiente (${art.precio.toLocaleString('es-PY')} Oikos requeridos).`);
    return;
  }

  jugadorLocal.oikos -= art.precio;
  if (!jugadorLocal.inventario) jugadorLocal.inventario = [];
  if (!jugadorLocal.garagem) jugadorLocal.garagem = [];

  if (art.tipo === 'vehiculo') {
    jugadorLocal.garagem.push({
      id: `${art.id}_${Date.now()}`,
      tipoId: art.id,
      nombre: art.nombre,
      icono: art.icono,
      velocidad: art.velocidad || 1.3,
      fecha: new Date().toLocaleDateString('es-PY')
    });
    mostrarNotificacion(`🚗 ¡Has comprado ${art.nombre}! Guardado en tu Garaje.`);
  } else {
    const existente = jugadorLocal.inventario.find(i => i.tipoId === art.id);
    if (existente) {
      existente.cantidad = (existente.cantidad || 1) + 1;
    } else {
      jugadorLocal.inventario.push({
        id: `${art.id}_${Date.now()}`,
        tipoId: art.id,
        nombre: art.nombre,
        icono: art.icono,
        precioBase: art.precio,
        desc: art.desc,
        tipo: art.tipo,
        cantidad: 1
      });
    }
    mostrarNotificacion(`🛍️ Compraste ${art.nombre} por ${art.precio} Ø.`);
  }

  tocarSonido('monedas');
  actualizarHUD();
  guardarCiudadEnStorage(false);
  renderizarArticulosVenta();
}

function renderizarArticulosVenta() {
  const cont = document.getElementById('lista-articulos-vender');
  if (!cont) return;
  cont.innerHTML = '';

  const inv = jugadorLocal.inventario || [];
  if (inv.length === 0) {
    cont.innerHTML = '<p style="color:var(--cor-texto-dim); text-align:center; padding: 25px;">Tu mochila está vacía. No tienes artículos para vender en este momento.</p>';
    return;
  }

  inv.forEach(item => {
    const precioVenta = Math.round((item.precioBase || 40) * 0.7);
    const card = document.createElement('div');
    card.className = 'item-tienda-tarjeta';
    card.innerHTML = `
      <div class="item-icono-lado">${item.icono || '📦'}</div>
      <div class="item-detalles-centro">
        <span class="item-nombre">${item.nombre} <strong style="color:var(--cor-primaria); font-size:11px;">(x${item.cantidad || 1})</strong></span>
        <span class="item-desc">${item.desc || 'Artículo de inventario'}</span>
        <span class="item-precio-badge" style="color:#81c784;">Reventa: +${precioVenta.toLocaleString('es-PY')} Ø c/u</span>
      </div>
      <button type="button" class="btn-vender-item" data-id="${item.id}">Vender 1x</button>
    `;
    card.querySelector('.btn-vender-item').addEventListener('click', () => {
      venderArticuloInventario(item.id);
    });
    cont.appendChild(card);
  });
}

function venderArticuloInventario(idItem) {
  if (!jugadorLocal.inventario) return;
  const idx = jugadorLocal.inventario.findIndex(i => i.id === idItem);
  if (idx === -1) return;

  const item = jugadorLocal.inventario[idx];
  const precioVenta = Math.round((item.precioBase || 40) * 0.7);

  jugadorLocal.oikos += precioVenta;
  if ((item.cantidad || 1) > 1) {
    item.cantidad--;
  } else {
    jugadorLocal.inventario.splice(idx, 1);
  }

  tocarSonido('monedas');
  actualizarHUD();
  guardarCiudadEnStorage(false);
  renderizarArticulosVenta();
  mostrarNotificacion(`💰 Vendiste 1x ${item.nombre} por +${precioVenta} Oikos.`);
}

function actualizarInfoEmpleoComercio(tipoComercio) {
  const datos = CATALOGO_COMERCIOS[tipoComercio];
  const sec = document.getElementById('info-empleo-local');
  if (!sec) return;

  if (!datos || !datos.empleo) {
    sec.innerHTML = '<p style="color:var(--cor-texto-dim); text-align:center;">Este establecimiento no cuenta con vacantes laborales disponibles.</p>';
    return;
  }

  const emp = datos.empleo;
  sec.innerHTML = `
    <div style="font-size:14px; font-weight:bold; color:#ffffff; margin-bottom:4px;">${emp.titulo}</div>
    <div style="font-size:12px; color:var(--cor-primaria); margin-bottom:8px;">${emp.empresa}</div>
    <div class="detalle-turno">
      <span>Salario acordado:</span>
      <strong class="salario-resaltado">+${emp.salario.toLocaleString('es-PY')} Ø / turno</strong>
    </div>
    <div class="detalle-turno">
      <span>Duración de la jornada:</span>
      <strong>${emp.duracion} segundos</strong>
    </div>
    <button type="button" id="btn-postular-trabajo-local" class="btn-accion-trabajo-grande">
      💼 Cumplir Turno de Trabajo (+${emp.salario} Ø)
    </button>
  `;

  document.getElementById('btn-postular-trabajo-local')?.addEventListener('click', () => {
    postularEmpleoEspecializado(emp);
  });
}

function postularEmpleoEspecializado(emp) {
  jugadorLocal.empleoEspecializado = emp;
  guardarCiudadEnStorage(false);
  iniciarTurnoEspecializado(emp);
}

function iniciarTurnoEspecializado(emp) {
  if (jugadorLocal.trabajando) {
    mostrarNotificacion('⚠️ Ya estás cumpliendo un turno de trabajo.');
    return;
  }

  cerrarModalComercio();
  jugadorLocal.trabajando = true;
  jugadorLocal.tiempoTurnoRestante = emp.duracion || 10;
  jugadorLocal.duracionTurnoTotal = emp.duracion || 10;
  actualizarEstadoTrabajoUI();
  mostrarNotificacion(`💼 Turno iniciado: ${emp.titulo} (${emp.duracion}s).`);

  const timer = setInterval(() => {
    jugadorLocal.tiempoTurnoRestante--;
    actualizarEstadoTrabajoUI();

    if (jugadorLocal.tiempoTurnoRestante <= 0) {
      clearInterval(timer);
      jugadorLocal.trabajando = false;
      jugadorLocal.oikos += emp.salario;
      actualizarHUD();
      actualizarEstadoTrabajoUI();
      guardarCiudadEnStorage(false);
      tocarSonido('monedas');
      mostrarNotificacion(`🎉 ¡Turno de ${emp.titulo} completado! Cobraste +${emp.salario} Oikos.`);
    }
  }, 1000);
}

/* ============================================================
   SISTEMA BANCARIO
   ============================================================ */
function abrirModalBanco() {
  const modal = document.getElementById('modal-banco');
  if (!modal) return;
  actualizarHUDBanco();
  cambiarTabBanco('deposito');
  modal.style.display = 'flex';
  if (controles) controles.enabled = false;
}

function cerrarModalBanco() {
  const modal = document.getElementById('modal-banco');
  if (modal) modal.style.display = 'none';
  if (controles) controles.enabled = true;
}

function cambiarTabBanco(nombreTab) {
  document.querySelectorAll('.tab-banco-btn').forEach(btn => {
    btn.classList.toggle('activa', btn.dataset.tab === nombreTab);
  });
  const secDep = document.getElementById('tab-banco-deposito');
  const secTransf = document.getElementById('tab-banco-transferir');
  const secPrest = document.getElementById('tab-banco-prestamo');

  if (secDep) secDep.style.display = (nombreTab === 'deposito') ? 'block' : 'none';
  if (secTransf) secTransf.style.display = (nombreTab === 'transferir') ? 'block' : 'none';
  if (secPrest) secPrest.style.display = (nombreTab === 'prestamo') ? 'block' : 'none';
}

function actualizarHUDBanco() {
  const elBilletera = document.getElementById('banco-saldo-billetera');
  const elBanco = document.getElementById('banco-saldo-cuenta');
  const elDeuda = document.getElementById('banco-valor-deuda');

  if (elBilletera) elBilletera.textContent = `${jugadorLocal.oikos.toLocaleString('es-PY')} Ø`;
  if (elBanco) elBanco.textContent = `${(jugadorLocal.saldoBanco || 0).toLocaleString('es-PY')} Ø`;
  if (elDeuda) elDeuda.textContent = `${(jugadorLocal.deudaPrestamo || 0).toLocaleString('es-PY')} Ø`;
}

function depositarEnBanco(monto) {
  monto = Math.floor(Number(monto));
  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('❌ Ingresa una cantidad válida para depositar.');
    return;
  }
  if (jugadorLocal.oikos < monto) {
    mostrarNotificacion('❌ Saldo insuficiente en tu billetera.');
    tocarSonido('error');
    return;
  }

  jugadorLocal.oikos -= monto;
  jugadorLocal.saldoBanco = (jugadorLocal.saldoBanco || 0) + monto;
  actualizarHUD();
  actualizarHUDBanco();
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`🏦 Has depositado ${monto.toLocaleString('es-PY')} Oikos en tu cuenta.`);
}

function retirarDeBanco(monto) {
  monto = Math.floor(Number(monto));
  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('❌ Ingresa una cantidad válida para retirar.');
    return;
  }
  if ((jugadorLocal.saldoBanco || 0) < monto) {
    mostrarNotificacion('❌ Saldo insuficiente en tu cuenta bancaria.');
    tocarSonido('error');
    return;
  }

  jugadorLocal.saldoBanco -= monto;
  jugadorLocal.oikos += monto;
  actualizarHUD();
  actualizarHUDBanco();
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`💵 Has retirado ${monto.toLocaleString('es-PY')} Oikos a tu billetera.`);
}

function transferirEntreJugadores(destinatario, monto) {
  destinatario = (destinatario || '').trim();
  monto = Math.floor(Number(monto));
  if (!destinatario) {
    mostrarNotificacion('❌ Ingresa el nombre del ciudadano destinatario.');
    return;
  }
  if (destinatario.toLowerCase() === jugadorLocal.nombre.toLowerCase()) {
    mostrarNotificacion('❌ No puedes transferir fondos a tu propia cuenta.');
    return;
  }
  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('❌ Ingresa un monto de transferencia válido.');
    return;
  }
  if (jugadorLocal.oikos < monto) {
    mostrarNotificacion('❌ Saldo insuficiente en tu billetera para transferir.');
    tocarSonido('error');
    return;
  }

  jugadorLocal.oikos -= monto;
  actualizarHUD();
  actualizarHUDBanco();
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');

  if (socket && socket.connected) {
    socket.emit('transferencia_bancaria', { destinatario, monto, remitente: jugadorLocal.nombre });
  }
  mostrarNotificacion(`💸 ¡Transferencia enviada! -${monto.toLocaleString('es-PY')} Ø a ${destinatario}.`);
}

function solicitarPrestamoBanco(monto) {
  monto = Math.floor(Number(monto));
  if (isNaN(monto) || monto <= 0) {
    mostrarNotificacion('❌ Ingresa un monto de préstamo válido.');
    return;
  }
  if ((jugadorLocal.deudaPrestamo || 0) > 0) {
    mostrarNotificacion('❌ Ya tienes un crédito pendiente de amortización.');
    return;
  }

  const deudaConInteres = Math.round(monto * 1.10); // 10% de recargo
  jugadorLocal.oikos += monto;
  jugadorLocal.deudaPrestamo = deudaConInteres;
  actualizarHUD();
  actualizarHUDBanco();
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`🤝 ¡Crédito otorgado! Recibiste +${monto} Ø (Deuda total: ${deudaConInteres} Ø).`);
}

function pagarPrestamoBanco() {
  const deuda = jugadorLocal.deudaPrestamo || 0;
  if (deuda <= 0) {
    mostrarNotificacion('✨ No tienes deudas bancarias pendientes.');
    return;
  }
  if (jugadorLocal.oikos < deuda) {
    mostrarNotificacion(`❌ Saldo insuficiente para saldar la deuda (${deuda.toLocaleString('es-PY')} Oikos requeridos).`);
    tocarSonido('error');
    return;
  }

  jugadorLocal.oikos -= deuda;
  jugadorLocal.deudaPrestamo = 0;
  actualizarHUD();
  actualizarHUDBanco();
  guardarCiudadEnStorage(false);
  tocarSonido('monedas');
  mostrarNotificacion(`🎉 ¡Felicidades! Has liquidado tu crédito bancario por completo.`);
}

function iniciarInteresBancario() {
  setInterval(() => {
    if (jugadorLocal.saldoBanco && jugadorLocal.saldoBanco > 0) {
      const ganancia = Math.max(1, Math.round(jugadorLocal.saldoBanco * 0.015));
      jugadorLocal.saldoBanco += ganancia;
      actualizarHUDBanco();
      guardarCiudadEnStorage(false);
      mostrarNotificacion(`📈 Rendimiento Bancario: +${ganancia} Ø generados en intereses.`);
    }
  }, 120000);
}

/* ============================================================
   SISTEMA DE INVENTARIO Y GARAJE PERSONAL
   ============================================================ */
function abrirModalInventario() {
  const modal = document.getElementById('modal-inventario');
  if (!modal) return;
  renderizarInventario();
  cambiarTabInventario('articulos');
  modal.style.display = 'flex';
  if (controles) controles.enabled = false;
}

function cerrarModalInventario() {
  const modal = document.getElementById('modal-inventario');
  if (modal) modal.style.display = 'none';
  if (controles) controles.enabled = true;
}

function cambiarTabInventario(nombreTab) {
  document.querySelectorAll('.tab-inventario-btn').forEach(btn => {
    btn.classList.toggle('activa', btn.dataset.tab === nombreTab);
  });
  const secArt = document.getElementById('tab-inventario-articulos');
  const secGar = document.getElementById('tab-inventario-garaje');
  if (secArt) secArt.style.display = (nombreTab === 'articulos') ? 'block' : 'none';
  if (secGar) secGar.style.display = (nombreTab === 'garaje') ? 'block' : 'none';
}

function renderizarInventario() {
  const listaMochila = document.getElementById('lista-mochila-items');
  const listaGaraje = document.getElementById('lista-garaje-vehiculos');

  if (listaMochila) {
    listaMochila.innerHTML = '';
    const inv = jugadorLocal.inventario || [];
    if (inv.length === 0) {
      listaMochila.innerHTML = '<p style="color:var(--cor-texto-dim); text-align:center; padding:20px;">Tu mochila está vacía. Visita las tiendas de Katueté para adquirir artículos.</p>';
    } else {
      inv.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-tienda-tarjeta';
        card.innerHTML = `
          <div class="item-icono-lado">${item.icono || '📦'}</div>
          <div class="item-detalles-centro">
            <span class="item-nombre">${item.nombre} <strong style="color:var(--cor-primaria); font-size:11px;">(x${item.cantidad || 1})</strong></span>
            <span class="item-desc">${item.desc || 'Artículo personal'}</span>
          </div>
          <button type="button" class="btn-comprar-item" style="background:#2e7d32;" data-id="${item.id}">Usar</button>
        `;
        card.querySelector('button').addEventListener('click', () => {
          usarArticuloInventario(item.id);
        });
        listaMochila.appendChild(card);
      });
    }
  }

  if (listaGaraje) {
    listaGaraje.innerHTML = '';
    const gar = jugadorLocal.garagem || [];
    if (gar.length === 0) {
      listaGaraje.innerHTML = '<p style="color:var(--cor-texto-dim); text-align:center; padding:20px;">No posees vehículos en tu garaje. Visita la Concesionaria Central para comprar uno.</p>';
    } else {
      gar.forEach(veh => {
        const card = document.createElement('div');
        card.className = 'item-tienda-tarjeta';
        card.innerHTML = `
          <div class="item-icono-lado">${veh.icono || '🚗'}</div>
          <div class="item-detalles-centro">
            <span class="item-nombre">${veh.nombre}</span>
            <span class="item-desc">Vehículo particular habilitado en Katueté</span>
            <span class="item-precio-badge" style="color:#81d4fa;">Velocidad: ×${veh.velocidad || 1.3}</span>
          </div>
          <button type="button" class="btn-comprar-item" style="background:#0288d1;" data-id="${veh.id}">Conducir</button>
        `;
        card.querySelector('button').addEventListener('click', () => {
          abordarVehiculoGarage(veh);
        });
        listaGaraje.appendChild(card);
      });
    }
  }
}

function usarArticuloInventario(idItem) {
  if (!jugadorLocal.inventario) return;
  const idx = jugadorLocal.inventario.findIndex(i => i.id === idItem);
  if (idx === -1) return;

  const item = jugadorLocal.inventario[idx];
  if ((item.cantidad || 1) > 1) {
    item.cantidad--;
  } else {
    jugadorLocal.inventario.splice(idx, 1);
  }

  tocarSonido('monedas');
  guardarCiudadEnStorage(false);
  renderizarInventario();
  mostrarNotificacion(`✨ Has utilizado ${item.nombre}. ¡Efecto activado!`);
}

function abordarVehiculoGarage(veh) {
  cerrarModalInventario();
  mostrarNotificacion(`🚗 ¡Conduciendo tu ${veh.nombre}! Velocidad de exploración aumentada (×${veh.velocidad || 1.3}).`);
  tocarSonido('construir');
}

/* ============================================================
   LISTENERS DE MODALES DE ECONOMÍA, COMERCIO, BANCO E INVENTARIO
   ============================================================ */
// Comercio
document.getElementById('btn-cerrar-modal-comercio')?.addEventListener('click', cerrarModalComercio);

document.querySelectorAll('.tab-comercio-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cambiarTabComercio(btn.dataset.seccion);
  });
});

document.getElementById('select-comercio-activo')?.addEventListener('change', (e) => {
  abrirModalComercio(e.target.value);
});

document.getElementById('dock-btn-comercio')?.addEventListener('click', () => {
  cerrarTodosLosMenus();
  abrirModalComercio(comercioActualTipo || 'mercado');
  actualizarDockActivo('dock-btn-comercio');
});

// Banco
document.getElementById('btn-cerrar-modal-banco')?.addEventListener('click', cerrarModalBanco);

document.querySelectorAll('.tab-banco-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cambiarTabBanco(btn.dataset.tab);
  });
});

document.getElementById('btn-banco-depositar')?.addEventListener('click', () => {
  const inp = document.getElementById('banco-input-monto');
  if (inp) { depositarEnBanco(inp.value); inp.value = ''; }
});

document.getElementById('btn-banco-retirar')?.addEventListener('click', () => {
  const inp = document.getElementById('banco-input-monto');
  if (inp) { retirarDeBanco(inp.value); inp.value = ''; }
});

document.getElementById('btn-banco-todo-dep')?.addEventListener('click', () => {
  if (jugadorLocal.oikos > 0) depositarEnBanco(jugadorLocal.oikos);
});

document.getElementById('btn-banco-todo-ret')?.addEventListener('click', () => {
  if (jugadorLocal.saldoBanco > 0) retirarDeBanco(jugadorLocal.saldoBanco);
});

document.getElementById('btn-banco-transferir-ejecutar')?.addEventListener('click', () => {
  const dest = document.getElementById('banco-input-destinatario');
  const monto = document.getElementById('banco-input-monto-transferir');
  if (dest && monto) {
    transferirEntreJugadores(dest.value, monto.value);
    monto.value = '';
  }
});

document.getElementById('btn-solicitar-credito-1000')?.addEventListener('click', () => {
  solicitarPrestamoBanco(1000);
});

document.getElementById('btn-solicitar-credito-3000')?.addEventListener('click', () => {
  solicitarPrestamoBanco(3000);
});

document.getElementById('btn-pagar-deuda')?.addEventListener('click', pagarPrestamoBanco);

// Inventario
document.getElementById('btn-cerrar-modal-inventario')?.addEventListener('click', cerrarModalInventario);

document.querySelectorAll('.tab-inventario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    cambiarTabInventario(btn.dataset.tab);
  });
});

document.getElementById('dock-btn-inventario')?.addEventListener('click', () => {
  cerrarTodosLosMenus();
  abrirModalInventario();
  actualizarDockActivo('dock-btn-inventario');
});

// Aislamiento táctil de clics en los modales
['modal-comercio', 'modal-banco', 'modal-inventario'].forEach(idModal => {
  const elModal = document.getElementById(idModal);
  if (elModal) {
    elModal.addEventListener('click', (e) => {
      if (e.target === elModal) {
        if (idModal === 'modal-comercio') cerrarModalComercio();
        else if (idModal === 'modal-banco') cerrarModalBanco();
        else if (idModal === 'modal-inventario') cerrarModalInventario();
      }
    });
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend', 'touchmove', 'wheel'].forEach(evt => {
      elModal.addEventListener(evt, e => e.stopPropagation());
    });
  }
});

/* ============================================================
   14. AUTO-INICIALIZACIÓN INMEDIATA DEL MAPA 3D
   ============================================================ */
// Se ejecuta de inmediato al cargar el script para que el visitante
// vea el mapa 3D y la ciudad sin tener que pasar por ninguna pantalla previa.

// Recuperar barrios globales si existen previamente
try {
  const guardadoBairros = localStorage.getItem('katuete_global_bairros');
  if (guardadoBairros) {
    const parsed = JSON.parse(guardadoBairros);
    if (Array.isArray(parsed) && parsed.length > 0) {
      estado.bairros = parsed;
    }
  }
} catch (e) {}

// Recuperar sesión previa de localStorage si el usuario ya inició sesión
try {
  const sesionGuardada = localStorage.getItem('katuete_session');
  if (sesionGuardada) {
    const s = JSON.parse(sesionGuardada);
    if (s && s.uid) {
      if (s.esAdmin) {
        jugadorLocal.uid = s.uid;
        jugadorLocal.nombre = 'ALCALDE';
        jugadorLocal.email = s.email;
        jugadorLocal.esAdmin = true;
        jugadorLocal.oikos = 9999999;
      } else {
        jugadorLocal.uid = s.uid;
        jugadorLocal.nombre = s.nombre;
        jugadorLocal.email = s.email;
        jugadorLocal.esAdmin = false;
        jugadorLocal.oikos = s.oikos || 1000;
      }
    }
  }
} catch (e) {}

const ciudadRestaurada = recuperarCiudadGuardada();

const centroInicial = Math.floor(TAMANHO_GRADE / 2);
if (!ciudadRestaurada && estado.grade[centroInicial][centroInicial] === null) {
  generarCiudadBase();
}

iniciarMotor3D();
reconstruirVisualBairros3D();
actualizarChunksCamara(true); // Carga inmediata de los chunks iniciales
iniciarCicloAlquilerLocal();
iniciarInteresBancario();
actualizarHUD();
desenharMiniMapa();

// Iniciar conexión con el servidor multijugador en tiempo real
inicializarConexionSocket();

// Autoguardado periódico cada 30 segundos garantizado
setInterval(() => {
  guardarCiudadEnStorage(false);
}, 30000);
