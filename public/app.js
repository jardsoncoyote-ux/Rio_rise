// app.js
const SERVER_URL = (window.RIORISE_CONFIG && window.RIORISE_CONFIG.serverUrl) || "";

let socket = null;
let currentUser = null;

// ---------- Helpers de UI ----------
function show(id) {
  document.getElementById(id).classList.remove('hidden');
}
function hide(id) {
  document.getElementById(id).classList.add('hidden');
}
function showError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function toggleForms() {
  document.getElementById('login-form').classList.toggle('hidden');
  document.getElementById('register-form').classList.toggle('hidden');
  document.getElementById('auth-error').classList.add('hidden');
}

// ---------- Autenticação ----------
async function handleRegister() {
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;

  if (!username || !password) {
    showError('Preencha usuário e senha.');
    return;
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Erro ao registrar');
      return;
    }
    loginSuccess(data);
  } catch (err) {
    showError('Não foi possível conectar ao servidor.');
  }
}

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    showError('Preencha usuário e senha.');
    return;
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Erro ao entrar');
      return;
    }
    loginSuccess(data);
  } catch (err) {
    showError('Não foi possível conectar ao servidor.');
  }
}

function loginSuccess(data) {
  currentUser = data;
  localStorage.setItem('riorise_token', data.token);
  hide('auth-screen');
  show('game-screen');
  document.getElementById('player-name').textContent = data.username;
  if ((data.adminLevel || 0) >= 1) {
    show('admin-panel');
  }
  connectSocket(data.token);
}

// ---------- Socket.io ----------
function connectSocket(token) {
  socket = io(SERVER_URL || undefined, {
    auth: { token }
  });

  socket.on('connect_error', (err) => {
    appendSystemMessage(`Erro de conexão: ${err.message}`);
  });

  socket.on('chat:message', ({ username, message }) => {
    appendChatMessage(username, message);
  });

  socket.on('chat:system', (msg) => {
    appendSystemMessage(msg);
  });

  socket.on('players:update', (players) => {
    updatePlayerList(players);
  });
}

// ---------- Chat ----------
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim()) {
      socket.emit('chat:message', chatInput.value.trim());
      chatInput.value = '';
    }
  });
});

function appendChatMessage(username, message) {
  const box = document.getElementById('chat-messages');
  const p = document.createElement('p');
  p.innerHTML = `<span class="username">${escapeHtml(username)}:</span> ${escapeHtml(message)}`;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function appendSystemMessage(msg) {
  const box = document.getElementById('chat-messages');
  const p = document.createElement('p');
  p.className = 'system';
  p.textContent = msg;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Lista de jogadores ----------
function updatePlayerList(players) {
  const list = document.getElementById('player-list-items');
  list.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p.username;
    list.appendChild(li);
  });
}

// ---------- Admin ----------
function adminCommand(command) {
  const target = document.getElementById('admin-target').value.trim();
  const value = document.getElementById('admin-amount')?.value;
  if (!target) return;
  socket.emit('admin:command', { command, target, value });
}
