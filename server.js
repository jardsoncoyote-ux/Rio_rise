// server.js
// Backend do Rio Rise RP — Express + Socket.io + MongoDB

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-isso-em-producao';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Conexão com MongoDB ----------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('[DB] Conectado ao MongoDB'))
  .catch((err) => console.error('[DB] Erro ao conectar:', err.message));

// ---------- Modelos ----------
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  adminLevel: { type: Number, default: 0 }, // 0 = jogador, 1 = mod, 2 = admin, 3 = superadmin
  money: { type: Number, default: 500 },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    z: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// ---------- Autenticação HTTP ----------
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Usuário inválido ou senha curta (mín. 6 caracteres)' });
    }
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ error: 'Usuário já existe' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor', detail: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Usuário ou senha incorretos' });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, adminLevel: user.adminLevel, money: user.money });
  } catch (err) {
    res.status(500).json({ error: 'Erro no servidor', detail: err.message });
  }
});

// ---------- Estado em memória dos players conectados ----------
const connectedPlayers = new Map(); // socket.id -> { username, position, adminLevel }

function broadcastPlayerList() {
  const list = Array.from(connectedPlayers.values()).map(p => ({
    username: p.username,
    position: p.position
  }));
  io.emit('players:update', list);
}

// ---------- Socket.io ----------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Sem token de autenticação'));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

io.on('connection', async (socket) => {
  const dbUser = await User.findById(socket.user.id);
  if (!dbUser) {
    socket.disconnect();
    return;
  }

  connectedPlayers.set(socket.id, {
    username: dbUser.username,
    position: dbUser.position,
    adminLevel: dbUser.adminLevel
  });

  console.log(`[CONNECT] ${dbUser.username} entrou no servidor`);
  io.emit('chat:system', `${dbUser.username} entrou no jogo`);
  broadcastPlayerList();

  // Movimento
  socket.on('player:move', (pos) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    player.position = pos;
    socket.broadcast.emit('player:moved', { username: player.username, position: pos });
  });

  // Chat
  socket.on('chat:message', (message) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    const clean = String(message).slice(0, 300); // limite simples anti-spam
    io.emit('chat:message', { username: player.username, message: clean, time: Date.now() });
  });

  // Comandos de admin
  socket.on('admin:command', async ({ command, target, value }) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || player.adminLevel < 1) {
      socket.emit('chat:system', 'Você não tem permissão para isso.');
      return;
    }

    switch (command) {
      case 'kick': {
        for (const [sockId, p] of connectedPlayers.entries()) {
          if (p.username === target) {
            io.sockets.sockets.get(sockId)?.disconnect();
            io.emit('chat:system', `${target} foi expulso por ${player.username}`);
          }
        }
        break;
      }
      case 'givemoney': {
        if (player.adminLevel < 2) return;
        const targetUser = await User.findOne({ username: target });
        if (targetUser) {
          targetUser.money += Number(value) || 0;
          await targetUser.save();
          io.emit('chat:system', `${player.username} deu $${value} para ${target}`);
        }
        break;
      }
      default:
        socket.emit('chat:system', 'Comando desconhecido.');
    }
  });

  socket.on('disconnect', async () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      // Salva a posição final no banco
      await User.findByIdAndUpdate(socket.user.id, { position: player.position }).catch(() => {});
      console.log(`[DISCONNECT] ${player.username} saiu`);
      io.emit('chat:system', `${player.username} saiu do jogo`);
    }
    connectedPlayers.delete(socket.id);
    broadcastPlayerList();
  });
});

// ---------- Rota de saúde (útil pro Railway saber que está vivo) ----------
app.get('/health', (req, res) => res.json({ status: 'ok', players: connectedPlayers.size }));

server.listen(PORT, () => {
  console.log(`[SERVER] Rio Rise RP rodando na porta ${PORT}`);
});
