const API_BASE_URL = (window.PONTO_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'ponto-digital-token';

const authScreen = document.querySelector('#auth-screen');
const dashboard = document.querySelector('#dashboard');
const loginForm = document.querySelector('#login-form');
const registerForm = document.querySelector('#register-form');
const loginMessage = document.querySelector('#login-message');
const registerMessage = document.querySelector('#register-message');
const punchMessage = document.querySelector('#punch-message');
const toast = document.querySelector('#toast');
let currentRecords = [];

function normalizeId(value) {
  return value.trim().toLowerCase();
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api${path}`, { ...options, headers });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Verifique se a API está em execução.');
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) logout();
    throw new Error(result.error || 'O servidor não conseguiu concluir a operação.');
  }
  return result;
}

function setAuthView(view) {
  const isRegister = view === 'register';
  loginForm.classList.toggle('hidden', isRegister);
  registerForm.classList.toggle('hidden', !isRegister);
  document.querySelector('#login-switch').classList.toggle('hidden', isRegister);
  document.querySelector('#register-switch').classList.toggle('hidden', !isRegister);
  document.querySelector('#auth-eyebrow').textContent = isRegister ? 'COMECE POR AQUI' : 'BEM-VINDO DE VOLTA';
  document.querySelector('#auth-title').textContent = isRegister ? 'Crie sua conta' : 'Acesse sua conta';
  document.querySelector('#auth-description').textContent = isRegister
    ? 'Preencha seus dados para começar a registrar sua jornada.'
    : 'Entre com seu ID de usuário e senha para continuar.';
  loginMessage.textContent = '';
  registerMessage.textContent = '';
}

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => setAuthView(button.dataset.view));
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  registerMessage.textContent = '';
  const formData = new FormData(registerForm);
  const name = String(formData.get('name')).trim();
  const userId = normalizeId(String(formData.get('userId')));
  const password = String(formData.get('password'));

  if (!/^[a-z0-9._-]{3,30}$/.test(userId)) {
    registerMessage.textContent = 'O ID deve ter de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.';
    return;
  }
  if (password.length < 8) {
    registerMessage.textContent = 'A senha precisa ter pelo menos 8 caracteres.';
    return;
  }

  const submitButton = registerForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const result = await apiRequest('/register', {
      method: 'POST',
      body: JSON.stringify({ name, userId, password }),
    });
    sessionStorage.setItem(TOKEN_KEY, result.token);
    registerForm.reset();
    showDashboard(result.user, result.records);
    showToast('Conta criada com sucesso!');
  } catch (error) {
    registerMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginMessage.textContent = '';
  const formData = new FormData(loginForm);
  const userId = normalizeId(String(formData.get('userId')));
  const password = String(formData.get('password'));
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const result = await apiRequest('/login', {
      method: 'POST',
      body: JSON.stringify({ userId, password }),
    });
    sessionStorage.setItem(TOKEN_KEY, result.token);
    loginForm.reset();
    showDashboard(result.user, result.records);
  } catch (error) {
    loginMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

function formatDate(date, options) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...options }).format(date);
}

function localDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function showDashboard(user, records) {
  currentRecords = Array.isArray(records) ? records : [];
  authScreen.classList.add('hidden');
  dashboard.classList.remove('hidden');
  document.querySelector('#user-name').textContent = user.name;
  document.querySelector('#user-id').textContent = `ID: ${user.id}`;
  document.querySelector('#user-avatar').textContent = user.name.trim().charAt(0).toLocaleUpperCase('pt-BR');
  document.querySelector('#welcome-name').textContent = user.name.trim().split(/\s+/)[0];
  renderDashboard();
}

function renderDashboard() {
  const records = currentRecords;
  const today = localDateKey(new Date());
  const todayRecords = records.filter(record => localDateKey(new Date(record.timestamp)) === today);
  const lastRecord = todayRecords[todayRecords.length - 1];
  const isWorking = lastRecord?.type === 'entrada';

  document.querySelector('#today-date').textContent = formatDate(new Date(), { weekday: 'short', day: 'numeric', month: 'long' });
  document.querySelector('#clock-date').textContent = formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.querySelector('#today-count').textContent = String(todayRecords.length);
  document.querySelector('#status-text').textContent = isWorking
    ? `Entrada registrada às ${formatDate(new Date(lastRecord.timestamp), { hour: '2-digit', minute: '2-digit' })}.`
    : lastRecord
      ? `Saída registrada às ${formatDate(new Date(lastRecord.timestamp), { hour: '2-digit', minute: '2-digit' })}.`
      : 'Você ainda não registrou uma entrada hoje.';
  document.querySelector('#status-dot').classList.toggle('is-working', isWorking);
  document.querySelector('#clock-in-button').disabled = isWorking;
  document.querySelector('#clock-out-button').disabled = !isWorking;
  document.querySelector('#history-count').textContent = `${records.length} ${records.length === 1 ? 'registro' : 'registros'}`;

  const body = document.querySelector('#history-body');
  body.replaceChildren();
  [...records].reverse().forEach(record => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    const timeCell = document.createElement('td');
    const typeCell = document.createElement('td');
    const timestamp = new Date(record.timestamp);
    dateCell.textContent = formatDate(timestamp, { day: '2-digit', month: 'long', year: 'numeric' });
    timeCell.textContent = formatDate(timestamp, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const badge = document.createElement('span');
    badge.className = `record-type${record.type === 'saída' ? ' exit' : ''}`;
    badge.textContent = record.type === 'entrada' ? 'Entrada' : 'Saída';
    typeCell.append(badge);
    row.append(dateCell, timeCell, typeCell);
    body.append(row);
  });
  document.querySelector('#empty-history').classList.toggle('hidden', records.length > 0);
}

async function registerPunch(type) {
  punchMessage.textContent = '';
  const button = document.querySelector(type === 'entrada' ? '#clock-in-button' : '#clock-out-button');
  button.disabled = true;
  try {
    const result = await apiRequest('/records', {
      method: 'POST',
      body: JSON.stringify({ type }),
    });
    currentRecords.push(result.record);
    renderDashboard();
    showToast(type === 'entrada' ? 'Entrada registrada com sucesso!' : 'Saída registrada com sucesso!');
  } catch (error) {
    punchMessage.textContent = error.message;
    renderDashboard();
  }
}

document.querySelector('#clock-in-button').addEventListener('click', () => registerPunch('entrada'));
document.querySelector('#clock-out-button').addEventListener('click', () => registerPunch('saída'));

function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  currentRecords = [];
  dashboard.classList.add('hidden');
  authScreen.classList.remove('hidden');
  setAuthView('login');
}

document.querySelector('#logout-button').addEventListener('click', logout);

let toastTimeout;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function updateClock() {
  document.querySelector('#live-clock').textContent = formatDate(new Date(), {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

async function restoreSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const result = await apiRequest('/me');
    showDashboard(result.user, result.records);
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    loginMessage.textContent = error.message;
  }
}

updateClock();
setInterval(updateClock, 1000);
restoreSession();
