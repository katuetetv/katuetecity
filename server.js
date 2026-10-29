/**
 * ============================================================
 * KatueteCity — Servidor Multijugador en Tiempo Real
 * Arquitectura: Node.js + Express + WebSockets (Socket.io)
 * Economía de Integración con 'Oikos'
 * ============================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PUERTO = process.env.PORT || 3000;

// Servir archivos estáticos del cliente (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

/* ============================================================
   CONFIGURACIÓN Y ESTADO GLOBAL DEL SERVIDOR
   ============================================================ */

const TAMANHO_GRADE = 40;
const CAPITAL_INICIAL_OIKOS = 1000;
const DURACION_TURNO_SEGUNDOS = 10;
const SALARIO_TURNO_OIKOS = 350;
const COSTO_ALQUILER_CICLO = 150; // Oikos cada ciclo por casa alquilada

// Costos de construcción en Oikos
const COSTOS_CONSTRUCCION = {
  estrada: 0,
  casa: 400,
  sobrado: 900,
  predio: 2200,
  loja: 1100,
  posto: 1800,
  parque: 600,
  usina: 2800,
  caixaDAgua: 2000,
  carro: 250,
  caminhao: 600,
  onibus: 900,
  viatura: 500
};

// Registro de jugadores conectados: socketId -> datos
const jugadores = new Map();

// Matriz de mapa compartido en el servidor
// mapa[z][x] = { tipo, rot, inquilino: null | nombre, fechaConstruccion, autor }
const mapa = [];
for (let z = 0; z < TAMANHO_GRADE; z++) {
  mapa[z] = [];
  for (let x = 0; x < TAMANHO_GRADE; x++) {
    mapa[z][x] = null;
  }
}

// Lista de vehículos compartidos
let idVehiculoAuto = 1;
const vehiculosCompartidos = [];

/* ============================================================
   GENERACIÓN DE LA CIUDAD INICIAL COMPARTIDA
   ============================================================ */
function inicializarCiudadBase() {
  const c = Math.floor(TAMANHO_GRADE / 2);

  // Avenidas centrales cruzadas
  for (let x = c - 7; x <= c + 7; x++) {
    mapa[c][x] = { tipo: 'estrada', rot: 0, autor: 'Municipio' };
  }
  for (let z = c - 7; z <= c + 7; z++) {
    mapa[z][c] = { tipo: 'estrada', rot: 0, autor: 'Municipio' };
  }

  // Viviendas iniciales disponibles para alquilar
  mapa[c - 2][c - 2] = { tipo: 'casa', rot: 0, inquilino: null, autor: 'Municipio' };
  mapa[c - 2][c + 2] = { tipo: 'sobrado', rot: 0, inquilino: null, autor: 'Municipio' };
  mapa[c + 2][c - 2] = { tipo: 'casa', rot: 0, inquilino: null, autor: 'Municipio' };
  mapa[c + 2][c + 2] = { tipo: 'predio', rot: 0, inquilino: null, autor: 'Municipio' };

  // Servicios y comercios de la ciudad
  mapa[c - 4][c - 3] = { tipo: 'loja', rot: 0, autor: 'Municipio' };
  mapa[c + 4][c + 3] = { tipo: 'posto', rot: 0, autor: 'Municipio' };
  mapa[c + 3][c - 4] = { tipo: 'parque', rot: 0, autor: 'Municipio' };
  mapa[c - 5][c + 4] = { tipo: 'usina', rot: 0, autor: 'Municipio' };
  mapa[c + 5][c + 4] = { tipo: 'caixaDAgua', rot: 0, autor: 'Municipio' };

  console.log('✅ Ciudad inicial de KatueteCity creada en el servidor.');
}
inicializarCiudadBase();

/* ============================================================
   LÓGICA DE WEBSOCKETS (SOCKET.IO)
   ============================================================ */

io.on('connection', (socket) => {
  console.log(`🔌 Nueva conexión establecida: ID ${socket.id}`);

  /**
   * 1. INICIO DE SESIÓN / IDENTIDAD DEL CIUDADANO
   */
  socket.on('iniciar_sesion', (datos) => {
    let nombreUsuario = (datos?.nombre || '').trim();
    if (!nombreUsuario) {
      nombreUsuario = `Ciudadano_${socket.id.substring(0, 4)}`;
    }

    // Verificar si el nombre ya está en uso por otro jugador activo
    let nombreFinal = nombreUsuario;
    let contador = 1;
    const nombresActivos = Array.from(jugadores.values()).map(j => j.nombre.toLowerCase());
    while (nombresActivos.includes(nombreFinal.toLowerCase())) {
      nombreFinal = `${nombreUsuario}_${contador++}`;
    }

    // Crear perfil del jugador en el servidor
    const nuevoJugador = {
      id: socket.id,
      nombre: nombreFinal,
      oikos: CAPITAL_INICIAL_OIKOS,
      empleo: {
        estado: 'desocupado', // 'desocupado' | 'trabajando'
        segundosRestantes: 0
      },
      casasAlquiladas: [], // [{ gx, gz }]
      fechaIngreso: new Date()
    };

    jugadores.set(socket.id, nuevoJugador);

    // Preparar el estado completo del mapa para enviárselo al nuevo usuario
    const mapaSerializado = [];
    for (let z = 0; z < TAMANHO_GRADE; z++) {
      for (let x = 0; x < TAMANHO_GRADE; x++) {
        const celda = mapa[z][x];
        if (celda) {
          mapaSerializado.push({
            x, z,
            tipo: celda.tipo,
            rot: celda.rot,
            inquilino: celda.inquilino || null,
            autor: celda.autor || 'Municipio'
          });
        }
      }
    }

    // Lista de ciudadanos conectados
    const listaUsuarios = Array.from(jugadores.values()).map(j => ({
      nombre: j.nombre,
      oikos: j.oikos,
      casas: j.casasAlquiladas.length
    }));

    // Enviar bienvenida personalizada al jugador que acaba de ingresar
    socket.emit('bienvenida', {
      perfil: nuevoJugador,
      mapa: mapaSerializado,
      jugadoresOnline: listaUsuarios,
      costos: COSTOS_CONSTRUCCION
    });

    // Notificar a todos los demás que un nuevo ciudadano ingresó
    socket.broadcast.emit('jugador_conectado', {
      nombre: nuevoJugador.nombre,
      totalConectados: jugadores.size
    });

    io.emit('actualizar_lista_jugadores', listaUsuarios);

    console.log(`👤 Ciudadano ingresó: ${nuevoJugador.nombre} (Capital: ${nuevoJugador.oikos} Oikos)`);
  });

  /**
   * 2. SISTEMA DE TRABAJO Y SALARIOS (EMPLEO)
   */
  socket.on('iniciar_turno_trabajo', () => {
    const jugador = jugadores.get(socket.id);
    if (!jugador) return;

    if (jugador.empleo.estado === 'trabajando') {
      socket.emit('notificacion', { tipo: 'error', mensaje: '¡Ya estás cumpliendo tu turno de trabajo!' });
      return;
    }

    jugador.empleo.estado = 'trabajando';
    jugador.empleo.segundosRestantes = DURACION_TURNO_SEGUNDOS;

    socket.emit('turno_iniciado', {
      duracion: DURACION_TURNO_SEGUNDOS,
      salarioPrometido: SALARIO_TURNO_OIKOS
    });

    // Temporizador de cuenta regresiva en el servidor para evitar trampas
    const intervaloTurno = setInterval(() => {
      // Verificar si el jugador sigue conectado
      if (!jugadores.has(socket.id)) {
        clearInterval(intervaloTurno);
        return;
      }

      jugador.empleo.segundosRestantes--;
      socket.emit('progreso_trabajo', { segundosRestantes: jugador.empleo.segundosRestantes });

      if (jugador.empleo.segundosRestantes <= 0) {
        clearInterval(intervaloTurno);
        jugador.empleo.estado = 'desocupado';
        jugador.oikos += SALARIO_TURNO_OIKOS;

        socket.emit('trabajo_completado', {
          salarioGanado: SALARIO_TURNO_OIKOS,
          nuevoSaldoOikos: jugador.oikos
        });

        io.emit('actualizar_saldo_jugador', {
          nombre: jugador.nombre,
          oikos: jugador.oikos
        });

        console.log(`💼 ${jugador.nombre} completó su turno de trabajo y cobró ${SALARIO_TURNO_OIKOS} Oikos.`);
      }
    }, 1000);
  });

  /**
   * 3. SISTEMA DE ALQUILER DE VIVIENDAS
   */
  socket.on('alquilar_vivienda', ({ gx, gz }) => {
    const jugador = jugadores.get(socket.id);
    if (!jugador) return;

    if (gx < 0 || gz < 0 || gx >= TAMANHO_GRADE || gz >= TAMANHO_GRADE) {
      socket.emit('notificacion', { tipo: 'error', mensaje: 'Coordenadas inválidas.' });
      return;
    }

    const celda = mapa[gz][gx];
    if (!celda || !['casa', 'sobrado', 'predio'].includes(celda.tipo)) {
      socket.emit('notificacion', { tipo: 'error', mensaje: 'Este edificio no es una vivienda para alquilar.' });
      return;
    }

    if (celda.inquilino !== null) {
      socket.emit('notificacion', { tipo: 'error', mensaje: `Esta vivienda ya está alquilada por ${celda.inquilino}.` });
      return;
    }

    if (jugador.oikos < COSTO_ALQUILER_CICLO) {
      socket.emit('notificacion', { tipo: 'error', mensaje: `Saldo insuficiente. Necesitas al menos ${COSTO_ALQUILER_CICLO} Oikos.` });
      return;
    }

    // Cobrar primer ciclo de alquiler y registrar al inquilino
    jugador.oikos -= COSTO_ALQUILER_CICLO;
    celda.inquilino = jugador.nombre;
    jugador.casasAlquiladas.push({ gx, gz });

    // Confirmar al inquilino
    socket.emit('alquiler_exitoso', {
      gx, gz,
      nuevoSaldoOikos: jugador.oikos,
      tipo: celda.tipo,
      inquilino: jugador.nombre
    });

    // Notificar a todos en la ciudad en tiempo real
    io.emit('casa_actualizada', {
      gx, gz,
      tipo: celda.tipo,
      inquilino: jugador.nombre
    });

    io.emit('notificacion_global', {
      mensaje: `🏡 ¡${jugador.nombre} ha alquilado una vivienda en (${gx}, ${gz})!`
    });

    console.log(`🔑 ${jugador.nombre} alquiló la vivienda en (${gx}, ${gz}) por ${COSTO_ALQUILER_CICLO} Oikos.`);
  });

  /**
   * CANCELAR ALQUILER
   */
  socket.on('desalojar_vivienda', ({ gx, gz }) => {
    const jugador = jugadores.get(socket.id);
    if (!jugador) return;

    const celda = mapa[gz]?.[gx];
    if (!celda || celda.inquilino !== jugador.nombre) {
      socket.emit('notificacion', { tipo: 'error', mensaje: 'No eres el inquilino de esta vivienda.' });
      return;
    }

    celda.inquilino = null;
    jugador.casasAlquiladas = jugador.casasAlquiladas.filter(c => !(c.gx === gx && c.gz === gz));

    io.emit('casa_actualizada', {
      gx, gz,
      tipo: celda.tipo,
      inquilino: null
    });

    socket.emit('notificacion', { tipo: 'exito', mensaje: 'Has entregado las llaves de la vivienda.' });
  });

  /**
   * 4. CONSTRUCCIÓN SINCRONIZADA EN EL MAPA MULTIJUGADOR
   */
  socket.on('solicitar_construccion', ({ tipo, gx, gz, rot }) => {
    const jugador = jugadores.get(socket.id);
    if (!jugador) return;

    if (gx < 0 || gz < 0 || gx >= TAMANHO_GRADE || gz >= TAMANHO_GRADE) return;

    if (mapa[gz][gx] !== null) {
      socket.emit('notificacion', { tipo: 'error', mensaje: 'Ese terreno ya está ocupado.' });
      return;
    }

    const costo = COSTOS_CONSTRUCCION[tipo] || 0;
    if (jugador.oikos < costo) {
      socket.emit('notificacion', { tipo: 'error', mensaje: `No tienes suficientes Oikos. Costo: ${costo} Oikos.` });
      return;
    }

    // Descontar Oikos
    jugador.oikos -= costo;

    // Registrar en el mapa compartido
    mapa[gz][gx] = {
      tipo,
      rot: rot || 0,
      inquilino: null,
      autor: jugador.nombre
    };

    // Confirmar al constructor con su saldo actualizado
    socket.emit('construccion_confirmada', {
      tipo, gx, gz, rot,
      nuevoSaldoOikos: jugador.oikos
    });

    // Replicar a todos los jugadores en la ciudad
    io.emit('objeto_construido', {
      tipo, gx, gz, rot,
      autor: jugador.nombre,
      inquilino: null
    });

    console.log(`🔨 [${jugador.nombre}] construyó ${tipo} en (${gx}, ${gz})`);
  });

  /**
   * 5. DEMOLICIÓN SINCRONIZADA
   */
  socket.on('solicitar_demolicion', ({ gx, gz }) => {
    const jugador = jugadores.get(socket.id);
    if (!jugador) return;

    if (gx < 0 || gz < 0 || gx >= TAMANHO_GRADE || gz >= TAMANHO_GRADE) return;
    const celda = mapa[gz][gx];
    if (!celda) return;

    // Si tiene un inquilino ajeno, avisar
    if (celda.inquilino && celda.inquilino !== jugador.nombre) {
      socket.emit('notificacion', { tipo: 'error', mensaje: `No puedes demoler una casa alquilada por ${celda.inquilino}.` });
      return;
    }

    // Si el inquilino era el mismo jugador, removerla de su lista
    if (celda.inquilino === jugador.nombre) {
      jugador.casasAlquiladas = jugador.casasAlquiladas.filter(c => !(c.gx === gx && c.gz === gz));
    }

    mapa[gz][gx] = null;

    io.emit('objeto_demolido', {
      gx, gz,
      demolidoPor: jugador.nombre
    });

    console.log(`💥 [${jugador.nombre}] demolió edificio en (${gx}, ${gz})`);
  });

  /**
   * 6. DESCONEXIÓN
   */
  socket.on('disconnect', () => {
    const jugador = jugadores.get(socket.id);
    if (jugador) {
      console.log(`❌ Ciudadano desconectado: ${jugador.nombre}`);

      // Liberar casas alquiladas si se desconecta (o mantenerlas según política de servidor)
      jugador.casasAlquiladas.forEach(({ gx, gz }) => {
        if (mapa[gz]?.[gx]) {
          mapa[gz][gx].inquilino = null;
          io.emit('casa_actualizada', { gx, gz, tipo: mapa[gz][gx].tipo, inquilino: null });
        }
      });

      jugadores.delete(socket.id);

      io.emit('jugador_desconectado', {
        nombre: jugador.nombre,
        totalConectados: jugadores.size
      });

      const listaActualizada = Array.from(jugadores.values()).map(j => ({
        nombre: j.nombre,
        oikos: j.oikos,
        casas: j.casasAlquiladas.length
      }));
      io.emit('actualizar_lista_jugadores', listaActualizada);
    }
  });
});

/* ============================================================
   CICLO ECONÓMICO PERIÓDICO DEL SERVIDOR (Cobro de Alquileres)
   ============================================================ */
setInterval(() => {
  if (jugadores.size === 0) return;

  jugadores.forEach((jugador, socketId) => {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket || jugador.casasAlquiladas.length === 0) return;

    const totalAlquiler = jugador.casasAlquiladas.length * COSTO_ALQUILER_CICLO;

    if (jugador.oikos >= totalAlquiler) {
      jugador.oikos -= totalAlquiler;
      socket.emit('alquiler_cobrado', {
        monto: totalAlquiler,
        nuevoSaldoOikos: jugador.oikos,
        cantidadCasas: jugador.casasAlquiladas.length
      });
    } else {
      // Desalojo por falta de Oikos
      socket.emit('notificacion', {
        tipo: 'error',
        mensaje: '⚠️ No tienes suficientes Oikos para pagar el alquiler. Tus contratos han sido cancelados.'
      });

      jugador.casasAlquiladas.forEach(({ gx, gz }) => {
        if (mapa[gz]?.[gx]) {
          mapa[gz][gx].inquilino = null;
          io.emit('casa_actualizada', { gx, gz, tipo: mapa[gz][gx].tipo, inquilino: null });
        }
      });
      jugador.casasAlquiladas = [];
    }
  });
}, 45000); // Cada 45 segundos

/* ============================================================
   INICIO DEL SERVIDOR
   ============================================================ */
server.listen(PUERTO, () => {
  console.log(`
============================================================
  🏙️  KATUETE CITY — SERVIDOR MULTIJUGADOR ONLINE
============================================================
  🌐 Servidor escuchando en: http://localhost:${PUERTO}
  💰 Moneda local: Oikos (Capital inicial: 1,000 Oikos)
  🔌 WebSockets activos con Socket.io
============================================================
`);
});

