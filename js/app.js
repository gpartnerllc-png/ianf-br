// ============================================================
// IANF v2 - Lógica da aplicação (SPA)
// ============================================================
import { initBackground } from './three-bg.js';
import './print.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let TOKEN = localStorage.getItem('ianf_token') || '';
let USER = null;
let PAGAMENTO = { url: null, posPackage: 'com.infinitepay.checkout', posScheme: 'infinitepay' };
let scanner = null;
window._itens = [];

// Hospedado no GitHub Pages (github.io / ianf.droppfy.com) a API fica no Worker;
// no workers.dev e em dev local o próprio Worker serve o frontend (caminho relativo).
const API_BASE = /workers\.dev|localhost|127\.0\.0\.1/.test(location.hostname)
  ? ''
  : 'https://ianf.contatodroppfy.workers.dev';

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API_BASE}/api${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({ ok: false, error: { message: 'Resposta inválida' } }));
  if (res.status === 401 && path !== '/auth/login' && data?.error?.code === 'UNAUTHORIZED') {
    sair();
    throw new Error('Sessão expirada');
  }
  if (!data.ok) {
    const erro = new Error(data.error?.message || data.message || 'Erro desconhecido');
    erro.code = data.error?.code || '';
    erro.status = res.status;
    erro.data = data;
    if (res.status === 402 && erro.code === 'ASSINATURA_PAUSADA') UI?.mostrarPausa?.(erro.message);
    throw erro;
  }
  return data;
}

window._log = (msg) => console.log('[IANF]', msg);

// ---------- Autenticação ----------
async function login(e) {
  e.preventDefault();
  const errEl = $('login-error');
  errEl.textContent = '';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('login-email').value, pass: $('login-pass').value }),
    });
    TOKEN = data.token;
    USER = data.user;
    localStorage.setItem('ianf_token', TOKEN);
    entrar();
  } catch (erro) {
    errEl.textContent = erro.message;
  }
}

async function registrar(e) {
  e.preventDefault();
  const errEl = $('reg-error');
  errEl.textContent = '';
  try {
    const data = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('reg-name').value,
        email: $('reg-email').value,
        doc: $('reg-doc').value,
        pass: $('reg-pass').value,
      }),
    });
    errEl.style.color = '#059669';
    errEl.textContent = data.message || 'Cadastro solicitado!';
    setTimeout(() => switchAuthTab('login'), 1800);
  } catch (erro) {
    errEl.textContent = erro.message;
  }
}

// Alterna entre as abas Entrar / Criar conta (só um formulário visível por vez)
function switchAuthTab(tab) {
  const login = tab === 'login';
  $('tab-login').classList.toggle('active', login);
  $('tab-register').classList.toggle('active', !login);
  $('tab-login').setAttribute('aria-selected', String(login));
  $('tab-register').setAttribute('aria-selected', String(!login));
  $('login-form').classList.toggle('hidden', !login);
  $('register-form').classList.toggle('hidden', login);
  if (!login) $('reg-error').textContent = '';
}

function sair() {
  TOKEN = '';
  USER = null;
  localStorage.removeItem('ianf_token');
  $('app').classList.add('hidden');
  $('auth-gate').classList.remove('hidden');
}

function togglePass(btn) {
  const input = $(btn.dataset.eye);
  if (!input) return;
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(mostrar));
  btn.setAttribute('aria-label', mostrar ? 'Ocultar a senha' : 'Mostrar a senha');
  btn.textContent = mostrar ? '🙈' : '👁';
  input.focus();
}

async function entrar() {
  $('auth-gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('user-chip').textContent = `${USER.name || USER.email} · ${USER.role === 'admin' ? 'ADMIN' : 'OPERADOR'}`;
  if (USER.role === 'admin') document.querySelectorAll('.admin-only').forEach((el) => el.classList.remove('hidden'));
  $('badge-network').textContent = 'NÚCLEO IANF ONLINE';
  await carregarTudo();
}

// ---------- Navegação ----------
function switchView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

async function carregarTudo() {
  await Promise.allSettled([carregarAssinatura(), carregarDre(), carregarNotas(), carregarStatus(), carregarInsight(), sdCarregar()]);
  if (USER?.role === 'admin') await Promise.allSettled([carregarAdmin()]);
}

async function carregarStatus() {
  try {
    const data = await api('/status');
    PAGAMENTO = data.pagamento || PAGAMENTO;
    const list = $('dash-integracoes');
    list.innerHTML = '';
    for (const integ of data.integracoes || []) {
      const cor = integ.status === 'online' ? 'tag-autorizada' : 'tag-processando';
      list.innerHTML += `
        <div class="item-row">
          <span>${integ.nome}</span>
          <span class="tag ${cor}">${integ.status}</span>
        </div>`;
    }
  } catch { /* offline */ }
}

// ---------- Dashboard ----------
async function carregarInsight() {
  try {
    const data = await api('/ia/insight');
    $('ai-insight').textContent = data.insight;
  } catch {
    $('ai-insight').textContent = 'IA indisponível no momento.';
  }
}

async function carregarDre() {
  const data = await api('/dre');
  const { dre, serie, porCategoria, totalLancamentos } = data;

  $('kpi-receita').textContent = fmt(dre.receita);
  $('kpi-despesa').textContent = fmt(dre.despesa);
  $('kpi-invest').textContent = fmt(dre.investimento);
  $('kpi-lucro').textContent = fmt(dre.lucroLiquido);
  $('kpi-margem').textContent = `Margem ${(dre.margem * 100).toFixed(1)}%`;
  $('kpi-receita-cnt').textContent = `${totalLancamentos} lançamentos`;
  $('dash-cbs').textContent = fmt(dre.impostosEstimados * (0.009 / 0.01));
  $('dash-ibs').textContent = fmt(dre.impostosEstimados * (0.001 / 0.01));
  $('dash-impostos').textContent = fmt(dre.impostosEstimados);
  $('dash-split').innerHTML = `
    <div class="split-chip">IBS ESTADO<b>${fmt(dre.impostosEstimados * 0.006)}</b></div>
    <div class="split-chip">IBS MUNICÍPIO<b>${fmt(dre.impostosEstimados * 0.004)}</b></div>
    <div class="split-chip">CBS UNIÃO<b>${fmt(dre.impostosEstimados * 0.09)}</b></div>`;

  desenharGrafico(serie);

  // Categorias
  const cats = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 1;
  $('categorias-list').innerHTML = cats.map(([nome, valor]) => `
    <div class="cat-row">
      <span style="min-width:110px">${nome}</span>
      <div class="cat-bar-wrap"><div class="cat-bar" style="width:${Math.max(4, (valor / max) * 100)}%"></div></div>
      <b>${fmt(valor)}</b>
    </div>`).join('') || '<p class="muted">Nenhum lançamento ainda.</p>';

  // Últimos lançamentos
  const l = await api('/lancamentos?limit=12');
  const tipos = { receita: ['tag-autorizada', '▲'], despesa: ['tag-cancelada', '▼'], investimento: ['tag-processando', '◆'] };
  $('tbl-lancamentos').innerHTML = l.lancamentos.map((x) => `
    <tr>
      <td>${new Date(x.created_at).toLocaleDateString('pt-BR')}</td>
      <td><span class="tag ${tipos[x.tipo]?.[0] || 'tag-rascunho'}">${x.tipo}</span></td>
      <td>${x.slot}</td>
      <td>${(x.descricao || '').slice(0, 40)}</td>
      <td class="right"><b>${fmt(x.valor)}</b></td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Sem lançamentos.</td></tr>';
}

function desenharGrafico(serie) {
  const canvas = $('chart-fluxo');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = 240;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 46, r: 14, t: 14, b: 28 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const max = Math.max(...serie.flatMap((d) => [d.receita, d.despesa]), 1);

  const x = (i) => pad.l + (i / (serie.length - 1)) * cw;
  const y = (v) => pad.t + ch - (v / max) * ch;

  // grade
  ctx.strokeStyle = 'rgba(15,23,42,0.08)';
  ctx.fillStyle = '#64748b';
  ctx.font = '9px Inter';
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const gy = pad.t + (ch * g) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, gy);
    ctx.lineTo(w - pad.r, gy);
    ctx.stroke();
    ctx.fillText(fmt(max * (1 - g / 4)), pad.l - 6, gy + 3);
  }
  // eixo x
  ctx.textAlign = 'center';
  const passos = new Set([0, Math.floor((serie.length - 1) / 3), Math.floor((2 * (serie.length - 1)) / 3), serie.length - 1]);
  for (const i of passos) {
    ctx.fillText(new Date(serie[i].data + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), x(i), h - 8);
  }

  // área receita
  const area = (key, cor1, cor2) => {
    ctx.beginPath();
    ctx.moveTo(x(0), y(serie[0][key]));
    serie.forEach((d, i) => ctx.lineTo(x(i), y(d[key])));
    ctx.lineTo(x(serie.length - 1), pad.t + ch);
    ctx.lineTo(x(0), pad.t + ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    grad.addColorStop(0, cor1);
    grad.addColorStop(1, cor2);
    ctx.fillStyle = grad;
    ctx.fill();
  };
  area('receita', 'rgba(139,92,246,0.35)', 'rgba(139,92,246,0.02)');
  area('despesa', 'rgba(255,107,0,0.28)', 'rgba(255,107,0,0.02)');

  // linhas
  const linha = (key, cor) => {
    ctx.beginPath();
    serie.forEach((d, i) => (i === 0 ? ctx.moveTo(x(i), y(d[key])) : ctx.lineTo(x(i), y(d[key]))));
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  linha('receita', '#7c3aed');
  linha('despesa', '#ea580c');

  // legenda
  ctx.fillStyle = '#7c3aed';
  ctx.fillRect(w - 170, 6, 10, 10);
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText('Receita', w - 154, 15);
  ctx.fillStyle = '#ea580c';
  ctx.fillRect(w - 92, 6, 10, 10);
  ctx.fillStyle = '#64748b';
  ctx.fillText('Despesa', w - 76, 15);
}

// ---------- Balancete (visão macro + comparativos D-1 / M-1 / Y-1) ----------
let balanceteCharts = [];
let balanceteDados = null;

function evolucaoTexto(atual, anterior) {
  if (!anterior) return atual > 0 ? '<span class="evol-up">▲ novo</span>' : '<span class="evol-flat">—</span>';
  if (!atual && !anterior) return '<span class="evol-flat">—</span>';
  const pct = ((atual - anterior) / (Math.abs(anterior) || 1)) * 100;
  const cls = pct > 0.5 ? 'evol-up' : pct < -0.5 ? 'evol-down' : 'evol-flat';
  const sinal = pct > 0.5 ? '▲' : pct < -0.5 ? '▼' : '•';
  return `<span class="${cls}">${sinal} ${Math.abs(pct).toFixed(1)}%</span>`;
}

async function abrirBalancete() {
  $('modal-balancete').classList.remove('hidden');
  const status = $('balancete-status');
  status.innerHTML = 'Consultando o núcleo de dados...';
  try {
    const data = await api('/dre/comparativo');
    balanceteDados = data;
    renderBalancete(data);
    status.innerHTML = `Balancete de <b>${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</b> · comparativos: D-1 (${data.labels.d1}) · M-1 (${data.labels.m1}) · Y-1 (${data.labels.y1}).`;
  } catch (erro) {
    status.innerHTML = `<span class="form-error">${erro.message}</span>`;
  }
}

function fecharBalancete() {
  $('modal-balancete').classList.add('hidden');
}

function renderBalancete(data) {
  balanceteCharts.forEach((c) => c.destroy());
  balanceteCharts = [];

  const hoje = data.hoje;
  const cores = { receita: '#059669', despesa: '#ef4444', investimento: '#3b82f6' };
  const totalSlot = (v) => v.receita + v.despesa + v.investimento;

  if (window.Chart) {
    Chart.defaults.color = '#64748b';
    Chart.defaults.font.family = 'Inter, sans-serif';

    balanceteCharts.push(new Chart($('chart-visao-macro'), {
      type: 'doughnut',
      data: {
        labels: ['Receita', 'Despesas', 'Investimentos'],
        datasets: [{
          data: [hoje.receita, hoje.despesa, hoje.investimento],
          backgroundColor: [cores.receita, cores.despesa, cores.investimento],
          borderWidth: 0,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
    }));

    const slots = Object.entries(data.porSlot).sort((a, b) => totalSlot(b[1].hoje) - totalSlot(a[1].hoje));
    balanceteCharts.push(new Chart($('chart-detalhamento'), {
      type: 'bar',
      data: {
        labels: slots.map(([n]) => n),
        datasets: [
          { label: 'Receita', data: slots.map(([, v]) => v.hoje.receita), backgroundColor: cores.receita },
          { label: 'Despesas', data: slots.map(([, v]) => v.hoje.despesa), backgroundColor: cores.despesa },
          { label: 'Investimento', data: slots.map(([, v]) => v.hoje.investimento), backgroundColor: cores.investimento },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true } },
      },
    }));
  }

  const rows = Object.entries(data.porSlot)
    .filter(([, v]) => ['hoje', 'd1', 'm1', 'y1'].some((k) => totalSlot(v[k]) > 0))
    .sort((a, b) => totalSlot(b[1].hoje) - totalSlot(a[1].hoje));
  $('tbl-balancete-slots').innerHTML = rows.map(([nome, v]) => `
    <tr>
      <td>${nome}</td>
      <td>${fmt(totalSlot(v.hoje))}</td>
      <td>${fmt(totalSlot(v.d1))}</td>
      <td>${fmt(totalSlot(v.m1))}</td>
      <td>${fmt(totalSlot(v.y1))}</td>
      <td class="right">${evolucaoTexto(totalSlot(v.hoje), totalSlot(v.d1))}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Sem lançamentos no período.</td></tr>';
}

function imprimirBalancete() {
  const data = balanceteDados;
  if (!data) return alert('Abra o balancete antes de imprimir.');
  const h = data.hoje;
  const c = data.comparativos;
  const lucro = (v) => v.receita - v.despesa - v.investimento;
  const totalSlot = (v) => v.receita + v.despesa + v.investimento;
  const linhaMetrica = (nome, fn) => `
    <tr>
      <td>${nome}</td>
      <td>${fmt(fn(h))}</td>
      <td>${fmt(fn(c.d1))} <span class="mini-evol">${evolucaoTexto(fn(c.d1), fn(h))}</span></td>
      <td>${fmt(fn(c.m1))} <span class="mini-evol">${evolucaoTexto(fn(c.m1), fn(c.d1))}</span></td>
      <td>${fmt(fn(c.y1))} <span class="mini-evol">${evolucaoTexto(fn(c.y1), fn(c.m1))}</span></td>
    </tr>`;
  const imgs = balanceteCharts.map((chart) => `<img src="${chart.toBase64Image()}" alt="gráfico" style="max-width:100%;height:auto;margin:12px 0;border:1px solid #e2e8f0">`).join('');
  const slotsRows = Object.entries(data.porSlot)
    .filter(([, v]) => ['hoje', 'd1', 'm1', 'y1'].some((k) => totalSlot(v[k]) > 0))
    .sort((a, b) => totalSlot(b[1].hoje) - totalSlot(a[1].hoje))
    .map(([nome, v]) => `
      <tr><td>${nome}</td><td class="r">${fmt(totalSlot(v.hoje))}</td><td class="r">${fmt(totalSlot(v.d1))}</td><td class="r">${fmt(totalSlot(v.m1))}</td><td class="r">${fmt(totalSlot(v.y1))}</td></tr>`)
    .join('');

  $('print-balancete').innerHTML = `
    <style>
      .balancete-print { font-family: 'Courier New', monospace; color: #000; font-size: 11px; max-width: 720px; margin: 0 auto; }
      .balancete-print h1 { font-size: 17px; margin: 0; }
      .balancete-print .head { display: flex; justify-content: space-between; border: 1.5px solid #000; padding: 8px; margin-bottom: 8px; }
      .balancete-print table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      .balancete-print td, .balancete-print th { border: 1px solid #000; padding: 4px 6px; text-align: left; }
      .balancete-print .r { text-align: right; }
      .balancete-print .total-row td { font-weight: bold; }
      .balancete-print .mini-evol { display: block; font-size: 9px; }
      .balancete-print .assinatura { margin-top: 34px; text-align: center; border-top: 1px solid #000; width: 220px; margin-left: auto; margin-right: auto; padding-top: 4px; }
    </style>
    <div class="balancete-print">
      <div class="head">
        <div>
          <h1>IANF - SISTEMA DE BALANÇOS</h1>
          <b>BALANCETE ANALÍTICO</b><br>
          Comparativo D-1 / M-1 / Y-1
        </div>
        <div style="text-align:right">
          <b>Emissão:</b> ${new Date().toLocaleString('pt-BR')}<br>
          <b>Operador:</b> ${(USER?.name || USER?.email || '—')}
        </div>
      </div>
      <table>
        <thead><tr><th>Métrica</th><th>Hoje</th><th>D-1 (${data.labels.d1})</th><th>M-1 (${data.labels.m1})</th><th>Y-1 (${data.labels.y1})</th></tr></thead>
        <tbody>
          ${linhaMetrica('Receita Bruta', (v) => v.receita)}
          ${linhaMetrica('Despesas Totais', (v) => v.despesa)}
          ${linhaMetrica('Investimentos', (v) => v.investimento)}
          <tr class="total-row"><td>Lucro Líquido</td><td>${fmt(lucro(h))}</td><td>${fmt(lucro(c.d1))}</td><td>${fmt(lucro(c.m1))}</td><td>${fmt(lucro(c.y1))}</td></tr>
        </tbody>
      </table>
      ${imgs}
      <table>
        <thead><tr><th>Detalhamento por Categoria</th><th class="r">Hoje</th><th class="r">D-1</th><th class="r">M-1</th><th class="r">Y-1</th></tr></thead>
        <tbody>${slotsRows || '<tr><td colspan="5">Sem lançamentos no período.</td></tr>'}</tbody>
      </table>
      <p>Reforma Tributária 2026 · CBS + IBS · Documento de controle interno sem valor fiscal.</p>
      <div class="assinatura">Assinatura do responsável</div>
    </div>`;
  window.print();
}

// ---------- Emissor ----------
let regimeCache = null;

async function calcFiscal() {
  const valor = parseFloat($('valorInput').value) || 0;
  try {
    const data = await api('/fiscal/calcular', {
      method: 'POST',
      body: JSON.stringify({ valor, regime: $('regimeSelect').value }),
    });
    regimeCache = data.fiscal;
    $('cbsVal').textContent = fmt(data.fiscal.cbs.valor);
    $('ibsVal').textContent = fmt(data.fiscal.ibs.valor);
    $('liqVal').textContent = fmt(data.fiscal.valorBruto);
  } catch {
    const v = valor;
    $('cbsVal').textContent = fmt(v * 0.009);
    $('ibsVal').textContent = fmt(v * 0.001);
    $('liqVal').textContent = fmt(v);
  }
}

function liberarNome(input) {
  const doc = input.value.replace(/\D/g, '');
  const nomeInput = $('nomeInput');
  if (doc.length === 11 || doc.length === 14) {
    nomeInput.removeAttribute('readonly');
    nomeInput.classList.remove('hidden');
    if (doc.length === 14) consultarCnpj(doc, nomeInput);
  }
}

function validarNome(el) {
  if (el.value.trim() && el.value.trim().split(/\s+/).length < 2) {
    alert('NOME COMPLETO REQUERIDO.');
    el.focus();
  }
}

function adicionarProduto() {
  const descricao = $('prodDesc').value.trim();
  const preco = parseFloat($('prodPreco').value) || 0;
  if (!descricao || preco <= 0) return alert('Informe descrição e preço do produto.');
  window._itens.push({ descricao, preco });
  $('prodDesc').value = '';
  $('prodPreco').value = '';
  renderItens();
  const total = window._itens.reduce((s, i) => s + i.preco, 0);
  $('valorInput').value = total.toFixed(2);
  calcFiscal();
}

function renderItens() {
  $('itens-lista').innerHTML = window._itens.map((i, idx) => `
    <div class="item-row">
      <span>${i.descricao.slice(0, 40)}</span>
      <b>${fmt(i.preco)}</b>
      <button class="icon-btn danger" onclick="window._itens.splice(${idx},1);UI.renderItens()">✕</button>
    </div>`).join('');
}

async function emitirNota() {
  const valor = parseFloat($('valorInput').value) || 0;
  const slot = $('slotDestino').value;
  if (valor <= 0) return alert('ERRO: Valor não definido.');

  const botaoEmitir = document.querySelector('#view-emissor .btn-gradient');
  if (botaoEmitir) botaoEmitir.textContent = 'IA PROCESSANDO...';

  try {
    const payload = {
      tipo: 'nfse',
      valor,
      doc_cliente: $('docInput').value,
      nome_cliente: $('nomeInput').value || 'Cliente',
      email_cliente: $('emailInput').value,
      telefone_cliente: $('telInput').value,
      endereco_cliente: dadosEnderecoEmissor(),
      descricao: $('descInput').value || 'Serviços prestados',
      regime: $('regimeSelect').value,
      itens: window._itens,
    };
    const nota = await api('/notas', { method: 'POST', body: JSON.stringify(payload) });

    const tipo = slot.startsWith('receita') ? 'receita' : 'despesa';
    await api('/lancamentos', {
      method: 'POST',
      body: JSON.stringify({ tipo, slot, valor, descricao: payload.descricao, doc_cliente: payload.doc_cliente, nome_cliente: payload.nome_cliente }),
    });

    const spedyMsg = nota.spedy?.ok ? 'Nota aceita pela Spedy (em processamento na prefeitura).' : nota.spedy?.message || '';
    alert(`✅ NOTA #${nota.nota.id} EMITIDA!\nCBS: ${fmt(nota.fiscal.cbs.valor)} | IBS: ${fmt(nota.fiscal.ibs.valor)}\n${spedyMsg}`);
    await carregarDre();
    await carregarNotas();
  } catch (erro) {
    alert('❌ ' + erro.message);
  } finally {
    if (botaoEmitir) botaoEmitir.textContent = '🚀 Emitir Nota (IA + Spedy)';
  }
}

async function pagarMaquininha() {
  const valor = parseFloat($('valorInput').value) || 0;
  if (valor <= 0) return alert('Informe o valor.');
  const cents = Math.round(valor * 100);
  if (PAGAMENTO.url) {
    window.open(`${PAGAMENTO.url}?amount=${cents}`, '_blank');
  }
  const intent = `intent://pay?amount=${cents}&currency=BRL#Intent;scheme=${PAGAMENTO.posScheme};package=${PAGAMENTO.posPackage};S.browser_fallback_url=${encodeURIComponent(PAGAMENTO.url || window.location.href)};end`;
  window.location.href = intent;
}

// ---------- Assinatura (franquia mensal) ----------
async function carregarAssinatura() {
  const tag = $('ass-status-tag');
  const detalhes = $('ass-detalhes');
  if (!tag || !detalhes) return;
  try {
    const data = await api('/assinatura');
    const ass = data.assinatura;

    // Acompanhamento em tempo real enquanto houver link aberto sem pagamento confirmado
    if (data.motivo === 'ativa') {
      pararPollingPagamento();
    } else if (data.motivo === 'aguardando_pagamento' || (data.motivo === 'atrasada' && ass?.checkout_url)) {
      iniciarPollingPagamento();
    }

    if (data.motivo === 'admin') {
      tag.className = 'tag tag-autorizada';
      tag.textContent = '✓ ADMIN VITALÍCIO';
      detalhes.innerHTML = '<p class="muted">Conta administradora — isenta de mensalidade.</p>';
      return;
    }

    const mapa = {
      ativa: ['tag-autorizada', '✓ ATIVA'],
      aguardando_pagamento: ['tag-processando', '⏳ AGUARDANDO PAGAMENTO'],
      atrasada: ['tag-cancelada', '⚠ ATRASADA · SISTEMA PAUSADO'],
      sem_assinatura: ['tag-rascunho', 'SEM ASSINATURA'],
      cancelada: ['tag-cancelada', 'CANCELADA'],
    };
    const [cls, txt] = mapa[data.motivo] || ['tag-rascunho', data.motivo];
    tag.className = 'tag ' + cls;
    tag.textContent = txt;

    detalhes.innerHTML = `
      <div class="form-grid">
        <div class="form-col">
          <label class="field-label">WhatsApp para avisos (5 dias antes e no dia do vencimento)</label>
          <div class="search-row">
            <input class="field" id="ass-whatsapp" placeholder="(00) 00000-0000" value="${data.whatsapp || ''}">
            <button class="btn btn-outline" onclick="UI.salvarWhatsapp()">Salvar</button>
          </div>
        </div>
      </div>
      <div class="kv mt-3"><span>Plano</span><b>Franquia mensal · ${fmt(data.valor)}</b></div>
      ${ass?.data_vencimento ? `<div class="kv"><span>Vencimento</span><b>${new Date(ass.data_vencimento).toLocaleDateString('pt-BR')}</b></div>` : ''}
      ${ass?.ultimo_pagamento ? `<div class="kv"><span>Último pagamento</span><b>${new Date(ass.ultimo_pagamento).toLocaleString('pt-BR')}</b></div>` : ''}
      <div class="btn-row mt-4">
        <button class="btn btn-gradient" onclick="UI.assinar()">${data.motivo === 'ativa' ? '💳 Renovar agora' : '💳 Assinar por ' + fmt(data.valor)}</button>
        <button class="btn btn-outline" onclick="UI.imprimirRecibo()">🖨️ Imprimir recibo</button>
      </div>
      ${data.motivo === 'aguardando_pagamento' || data.motivo === 'atrasada'
        ? '<p class="muted small mt-3">🔎 Acompanhando o pagamento em tempo real junto à InfinitePay. A liberação é automática assim que a cobrança for confirmada — sem confirmação manual.</p>'
        : '<p class="muted small mt-3">Cobrança mensal automática via PIX ou cartão de crédito (Infinitepay). Sem pagamento, o sistema é pausado e reativado assim que a mensalidade cair.</p>'}`;
  } catch (erro) {
    tag.className = 'tag tag-rascunho';
    tag.textContent = 'indisponível';
    detalhes.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

async function assinar() {
  try {
    const data = await api('/assinatura', { method: 'POST' });
    window.open(data.checkout_url, '_blank', 'noopener');
    iniciarPollingPagamento();
    carregarAssinatura();
  } catch (erro) { alert('❌ ' + erro.message); }
}

// Acompanhamento em tempo real: pergunta à InfinitePay (via API) se o pagamento foi executado
let pollAssinatura = null;
let pollTentativas = 0;

function iniciarPollingPagamento() {
  if (pollAssinatura) return;
  pollTentativas = 0;
  pollAssinatura = setInterval(async () => {
    pollTentativas++;
    if (pollTentativas > 60) return pararPollingPagamento(); // 10 min sem confirmação
    try {
      const data = await api('/assinatura');
      if (data.ativa) {
        pararPollingPagamento();
        fecharPausa();
        carregarAssinatura();
        alert('✅ Pagamento CONFIRMADO pela InfinitePay! Sistema liberado.');
      }
    } catch { /* mantém acompanhando */ }
  }, 10000);
}

function pararPollingPagamento() {
  clearInterval(pollAssinatura);
  pollAssinatura = null;
}

async function salvarWhatsapp() {
  try {
    await api('/assinatura/whatsapp', { method: 'PUT', body: JSON.stringify({ whatsapp: $('ass-whatsapp').value }) });
    alert('✅ WhatsApp salvo! Você receberá avisos 5 dias antes e no dia do vencimento.');
  } catch (erro) { alert('❌ ' + erro.message); }
}

async function imprimirRecibo() {
  try {
    const res = await fetch(`${API_BASE}/api/assinatura/recibo`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error?.message || 'Recibo indisponível.');
    }
    $('print-recibo').innerHTML = await res.text();
    window.print();
  } catch (erro) { alert('❌ ' + erro.message); }
}

function mostrarPausa(msg) {
  if (msg) $('pausa-msg').textContent = msg;
  $('pausa-overlay').classList.remove('hidden');
}

function fecharPausa() {
  $('pausa-overlay').classList.add('hidden');
}

// ---------- Scanner QR ----------
async function toggleScanner() {
  const reader = $('reader');
  const btn = $('btnScanner');
  if (!scanner) {
    if (!window.Html5Qrcode) return alert('Biblioteca de scanner não carregada.');
    scanner = new Html5Qrcode('reader');
  }
  if (reader.classList.contains('hidden')) {
    reader.classList.remove('hidden');
    btn.textContent = 'FECHAR CÂMERA (X)';
    await scanner.start({ facingMode: 'environment' }, { fps: 15, qrbox: 250 }, (txt) => {
      const valor = parseFloat(txt.replace(',', '.')) || (Math.floor(Math.random() * 50) + 10);
      window._itens.push({ descricao: `Item bipado: ${txt}`, preco: valor });
      renderItens();
      const total = window._itens.reduce((s, i) => s + i.preco, 0);
      $('valorInput').value = total.toFixed(2);
      calcFiscal();
    }).catch(() => {});
  } else {
    await scanner.stop().catch(() => {});
    reader.classList.add('hidden');
    btn.textContent = '📷 Bipar Nota Fiscal';
  }
}

// ---------- Notas ----------
async function carregarNotas() {
  const data = await api('/notas');
  const statusTag = { rascunho: 'tag-rascunho', em_processamento: 'tag-processando', autorizada: 'tag-autorizada', cancelada: 'tag-cancelada', recebida: 'tag-recebida' };
  const tipoTag = { nfse: 'tag-nfse', nfe: 'tag-nfe', nfce: 'tag-nfce', entrada: 'tag-entrada' };
  $('tbl-notas').innerHTML = data.notas.map((n) => `
    <tr>
      <td>#${n.id}</td>
      <td><span class="tag ${tipoTag[n.tipo] || 'tag-rascunho'}">${n.tipo}</span></td>
      <td>${n.cliente_nome || '—'}</td>
      <td><b>${fmt(n.valor)}</b></td>
      <td><span class="tag ${statusTag[n.status] || 'tag-rascunho'}">${n.status}</span></td>
      <td>${new Date(n.created_at).toLocaleString('pt-BR')}</td>
      <td class="right">
        ${n.provider === 'spedy' ? `<button class="icon-btn" onclick="UI.consultarNota(${n.id})">SEFAZ</button>` : ''}
        <button class="icon-btn" onclick="UI.imprimirNota(${n.id})">IMPRIMIR</button>
        <button class="icon-btn danger" onclick="UI.cancelarNota(${n.id})">CANCELAR</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma nota emitida ainda.</td></tr>';
}

async function consultarNota(id) {
  try {
    const data = await api(`/notas/${id}/consultar`, { method: 'POST' });
    alert(`Consulta SEFAZ: ${data.data?.status || JSON.stringify(data.data)}`);
    carregarNotas();
  } catch (erro) { alert('❌ ' + erro.message); }
}

async function cancelarNota(id) {
  if (!confirm('Cancelar esta nota?')) return;
  try {
    await api(`/notas/${id}`, { method: 'DELETE' });
    carregarNotas();
  } catch (erro) { alert('❌ ' + erro.message); }
}

function imprimirNota(id) {
  api(`/notas/${id}`).then(({ nota }) => {
    $('valorInput').value = nota.valor;
    $('nomeInput').value = nota.cliente_nome || '';
    $('docInput').value = nota.cliente_doc || '';
    try {
      const extra = JSON.parse(nota.extra || '{}');
      $('descInput').value = extra.descricao || '';
      const end = extra.endereco_cliente || {};
      $('endInput').value = end.endereco || '';
      $('numInput').value = end.numero || '';
      $('bairroInput').value = end.bairro || '';
      $('cidadeInput').value = end.cidade || '';
      $('ufInput').value = end.uf || '';
      $('paisInput').value = end.pais || 'Brasil';
      $('telInput').value = extra.telefone_cliente || '';
    } catch { /* */ }
    Print.danfeA4();
  }).catch((e) => alert(e.message));
}

async function sincronizarEntradas() {
  try {
    const data = await api('/notas/sincronizar-entradas', { method: 'POST' });
    alert('✅ ' + (data.message || 'Sincronização solicitada.'));
    carregarNotas();
  } catch (erro) { alert('❌ ' + erro.message); }
}

// ---------- Consultas ----------
// Consulta CNPJ: chamada manual (aba Consultas) ou automática (emissor, preenche nome + endereço)
async function consultarCnpj(docArg, inputEl) {
  const doc = (docArg || $('cnpjInput')?.value || '').replace(/\D/g, '');
  if (doc.length !== 14) {
    if (!docArg) return alert('CNPJ incompleto.');
    return;
  }
  const el = $('cnpj-result');
  if (!inputEl && el) el.innerHTML = '<p class="muted">Consultando a Receita Federal / Redesim...</p>';
  try {
    const data = await api(`/integracao/cnpj?cnpj=${doc}`);
    const c = data.cnpj;
    if (inputEl) {
      inputEl.value = c.razao_social || '';
      preencherEnderecoEmissor(c);
      return;
    }
    el.innerHTML = `
      <h4>${c.razao_social || '—'}</h4>
      <p class="muted">${c.nome_fantasia ? c.nome_fantasia + ' · ' : ''}${c.fonte || ''}</p>
      <div class="kv"><span>Situação</span><b>${c.situacao_cadastral || '—'}</b></div>
      <div class="kv"><span>Data situação</span><b>${c.data_situacao || '—'}</b></div>
      <div class="kv"><span>CNAE principal</span><b>${c.cnae_principal || '—'}</b></div>
      <div class="kv"><span>Município</span><b>${c.municipio || '—'} / ${c.uf || '—'}</b></div>
      <div class="kv"><span>Porte</span><b>${c.porte || '—'}</b></div>
      <div class="kv"><span>Capital social</span><b>${c.capital_social ? fmt(c.capital_social) : '—'}</b></div>
      ${(c.socios || []).length ? `<div class="kv"><span>Sócios</span><b>${c.socios.length} registrado(s)</b></div>` : ''}`;
  } catch (erro) {
    if (!inputEl && el) el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

// Preenche os campos de endereço do Emissor com os dados cadastrais do CNPJ
function preencherEnderecoEmissor(c) {
  const set = (id, valor) => {
    const campo = $(id);
    if (campo && valor && !campo.value.trim()) campo.value = valor;
  };
  set('endInput', c.logradouro);
  set('numInput', c.numero);
  set('bairroInput', c.bairro);
  set('cidadeInput', c.municipio);
  set('ufInput', c.uf);
  set('paisInput', 'Brasil');
  if (c.telefone && c.telefone !== '00000000') set('telInput', c.telefone);
  set('emailInput', c.email);
}

function dadosEnderecoEmissor() {
  return {
    endereco: $('endInput')?.value || '',
    numero: $('numInput')?.value || '',
    bairro: $('bairroInput')?.value || '',
    cidade: $('cidadeInput')?.value || '',
    uf: $('ufInput')?.value || '',
    pais: $('paisInput')?.value || 'Brasil',
  };
}

async function consultarCpf() {
  const doc = $('cpfInput').value.replace(/\D/g, '');
  if (doc.length !== 11) return alert('CPF incompleto.');
  const el = $('cpf-result');
  el.innerHTML = '<p class="muted">Consultando a base da Receita...</p>';
  try {
    const data = await api(`/integracao/cpf?cpf=${doc}`);
    const c = data.cpf;
    el.innerHTML = `
      <h4>Consulta concluída</h4>
      <div class="kv"><span>CPF</span><b>${c.cpf || doc}</b></div>
      <div class="kv"><span>Fonte</span><b>${data.fonte}</b></div>
      <div class="kv"><span>Validação</span><b>Estrutura válida ✓</b></div>`;
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

async function consultarCep() {
  const cep = $('cepInput').value.replace(/\D/g, '');
  if (cep.length !== 8) return alert('CEP incompleto.');
  const el = $('cep-result');
  el.innerHTML = '<p class="muted">Buscando endereço...</p>';
  try {
    const data = await api(`/integracao/cep?cep=${cep}`);
    const c = data.cep;
    el.innerHTML = `
      <h4>${c.street || ''}${c.number ? ', ' + c.number : ''}</h4>
      <div class="kv"><span>Bairro</span><b>${c.neighborhood || '—'}</b></div>
      <div class="kv"><span>Cidade</span><b>${c.city || '—'}</b></div>
      <div class="kv"><span>UF</span><b>${c.state || '—'}</b></div>`;
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

// ---------- PGFN / Dívida Ativa (Regularize) ----------
async function consultarPgfn() {
  const ni = ($('pgfnInput')?.value || '').replace(/\D/g, '');
  if (ni.length !== 11 && ni.length !== 14) return alert('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
  const el = $('fiscal-panel');
  el.innerHTML = '<p class="muted">Consultando a Dívida Ativa da União (PGFN)...</p>';
  try {
    const data = await api(`/integracao/pgfn?acao=dividas&ni=${ni}`);
    const tags = {
      com_debitos: ['tag-cancelada', '⚠ Com débitos'],
      regular: ['tag-autorizada', '✓ Regular'],
      sem_registros: ['tag-rascunho', 'Sem registros'],
    };
    const [tagCls, tagTxt] = tags[data.situacao] || ['tag-rascunho', data.situacao];
    const rows = (data.inscricoes || []).map((i) => `
      <div class="kv"><span>${i.origem || 'Inscrição ' + i.numero}${i.numero ? ' · ' + i.numero : ''}</span><b>${i.situacao || '—'} — ${fmt(i.valor)}</b></div>`).join('');
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <h4>Dívida Ativa da União</h4>
        <span class="tag ${tagCls}">${tagTxt}</span>
      </div>
      <p class="muted small">${data.fonte || ''}</p>
      <div class="kv"><span>Total consolidado</span><b>${fmt(data.totalConsolidado)}</b></div>
      ${rows || '<p class="muted small">Nenhuma inscrição retornada.</p>'}
      <p class="muted small mt-3">Regularize: emita DARF/DAS/DAE, parcele ou negocie com desconto (transação tributária) no portal oficial.</p>`;
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

function abrirPgfn() {
  window.open('https://www.regularize.pgfn.gov.br/', '_blank', 'noopener');
}

async function pgfnLinks() {
  const box = $('pgfn-links');
  if (!box.classList.contains('hidden')) {
    box.classList.add('hidden');
    return;
  }
  try {
    const data = await api('/integracao/pgfn?acao=links');
    box.innerHTML = (data.servicos || []).map((s) => `
      <div class="item-row">
        <span>${s.nome}<br><span class="muted small">${s.descricao}</span></span>
        <a href="${s.url}" target="_blank" rel="noopener" class="icon-btn">Abrir ↗</a>
      </div>`).join('');
  } catch {
    box.innerHTML = '<p class="form-error">Serviços indisponíveis no momento.</p>';
  }
  box.classList.remove('hidden');
}

// ---------- Certificados (ZapSign) ----------
async function carregarSaldoZapsign() {
  try {
    const data = await api('/integracao/zapsign?acao=saldo');
    $('zapsign-saldo').textContent = `Créditos disponíveis: ${data.data?.credits ?? data.data?.balance ?? 'consultar portal'}`;
  } catch (erro) {
    $('zapsign-saldo').textContent = erro.message;
  }
}

function toggleCertForm() {
  const isPj = $('certTipo').value === 'e_cnpj';
  $('cert-campos-pf').classList.toggle('hidden', isPj);
  $('cert-campos-pj').classList.toggle('hidden', !isPj);
}

async function criarCertificado(e) {
  e.preventDefault();
  const el = $('cert-result');
  el.textContent = '';
  el.style.color = '';
  const tipo = $('certTipo').value;
  const endereco = {
    cep: $('certCep').value, rua: $('certRua').value, numero: $('certNumero').value,
    bairro: $('certBairro').value, cidade: $('certCidade').value, uf: $('certUf').value,
  };
  try {
    const body = tipo === 'e_cpf'
      ? { tipo, cpf: $('certCpf').value, nascimento: $('certNasc').value, email: $('certEmail').value, telefone: $('certTel').value, endereco }
      : {
          tipo, cnpj: $('certCnpj').value,
          representante: {
            cpf: $('certRepCpf').value, nascimento: $('certRepNasc').value,
            email: $('certRepEmail').value, telefone: $('certRepTel').value, endereco,
          },
        };
    const data = await api('/integracao/zapsign/protocolo', { method: 'POST', body: JSON.stringify(body) });
    el.style.color = '#059669';
    el.textContent = `✅ Protocolo criado: ${data.data?.id || 'sucesso'}. O titular será contatado para a videoconferência.`;
    carregarProtocolos();
  } catch (erro) {
    el.textContent = '❌ ' + erro.message;
  }
}

async function carregarProtocolos() {
  const el = $('zapsign-protocolos');
  el.innerHTML = '<p class="muted">Carregando...</p>';
  try {
    const data = await api('/integracao/zapsign?acao=protocolos');
    const itens = data.data?.protocols || data.data?.items || data.data || [];
    const lista = Array.isArray(itens) ? itens : [];
    el.innerHTML = lista.length
      ? lista.slice(0, 15).map((p) => `
          <div class="protocolo-row">
            <div><b>${p.id || p.protocol_id || '—'}</b><br><span class="muted small">${p.certificate_type || p.type || ''}</span></div>
            <span class="tag tag-processando">${p.status || p.stage || 'em andamento'}</span>
          </div>`).join('')
      : '<p class="muted">Nenhum protocolo encontrado.</p>';
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

// ---------- IA ----------
let chatHistorico = [];

async function enviarChat() {
  const input = $('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  const log = $('chat-log');
  log.innerHTML += `<div class="msg user">${msg}</div>`;
  log.innerHTML += `<div class="msg ai"><span class="muted">Pensando...</span></div>`;
  log.scrollTop = log.scrollHeight;

  try {
    const data = await api('/ia/chat', {
      method: 'POST',
      body: JSON.stringify({ mensagem: msg, historico: chatHistorico }),
    });
    chatHistorico.push({ role: 'user', content: msg }, { role: 'assistant', content: data.resposta });
    log.lastElementChild.textContent = data.resposta;
    log.scrollTop = log.scrollHeight;
  } catch (erro) {
    log.lastElementChild.textContent = '❌ ' + erro.message;
  }
}

async function analisarNotaIA() {
  const texto = $('ia-nota-texto').value.trim();
  if (!texto) return alert('Cole o conteúdo da nota.');
  const el = $('ia-nota-result');
  el.innerHTML = '<p class="muted">IA analisando o documento fiscal...</p>';
  try {
    const data = await api('/ia/analisar-nota', { method: 'POST', body: JSON.stringify({ texto }) });
    const d = data.dados || {};
    el.innerHTML = `
      <h4>Análise concluída</h4>
      <div class="kv"><span>Emitente</span><b>${d.emitente || '—'}</b></div>
      <div class="kv"><span>Destinatário</span><b>${d.destinatario || '—'}</b></div>
      <div class="kv"><span>Valor total</span><b>${d.valor_total || '—'}</b></div>
      <div class="kv"><span>CBS</span><b>${d.cbs || '—'}</b></div>
      <div class="kv"><span>IBS</span><b>${d.ibs || '—'}</b></div>
      <div class="kv"><span>Chave</span><b>${d.chave || '—'}</b></div>`;
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

// ---------- Admin ----------
async function carregarAdmin() {
  const [users, audit, met] = await Promise.all([
    api('/admin/users'),
    api('/admin/auditoria?limit=80'),
    api('/admin/metricas'),
  ]);
  $('adm-users').textContent = met.usuarios;
  $('adm-receita').textContent = fmt(met.receitaTotal);
  $('adm-notas').textContent = met.notas;
  $('adm-eventos').textContent = met.eventosHoje;

  const statusTag = { active: 'tag-autorizada', pending: 'tag-processando', blocked: 'tag-cancelada' };
  $('tbl-users').innerHTML = users.users.map((u) => `
    <tr>
      <td>${u.email}</td>
      <td>${u.name || '—'}</td>
      <td><span class="tag ${u.role === 'admin' ? 'tag-nfse' : 'tag-rascunho'}">${u.role}</span></td>
      <td><span class="tag ${statusTag[u.status]}">${u.status}</span></td>
      <td class="right">
        ${u.role !== 'admin' && u.status !== 'active' ? `<button class="icon-btn" onclick="UI.alterarUser(${u.id},'active')">LIBERAR</button>` : ''}
        ${u.role !== 'admin' && u.status === 'active' ? `<button class="icon-btn danger" onclick="UI.alterarUser(${u.id},'blocked')">BLOQUEAR</button>` : ''}
        ${u.role !== 'admin' ? `<button class="icon-btn danger" onclick="UI.removerUser(${u.id})">REMOVER</button>` : ''}
      </td>
    </tr>`).join('');

  $('audit-list').innerHTML = audit.eventos.map((a) => `
    <div class="audit-row">
      <b>${a.acao}</b> ${a.detalhe || ''}<br>
      <span class="t">${a.email || 'sistema'} · ${new Date(a.created_at).toLocaleString('pt-BR')} · ${a.ip}</span>
    </div>`).join('') || '<p class="muted">Sem eventos.</p>';
}

async function alterarUser(id, status) {
  try {
    await api(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    carregarAdmin();
  } catch (erro) { alert('❌ ' + erro.message); }
}

async function removerUser(id) {
  if (!confirm('Remover permanentemente este usuário?')) return;
  try {
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    carregarAdmin();
  } catch (erro) { alert('❌ ' + erro.message); }
}

// ---------- Serasa Experian (Verify PF/PJ) ----------
async function consultarSerasa() {
  const tipo = $('serasaTipo')?.value || 'pf';
  const doc = ($('serasaDoc')?.value || '').replace(/\D/g, '');
  if (tipo === 'pf' && doc.length !== 11) return alert('CPF incompleto.');
  if (tipo === 'pj' && doc.length !== 14) return alert('CNPJ incompleto.');
  const el = $('serasa-result');
  el.innerHTML = '<p class="muted">Consultando a Serasa Experian...</p>';
  try {
    const body = { document: doc };
    const nome = ($('serasaNome')?.value || '').trim();
    if (tipo === 'pf') body.name = nome;
    else body.companyName = nome;
    const data = await api(`/integracao/serasa?acao=${tipo}`, { method: 'POST', body: JSON.stringify(body) });
    const v = data.verificacao || {};
    const grupos = (v.validationGroups || []).map((g) => `
      <div class="kv"><span>${g.code} — ${g.message}</span><b>${g.rating ?? '—'}</b></div>
      ${(g.details || []).map((d) => `<div class="kv indent"><span>${d.type}: ${d.value}</span><b>${d.code} ${d.message}</b></div>`).join('')}`).join('');
    const score = Number(v.verificationScore);
    const cor = score >= 700 ? '#059669' : score >= 400 ? '#d97706' : '#b91c1c';
    el.innerHTML = `
      <h4>Verificação ${tipo === 'pf' ? 'de CPF' : 'de CNPJ'}</h4>
      <p class="muted small">${data.fonte || ''}</p>
      <div style="display:flex;gap:10px;margin:10px 0">
        <div class="kv" style="flex:1"><span>Score</span><b style="color:${cor}">${v.verificationScore ?? '—'}</b></div>
        <div class="kv" style="flex:1"><span>Risco</span><b>${v.verificationRisk || '—'}</b></div>
      </div>
      ${grupos || '<p class="muted small">Nenhum grupo de validação retornado.</p>'}`;
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

// ---------- Serasa Experian · consultas completas (bureau) ----------
const SOA_SERVICOS = [
  { v: 'basica-pf', t: 'Consulta cadastral básica · CPF', doc: 11, custo: 5.40 },
  { v: 'basica-pj', t: 'Consulta cadastral básica · CNPJ', doc: 14, custo: 5.40 },
  { v: 'crednet-pf', t: 'CredNet — score e negativas · CPF', doc: 11, custo: 16.06, uf: true },
  { v: 'crednet-pj', t: 'CredNet — score e negativas · CNPJ', doc: 14, custo: 16.06, uf: true },
  { v: 'concentre-pf', t: 'Concentre — passivo concentrado · CPF', doc: 11, custo: 33.87 },
  { v: 'concentre-pj', t: 'Concentre — passivo concentrado · CNPJ', doc: 14, custo: 33.87 },
  { v: 'recomenda-pf', t: 'Recomenda — limite de crédito · CPF', doc: 11, custo: 24, valor: true },
  { v: 'recomenda-pj', t: 'Recomenda — limite de crédito · CNPJ', doc: 14, custo: 24, valor: true },
  { v: 'cdc-pf-basica', t: 'Prova cadastral PF (nome + nascimento)', doc: 11, nasc: true },
  { v: 'cdc-pj-qsa', t: 'Quadro de sócios (QSA)', doc: 14 },
  { v: 'cdc-pj-simples', t: 'Situação no Simples Nacional', doc: 14 },
  { v: 'negativacao-tipos', t: 'Códigos de restrição disponíveis', doc: 0 },
  { v: 'negativacao-baixas', t: 'Códigos de baixa disponíveis', doc: 0 },
  { v: 'negativacao-lista', t: 'Negativações da conta (por condição)', doc: 0, condicao: true },
  { v: 'negativacao-consultar', t: 'Consultar uma negativação (uniqueID)', doc: 0, unique: true },
  { v: 'negativacao-inserir', t: 'Negativar devedor (escrita)', doc: 0, mutacao: true, incluir: true },
  { v: 'negativacao-excluir', t: 'Baixar negativação (escrita)', doc: 0, mutacao: true, unique: true, baixa: true },
  { v: 'recarga-pix', t: 'Recarga da conta via PIX', doc: 0, mutacao: true, valor: true },
];

function soaServicoAtual() {
  return SOA_SERVICOS.find((s) => s.v === ($('soaServico')?.value || 'basica-pf')) || SOA_SERVICOS[0];
}

function soaServicoChange() {
  const s = soaServicoAtual();
  const doc = $('soaDoc');
  if (doc) {
    doc.placeholder = s.doc === 11 ? 'CPF (000.000.000-00)' : s.doc === 14 ? 'CNPJ (00.000.000/0000-00)' : 'não usa documento nesta frente';
    doc.disabled = !s.doc;
  }
  const campos = { soaUf: !!s.uf, soaNasc: !!s.nasc, soaValor: !!s.valor, soaUnique: !!s.unique, soaCondicao: !!s.condicao, soaBaixa: !!s.baixa };
  for (const [id, on] of Object.entries(campos)) {
    const el = $(id);
    if (el) el.style.display = on ? '' : 'none';
  }
  const form = $('soaIncluirWrap');
  if (form) form.style.display = s.incluir ? '' : 'none';
  const conf = $('soaConfirmarWrap');
  if (conf) conf.style.display = s.mutacao ? '' : 'none';
  const res = $('soa-result');
  if (res) res.innerHTML = s.mutacao
    ? '<p class="muted small">Frente de escrita: afeta dados reais no bureau ou a conta de billing. Marque a confirmação para executar.</p>'
    : `<p class="muted small">Tarifa desta frente: ${s.custo ? fmt(s.custo) + ' por consulta' : 'sem tarifa (administração/consulta de catálogo)'}.</p>`;
}

function soaRodape(data) {
  return `<p class="muted small mt-2">${ddEsc(data.fonte || 'Base de risco')} · ambiente ${ddEsc(data.ambiente || '—')}${data.custo ? ` · tarifa ${fmt(data.custo)}` : ''}</p>`;
}

function soaRenderNegativacao(data) {
  const r = data.resumo || {};
  const tipos = (r.tipos || []).map((t) => `<div class="kv"><span>${ddEsc(t.codigoRestricao || '')}</span><b>${ddEsc(t.restricaoDescricao || '')}</b></div>`).join('');
  const baixas = (r.codigosBaixa || []).map((t) => `<div class="kv"><span>${ddEsc(t.codigoBaixa ?? t.codigo ?? '')}</span><b>${ddEsc(t.descricao || t.baixaDescricao || '')}</b></div>`).join('');
  const devedores = (r.devedores || []).map((d) => `<div class="kv"><span>${ddEsc(d.nome || d.documento || '')}</span><b>${ddEsc(d.documento || '')} · ${ddEsc(d.tipoDevedor || '')}${d.endereco?.cidade ? ` · ${ddEsc(d.endereco.cidade)}/${ddEsc(d.endereco.estado || '')}` : ''}</b></div>`).join('');
  const erros = (r.erros || []).map((e) => `<div class="kv"><span>${ddEsc(e.codigo || '')}</span><b>${ddEsc(e.mensagem || '')}</b></div>`).join('');
  const rest = r.restricao;
  const credor = r.credor && (r.credor.nomeCredor || r.credor.documentoCredor);
  const linhas = (r.lista || []).slice(0, 40).map((it, i) => {
    const cam = ['uniqueID', 'documento', 'nome', 'nomeCredor', 'documentoCredor', 'codigoRestricao', 'restricaoDescricao', 'valor', 'dataHoraInclusao', 'dataVencimento', 'situacao', 'descricao'];
    const pares = cam.filter((k) => it[k] !== undefined && it[k] !== null && it[k] !== '');
    if (!pares.length) return `<div class="kv"><span>Registro ${i + 1}</span><b class="small" style="word-break:break-all">${ddEsc(JSON.stringify(it)).slice(0, 200)}</b></div>`;
    return `<div class="kv"><span>${ddEsc(String(it.nome || it.documento || it.uniqueID || `Registro ${i + 1}`))}</span><b>${pares.filter((k) => k !== 'nome' && k !== 'documento').map((k) => ddEsc(String(it[k]))).join(' · ')}</b></div>`;
  }).join('');
  return `
    ${r.uniqueID ? `<div class="kv"><span>uniqueID</span><b>${ddEsc(r.uniqueID)}</b></div>` : ''}
    ${r.situacao ? `<div class="kv"><span>Situação</span><b>${ddEsc(typeof r.situacao === 'string' ? r.situacao : JSON.stringify(r.situacao))}</b></div>` : ''}
    ${credor ? `<div class="kv"><span>Credor</span><b>${ddEsc(r.credor.nomeCredor || '')}${r.credor.documentoCredor ? ` · ${ddEsc(r.credor.documentoCredor)}` : ''}</b></div>` : ''}
    ${rest ? `<div class="kv"><span>Restrição</span><b>${ddEsc(rest.codigoRestricao ?? '')}${rest.contrato ? ` · contrato ${ddEsc(rest.contrato)}` : ''}${rest.nossoNumero ? ` · nn ${ddEsc(rest.nossoNumero)}` : ''}${rest.valor ? ` · ${fmt(rest.valor)}` : ''}</b></div>` : ''}
    ${rest?.dataVencimento ? `<div class="kv"><span>Vencimento</span><b>${ddEsc(fmtDataBr(rest.dataVencimento) || rest.dataVencimento)}</b></div>` : ''}
    ${r.inclusao ? `<div class="kv"><span>Inclusão</span><b>${ddEsc(r.inclusao)}</b></div>` : ''}
    ${r.baixa ? `<div class="kv"><span>Baixa aplicada</span><b>${ddEsc(r.baixa.baixaDescricao || '')}${r.baixa.codigoBaixa != null ? ` (código ${ddEsc(r.baixa.codigoBaixa)})` : ''}</b></div>
      ${r.baixa.credor ? `<div class="kv"><span>Credor baixado</span><b>${ddEsc(r.baixa.credor)}</b></div>` : ''}
      ${r.baixa.devedor ? `<div class="kv"><span>Devedor baixado</span><b>${ddEsc(r.baixa.devedor)}</b></div>` : ''}
      ${r.baixa.valor ? `<div class="kv"><span>Valor</span><b>${fmt(r.baixa.valor)}</b></div>` : ''}
      ${r.baixa.dataHoraExclusao ? `<div class="kv"><span>Exclusão</span><b>${ddEsc(r.baixa.dataHoraExclusao)}</b></div>` : ''}` : ''}
    ${linhas ? `<div class="dd-sub">Negativações registradas</div>${linhas}` : ''}
    ${devedores}${erros}${tipos}${baixas}
    ${!(devedores || erros || tipos || baixas || linhas || credor || rest || r.baixa || r.inclusao || r.uniqueID || r.situacao) ? '<p class="muted small">Operação concluída sem itens de detalhe.</p>' : ''}`;
}

function soaRenderAdmin(data) {
  const r = data.resumo || {};
  if (typeof r.saldo === 'number') return `<div class="kv"><span>Saldo disponível</span><b>${fmt(r.saldo)}</b></div>`;
  if (r.detalhes) {
    return `<div class="kv"><span>Consumo do período</span><b>${r.quantidade ?? '—'} consultas · ${fmt(r.valor)}</b></div>
      ${r.detalhes.map((d) => `<div class="kv indent"><span>${ddEsc(d.produto || d.documento || 'Consulta')}${d.dataHora ? ` · ${ddEsc(String(d.dataHora).slice(0, 16))}` : ''}</span><b>${d.quantidade != null ? `${d.quantidade} × ` : ''}${fmt(d.valor)}</b></div>`).join('') || '<p class="muted small">Sem consumo registrado.</p>'}`;
  }
  if (r.pixCopyPaste) {
    return `<div class="kv"><span>PIX copia e cola</span><b class="small" style="word-break:break-all">${ddEsc(r.pixCopyPaste)}</b></div>
      <div class="btn-row mt-2"><button class="btn btn-ghost small" data-url="${ddEsc(r.pixCopyPaste)}" onclick="UI.soaCopiarPix(this)">Copiar código PIX</button></div>
      ${r.instrucoes ? `<div class="kv"><span>Link de pagamento</span><b class="small" style="word-break:break-all">${ddEsc(r.instrucoes)}</b></div>
        <div class="btn-row mt-2"><button class="btn btn-ghost small" data-url="${ddEsc(r.instrucoes)}" onclick="UI.lupaAbrirPix(this)">Abrir link de pagamento</button></div>` : ''}
      ${r.expiraEm ? `<div class="kv"><span>Expira em</span><b>${ddEsc(r.expiraEm)}</b></div>` : ''}`;
  }
  return ddBloque(r);
}

async function consultarSoa() {
  const s = soaServicoAtual();
  const el = $('soa-result');
  const body = {};
  const doc = ($('soaDoc')?.value || '').replace(/\D/g, '');
  if (s.doc) {
    if (doc.length !== s.doc) return alert(`Informe ${s.doc === 11 ? 'o CPF (11 dígitos)' : 'o CNPJ (14 dígitos)'}.`);
    body.documento = doc;
  }
  const uf = ($('soaUf')?.value || '').toUpperCase().trim();
  if (s.uf) {
    if (!/^[A-Z]{2}$/.test(uf)) return alert('Informe a UF (2 letras).');
    body.uf = uf;
  }
  if (s.uf || s.v.startsWith('concentre')) body.adicionais = [1, 2, 3, 4];
  const nasc = ($('soaNasc')?.value || '').trim();
  if (s.nasc && /^\d{4}-\d{2}-\d{2}$/.test(nasc)) body.dataNascimento = nasc;
  const valor = Number(($('soaValor')?.value || '').replace(/\./g, '').replace(',', '.'));
  if (s.valor) {
    if (!(valor > 0)) return alert('Informe o valor (R$) desta frente.');
    body.valorOperacao = valor;
    if (s.v === 'recarga-pix') { delete body.valorOperacao; body.valor = valor; }
    if (s.v.startsWith('recomenda')) { body.tipoVenda = 1; body.politica = 1; }
  }
  const unique = ($('soaUnique')?.value || '').trim();
  if (s.unique) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unique)) return alert('uniqueID inválido (UUID).');
    body.uniqueID = unique;
  }
  if (s.condicao) body.condicao = Number($('soaCondicao')?.value || 1);
  if (s.mutacao && !$('soaConfirmar')?.checked) return alert('Marque a confirmação para executar uma frente de escrita.');
  if (s.baixa) {
    body.codigoBaixa = Number(($('soaBaixa')?.value || '0'));
    if (!Number.isInteger(body.codigoBaixa) || body.codigoBaixa <= 0) return alert('Informe o código de baixa (1 a 9) — use "Códigos de restrição e baixa".');
    body.dataBaixa = new Date().toISOString().slice(0, 10);
  }
  if (s.incluir) {
    const venc = ($('soaIxVencimento')?.value || '').trim();
    const valorRest = Number(($('soaIxValor')?.value || '').replace(/\./g, '').replace(',', '.'));
    const codigoRest = ($('soaIxCodigo')?.value || '').trim();
    if (!codigoRest) return alert('Informe o código da restrição.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) return alert('Informe a data de vencimento do título.');
    if (!(valorRest > 0)) return alert('Informe o valor devido (R$).');
    const docV = ($('soaIvDoc')?.value || '').replace(/\D/g, '');
    if (docV.length !== 11 && docV.length !== 14) return alert('Informe o CPF (11) ou CNPJ (14) do devedor.');
    const nomeV = ($('soaIvNome')?.value || '').trim();
    if (!nomeV) return alert('Informe o nome ou a razão social do devedor.');
    const ufV = ($('soaIvUf')?.value || '').toUpperCase().trim();
    if (!/^[A-Z]{2}$/.test(ufV)) return alert('Informe a UF do endereço do devedor.');
    body.confirmar = true;
    body.devedores = [{
      documento: docV,
      tipoDevedor: docV.length === 14 ? 2 : 1,
      nome: nomeV,
      endereco: {
        logradouro: ($('soaIvLogra')?.value || '').trim(),
        numero: ($('soaIvNumero')?.value || '').trim(),
        bairro: ($('soaIvBairro')?.value || '').trim(),
        cidade: ($('soaIvCidade')?.value || '').trim(),
        estado: ufV,
        cep: ($('soaIvCep')?.value || '').replace(/\D/g, ''),
      },
    }];
    body.restricao = {
      codigoRestricao: codigoRest,
      contrato: ($('soaIxContrato')?.value || '').trim(),
      nossoNumero: ($('soaIxNosso')?.value || '').trim(),
      dataVencimento: venc,
      valor: valorRest,
    };
  } else if (s.mutacao) body.confirmar = true;

  el.innerHTML = '<p class="muted">Consultando a base de risco...</p>';
  try {
    const data = await api(`/integracao/soa?acao=${s.v}`, { method: 'POST', body: JSON.stringify(body) });
    let corpo;
    if (s.v.startsWith('negativacao')) corpo = soaRenderNegativacao(data);
    else if (s.v === 'recarga-pix' || s.v.startsWith('extrato') || s.v === 'saldo') corpo = soaRenderAdmin(data);
    else if (s.v.startsWith('recomenda')) corpo = lupaRecomendaHtml(data);
    else if (s.v.startsWith('cdc')) corpo = ddBloque(data.resumo);
    else corpo = lupaRiscoHtml(data, s.t);
    el.innerHTML = `<h4>${ddEsc(s.t)}</h4>${corpo}${soaRodape(data)}${serproDetalhes(data)}`;
  } catch (e) {
    el.innerHTML = soaErro(e);
  }
}

async function soaCatalogos() {
  const el = $('soa-result');
  el.innerHTML = '<p class="muted">Lendo os códigos de restrição e de baixa...</p>';
  try {
    const [t, b] = await Promise.all([
      api('/integracao/soa?acao=negativacao-tipos', { method: 'POST', body: '{}' }),
      api('/integracao/soa?acao=negativacao-baixas', { method: 'POST', body: '{}' }),
    ]);
    const tipos = (t.resumo?.tipos || []).map((x) => `<div class="kv"><span>${ddEsc(x.codigoRestricao ?? '—')}</span><b>${ddEsc(x.restricaoDescricao || '')}</b></div>`).join('');
    const baixas = (b.resumo?.codigosBaixa || []).map((x) => `<div class="kv"><span>${ddEsc(x.codigoBaixa ?? x.codigo ?? '—')}</span><b>${ddEsc(x.descricao || x.baixaDescricao || '')}</b></div>`).join('');
    el.innerHTML = `<h4>Códigos disponíveis na conta</h4>
      ${tipos ? `<div class="dd-sub">Restrições</div>${tipos}` : ''}
      ${baixas ? `<div class="dd-sub">Baixas</div>${baixas}` : ''}
      ${!(tipos + baixas) ? '<p class="muted small">O provedor não devolveu nenhum código para esta conta.</p>' : ''}
      ${soaRodape(t)}`;
  } catch (e) {
    el.innerHTML = soaErro(e);
  }
}

function soaCopiarPix(btn) {
  const codigo = btn?.dataset?.url || '';
  if (!codigo) return;
  navigator.clipboard?.writeText(codigo)
    .then(() => { btn.textContent = 'Código copiado'; })
    .catch(() => { btn.textContent = 'Copie manualmente o código acima'; });
}

async function soaSaldo() {
  const el = $('soa-result');
  el.innerHTML = '<p class="muted">Lendo o saldo da conta...</p>';
  try {
    const data = await api('/integracao/soa?acao=saldo', { method: 'POST', body: '{}' });
    el.innerHTML = `<h4>Saldo da conta de risco</h4>${soaRenderAdmin(data)}${soaRodape(data)}${serproDetalhes(data)}`;
  } catch (e) {
    el.innerHTML = soaErro(e);
  }
}

async function soaExtrato() {
  const el = $('soa-result');
  el.innerHTML = '<p class="muted">Montando o extrato do mês...</p>';
  try {
    const data = await api('/integracao/soa?acao=extrato-sintetico', { method: 'POST', body: '{}' });
    el.innerHTML = `<h4>Extrato de consumo (mês corrente)</h4>${soaRenderAdmin(data)}${soaRodape(data)}${serproDetalhes(data)}`;
  } catch (e) {
    el.innerHTML = soaErro(e);
  }
}

function soaPreencherServicos() {
  const sel = $('soaServico');
  if (!sel || sel.options.length) return;
  sel.innerHTML = SOA_SERVICOS.map((s) => `<option value="${s.v}">${ddEsc(s.t)}${s.custo ? ` · ${fmt(s.custo)}` : ''}</option>`).join('');
  soaServicoChange();
}

function soaErro(e) {
  const code = e.code || e.data?.code || '';
  const checkout = e.data?.checkout_url || e.data?.error?.checkout_url;
  const orderNsu = e.data?.order_nsu || e.data?.error?.order_nsu;
  let h = `<p class="form-error">${ddEsc(lupaNeutro(e.message) || 'A base de risco não retornou dados agora.')}</p>`;
  if (checkout && orderNsu) {
    h += `<button class="btn btn-gradient small mt-3" data-url="${ddEsc(checkout)}" onclick="UI.lupaAbrirPix(this)">Pagar PIX para liberar</button>
      <button class="btn btn-ghost small mt-2" data-order="${ddEsc(orderNsu)}" onclick="UI.soaAposPagamento(this)">Já paguei — conferir</button>`;
  } else if (code === 'SALDO_INSUFICIENTE') {
    h += '<p class="muted small mt-2">Saldo da conta de consultas esgotado — use a recarga PIX do painel ou a cobrança acima.</p>';
  } else if (code === 'SOA_NAO_CONFIGURADO') {
    h += '<p class="muted small mt-2">Enquanto as credenciais do bureau não estiverem salvas no cofre, as frentes de score ficam indisponíveis; o retrato cadastral oficial continua funcionando. A conta do distribuidor é criada em soawebservices.com.br/criar-conta (Central (11) 4560-7722), e a credencial da Serasa Experian é emitida pelo representante comercial ou pela Central de Atendimento (11) 3003-7372.</p>';
  }
  return h;
}

async function soaAposPagamento(btn) {
  const el = $('soa-result');
  el.innerHTML = '<p class="muted">Confirmando o pagamento...</p>';
  try {
    const r = await api('/integracao/apibrasil?acao=pagar-consulta', {
      method: 'POST', body: JSON.stringify({ order_nsu: btn.dataset.order }),
    });
    el.innerHTML = `<h4>Consulta liberada</h4>${lupaRiscoHtml(r, 'Risco')}${soaRodape(r)}${serproDetalhes(r)}`;
  } catch (e) {
    el.innerHTML = soaErro(e);
  }
}

// ---------- Serasa Experian · APIs do portal ----------
const SD_CAMPOS = {
  document: { tipo: 'text', ph: 'CPF (11) ou CNPJ (14) dígitos' },
  reportName: { tipo: 'select', ph: 'Relatório' },
  reportNameOutro: { tipo: 'text', ph: 'Nome técnico do relatório (RELATORIO_...)' },
  uf: { tipo: 'text', ph: 'UF', max: 2 },
  features: { tipo: 'text', ph: 'optionalFeatures (separadas por vírgula)' },
  parametros: { tipo: 'text', ph: 'reportParameters' },
  valorOperacao: { tipo: 'text', ph: 'Valor da operação (R$)' },
  tipoVenda: { tipo: 'select', opcoes: [['1', 'Venda à vista'], ['2', 'Venda a prazo']] },
  politica: { tipo: 'select', opcoes: [['1', 'Política padrão'], ['2', 'Política conservadora']] },
  numeroProposta: { tipo: 'text', ph: 'Número da proposta' },
  busca: { tipo: 'text', ph: 'Busca (documento ou nome)' },
  q: { tipo: 'text', ph: 'Filtro da lista' },
  dataInicio: { tipo: 'text', ph: 'De (AAAA-MM-DD)' },
  dataFim: { tipo: 'text', ph: 'Até (AAAA-MM-DD)' },
  pagina: { tipo: 'text', ph: 'Página (1)' },
  cnpj: { tipo: 'text', ph: 'CNPJ (14 dígitos)' },
  nome: { tipo: 'text', ph: 'Razão social' },
  lote: { tipo: 'text', ph: 'Um CPF/CNPJ por linha' },
  ambInfomais: { tipo: 'select', opcoes: [['uat', 'Infomais · homologação (spec)'], ['prod', 'Infomais · produção'], ['sandbox', 'Infomais · sandbox']] },
};
const SD = { servicos: [], ambientes: [], carregando: false };

function sdCampo(id) { return document.getElementById(`sdF_${id}`); }
function sdValor(id) { return (sdCampo(id)?.value || '').trim(); }

async function sdRecarregar() {
  SD.servicos = [];
  SD.carregando = false;
  await sdCarregar(true);
}

async function sdCarregar(forcar) {
  if (SD.servicos.length && !forcar) return SD.servicos;
  if (SD.carregando) return SD.servicos;
  SD.carregando = true;
  const sel = $('sdServico');
  try {
    const data = await api('/integracao/serasa-apis?acao=catalogo', { method: 'POST', body: '{}' });
    SD.servicos = data.servicos || [];
    SD.ambientes = data.ambientes || [{ v: 'demo', t: 'demonstração' }];
    const grupos = [];
    for (const s of SD.servicos) {
      let g = grupos.find((x) => x.g === s.grupo);
      if (!g) { g = { g: s.grupo, itens: [] }; grupos.push(g); }
      g.itens.push(s);
    }
    if (sel) {
      sel.innerHTML = grupos.map((g) => `<optgroup label="${ddEsc(g.g)}">${g.itens.map((s) => `<option value="${s.acao}">${ddEsc(s.titulo)}${s.mutacao ? ' · escrita' : ''}</option>`).join('')}</optgroup>`).join('');
    }
    const amb = $('sdAmbiente');
    if (amb) {
      const nomes = { demo: 'Demonstração (mock público)', sandbox: 'Sandbox do contrato', uat: 'Homologação', prod: 'Produção oficial' };
      amb.innerHTML = SD.ambientes.map((a) => `<option value="${a.v}">${ddEsc(nomes[a.v] || a.t)}</option>`).join('');
      amb.value = data.ambientePadrao || 'demo';
    }
    sdServicoChange();
    if (!data.comCredencial) {
      const el = $('sd-result');
      if (el && !el.innerHTML) el.innerHTML = '<p class="muted small">As frentes oficiais ficam liberadas quando as credenciais client-identities do portal estiverem salvas no cofre; a demonstração já responde os exemplos públicos do gateway.</p>';
    }
  } catch (e) {
    if (sel) sel.innerHTML = '<option value="">Catálogo indisponível</option>';
    const el = $('sd-result');
    if (el) el.innerHTML = `<p class="form-error">${ddEsc(e.message || 'Não foi possível carregar o catálogo de APIs.')}</p>`;
  } finally {
    SD.carregando = false;
  }
  return SD.servicos;
}

function sdServicoAtual() {
  return SD.servicos.find((s) => s.acao === ($('sdServico')?.value || '')) || SD.servicos[0] || null;
}

function sdAmbienteChange() {
  const sel = $('sdAmbiente');
  const el = $('sd-result');
  if (!el) return;
  const v = sel?.value;
  el.innerHTML = v === 'demo'
    ? '<p class="muted small">Demonstração: respostas de exemplo do gateway público da Serasa. Nenhum dado real é consultado e nada é cobrado.</p>'
    : `<p class="muted small">Ambiente ${ddEsc(sel?.selectedOptions[0]?.text || v || '')}: usa suas credenciais client-identities e o contrato da conta.</p>`;
}

function sdServicoChange() {
  const s = sdServicoAtual();
  const area = $('sdCampos');
  if (!s || !area) return;
  const keys = (s.doc ? ['document'] : []).concat(s.campos || []);
  area.innerHTML = keys.map((k) => {
    const def = SD_CAMPOS[k];
    if (!def) return '';
    const id = `sdF_${k}`;
    if (def.tipo === 'select') {
      const opcoes = k === 'reportName'
        ? (s.relatorios || []).map((r) => `<option value="${ddEsc(r.v)}">${ddEsc(r.t)}</option>`).join('') + '<option value="OUTRO">Outro (digitar o nome técnico)…</option>'
        : def.opcoes.map(([v, t]) => `<option value="${ddEsc(v)}">${ddEsc(t)}</option>`).join('');
      return `<select class="field" id="${id}"${k === 'reportName' ? ' onchange="UI.sdReportNameChange()"' : ''}>${opcoes}</select>`;
    }
    const extra = k === 'document' ? ' inputmode="numeric"' : '';
    const max = def.max ? ` maxlength="${def.max}"` : '';
    return `<input class="field" id="${id}" placeholder="${ddEsc(def.ph)}"${max}${extra}>`;
  }).join('') + '<input class="field" id="sdF_reportNameOutro" placeholder="Nome técnico do relatório (RELATORIO_...)" style="display:none">';
  sdReportNameChange();
  const conf = $('sdConfirmarWrap');
  if (conf) conf.style.display = s.mutacao ? '' : 'none';
  const el = $('sd-result');
  if (el) {
    el.innerHTML = s.mutacao
      ? '<p class="muted small">Frente de escrita: grava uma proposta no bureau. Marque a confirmação para executar.</p>'
      : '<p class="muted small">' + ddEsc(s.grupo) + ' · ' + ddEsc(s.titulo) + '</p>';
  }
}

function sdReportNameChange() {
  const sel = sdCampo('reportName');
  const outro = $('sdF_reportNameOutro');
  if (outro) outro.style.display = sel?.value === 'OUTRO' ? '' : 'none';
}

function sdPares(pares) {
  return (pares || []).filter((p) => p && p.valor).map((p) => `<div class="kv"><span>${ddEsc(p.rotulo)}</span><b>${ddEsc(p.valor)}</b></div>`).join('');
}

function sdRenderRelatorio(r) {
  const blocos = (r.blocos || []).map((b) => `<div class="kv"><span>${ddEsc(b.bloco)}</span><b>${ddEsc(b.itens)} ${b.itens === 1 ? 'item' : 'itens'}${b.reportName ? ` · ${ddEsc(b.reportName)}` : ''}</b></div>`).join('');
  const score = (r.score || []).map((p) => `<div class="kv"><span>${ddEsc(p.rotulo)}</span><b>${ddEsc(p.valor)}</b></div>`).join('');
  return `
    ${r.nome ? `<div class="kv"><span>Titular</span><b>${ddEsc(r.nome)}${r.documento ? ` · ${ddEsc(r.documento)}` : ''}</b></div>` : ''}
    ${(r.reportNames || []).length ? `<div class="kv"><span>Relatório retornado</span><b>${ddEsc(r.reportNames.join(' · '))}</b></div>` : ''}
    ${sdPares(r.detalhesCadastro)}
    ${score ? `<div class="dd-sub">Pontuações</div>${score}` : ''}
    ${sdPares(r.endereco)}
    <div class="kv"><span>Negativas</span><b>${ddEsc(r.negativacoes || '—')}</b></div>
    ${blocos ? `<div class="dd-sub">Blocos do relatório</div>${blocos}` : ''}
    ${(r.opcionais || []).length ? `<div class="kv"><span>Features opcionais entregues</span><b>${ddEsc(r.opcionais.join(', '))}</b></div>` : ''}
    ${!(r.detalhesCadastro || []).length && !blocos ? '<p class="muted small">O relatório veio sem blocos de dados neste ambiente.</p>' : ''}`;
}

function sdRenderRecomenda(r) {
  if (r.tipo === 'lista') {
    const itens = (r.itens || []).map((p) => `<div class="kv"><span>${ddEsc(p.rotulo || 'Proposta')}</span><b>${[p.documento, p.nome, p.status, p.limite != null ? fmt(p.limite) : ''].filter(Boolean).map((x) => ddEsc(String(x))).join(' · ')}</b></div>`).join('');
    return `<div class="kv"><span>Propostas localizadas</span><b>${r.total ?? (r.itens || []).length}</b></div>${itens || '<p class="muted small">Nenhuma proposta registrada neste ambiente.</p>'}`;
  }
  const neg = r.negatives || {};
  const semResposta = !r.numeroProposta && !r.mensagem && !r.tipoRecomendacao && r.limiteRecomendado == null && r.score == null;
  if (semResposta) {
    return `
    ${r.documento ? `<div class="kv"><span>Titular</span><b>${ddEsc(r.documento)}</b></div>` : ''}
    <p class="muted small">O pedido foi aceito no formato correto, mas este ambiente devolve apenas o eco da requisição. Número da proposta, limite recomendado e orientação de venda aparecem no ambiente oficial do contrato.</p>`;
  }
  return `
    ${r.numeroProposta ? `<div class="kv"><span>Nº da proposta</span><b>${ddEsc(r.numeroProposta)}</b></div>` : ''}
    ${r.nome ? `<div class="kv"><span>Titular</span><b>${ddEsc(r.nome)}${r.documento ? ` · ${ddEsc(r.documento)}` : ''}</b></div>` : ''}
    ${r.limiteRecomendado != null ? `<div class="kv"><span>Limite recomendado</span><b>${fmt(r.limiteRecomendado)}</b></div>` : ''}
    ${r.score != null ? `<div class="kv"><span>Score Serasa</span><b>${ddEsc(String(r.score))}${r.taxa != null ? ` · taxa ${ddEsc(String(r.taxa))}` : ''}</b></div>` : ''}
    ${r.nivelRisco != null ? `<div class="kv"><span>Nível de risco</span><b>${ddEsc(String(r.nivelRisco))}</b></div>` : ''}
    ${r.tipoRecomendacao ? `<div class="kv"><span>Tipo de recomendação</span><b>${ddEsc(r.tipoRecomendacao)}</b></div>` : ''}
    ${r.faixaRenda != null ? `<div class="kv"><span>Faixa de renda</span><b>${ddEsc(String(r.faixaRenda))}</b></div>` : ''}
    ${r.mensagem ? `<div class="kv"><span>Resposta do bureau</span><b>${ddEsc(r.mensagem)}</b></div>` : ''}
    <div class="dd-sub">Blocos analisados</div>
    ${['negativos', 'consultas', 'participacoes', 'cheques', 'habitosPagamento'].map((k) => `<div class="kv"><span>${ddEsc({ negativos: 'Anotações negativas', consultas: 'Consultas Serasa', participacoes: 'Participações societárias', cheques: 'Cheques devolvidos', habitosPagamento: 'Hábitos de pagamento' }[k])}</span><b>${ddEsc(String(neg[k] ?? r[k] ?? '—'))}</b></div>`).join('')}`;
}

function sdRenderLista(r) {
  const itens = (r.itens || []).map((p) => `
    <div class="dd-sub">
      <div class="kv"><span>${ddEsc(p.rotulo || 'Registro')}${p.id ? ` · ${ddEsc(p.id)}` : ''}</span><b>${[p.status, p.data ? fmtDataBr(p.data) || p.data : ''].filter(Boolean).map((x) => ddEsc(String(x))).join(' · ')}</b></div>
      ${sdPares(p.campos)}
    </div>`).join('');
  return `
    <div class="kv"><span>Registros</span><b>${ddEsc(String(r.total ?? (r.itens || []).length))}</b></div>
    ${itens || '<p class="muted small">Nenhum registro retornado por este ambiente. A chamada funcionou: o catálogo vazio é do contrato ou da base de exemplo.</p>'}`;
}

function sdRenderInfomais(r) {
  const bloco = (t, linhas) => (linhas && linhas.length ? `<div class="dd-sub">${ddEsc(t)}</div>${linhas.map((l) => `<div class="kv"><span>—</span><b>${ddEsc(String(l))}</b></div>`).join('')}` : '');
  return `
    <div class="kv"><span>Titular</span><b>${ddEsc(r.nome || '—')}${r.documento ? ` · ${ddEsc(r.documento)}` : ''}</b></div>
    ${sdPares(r.campos)}
    ${r.renda ? `<div class="kv"><span>Renda estimada</span><b>${fmt(r.renda)}</b></div>` : ''}
    ${r.classeSocial ? `<div class="kv"><span>Classe social</span><b>${ddEsc(r.classeSocial)}</b></div>` : ''}
    ${r.mosaic ? `<div class="kv"><span>Mosaico</span><b>${ddEsc(r.mosaic)}</b></div>` : ''}
    ${r.poderCompra ? `<div class="kv"><span>Poder de compra</span><b>${ddEsc(r.poderCompra)}</b></div>` : ''}
    ${r.risco ? `<div class="kv"><span>Triagem de risco</span><b>${ddEsc(r.risco)}</b></div>` : ''}
    ${bloco('Endereços', r.endereco)}
    ${bloco('Telefones', r.telefones)}
    ${bloco('Sócios / representações', r.socios)}
    ${bloco('Afinidades de consumo', r.afinidades)}`;
}

function sdRenderVerify(r) {
  const itens = Array.isArray(r) ? r : (r.results || r.content || []);
  return itens.map((it, i) => `<div class="dd-sub"><p><b>Registro ${i + 1}</b></p>${normalizarVerificacaoLocal(it)}</div>`).join('')
    || '<p class="muted small">Nenhum item no lote.</p>';
}

function normalizarVerificacaoLocal(d = {}) {
  const grupos = (d.validationGroups || []).map((g) => `<div class="kv"><span>${ddEsc(g.code || '')}</span><b>${ddEsc(g.message || '')}${g.rating ? ` · ${ddEsc(g.rating)}` : ''}</b></div>`).join('');
  return `${d.verificationScore != null ? `<div class="kv"><span>Score</span><b>${ddEsc(String(d.verificationScore))}</b></div>` : ''}
    ${d.verificationRisk ? `<div class="kv"><span>Risco</span><b>${ddEsc(d.verificationRisk)}</b></div>` : ''}
    ${grupos || ddBloque(d)}`;
}

async function consultarSd() {
  const s = sdServicoAtual();
  const el = $('sd-result');
  if (!s) { await sdCarregar(); return; }
  const body = { ambiente: $('sdAmbiente')?.value || 'demo' };
  const doc = sdValor('document').replace(/\D/g, '');
  if (s.doc === 'pf' && doc.length !== 11) return alert('Informe o CPF (11 dígitos).');
  if (s.doc === 'pj' && doc.length !== 14) return alert('Informe o CNPJ (14 dígitos).');
  if (s.doc === 'ambos' && ![11, 14].includes(doc.length)) return alert('Informe CPF (11) ou CNPJ (14) dígitos.');
  if (doc) body.document = doc;
  for (const k of (s.campos || [])) {
    if (k === 'lote') continue;
    const v = sdValor(k);
    if (v) body[k] = v;
  }
  if ((s.campos || []).includes('lote')) {
    body.pessoas = sdValor('lote').split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter((x) => x.length === 11 || x.length === 14).slice(0, 20).map((d) => ({ document: d }));
    if (!body.pessoas.length) return alert('Informe ao menos um CPF/CNPJ por linha no lote.');
  }
  if (s.mutacao) {
    if (!$('sdConfirmar')?.checked) return alert('Marque a confirmação: este chamado grava uma proposta no bureau.');
    body.confirmar = true;
  }
  el.innerHTML = '<p class="muted">Consultando a Serasa...</p>';
  try {
    const data = await api(`/integracao/serasa-apis?acao=${encodeURIComponent(s.acao)}`, { method: 'POST', body: JSON.stringify(body) });
    const r = data.resumo || {};
    let corpo;
    if (s.acao.startsWith('relatorio-')) corpo = sdRenderRelatorio(r);
    else if (s.acao.startsWith('recomenda-')) corpo = sdRenderRecomenda(r);
    else if (s.acao.startsWith('infomais-')) corpo = sdRenderInfomais(r);
    else if (s.acao.startsWith('verify-lote')) corpo = sdRenderVerify(data.detalhes || []);
    else corpo = sdRenderLista(r);
    el.innerHTML = `
      ${serproCabecalho(s.titulo, { ambiente: data.ambiente === 'oficial' ? 'prod' : data.ambiente === 'demonstração' ? 'demo' : data.ambiente, fonte: data.fonte })}
      ${data.vazio ? '<p class="muted small">A chamada foi aceita, mas este ambiente não devolve corpo para este serviço.</p>' : ''}
      ${corpo}
      <p class="muted small mt-2">${ddEsc(data.caminho || '')}</p>
      ${serproDetalhes(data)}`;
  } catch (e) {
    el.innerHTML = soaErro(e);
  }
}

// ---------- APIBrasil ----------
function renderApibrasil(data, cnpj, el) {
  const c = data.dados?.cnpj || {};
  const end = c.endereco || c.end || {};
  el.innerHTML = `
    <h4>${c.razao_social || c.nome_fantasia || '—'}</h4>
    <p class="muted small">${data.fonte || 'APIBrasil'}${data.valorConsulta ? ' · tarifa ' + fmt(data.valorConsulta) : ''}</p>
    <div class="kv"><span>CNPJ</span><b>${c.cnpj || cnpj}</b></div>
    <div class="kv"><span>Fantasia</span><b>${c.nome_fantasia || '—'}</b></div>
    <div class="kv"><span>Situação</span><b>${c.situacao_cadastral || '—'}</b></div>
    <div class="kv"><span>CNAE</span><b>${(c.cnae || []).map((x) => x.descricao || x.codigo || '').filter(Boolean).join(' · ') || '—'}</b></div>
    <div class="kv"><span>Endereço</span><b>${[end.logradouro, end.numero].filter(Boolean).join(', ') || '—'}</b></div>
    <div class="kv"><span>Município</span><b>${end.municipio || c.municipio || '—'} / ${end.uf || c.uf || '—'}</b></div>
    ${(c.socios || []).length ? `<div class="kv"><span>Sócios</span><b>${c.socios.length} registrado(s)</b></div>` : ''}
    ${data.balance ? `<div class="kv"><span>Saldo após consulta</span><b>${data.balance}</b></div>` : ''}`;
}

async function consultarApibrasil() {
  const cnpj = ($('apibrasilCnpj')?.value || '').replace(/\D/g, '');
  if (cnpj.length !== 14) return alert('CNPJ incompleto.');
  const el = $('apibrasil-result');
  el.innerHTML = '<p class="muted">Consultando a APIBrasil...</p>';
  try {
    const data = await api('/integracao/apibrasil?acao=cnpj', { method: 'POST', body: JSON.stringify({ cnpj }) });
    renderApibrasil(data, cnpj, el);
  } catch (erro) {
    if (erro.code === 'SALDO_INSUFICIENTE' && erro.data?.checkout_url) {
      const valor = Number(erro.data.valor) || 0.05;
      el.innerHTML = `
        <p class="form-error">${erro.message}</p>
        <div class="qr-box"><div id="apibrasil-qr"></div></div>
        <p class="muted small">Escaneie o QR code e pague <b>${fmt(valor)}</b> via PIX para liberar esta consulta.</p>
        <p class="muted small" id="apibrasil-pix-status">Aguardando pagamento...</p>`;
      try { new QRCode($('apibrasil-qr'), { text: erro.data.checkout_url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); } catch { /* sem lib de QR */ }
      pollApibrasilPagamento(erro.data.order_nsu, cnpj, el);
    } else {
      el.innerHTML = `<p class="form-error">${erro.message}</p>`;
    }
  }
}

// Confirma o pagamento na InfinitePay e reexecuta a consulta automaticamente
async function pollApibrasilPagamento(orderNsu, cnpj, el) {
  for (let i = 0; i < 60; i++) { // até ~5 minutos
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const data = await api('/integracao/apibrasil?acao=pagar-consulta', { method: 'POST', body: JSON.stringify({ order_nsu: orderNsu }) });
      if (data.status === 'pendente') continue;
      renderApibrasil(data, cnpj, el);
      return;
    } catch (erro) {
      if (erro.code === 'SALDO_INSUFICIENTE') {
        el.innerHTML = `<p class="form-error">${erro.message}</p>`;
        return;
      }
      // erros transitórios: continua tentando
    }
  }
  const statusEl = $('apibrasil-pix-status');
  if (statusEl) statusEl.textContent = 'Pagamento não confirmado ainda. Atualize a página e tente a consulta novamente.';
}

async function apibrasilSaldo() {
  const el = $('apibrasil-result');
  el.innerHTML = '<p class="muted">Consultando saldo...</p>';
  try {
    const data = await api('/integracao/apibrasil?acao=saldo', { method: 'POST', body: '{}' });
    el.innerHTML = `<div class="kv"><span>Saldo</span><b>${data.saldo || '—'}</b></div>`;
  } catch (erro) {
    el.innerHTML = `<p class="form-error">${erro.message}</p>`;
  }
}

// ---------- DirectData (consultas Big Data por consumo) ----------
// Endpoints do catálogo: https://www.directd.com.br/central-de-ajuda/apis/catalogo
const DIRECTDATA_CATALOGO = [
  { g: 'Cadastral', n: 'Cadastro Pessoa Física', e: 'CadastroPessoaFisica', p: 'Cpf', r: 0.16 },
  { g: 'Cadastral', n: 'Cadastro PF Plus', e: 'CadastroPessoaFisicaPlus', p: 'Cpf', r: 0.36 },
  { g: 'Cadastral', n: 'Cadastro Pessoa Jurídica', e: 'CadastroPessoaJuridica', p: 'Cnpj', r: 0.16 },
  { g: 'Cadastral', n: 'Cadastro PJ Plus', e: 'CadastroPessoaJuridicaPlus', p: 'Cnpj', r: 0.36 },
  { g: 'Cadastral', n: 'CNH', e: 'ConsultaCNH', p: 'Cpf', r: 0.90 },
  { g: 'Cadastral', n: 'CNH Plus', e: 'ConsultaCNHPlus', p: 'Cpf', r: 1.45 },
  { g: 'Cadastral', n: 'CNH Completa', e: 'ConsultaCNHCompleta', p: 'Cpf', r: 4.85 },
  { g: 'Cadastral', n: 'Óbito', e: 'ConsultaObito', p: 'Cpf', r: 0.36 },
  { g: 'Cadastral', n: 'PIS/NIT', e: 'ConsultaPIS', p: 'Cpf', r: 0.36 },
  { g: 'Cadastral', n: 'OAB (advogados)', e: 'ConsultaOAB', p: 'Nome', r: 0.36 },
  { g: 'Cadastral', n: 'Benefícios Sociais (12m)', e: 'ConsultaBeneficiosSociais', p: 'Cpf', r: 0.75 },
  { g: 'Cadastral', n: 'Bolsa Família', e: 'ConsultaBolsaFamilia', p: 'Nis', r: 0.36 },
  { g: 'Cadastral', n: 'Vínculo Empregatício', e: 'VinculoEmpregaticio', p: 'Cpf', r: 0.36 },
  { g: 'Crédito', n: 'Score', e: 'ConsultaScore', p: 'Cpf', r: '' },
  { g: 'Crédito', n: 'SCR Bacen (analítica)', e: 'ConsultaSCRBacen', p: 'Cpf', r: 3.90 },
  { g: 'Crédito', n: 'Protestos', e: 'ConsultaProtestos', p: 'Cpf', r: 2.95 },
  { g: 'Crédito', n: 'Dossiê Direct Data', e: 'DossieDirectData', p: 'Cnpj', r: 2.40 },
  { g: 'Crédito', n: 'Antifraude Chave PIX', e: 'ConsultaPix', p: 'ChavePix', r: 1.55 },
  { g: 'Fiscal e Tributário', n: 'Certidão Conjunta de Débitos', e: 'CertidaoConjuntaDebitos', p: 'Cnpj', r: 0.36 },
  { g: 'Fiscal e Tributário', n: 'Certidão Negativa de Débitos', e: 'CertidaoNegativaDebitos', p: 'Cnpj', r: 0.36 },
  { g: 'Fiscal e Tributário', n: 'NF-e Completa', e: 'ConsultaNFE', p: 'Chave', r: 1.30 },
  { g: 'Fiscal e Tributário', n: 'Simples Nacional', e: 'ConsultaSimplesNacional', p: 'Cnpj', r: 0.36 },
  { g: 'Processos', n: 'Processos Judiciais', e: 'ConsultaProcessosJudiciais', p: 'Cpf', r: 1.10 },
  { g: 'Ambiental', n: 'IBAMA CND', e: 'IbamaCertidaoNegativaDebitos', p: 'Cpf', r: 0.36 },
  { g: 'Ambiental', n: 'IBAMA Embargo', e: 'IbamaCertidaoEmbargo', p: 'Cpf', r: 0.36 },
  { g: 'Ambiental', n: 'IBAMA Autuações', e: 'IbamaAutuacoes', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'CEIS', e: 'CadastroEmpresasInidoneasSuspensas', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'CEPIM', e: 'CadastroEntidadesPrivadasImpedidas', p: 'Cnpj', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'CNEP', e: 'CadastroNacionalEmpresasPunidas', p: 'Cnpj', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'CNIA (improbidade)', e: 'CadastroNacionalImprobidadeAdministrativa', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'CNJ Mandados de Prisão', e: 'CNJMandadosPrisao', p: 'Cpf', r: 0.72 },
  { g: 'Sanções e Restrições', n: 'PEP', e: 'PessoaExpostaPoliticamente', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'PEP Estendida', e: 'PEPParentescos', p: 'Cpf', r: 0.72 },
  { g: 'Sanções e Restrições', n: 'PGFN Devedores da União', e: 'PGFNListaDevedoresUniao', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'Polícia Civil Antecedentes', e: 'PoliciaCivilAntecedentesCriminais', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'Polícia Federal Antecedentes', e: 'PoliciaFederalAntecedentesCriminais', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'TCU Licitante Inidôneo', e: 'TCUCertidaoNegativaLicitanteInidoneo', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'TCU Consolidada PJ', e: 'TCUConsultaConsolidadaPessoaJuridica', p: 'Cnpj', r: 0.72 },
  { g: 'Sanções e Restrições', n: 'TJ Certidão Cível/Criminal/Fiscal', e: 'TJCertidaoCivelCriminalFiscal', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'TRF Certidão', e: 'TribunalRegionalFederal', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'Trabalho Forçado', e: 'VerificacaoEmpregadorTrabalhoForcado', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'BACEN Inabilitados', e: 'BancoCentralInabilitados', p: 'Cpf', r: 0.36 },
  { g: 'Sanções e Restrições', n: 'BACEN Proibidos', e: 'BancoCentralProibidos', p: 'Cpf', r: 0.36 },
  { g: 'Societário', n: 'Beneficiário Final (UBO)', e: 'ConsultaBeneficiarioFinal', p: 'Cnpj', r: 1.44 },
  { g: 'Societário', n: 'Vínculos Societários', e: 'VinculosSocietarios', p: 'Cpf', r: 1.84 },
  { g: 'Societário', n: 'AML', e: 'ConsultaAML', p: 'Cpf', r: 0.72 },
  { g: 'Trabalhista', n: 'MPT', e: 'ConsultaMPT', p: 'Cnpj', r: 1.30 },
  { g: 'Trabalhista', n: 'CNDT (débitos trabalhistas)', e: 'CertidaoDebitosTrabalhistas', p: 'Cnpj', r: 0.36 },
  { g: 'Regularidade', n: 'FGTS (CRF)', e: 'CertidaoRegularidadeFGTS', p: 'Cnpj', r: 0.36 },
  { g: 'Regularidade', n: 'TSE', e: 'ConsultaTSE', p: 'Cpf', r: 0.36 },
  { g: 'Sanções Internacionais', n: 'OFAC', e: 'OFAC', p: 'Nome', r: 0.36 },
  { g: 'Sanções Internacionais', n: 'INTERPOL', e: 'Interpol', p: 'Nome', r: 0.36 },
  { g: 'Veicular', n: 'Consulta Veicular Nacional', e: 'ConsultaVeicular', p: 'Placa', r: 1.10 },
  { g: 'Veicular', n: 'Histórico de Proprietários', e: 'ConsultaVeicularHistorico', p: 'Placa', r: 4.10 },
  { g: 'Veicular', n: 'FIPE', e: 'ConsultaVeicularFipe', p: 'Placa', r: 3.98 },
  { g: 'Veicular', n: 'RENAINF (multas)', e: 'Renainf', p: 'Placa', r: 2.10 },
  { g: 'Veicular', n: 'RENAJUD (restrições)', e: 'Renajud', p: 'Placa', r: 1.90 },
  { g: 'Veicular', n: 'Roubo e Furto', e: 'ConsultaRouboFurto', p: 'Placa', r: 1.45 },
  { g: 'Veicular', n: 'Recall', e: 'RecallVeicular', p: 'Placa', r: 1.20 },
  { g: 'Outros', n: 'Endpoint personalizado...', e: '__custom', p: '', r: '' },
];

// Preços exibidos com margem de 10% do usuário sobre a tarifa da DirectData
const DD_MARKUP = 1.1;
function ddPreco(v) { return 'R$ ' + (v * DD_MARKUP).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function ddInit() {
  const sel = $('ddEndpoint');
  if (!sel) return;
  const grupos = {};
  DIRECTDATA_CATALOGO.forEach((c) => { (grupos[c.g] ||= []).push(c); });
  sel.innerHTML = Object.entries(grupos)
    .map(([g, itens]) => `<optgroup label="${g}">${itens.map((c) => `<option value="${c.e}">${c.n}${c.r ? ` · ${ddPreco(c.r)}` : ''}</option>`).join('')}</optgroup>`)
    .join('');
  ddEndpointChange();
}

function ddEndpointChange() {
  const sel = $('ddEndpoint');
  const custom = sel?.value === '__custom';
  $('ddEndpointCustomRow')?.classList.toggle('hidden', !custom);
  if (custom) $('ddEndpointCustom')?.focus();
  const item = DIRECTDATA_CATALOGO.find((c) => c.e === sel?.value);
  const inp = $('ddParam');
  if (inp && item?.p) inp.placeholder = `Ex: 000.000.000-00 (${item.p})`;
}

function ddEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function ddBloque(obj, depth = 0) {
  if (depth > 5) return `<div class="kv"><span>Dados</span><b>${ddEsc(JSON.stringify(obj))}</b></div>`;
  if (obj === null || obj === undefined) return '<p class="muted small">Sem retorno.</p>';
  if (Array.isArray(obj)) {
    if (!obj.length) return '<p class="muted small">Nenhum registro encontrado.</p>';
    return obj.map((item, i) => {
      if (item !== null && typeof item === 'object') {
        return `<div class="dd-sub"><p class="muted small">Registro ${i + 1}</p>${ddBloque(item, depth + 1)}</div>`;
      }
      return `<div class="kv"><span>${i + 1}</span><b>${ddEsc(item)}</b></div>`;
    }).join('');
  }
  if (typeof obj !== 'object') return `<div class="kv"><span>Valor</span><b>${ddEsc(obj)}</b></div>`;
  return Object.entries(obj).map(([k, v]) => {
    if (v === null || v === undefined) return '';
    const label = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    if (typeof v === 'object') return `<div class="kv"><span>${ddEsc(label)}</span>${ddBloque(v, depth + 1)}</div>`;
    return `<div class="kv"><span>${ddEsc(label)}</span><b>${ddEsc(v)}</b></div>`;
  }).join('');
}

async function consultarDirectdata() {
  const sel = $('ddEndpoint');
  const custom = sel?.value === '__custom';
  const endpoint = (custom ? ($('ddEndpointCustom')?.value || '') : (sel?.value || '')).trim();
  if (!endpoint) return alert('Escolha uma consulta no catálogo ou informe o endpoint.');
  const item = DIRECTDATA_CATALOGO.find((c) => c.e === sel?.value);
  const valor = ($('ddParam')?.value || '').trim();
  if (!valor) return alert('Informe o valor da consulta (CPF, CNPJ, placa...).');
  const el = $('dd-result');
  el.innerHTML = `<p class="muted">Consultando DirectData (${ddEsc(endpoint)})...</p>`;
  try {
    const params = {};
    if (custom && valor.includes('=')) {
      const [k, v] = valor.split('=');
      params[k.trim()] = v.trim();
    } else if (item?.p) {
      params[item.p] = ['Cpf', 'Cnpj', 'Nis'].includes(item.p) ? valor.replace(/\D/g, '') : valor.toUpperCase();
    } else {
      const doc = valor.replace(/\D/g, '');
      params[/^\d{14}$/.test(doc) ? 'Cnpj' : 'Cpf'] = doc;
    }
    const data = await api('/integracao/directdata?acao=consultar', { method: 'POST', body: JSON.stringify({ endpoint, params }) });
    const meta = data.metaDados || {};
    el.innerHTML = `
      <h4>${ddEsc(endpoint)}</h4>
      <p class="muted small">${ddEsc(data.fonte || 'DirectData')}${meta.tempoExecucaoMs ? ` · ${meta.tempoExecucaoMs}ms` : ''}${meta.consultaUid ? ` · uid ${ddEsc(meta.consultaUid)}` : ''}</p>
      ${ddBloque(data.retorno)}
      <p class="mt-3 small"><a class="link" href="https://www.directd.com.br/central-de-ajuda/apis/catalogo" target="_blank" rel="noopener">Catálogo DirectData ↗</a></p>`;
  } catch (erro) {
    const recarga = erro.code === 'SALDO_INSUFICIENTE'
      ? `<p class="mt-3"><a class="link" href="https://app.directd.com.br" target="_blank" rel="noopener">Adicionar saldo DirectData ↗</a></p>`
      : '';
    el.innerHTML = `<p class="form-error">${erro.message}</p>${recarga}`;
  }
}

// ---------- Serpro (Receita / PGFN / CND / DUE / Compras / Contador / Carimbo / Comex / IA) ----------
const SERPRO_LOJA = 'https://loja.serpro.gov.br';

// Especificação de cada serviço: campo principal + campos extras dinâmicos
const SERPRO_SERVICOS = {
  cnpj: { main: true, ph: '00.000.000/0000-00', extras: [['modo', 'select', [['basica', 'Básica (cadastro completo)'], ['qsa', 'Quadro Societário (QSA)'], ['empresa', 'Empresa (completa, sócios com CPF)']]]] },
  cpf: { main: true, ph: '000.000.000-00', extras: [['nasc', 'input', 'Nascimento dd/mm/aaaa (obrigatório na CPF v3)']] },
  'situacao-cpf': { main: true, ph: '000.000.000-00', extras: [['nasc', 'input', 'Nascimento dd/mm/aaaa (obrigatório na CPF v3)']] },
  nfe: { main: true, ph: 'Chave de acesso da NF-e (44 dígitos)' },
  'nfe-escalonada': { main: true, ph: 'Chave de acesso da NF-e (44 dígitos) — processamento em lote' },
  'nfe-push': { main: false, extras: [['tipo', 'select', [['status', 'Status da API NF-e'], ['clientes', 'Clientes com push configurado'], ['listar', 'Listar monitoramentos'], ['criar', 'Criar monitoramento (chaves abaixo)'], ['excluir', 'Excluir monitoramento (id abaixo)']]], ['chaves', 'textarea', 'Chaves de acesso (uma por linha, 1 a 500)'], ['id', 'input', 'ID do monitoramento (excluir)']] },
  cnd: { main: true, ph: 'CPF ou CNPJ do contribuinte', extras: [['tipo', 'select', [['2', 'Pessoa Jurídica'], ['1', 'Pessoa Física'], ['3', 'NIRF']]], ['pdf', 'check', 'Gerar certidão em PDF']] },
  'divida-ativa': { main: true, ph: 'CPF ou CNPJ' },
  'divida-inscricao': { main: true, ph: 'Número da inscrição (ex.: 9061700096419)' },
  faturamento: { main: false, extras: [['tipo', 'select', [['consultar', 'Consultar (token + contratante)'], ['autorizacoes', 'Autorizações (contratante/titular)']]], ['token', 'input', 'Token de autorização (e-CAC → Compartilha)'], ['contratante', 'input', 'CNPJ do contratante (14 dígitos)'], ['titular', 'input', 'CPF do titular dos dados (11 dígitos)']] },
  due: { main: false, extras: [['numero', 'input', 'Número da DUE (ex.: 18BR0000133506)'], ['chave', 'input', 'Chave de acesso da DUE (ex.: 18ERM135006)']] },
  comex: { main: true, ph: 'Nº contêiner (ex.: MOLU...), NIC ou CNPJ', extras: [['servico', 'select', [['container', 'Situação de contêiner'], ['presenca', 'Presença de carga (NIC no campo + recinto abaixo)'], ['habitacao', 'Habilitação (CNPJ)']]], ['recinto', 'input', 'Recinto (obrigatório p/ presença de carga)'], ['jwt', 'input', 'JWT token SAPI (opcional)']] },
  compras: { main: true, ph: 'Chave da compra', extras: [['tipo', 'select', [['chat', 'Chat de mensagens'], ['diligencias', 'Diligências']]]] },
  contador: { main: false, extras: [['operacao', 'select', [['Consultar', 'Consultar'], ['Declarar', 'Declarar'], ['Emitir', 'Emitir'], ['Monitorar', 'Monitorar'], ['Apoiar', 'Apoiar']]], ['jwt', 'input', 'JWT token (procuração e-CAC)'], ['dados', 'textarea', 'DadosEntrada (JSON)']] },
  carimbo: { main: false, extras: [['base64', 'textarea', 'Timestamp em base64 (header x-signature)'], ['document', 'textarea', 'Documento original (JSON) — opcional']] },
  ia: { main: false, extras: [['prompt', 'textarea', 'Ex.: analise o CNPJ 27.865.757/0001-02 e aponte riscos fiscais']] },
  cartorio: { main: true, ph: 'CPF ou CNPJ', extras: [['modo', 'select', [['cpf', 'CPF (pessoa física)'], ['basica', 'CNPJ — Básica'], ['qsa', 'CNPJ — Quadro Societário'], ['empresa', 'CNPJ — Empresa']]]] },
  ccir: { main: false, extras: [['tipo', 'select', [['ni', 'Códigos de imóveis por CPF/CNPJ'], ['codigo', 'Dados do CCIR pelo código do imóvel'], ['emitir', 'Emitir CCIR pelo código'], ['status', 'Status do serviço']]], ['ni', 'input', 'CPF ou CNPJ do titular do imóvel'], ['codigo', 'input', 'Código do imóvel INCRA (11 dígitos)']] },
  renda: { main: false, extras: [['tipo', 'select', [['consultar', 'Consultar (token)'], ['autorizacoes', 'Autorizações (contratante/titular)'], ['status', 'Status do serviço']]], ['token', 'input', 'Token de autorização (e-CAC → Compartilha)'], ['contratante', 'input', 'CNPJ do contratante (14 dígitos)'], ['titular', 'input', 'CPF do titular dos dados (11 dígitos)']] },
  restituicao: { main: false, extras: [['tipo', 'select', [['consultar', 'Consultar (token)'], ['autorizacoes', 'Autorizações (contratante/titular)'], ['status', 'Status do serviço']]], ['token', 'input', 'Token de autorização (e-CAC → Compartilha)'], ['contratante', 'input', 'CNPJ do contratante (14 dígitos)'], ['titular', 'input', 'CPF do titular dos dados (11 dígitos)']] },
  datavalid: { main: true, ph: '000.000.000-00', extras: [['nome', 'input', 'Nome completo (opcional — valida o nome)'], ['nasc', 'input', 'Nascimento dd/mm/aaaa (opcional — valida a data)'], ['rfb', 'check', 'Comparar com a base da Receita Federal (RFB)'], ['senatran', 'check', 'Comparar com a base da Senatran (CNH)']] },
  'datavalid-status': { main: false },
  biovalid: { main: true, ph: '000.000.000-00', extras: [['servico', 'select', [['token', 'Gerar token (biometria)'], ['liveness', 'Prova de vida (selfie)']]], ['expira', 'input', 'Validade do token em minutos (opcional)'], ['tentativas', 'input', 'Qtd de tentativas (opcional)'], ['pin', 'input', 'PIN retornado no token (obrigatório p/ liveness)'], ['device', 'input', 'Identificador do dispositivo (obrigatório p/ liveness)'], ['sexo', 'input', 'Sexo: M ou F (liveness)'], ['selfie', 'textarea', 'Selfie em base64 (liveness)']] },
  antecipa: { main: false, extras: [['tipo', 'select', [['cotacoes', 'Cotações disponíveis'], ['proposta', 'Proposta (ID da cotação)'], ['contrato', 'Contrato (cotação + UASG + nº)'], ['dadosbasicos', 'Dados básicos do fornecedor'], ['situacaonivel', 'Situação/nível do fornecedor'], ['regularidade', 'Regularidade fiscal-financeira'], ['ocorrencias', 'Ocorrências do fornecedor'], ['historico', 'Histórico do fornecedor'], ['arquivo', 'Arquivo (código)']]], ['id', 'input', 'ID (cotação / arquivo)'], ['ni', 'input', 'CPF ou CNPJ do fornecedor'], ['uasg', 'input', 'UASG'], ['contrato', 'input', 'Nº do contrato'], ['nivel', 'select', [['detalhada', 'Ocorrências detalhadas'], ['nadaconsta', 'Nada consta'], ['impeditivasindiretas', 'Impeditivas indiretas']]]] },
  pilar: { main: false, extras: [['tipo', 'select', [['avaliacao', 'Avaliação do fornecedor'], ['contratos', 'Execuções de contrato'], ['ordembancaria', 'Ordem bancária'], ['operacoes', 'Operações de crédito (lista)'], ['operacao', 'Operação de crédito (ID)'], ['cotacao', 'Cotação (UASG + contrato)'], ['documento', 'Documento da cotação'], ['cronograma', 'Cronograma do contrato'], ['empenhos', 'Empenhos do contrato'], ['faturas', 'Faturas do contrato'], ['historico', 'Histórico do contrato'], ['itens', 'Itens do contrato'], ['empenho', 'Empenho (nº)']]], ['ni', 'input', 'CPF ou CNPJ do fornecedor'], ['id', 'input', 'ID (cotação / contrato / ordem / operação)'], ['uasg', 'input', 'UASG'], ['contrato', 'input', 'Nº do contrato / empenho']] },
};

// Cabeçalho padrão dos resultados Serpro: título + selo do ambiente + fonte
function serproCabecalho(titulo, data) {
  const badge = (data.ambiente === 'demo' || data.ambiente === 'trial')
    ? '<span class="tag tag-rascunho">demonstração</span>'
    : data.ambiente === 'prod' ? '<span class="tag tag-autorizada">oficial</span>' : '';
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h4>${ddEsc(titulo)} ${badge}</h4></div><p class="muted small">${ddEsc(data.fonte || '')}</p>`;
}

function serproDetalhes(data) {
  const d = data.detalhes ?? data.dados ?? data;
  return `<details class="mt-3"><summary class="small muted">Retorno completo (JSON oficial)</summary>${ddBloque(d)}</details>`;
}

function serproKv(rotulo, valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  return `<div class="kv"><span>${ddEsc(rotulo)}</span><b>${ddEsc(String(valor))}</b></div>`;
}

function fmtDataBr(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

// Cartão detalhado de CNPJ (CNPJ-BASICO/QSA/EMPRESA — schema oficial Serpro v2)
function serproRenderCnpj(s, data, tituloAlt) {
  s = s || {};
  const socios = (s.socios || []).map((x) => `<div class="dd-sub"><p><b>${ddEsc(x.nome || '—')}</b>${x.qualificacao ? ` · ${ddEsc(x.qualificacao)}` : ''}${x.faixa_etaria ? ` · ${ddEsc(x.faixa_etaria)}` : ''}</p></div>`).join('');
  return `
    ${serproCabecalho(tituloAlt || s.razao_social || 'CNPJ', data)}
    ${serproKv('CNPJ', s.cnpj)}
    ${serproKv('Tipo de estabelecimento', s.tipo_estabelecimento)}
    ${serproKv('Nome empresarial', s.razao_social)}
    ${serproKv('Fantasia', s.nome_fantasia)}
    ${serproKv('Situação cadastral', [s.situacao_cadastral, fmtDataBr(s.situacao_data), s.situacao_motivo && `motivo ${s.situacao_motivo}`].filter(Boolean).join(' · '))}
    ${serproKv('Natureza jurídica', s.natureza_juridica)}
    ${serproKv('Data de abertura', fmtDataBr(s.data_abertura))}
    ${serproKv('Porte', s.porte)}
    ${serproKv('CNAE principal', s.cnae_principal)}
    ${(s.cnae_secundarias || []).length ? serproKv(`CNAE secundários (${s.cnae_secundarias.length})`, s.cnae_secundarias.slice(0, 8).join(' | ') + (s.cnae_secundarias.length > 8 ? ' …' : '')) : ''}
    ${serproKv('Endereço', [s.endereco, s.bairro && `${s.bairro}`, s.municipio && `${s.municipio}/${s.uf}`, s.cep && `CEP ${s.cep}`, s.pais].filter(Boolean).join(', '))}
    ${serproKv('Município da jurisdição', s.municipio_jurisdicao)}
    ${(s.telefones || []).length ? serproKv('Telefones', s.telefones.join(' · ')) : ''}
    ${serproKv('E-mail', s.email)}
    ${s.capital_social !== '' && s.capital_social != null ? `<div class="kv"><span>Capital social</span><b>${fmt(Number(String(s.capital_social).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.')) || 0)}</b></div>` : ''}
    ${serproKv('Situação especial', s.situacao_especial ? `${s.situacao_especial}${s.data_situacao_especial ? ' (' + fmtDataBr(s.data_situacao_especial) + ')' : ''}` : '')}
    ${socios ? `<p class="mt-3 small"><b>Quadro societário (${s.socios.length}):</b></p>${socios}` : ''}
    ${serproDetalhes(data)}`;
}

function serproRenderCpf(s, data) {
  s = s || {};
  return `
    ${serproCabecalho(s.nome || 'CPF', data)}
    ${serproKv('CPF', s.cpf)}
    ${serproKv('Nome', s.nome)}
    ${serproKv('Nome social', s.nome_social)}
    ${serproKv('Situação cadastral', s.situacao)}
    ${serproKv('Nascimento', fmtDataBr(s.nascimento) || s.nascimento)}
    ${serproKv('Data de inscrição', fmtDataBr(s.data_inscricao) || s.data_inscricao)}
    ${serproDetalhes(data)}`;
}

// Cartão detalhado de NF-e (protNFe + infNFe — resposta real da Consulta NF-e)
function serproRenderNfe(s, data) {
  s = s || {};
  const v = s.valores || {};
  const itens = (s.itens || []).slice(0, 20).map((i) => `<div class="dd-sub"><p class="small"><b>${ddEsc(String(i.item || ''))} · ${ddEsc(i.descricao || '')}</b><br>${ddEsc([i.codigo && `cód ${i.codigo}`, i.ncm && `NCM ${i.ncm}`, i.cfop && `CFOP ${i.cfop}`, i.quantidade && `${i.quantidade} ${i.unidade || ''}`, i.valor && fmt(i.valor)].filter(Boolean).join(' · '))}</p></div>`).join('');
  const pags = (s.pagamentos || []).filter((p) => p.forma || p.valor).map((p) => `${ddEsc(p.forma || '')}${p.valor ? ` ${fmt(p.valor)}` : ''}`).join(' · ');
  return `
    ${serproCabecalho(`NF-e nº ${s.numero || '—'} (série ${ddEsc(String(s.serie || '—'))})`, data)}
    ${serproKv('Chave de acesso', s.chave)}
    ${serproKv('Situação', [s.situacao_processamento, s.numero_protocolo && `protocolo ${s.numero_protocolo}`].filter(Boolean).join(' · '))}
    ${serproKv('Ambiente', s.ambiente)}
    ${serproKv('Modelo/Série/Número', [s.modelo, s.serie, s.numero].filter(Boolean).join(' / '))}
    ${serproKv('Natureza da operação', s.natureza_operacao)}
    ${serproKv('Tipo', s.tipo)}
    ${serproKv('Finalidade', s.finalidade)}
    ${serproKv('Data de emissão', s.data_emissao)}
    ${serproKv('Data de recebimento', s.data_recebimento)}
    ${s.emissor ? serproKv('Emissor', [s.emissor.documento, s.emissor.nome, s.emissor.fantasia].filter(Boolean).join(' · ')) : ''}
    ${s.emissor && s.emissor.endereco ? serproKv('Endereço do emissor', s.emissor.endereco) : ''}
    ${s.destinatario ? serproKv('Destinatário', [s.destinatario.documento, s.destinatario.nome].filter(Boolean).join(' · ')) : ''}
    ${s.destinatario && s.destinatario.endereco ? serproKv('Endereço do destinatário', s.destinatario.endereco) : ''}
    ${`<div class="kv"><span>Valor dos produtos</span><b>${fmt(v.produtos || 0)}</b></div>`}
    ${`<div class="kv"><span>ICMS / ST / IPI</span><b>${fmt(v.icms || 0)} / ${fmt(v.icms_st || 0)} / ${fmt(v.ipi || 0)}</b></div>`}
    ${`<div class="kv"><span>PIS / COFINS</span><b>${fmt(v.pis || 0)} / ${fmt(v.cofins || 0)}</b></div>`}
    ${(v.frete || v.seguro || v.desconto) ? `<div class="kv"><span>Frete / Seguro / Desconto</span><b>${fmt(v.frete || 0)} / ${fmt(v.seguro || 0)} / ${fmt(v.desconto || 0)}</b></div>` : ''}
    ${`<div class="kv"><span>Total da nota</span><b>${fmt(v.total_nota || v.produtos || 0)}</b></div>`}
    ${pags ? serproKv('Pagamentos', pags) : ''}
    ${(s.volumes || []).length ? serproKv('Volumes', s.volumes.map((x) => [x.especie, x.marca || x.marcas, x.peso_liquido && `PL ${x.peso_liquido}`].filter(Boolean).join(' ')).join(' | ')) : ''}
    ${s.informacoes_adicionais ? serproKv('Informações complementares', String(s.informacoes_adicionais).slice(0, 400)) : ''}
    ${(s.itens || []).length ? `<p class="mt-3 small"><b>Itens (${s.itens.length}):</b></p>${itens}` : ''}
    ${serproDetalhes(data)}`;
}

// Renderizador dos serviços Compartilha RFB (renda / restituição / faturamento)
function serproRenderCompartilha(s) {
  s = s || {};
  if (Array.isArray(s.autorizacoes)) {
    if (!s.autorizacoes.length) return '<p class="muted small">Nenhuma autorização retornada.</p>';
    return s.autorizacoes.map((a) => `
      <div class="dd-sub">
        <p><b>${ddEsc(a.ni || a.token || 'Autorização')}</b> · ${ddEsc(a.status || '')}</p>
        ${serproKv('Token', a.token)}
        ${serproKv('Vigência', [a.vigenciaInicial, a.vigenciaFinal].filter(Boolean).join(' → '))}
        ${serproKv('Serviço', [a.idServico, a.versao].filter(Boolean).join(' v'))}
        ${serproKv('Hash ICP-Brasil', a.hashStatus)}
      </div>`).join('') + (s.errorResponse ? serproKv('Erro', s.errorResponse) : '');
  }
  if (s.status) return serproKv('Status', typeof s.status === 'object' ? JSON.stringify(s.status) : s.status);
  const a = s.autorizacao;
  let out = '';
  if (a) out += serproKv('Titular', a.titular) + serproKv('Destinatário', a.destinatario) + serproKv('Registro da autorização', a.dataHoraRegistro);
  out += serproKv('Serviço', [s.servico, s.idServico, s.versao && `v${s.versao}`].filter(Boolean).join(' · '));
  out += (s.dados || []).map((x) => `
    <div class="dd-sub"><p class="small"><b>${ddEsc([x.codigo, x.texto].filter(Boolean).join(' · ') || 'Dado')}</b>${x.valorTexto ? `<br>${ddEsc(String(x.valorTexto).slice(0, 300))}` : ''}</p></div>`).join('');
  Object.entries(s.blocos || {}).forEach(([nome, dados]) => {
    out += `<p class="mt-3 small"><b>${ddEsc(nome.replace(/^dados/, '').replace(/([a-z])([A-Z])/g, '$1 $2'))}:</b></p>`;
    out += dados.map((x) => `<div class="kv"><span>${ddEsc([x.codigo, x.texto].filter(Boolean).join(' · '))}</span><b>${ddEsc(String(x.valorTexto || x.valor || '').slice(0, 120))}</b></div>`).join('');
  });
  if (s.mensagem) out += serproKv('Mensagem', s.mensagem);
  return out || ddBloque(s);
}

// Cartão detalhado de CCIR (INCRA)
function serproRenderCcir(s) {
  s = s || {};
  const titulares = (s.titulares || []).map((t) => `<div class="dd-sub"><p class="small"><b>${ddEsc(t.nome || '—')}</b> · ${ddEsc(t.documento || '')}${t.condicao ? ` · ${ddEsc(t.condicao)}` : ''}${t.percentual ? ` · ${ddEsc(t.percentual)}%` : ''}</p></div>`).join('');
  const areas = (s.areas_registradas || []).map((a) => `<div class="dd-sub"><p class="small">${ddEsc([a.area && `Área ${a.area}`, a.registro, a.cns_oficio && `CNS ${a.cns_oficio}`, a.municipio_cartorio && `${a.municipio_cartorio}/${a.uf_cartorio}`, a.data_registro].filter(Boolean).join(' · '))}</p></div>`).join('');
  return `
    ${serproKv('Código do imóvel (INCRA)', s.codigo_imovel)}
    ${serproKv('Denominação', s.denominacao)}
    ${serproKv('Área total', s.area_total)}
    ${serproKv('Área registrada / certificada', [s.area_registrada, s.area_certificada].filter(Boolean).join(' / '))}
    ${serproKv('Módulos fiscal / rural', [s.area_modulo_fiscal, s.area_modulo_rural].filter(Boolean).join(' / '))}
    ${serproKv('Nº de módulos fiscais', s.numero_modulos_fiscais)}
    ${serproKv('Classificação fundiária', s.classificacao_fundiaria)}
    ${serproKv('Sede', [s.municipio_sede, s.uf_sede].filter(Boolean).join('/'))}
    ${s.situacao_ccir ? serproKv('Situação do CCIR', [s.situacao_ccir, s.numero_ccir && `nº ${s.numero_ccir}`].filter(Boolean).join(' · ')) : ''}
    ${s.data_geracao ? serproKv('Geração / vencimento', [s.data_geracao, s.data_vencimento && `vence ${fmtDataBr(s.data_vencimento)}`].filter(Boolean).join(' · ')) : ''}
    ${s.valor_total || s.valor_cobrado ? `<div class="kv"><span>Valor total / cobrado</span><b>${fmt(s.valor_total || 0)} / ${fmt(s.valor_cobrado || 0)}</b></div>` : ''}
    ${s.juros || s.multa ? `<div class="kv"><span>Juros / Multa</span><b>${fmt(s.juros || 0)} / ${fmt(s.multa || 0)}</b></div>` : ''}
    ${s.autenticidade ? serproKv('Autenticidade', s.autenticidade) : ''}
    ${titulares ? `<p class="mt-3 small"><b>Titulares (${(s.titulares || []).length}):</b></p>${titulares}` : ''}
    ${areas ? `<p class="mt-3 small"><b>Áreas registradas (${(s.areas_registradas || []).length}):</b></p>${areas}` : ''}`;
}

function baixarPdfBase64(b64, nome) {
  try {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = nome || 'documento.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch { alert('Não foi possível abrir o PDF.'); }
}

function baixarCndPdf() {
  if (window.__serproCndPdf) baixarPdfBase64(window.__serproCndPdf, 'cnd-serpro.pdf');
}

function serproExtra(id) {
  return document.getElementById(`serproE_${id}`);
}

function serproServicoChange() {
  const svc = $('serproServico')?.value || 'cnpj';
  const spec = SERPRO_SERVICOS[svc] || SERPRO_SERVICOS.cnpj;
  $('serproMainRow').classList.toggle('hidden', !spec.main);
  if (spec.ph) $('serproInput').placeholder = spec.ph;
  const ex = $('serproExtras');
  ex.innerHTML = '';
  (spec.extras || []).forEach(([id, tipo, rotulo]) => {
    const row = document.createElement('div');
    row.className = 'search-row mt-3';
    if (tipo === 'select') {
      row.innerHTML = `<select class="field" id="serproE_${id}">${rotulo.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
    } else if (tipo === 'check') {
      row.innerHTML = `<label class="small muted" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="serproE_${id}"> ${rotulo}</label>`;
    } else if (tipo === 'textarea') {
      row.innerHTML = `<textarea class="field" id="serproE_${id}" rows="3" placeholder="${rotulo}"></textarea>`;
    } else {
      row.innerHTML = `<input class="field" id="serproE_${id}" placeholder="${rotulo}">`;
    }
    ex.appendChild(row);
  });
  $('serpro-result').innerHTML = '';
}

function serproErro(el, erro) {
  const base = `<p class="form-error">${ddEsc(erro.message)}</p>`;
  if (erro.code === 'SERPRO_SEM_ASSINATURA' || erro.code === 'SERPRO_NAO_CONFIGURADO') {
    el.innerHTML = `${base}<p class="mt-3"><a class="link" href="${SERPRO_LOJA}" target="_blank" rel="noopener">Assinar produtos Serpro na loja oficial ↗</a></p>`;
    return;
  }
  el.innerHTML = base;
}

async function consultarSerpro() {
  const svc = $('serproServico')?.value || 'cnpj';
  const el = $('serpro-result');
  el.innerHTML = '<p class="muted">Consultando a base oficial do Serpro...</p>';

  try {
    // ---- Serviços sem campo principal ----
    if (svc === 'ia') {
      const prompt = (serproExtra('prompt')?.value || '').trim();
      if (!prompt) {
        el.innerHTML = '<p class="form-error">Descreva o que a IA deve analisar.</p>';
        return;
      }
      const data = await api('/integracao/serpro?acao=ia', { method: 'POST', body: JSON.stringify({ prompt }) });
      el.innerHTML = `<h4>Serpro IA</h4><p class="muted small">${ddEsc(data.fonte || '')}</p>${ddBloque(data.resposta)}`;
      return;
    }

    if (svc === 'due') {
      const numero = (serproExtra('numero')?.value || '').trim();
      const chave = (serproExtra('chave')?.value || '').trim();
      if (!numero || !chave) {
        el.innerHTML = '<p class="form-error">Informe o número e a chave de acesso da DUE.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=due&numero=${encodeURIComponent(numero)}&chave=${encodeURIComponent(chave)}`);
      const s = data.resumo || {};
      el.innerHTML = `
        ${serproCabecalho(`DUE ${numero}`, data)}
        ${serproKv('Situação', s.situacao)}
        ${serproKv('Canal', s.canal)}
        ${serproKv('Situação da carga', s.situacaoDaCarga)}
        ${serproKv('Bloqueada p/ embarque', s.bloqueadaParaEmbarque)}
        ${serproKv('Exigência', s.exigencia)}
        ${serproKv('Declarante', s.declarante)}
        ${serproKv('Forma de exportação', s.formaExportacao)}
        ${serproKv('País do importador', s.paisImportador)}
        ${serproKv('Peso líquido total', s.pesoLiquidoTotal)}
        ${s.valorMercadorias ? `<div class="kv"><span>Valor das mercadorias</span><b>${fmt(s.valorMercadorias)} (${ddEsc(String(s.moeda || ''))})</b></div>` : ''}
        ${serproKv('Itens / Eventos', `${s.totalItens || 0} itens · ${s.totalEventos || 0} eventos`)}
        ${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'faturamento') {
      const tipo = serproExtra('tipo')?.value || 'consultar';
      const token = (serproExtra('token')?.value || '').trim();
      const contratante = (serproExtra('contratante')?.value || '').replace(/\D/g, '');
      const titular = (serproExtra('titular')?.value || '').replace(/\D/g, '');
      if (tipo === 'consultar' && (!token || contratante.length !== 14)) {
        el.innerHTML = '<p class="form-error">Informe o token de autorização e o CNPJ do contratante (14 dígitos).</p>';
        return;
      }
      if (tipo === 'autorizacoes' && (contratante.length !== 14 || titular.length !== 11)) {
        el.innerHTML = '<p class="form-error">CNPJ do contratante (14) e CPF do titular (11) são obrigatórios.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=faturamento&tipo=${tipo}&token=${encodeURIComponent(token)}&contratante=${contratante}&titular=${titular}`);
      el.innerHTML = `${serproCabecalho(`Faturamento (Compartilha RFB) · ${tipo}`, data)}${serproRenderCompartilha(data.resumo)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'contador') {
      const operacao = serproExtra('operacao')?.value || 'Consultar';
      const jwt = (serproExtra('jwt')?.value || '').trim();
      const dadosRaw = (serproExtra('dados')?.value || '').trim();
      if (!dadosRaw) {
        el.innerHTML = '<p class="form-error">Informe o DadosEntrada (JSON).</p>';
        return;
      }
      let dados;
      try { dados = JSON.parse(dadosRaw); } catch {
        el.innerHTML = '<p class="form-error">DadosEntrada precisa ser um JSON válido.</p>';
        return;
      }
      const data = await api('/integracao/serpro?acao=contador', { method: 'POST', body: JSON.stringify({ operacao, jwtToken: jwt, dados }) });
      el.innerHTML = `${serproCabecalho(`Integra Contador · ${operacao}`, data)}${ddBloque(data.retorno)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'carimbo') {
      const base64 = (serproExtra('base64')?.value || '').trim();
      if (!base64) {
        el.innerHTML = '<p class="form-error">Informe o timestamp em base64.</p>';
        return;
      }
      let document;
      const docRaw = (serproExtra('document')?.value || '').trim();
      if (docRaw) {
        try { document = JSON.parse(docRaw); } catch {
          el.innerHTML = '<p class="form-error">Documento precisa ser um JSON válido.</p>';
          return;
        }
      }
      const data = await api('/integracao/serpro?acao=carimbo', { method: 'POST', body: JSON.stringify({ base64, document }) });
      el.innerHTML = `${serproCabecalho('Carimbo de Tempo', data)}${ddBloque(data.verificacao)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'renda' || svc === 'restituicao') {
      const tipo = serproExtra('tipo')?.value || 'consultar';
      const token = (serproExtra('token')?.value || '').trim();
      const contratante = (serproExtra('contratante')?.value || '').replace(/\D/g, '');
      const titular = (serproExtra('titular')?.value || '').replace(/\D/g, '');
      if (tipo === 'consultar' && !token) {
        el.innerHTML = '<p class="form-error">Informe o token de autorização (e-CAC → Compartilha).</p>';
        return;
      }
      if (tipo === 'autorizacoes' && (contratante.length !== 14 || titular.length !== 11)) {
        el.innerHTML = '<p class="form-error">CNPJ do contratante (14) e CPF do titular (11) são obrigatórios.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=${svc}&tipo=${tipo}&token=${encodeURIComponent(token)}&contratante=${contratante}&titular=${titular}`);
      const titulo = svc === 'renda' ? 'Renda PF (IRPF)' : 'Restituição IRPF';
      el.innerHTML = `${serproCabecalho(`${titulo} · ${tipo}`, data)}${serproRenderCompartilha(data.resumo)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'datavalid-status') {
      const data = await api('/integracao/serpro?acao=datavalid-status');
      el.innerHTML = `${serproCabecalho('Datavalid · Status', data)}${ddBloque(data.status)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'nfe-push') {
      const tipo = serproExtra('tipo')?.value || 'status';
      const chaves = (serproExtra('chaves')?.value || '').trim();
      const id = (serproExtra('id')?.value || '').trim();
      if (tipo === 'criar' && !chaves) {
        el.innerHTML = '<p class="form-error">Informe as chaves de acesso (uma por linha).</p>';
        return;
      }
      if (tipo === 'excluir' && !id) {
        el.innerHTML = '<p class="form-error">Informe o ID do monitoramento.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=nfe-push&tipo=${tipo}${tipo === 'excluir' ? '&id=' + encodeURIComponent(id) : ''}`, { method: 'POST', body: JSON.stringify({ chaves, id }) });
      el.innerHTML = `${serproCabecalho('NF-e · Monitoramento (push)', data)}${ddBloque(data.push)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'antecipa') {
      const tipo = serproExtra('tipo')?.value || 'cotacoes';
      const id = (serproExtra('id')?.value || '').trim();
      const ni = (serproExtra('ni')?.value || '').replace(/\D/g, '');
      const uasg = (serproExtra('uasg')?.value || '').trim();
      const contrato = (serproExtra('contrato')?.value || '').trim();
      const nivel = serproExtra('nivel')?.value || 'detalhada';
      if (['dadosbasicos', 'situacaonivel', 'regularidade', 'ocorrencias', 'historico'].includes(tipo) && !ni) {
        el.innerHTML = '<p class="form-error">Informe o CPF ou CNPJ do fornecedor.</p>';
        return;
      }
      if (['proposta', 'arquivo'].includes(tipo) && !id) {
        el.innerHTML = '<p class="form-error">Informe o ID (cotação / arquivo).</p>';
        return;
      }
      if (tipo === 'contrato' && (!id || !uasg || !contrato)) {
        el.innerHTML = '<p class="form-error">Informe cotação, UASG e número do contrato.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=antecipa&tipo=${tipo}&ni=${ni}&id=${encodeURIComponent(id)}&uasg=${encodeURIComponent(uasg)}&contrato=${encodeURIComponent(contrato)}&nivel=${nivel}`);
      el.innerHTML = `${serproCabecalho(`Antecipa Gov · Portal · ${tipo}`, data)}${ddBloque(data.antecipa)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'pilar') {
      const tipo = serproExtra('tipo')?.value || 'avaliacao';
      const ni = (serproExtra('ni')?.value || '').replace(/\D/g, '');
      const id = (serproExtra('id')?.value || '').trim();
      const uasg = (serproExtra('uasg')?.value || '').trim();
      const contrato = (serproExtra('contrato')?.value || '').trim();
      if (tipo === 'avaliacao' && ni.length !== 11 && ni.length !== 14) {
        el.innerHTML = '<p class="form-error">Informe o CPF (11) ou CNPJ (14) do fornecedor.</p>';
        return;
      }
      if (['contratos', 'ordembancaria', 'operacao'].includes(tipo) && !id) {
        el.innerHTML = '<p class="form-error">Informe o ID.</p>';
        return;
      }
      if (['cotacao', 'documento', 'cronograma', 'empenhos', 'faturas', 'historico', 'itens'].includes(tipo) && (!id || !uasg || !contrato)) {
        el.innerHTML = '<p class="form-error">Informe cotação, UASG e número do contrato.</p>';
        return;
      }
      if (tipo === 'empenho' && (!id || !uasg || !contrato)) {
        el.innerHTML = '<p class="form-error">Informe cotação, UASG e número do empenho.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=pilar&tipo=${tipo}&ni=${ni}&id=${encodeURIComponent(id)}&uasg=${encodeURIComponent(uasg)}&contrato=${encodeURIComponent(contrato)}`);
      el.innerHTML = `${serproCabecalho(`Antecipa Gov · PILAR · ${tipo}`, data)}${ddBloque(data.pilar)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'ccir') {
      const tipo = serproExtra('tipo')?.value || 'ni';
      const ni = (serproExtra('ni')?.value || '').replace(/\D/g, '');
      const codigo = (serproExtra('codigo')?.value || '').trim().toUpperCase();
      if (tipo === 'ni' && ni.length !== 11 && ni.length !== 14) {
        el.innerHTML = '<p class="form-error">Informe o CPF ou CNPJ do titular do imóvel.</p>';
        return;
      }
      if (['codigo', 'emitir'].includes(tipo) && !codigo) {
        el.innerHTML = '<p class="form-error">Informe o código do imóvel (INCRA).</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=ccir&tipo=${tipo}&ni=${ni}&codigo=${encodeURIComponent(codigo)}`);
      if (tipo === 'ni' && Array.isArray(data.ccir)) {
        el.innerHTML = `
          ${serproCabecalho('CCIR · Imóveis rurais do titular', data)}
          ${serproKv('Códigos encontrados', data.ccir.length)}
          ${data.ccir.map((c) => `<div class="kv"><span>Código INCRA</span><b>${ddEsc(String(c))}</b></div>`).join('')}
          <p class="mt-2 small muted">Use o tipo “Dados do CCIR pelo código” com um dos códigos acima.</p>
          ${serproDetalhes(data)}`;
        return;
      }
      el.innerHTML = `${serproCabecalho(tipo === 'emitir' ? 'CCIR · Emissão' : tipo === 'status' ? 'CCIR · Status' : 'CCIR · Dados do imóvel', data)}${tipo === 'status' ? ddBloque(data.ccir) : serproRenderCcir(data.resumo)}${serproDetalhes(data)}`;
      return;
    }

    // ---- Serviços com campo principal ----
    const valor = ($('serproInput')?.value || '').replace(/\D/g, '');
    if (!valor) {
      el.innerHTML = '<p class="form-error">Preencha o campo de consulta.</p>';
      return;
    }

    if (svc === 'cnpj') {
      if (valor.length !== 14) {
        el.innerHTML = '<p class="form-error">CNPJ inválido (14 dígitos).</p>';
        return;
      }
      const modo = serproExtra('modo')?.value || 'basica';
      const data = await api(`/integracao/serpro?acao=cnpj&cnpj=${valor}&modo=${modo}`);
      el.innerHTML = serproRenderCnpj(data.resumo || data.cnpj || {}, data);
      return;
    }

    if (svc === 'cpf' || svc === 'situacao-cpf') {
      if (valor.length !== 11) {
        el.innerHTML = '<p class="form-error">CPF inválido (11 dígitos).</p>';
        return;
      }
      const nascRaw = (serproExtra('nasc')?.value || '').replace(/\D/g, '');
      const m = /^(\d{2})(\d{2})(\d{4})$/.exec(nascRaw);
      const nasc = nascRaw.length === 8 && !m ? nascRaw : (m ? m[1] + m[2] + m[3] : '');
      if (nasc.length !== 8) {
        el.innerHTML = '<p class="form-error">Informe o nascimento (dd/mm/aaaa) — obrigatório na CPF v3 do Serpro.</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=${svc}&cpf=${valor}&nasc=${nasc}`);
      el.innerHTML = serproRenderCpf(data.resumo || {}, data);
      return;
    }

    if (svc === 'nfe') {
      if (valor.length !== 44) {
        el.innerHTML = '<p class="form-error">Chave de acesso inválida (44 dígitos).</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=nfe&chave=${valor}`);
      el.innerHTML = serproRenderNfe(data.resumo || {}, data);
      return;
    }

    if (svc === 'nfe-escalonada') {
      if (valor.length !== 44) {
        el.innerHTML = '<p class="form-error">Chave de acesso inválida (44 dígitos).</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=nfe-escalonada&chave=${valor}`);
      el.innerHTML = `${serproCabecalho('NF-e Escalonada (processamento em lote)', data)}${ddBloque(data.resumo)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'cnd') {
      if (![8, 11, 14].includes(valor.length)) {
        el.innerHTML = '<p class="form-error">Contribuinte inválido (CPF 11, CNPJ 14 ou NIRF 8).</p>';
        return;
      }
      const tipo = Number(serproExtra('tipo')?.value || (valor.length === 11 ? 1 : 2));
      const pdf = serproExtra('pdf')?.checked === true;
      const data = await api('/integracao/serpro?acao=cnd', { method: 'POST', body: JSON.stringify({ tipo, contribuinte: valor, pdf }) });
      const s = data.resumo || {};
      window.__serproCndPdf = data.pdfBase64 || '';
      el.innerHTML = `
        ${serproCabecalho('CND · Certidão Negativa de Débitos', data)}
        ${serproKv('Status', s.status)}
        ${serproKv('Mensagem', s.mensagem)}
        ${serproKv('Contribuinte', s.contribuinte)}
        ${serproKv('Tipo de certidão', s.tipoCertidao)}
        ${serproKv('Código de controle', s.codigoControle)}
        ${serproKv('Emissão', fmtDataBr(s.dataEmissao) || s.dataEmissao)}
        ${serproKv('Validade', fmtDataBr(s.dataValidade) || s.dataValidade)}
        ${s.temPdf && data.pdfBase64 ? '<button class="btn btn-ghost mt-2" onclick="UI.baixarCndPdf()">⬇ Baixar certidão em PDF</button>' : ''}
        ${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'divida-ativa') {
      if (valor.length !== 11 && valor.length !== 14) {
        el.innerHTML = '<p class="form-error">Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=divida-ativa&ni=${valor}`);
      const tags = {
        com_debitos: ['tag-cancelada', '⚠ Com débitos'],
        regular: ['tag-autorizada', '✓ Regular'],
        sem_registros: ['tag-rascunho', 'Sem registros'],
      };
      const [tagCls, tagTxt] = tags[data.situacao] || ['tag-rascunho', data.situacao];
      const trialBadge = data.ambiente === 'trial' ? '<span class="tag tag-rascunho">demonstração</span>' : '';
      const rows = (data.inscricoes || []).map((i) => `
        <div class="kv"><span>${ddEsc(i.origem || 'Inscrição ' + i.numero)}${i.numero ? ' · ' + ddEsc(i.numero) : ''}${i.devedor ? ' · ' + ddEsc(i.devedor) : ''}</span><b>${ddEsc(String(i.situacao || '—'))} — ${fmt(i.valor)}</b></div>`).join('');
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <h4>Dívida Ativa da União ${trialBadge}</h4>
          <span class="tag ${tagCls}">${tagTxt}</span>
        </div>
        <p class="muted small">${ddEsc(data.fonte || '')}</p>
        <div class="kv"><span>Total consolidado</span><b>${fmt(data.totalConsolidado)}</b></div>
        ${rows || '<p class="muted small">Nenhuma inscrição retornada.</p>'}`;
      return;
    }

    if (svc === 'divida-inscricao') {
      if (valor.length < 6) {
        el.innerHTML = '<p class="form-error">Informe o número da inscrição (somente dígitos).</p>';
        return;
      }
      const data = await api(`/integracao/serpro?acao=divida-inscricao&numero=${valor}`);
      const i = data.inscricao || {};
      const trialBadge = data.ambiente === 'trial' ? '<span class="tag tag-rascunho">demonstração</span>' : '';
      el.innerHTML = `
        <h4>Inscrição ${ddEsc(String(i.numero || valor))} ${trialBadge}</h4>
        <p class="muted small">${ddEsc(data.fonte || '')}</p>
        <div class="kv"><span>Situação</span><b>${ddEsc(String(i.situacao || '—'))}</b></div>
        <div class="kv"><span>Órgão de origem</span><b>${ddEsc(String(i.origem || '—'))}</b></div>
        <div class="kv"><span>Data da inscrição</span><b>${ddEsc(String(i.dataInscricao || '—'))}</b></div>
        <div class="kv"><span>Valor inscrito</span><b>${fmt(i.valorTotalInscrito || 0)}</b></div>
        <div class="kv"><span>Valor consolidado</span><b>${fmt(i.valorConsolidado || 0)}</b></div>
        <div class="kv"><span>Valor remanescente</span><b>${fmt(i.valorRemanescente || 0)}</b></div>
        ${i.processo ? `<div class="kv"><span>Processo</span><b>${ddEsc(String(i.processo))}</b></div>` : ''}
        ${i.unidade ? `<div class="kv"><span>PFN responsável</span><b>${ddEsc(String(i.unidade))}</b></div>` : ''}
        <details class="mt-3"><summary class="small muted">Retorno completo</summary>${ddBloque(data.detalhes)}</details>`;
      return;
    }

    if (svc === 'compras') {
      const tipo = serproExtra('tipo')?.value || 'chat';
      const data = await api(`/integracao/serpro?acao=compras&compra=${encodeURIComponent(valor)}&tipo=${tipo}`);
      el.innerHTML = `${serproCabecalho('Compras.gov.br · ' + (tipo === 'diligencias' ? 'Diligências' : 'Chat'), data)}${ddBloque(data.mensagens)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'comex') {
      const servico = serproExtra('servico')?.value || 'container';
      const jwt = (serproExtra('jwt')?.value || '').trim();
      const recinto = (serproExtra('recinto')?.value || '').trim();
      if (servico === 'habitacao' && valor.length !== 14) {
        el.innerHTML = '<p class="form-error">CNPJ inválido (14 dígitos).</p>';
        return;
      }
      if (servico === 'presenca' && !recinto) {
        el.innerHTML = '<p class="form-error">Informe o recinto para presença de carga.</p>';
        return;
      }
      let data;
      if (servico === 'container') {
        data = await api('/integracao/serpro?acao=comex&servico=container', { method: 'POST', body: JSON.stringify({ numero: valor, jwtToken: jwt }) });
      } else if (servico === 'presenca') {
        data = await api('/integracao/serpro?acao=comex&servico=presenca', { method: 'POST', body: JSON.stringify({ nic: valor, recinto, jwtToken: jwt }) });
      } else {
        data = await api(`/integracao/serpro?acao=comex&servico=habitacao&cnpj=${valor}`, { method: 'POST', body: JSON.stringify({ jwtToken: jwt }) });
      }
      el.innerHTML = `${serproCabecalho(`Integra Comex · ${servico}`, data)}${ddBloque(data.comex)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'cartorio') {
      const modo = serproExtra('modo')?.value || 'basica';
      const esperado = modo === 'cpf' ? 11 : 14;
      if (valor.length !== esperado) {
        el.innerHTML = `<p class="form-error">${modo === 'cpf' ? 'CPF inválido (11 dígitos).' : 'CNPJ inválido (14 dígitos).'}</p>`;
        return;
      }
      const data = await api(`/integracao/serpro?acao=cartorio&ni=${valor}&modo=${modo}`);
      el.innerHTML = modo === 'cpf'
        ? serproRenderCpf(data.resumo || {}, data)
        : serproRenderCnpj(data.resumo || {}, data, `Cartório Data · ${modo}`);
      return;
    }

    if (svc === 'datavalid') {
      if (valor.length !== 11) {
        el.innerHTML = '<p class="form-error">CPF inválido (11 dígitos).</p>';
        return;
      }
      const nome = (serproExtra('nome')?.value || '').trim();
      const nascRaw = (serproExtra('nasc')?.value || '').replace(/\D/g, '');
      const m = /^(\d{2})(\d{2})(\d{4})$/.exec(nascRaw);
      const nasc = nascRaw.length === 8 && !m ? nascRaw : (m ? m[1] + m[2] + m[3] : '');
      if (nascRaw && nasc.length !== 8) {
        el.innerHTML = '<p class="form-error">Nascimento inválido (dd/mm/aaaa).</p>';
        return;
      }
      const rfb = serproExtra('rfb')?.checked === true;
      const senatran = serproExtra('senatran')?.checked === true;
      const data = await api('/integracao/serpro?acao=datavalid', { method: 'POST', body: JSON.stringify({ cpf: valor, nome, nasc, rfb, senatran }) });
      el.innerHTML = `${serproCabecalho('Datavalid · Validação de identidade', data)}${ddBloque(data.validacao)}${serproDetalhes(data)}`;
      return;
    }

    if (svc === 'biovalid') {
      if (valor.length !== 11) {
        el.innerHTML = '<p class="form-error">CPF inválido (11 dígitos).</p>';
        return;
      }
      const servico = serproExtra('servico')?.value || 'token';
      const pin = (serproExtra('pin')?.value || '').trim();
      const device = (serproExtra('device')?.value || '').trim();
      const selfie = (serproExtra('selfie')?.value || '').trim();
      if (servico === 'liveness' && (!pin || !device || !selfie)) {
        el.innerHTML = '<p class="form-error">PIN, dispositivo e selfie (base64) são obrigatórios na prova de vida.</p>';
        return;
      }
      const data = await api('/integracao/serpro?acao=biovalid', {
        method: 'POST',
        body: JSON.stringify({
          cpf: valor, servico,
          expiraEm: (serproExtra('expira')?.value || '').trim(),
          tentativas: (serproExtra('tentativas')?.value || '').trim(),
          pin, device, selfie,
          sexo: (serproExtra('sexo')?.value || '').trim().toUpperCase(),
        }),
      });
      el.innerHTML = `${serproCabecalho(`BioValid · ${servico === 'liveness' ? 'Prova de vida' : 'Token'}`, data)}${ddBloque(data.biovalid)}${serproDetalhes(data)}`;
      return;
    }

    el.innerHTML = '<p class="form-error">Serviço não reconhecido.</p>';
  } catch (erro) {
    serproErro(el, erro);
  }
}

// ============================================================
// BUSCA ÚNICA — uma lupa, todas as bases (nomes de fornecedores
// ficam no backend; o cliente vê só o retrato completo)
// ============================================================
const LUPA = { doc: '', tipo: '', secoes: [], memo: {}, campos: { uf: '', valorOperacao: '' } };

// Cada frente reusa a mesma chamada: um único número digitado = uma consulta por base.
function lupaMemo(key, factory) {
  if (!LUPA.memo[key]) {
    LUPA.memo[key] = Promise.resolve().then(factory).catch((e) => { delete LUPA.memo[key]; throw e; });
  }
  return LUPA.memo[key];
}

function lupaDetectarTipo(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 8) return { tipo: 'cep', doc: d };
  if (d.length === 11) return { tipo: 'cpf', doc: d };
  if (d.length === 14) return { tipo: 'cnpj', doc: d };
  if (d.length === 44) return { tipo: 'nfe', doc: d };
  return { tipo: d.length ? 'indefinido' : 'vazio', doc: d };
}

function lupaMascara(tipo, doc) {
  if (tipo === 'cep') return `${doc.slice(0, 5)}-${doc.slice(5)}`;
  if (tipo === 'cpf') return `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`;
  if (tipo === 'cnpj') return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}`;
  if (tipo === 'nfe') return (doc.match(/.{1,4}/g) || []).join(' ');
  return doc;
}

function lupaDetectarChange() {
  const { tipo } = lupaDetectarTipo($('lupaInput').value);
  const mapa = {
    cep: '📍 CEP detectado — o endereço completo será localizado.',
    cpf: '👤 CPF detectado — todas as frentes de pessoa física serão varridas.',
    cnpj: '🏢 CNPJ detectado — todas as frentes de pessoa jurídica serão varridas.',
    nfe: '🧾 Chave de NF-e detectada — o documento será localizado nas bases oficiais.',
    indefinido: 'Digite 8 dígitos (CEP), 11 (CPF), 14 (CNPJ) ou 44 (chave de NF-e).',
    vazio: 'Detectamos automaticamente o que você digitou.',
  };
  const el = $('lupaDetect');
  if (el) el.textContent = mapa[tipo] || mapa.vazio;
  document.querySelectorAll('.lupa-chip').forEach((c) => c.classList.toggle('ativa', c.dataset.t === tipo));
}

function lupaFonteGen(d, txt) { return { ...d, fonte: txt }; }

// Os fornecedores ficam no backend: nenhuma mensagem exibida na lupa pode trazê-los.
const LUPA_NEUTRO = [
  [/loja\.serpro\.gov\.br\/?\S*/gi, ''],
  [/(app|gateway)\.apibrasil\.io\S*/gi, ''],
  [/app\.directd\.com\.br\S*/gi, ''],
  [/(api\.)?seras(aexperian|saexperian)\.com\.br\S*/gi, ''],
  [/https?:\/\/\S+/gi, ''],
  [/\bdirect\s*data\b|\bdirectd\b/gi, 'base ampliada'],
  [/api\s*brasil/gi, 'base de crédito'],
  [/serasa\s+experian|\bserasa\b/gi, 'verificação de risco'],
  [/infinite\s*pay/gi, 'meio de pagamento'],
  [/\bserpro\b/gi, 'base oficial'],
];

function lupaNeutro(txt) {
  let s = String(txt || '');
  for (const [re, rep] of LUPA_NEUTRO) s = s.replace(re, rep);
  return s.replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/g, '').trim();
}

function lupaCnpjOficial(doc) {
  return lupaMemo('cad', () => api(`/integracao/serpro?acao=cnpj&cnpj=${doc}`));
}

async function lupaRunCnpjOficial(doc) {
  const d = await lupaCnpjOficial(doc);
  return serproRenderCnpj(d.resumo, lupaFonteGen(d, 'Base oficial · Receita Federal'));
}

function lupaCpfBasico(doc) {
  return lupaMemo('basico', () => api(`/integracao/cpf?cpf=${doc}`));
}

async function lupaRunCpfBasico(doc) {
  const d = await lupaCpfBasico(doc);
  return `
    <div class="kv"><span>CPF</span><b>${lupaMascara('cpf', doc)}</b></div>
    <div class="kv"><span>Estrutura</span><b>${d.cpf?.isValid ? 'Dígitos verificadores válidos ✓' : 'Estrutura inválida ✗'}</b></div>
    ${d.cpf && Object.keys(d.cpf).length > 1 ? ddBloque(d.cpf) : ''}`;
}

async function lupaRunCpfOficial(doc) {
  const nasc = ($('lupaNasc')?.value || '').replace(/\D/g, '');
  if (nasc.length !== 8) { const e = new Error('Informe a data de nascimento (ddmmaaaa) para a consulta oficial.'); e.code = 'NASC'; throw e; }
  const d = await lupaMemo('oficial', () => api(`/integracao/serpro?acao=cpf&cpf=${doc}&nasc=${nasc}`));
  return serproRenderCpf(d.resumo, lupaFonteGen(d, 'Base oficial · Receita Federal'));
}

function lupaDivida(doc) {
  return lupaMemo('divida', () => api(`/integracao/serpro?acao=divida-ativa&ni=${doc}`));
}

async function lupaRunDivida(doc) {
  let d;
  try {
    d = await lupaDivida(doc);
  } catch (e) {
    if (!/no matching resource|not found|subscription|api subscription/i.test(String(e.message || ''))) throw e;
    return `<div class="lupa-status"><span class="tag tag-rascunho">Sem cobertura</span><b>A base oficial de dívida ativa não devolve dados para este documento agora.</b></div>
      <p class="muted small">Use o modo avançado para consultar pelo número da inscrição, ou tente novamente mais tarde — as demais frentes não dependem desta base.</p>`;
  }
  const tags = { com_debitos: ['tag-cancelada', '⚠ Com débitos'], regular: ['tag-autorizada', '✓ Regular'], sem_registros: ['tag-rascunho', 'Sem registros'] };
  const [cls, txt] = tags[d.situacao] || ['tag-rascunho', String(d.situacao || '—')];
  const rows = (d.inscricoes || []).map((i) => `<div class="kv"><span>${ddEsc(i.origem || 'Inscrição')}${i.numero ? ` · ${ddEsc(i.numero)}` : ''}</span><b>${ddEsc(i.situacao || '—')} — ${fmt(i.valor || 0)}</b></div>`).join('');
  return `
    <div class="lupa-status"><span class="tag ${cls}">${txt}</span><b>Total consolidado: ${fmt(d.totalConsolidado || 0)}</b></div>
    ${rows || '<p class="muted small">Nenhuma inscrição encontrada nesta base.</p>'}`;
}

const LUPA_SIT = { com_debitos: 'há débitos em aberto', regular: 'sem débitos em aberto', sem_registros: 'sem registros' };

function lupaIndiceHtml(rotulo, pct, linhas) {
  const cor = pct >= 75 ? '#059669' : pct >= 45 ? '#d97706' : '#b91c1c';
  return `
    <div class="lupa-status">
      <span>${rotulo} <b style="color:${cor}">${pct}%</b></span>
      <span class="tag ${pct >= 75 ? 'tag-autorizada' : 'tag-rascunho'}">calculado sobre dados oficiais</span>
    </div>
    ${linhas.map((l) => `<div class="kv"><span>${ddEsc(l[0])}</span><b>${l[1] ? '✓' : '✗'} ${ddEsc(String(l[2] ?? '—'))}</b></div>`).join('')}`;
}

async function lupaLinhaDivida(doc) {
  const d = await lupaDivida(doc).catch(() => null);
  if (!d) return ['Dívida Ativa da União', false, 'sem retorno agora'];
  return ['Dívida Ativa da União', d.situacao !== 'com_debitos', `${LUPA_SIT[d.situacao] || d.situacao}${d.totalConsolidado ? ` (${fmt(d.totalConsolidado)})` : ''}`];
}

async function lupaIndiceCnpj(doc) {
  const d = await lupaCnpjOficial(doc);
  const s = d.resumo || d.cnpj || {};
  const contato = s.email || (s.telefones || [])[0] || '';
  const linhas = [
    ['Situação cadastral', !!s.situacao_cadastral, s.situacao_cadastral],
    ['Data de abertura', !!s.data_abertura, s.data_abertura],
    ['Natureza jurídica', !!s.natureza_juridica, s.natureza_juridica],
    ['CNAE principal', !!s.cnae_principal, s.cnae_principal],
    ['Endereço completo', !!(s.endereco && s.municipio && s.uf), [s.endereco, s.bairro, `${s.municipio || '—'}/${s.uf || '—'}`].filter(Boolean).join(' · ')],
    ['Contato cadastrado', !!contato, contato],
    ['Quadro societário', (s.socios || []).length > 0, `${(s.socios || []).length} registrado(s)`],
    await lupaLinhaDivida(doc),
  ];
  return lupaIndiceHtml('Consistência cadastral', Math.round((linhas.filter((l) => l[1]).length / linhas.length) * 100), linhas);
}

async function lupaIndiceCpf(doc) {
  const b = await lupaCpfBasico(doc);
  const off = await (LUPA.memo.oficial || Promise.reject(new Error('sem consulta oficial'))).catch(() => null);
  const c = off?.resumo || {};
  const linhas = [
    ['Estrutura do documento', !!b.cpf?.isValid, b.cpf?.isValid ? 'dígitos verificadores válidos' : 'dígitos inválidos'],
    ['Órgão emissor', !!b.cpf?.rf, b.cpf?.rf],
    ['UFs vinculadas', (b.cpf?.ufs || []).length > 0, (b.cpf?.ufs || []).join(', ')],
  ];
  if (c.nome || c.situacao) {
    linhas.push(['Nome na base oficial', !!c.nome, c.nome]);
    linhas.push(['Situação na base oficial', /ativo|regular/i.test(String(c.situacao || '')), c.situacao]);
    linhas.push(['Data de nascimento', !!c.nascimento, c.nascimento]);
  }
  linhas.push(await lupaLinhaDivida(doc));
  return lupaIndiceHtml('Consistência cadastral', Math.round((linhas.filter((l) => l[1]).length / linhas.length) * 100), linhas);
}

async function lupaRunRisco(doc, acao, construir) {
  let falhaExterna;
  try {
    const d = await api(`/integracao/serasa?acao=${acao}`, { method: 'POST', body: JSON.stringify({ document: doc }) });
    const v = d.verificacao || {};
    const score = Number(v.verificationScore);
    const cor = score >= 700 ? '#059669' : score >= 400 ? '#d97706' : '#b91c1c';
    const grupos = (v.validationGroups || []).map((g) => `<div class="kv"><span>${ddEsc(g.code)} — ${ddEsc(g.message || '')}</span><b>${ddEsc(String(g.rating ?? '—'))}</b></div>`).join('');
    return `
      <div class="lupa-status"><span>Score <b style="color:${cor}">${v.verificationScore ?? '—'}</b></span><span>Risco <b>${ddEsc(v.verificationRisk || '—')}</b></span></div>
      ${grupos || '<p class="muted small">Sem atributos retornados.</p>'}`;
  } catch (e) {
    falhaExterna = e;
  }
  const alt = await construir().catch(() => null);
  if (!alt) throw falhaExterna;
  return `${alt}<p class="muted small mt-2">A verificação externa de risco não está liberada nesta conta (${ddEsc(lupaNeutro(falhaExterna.message) || 'sem credenciais')}). O índice acima é calculado apenas sobre os dados oficiais desta mesma busca — não é score de bureau.</p>`;
}

function lupaRunDD(endpoint, param, valor) {
  return async () => {
    const d = await api('/integracao/directdata?acao=consultar', { method: 'POST', body: JSON.stringify({ endpoint, params: { [param]: valor } }) });
    return ddBloque(d.retorno);
  };
}

function lupaCreditoHtml(d) {
  const c = d?.dados?.cnpj || {};
  const end = c.endereco || c.end || {};
  return `
    <div class="kv"><span>Razão social</span><b>${ddEsc(c.razao_social || '—')}</b></div>
    <div class="kv"><span>Situação</span><b>${ddEsc(c.situacao_cadastral || '—')}</b></div>
    <div class="kv"><span>Endereço</span><b>${ddEsc([end.logradouro, end.numero].filter(Boolean).join(', ') || '—')}</b></div>
    <div class="kv"><span>Município</span><b>${ddEsc(`${end.municipio || c.municipio || '—'} / ${end.uf || c.uf || '—'}`)}</b></div>
    ${(c.socios || []).length ? `<div class="kv"><span>Quadro societário</span><b>${c.socios.length} registrado(s)</b></div>` : ''}`;
}

async function lupaRunCredito(doc) {
  const d = await api('/integracao/apibrasil?acao=cnpj', { method: 'POST', body: JSON.stringify({ cnpj: doc }) });
  return lupaCreditoHtml(d);
}

async function lupaRunCep(doc) {
  const d = await api(`/integracao/cep?cep=${doc}`);
  const c = d.cep || {};
  return `
    <h4>${ddEsc(c.street || '—')}${c.number ? ', ' + ddEsc(c.number) : ''}</h4>
    <div class="kv"><span>Bairro</span><b>${ddEsc(c.neighborhood || '—')}</b></div>
    <div class="kv"><span>Cidade</span><b>${ddEsc(c.city || '—')}</b></div>
    <div class="kv"><span>UF</span><b>${ddEsc(c.state || '—')}</b></div>`;
}

async function lupaRunNfe(doc) {
  const d = await api(`/integracao/serpro?acao=nfe&chave=${doc}`);
  return serproRenderNfe(d.resumo, lupaFonteGen(d, 'Documento fiscal · base oficial'));
}

// ---- Frentes de risco de crédito (bureau) ----
const SERASA_PRODUTOS = {
  crednet: { custo: 16.06, rotulo: 'Score e Negativas', sub: 'score, dívidas, protestos, cheques e ações judiciais' },
  concentra: { custo: 33.87, rotulo: 'Passivo Concentrado', sub: 'dívidas concentradas do sistema financeiro' },
};

function lupaPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${(n <= 1 ? n * 100 : n).toFixed(1).replace('.', ',')}%`;
}

function lupaScoreCor(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 'var(--text-primary)';
  return n >= 700 ? '#059669' : n >= 400 ? '#d97706' : '#b91c1c';
}

function lupaFrentesHtml(frentes) {
  const entradas = Object.entries(frentes || {});
  if (!entradas.length) return '';
  return `<div class="dd-sub">Negativas por frente</div>` + entradas.map(([rotulo, f]) => {
    const valor = Number(f.valor) > 0 ? ` · ${fmt(f.valor)}` : '';
    return `<div class="kv"><span>${ddEsc(rotulo)}</span><b>${Number(f.total) || 0}${ddEsc(valor)}</b></div>`;
  }).join('');
}

function lupaOcorrenciasHtml(frentes) {
  const linhas = [];
  for (const [rotulo, f] of Object.entries(frentes || {})) {
    for (const it of (f.itens || []).slice(0, 6)) {
      linhas.push(`<tr><td>${ddEsc(rotulo)}</td><td>${ddEsc(fmtDataBr(it.dataOcorrencia) || '—')}</td><td>${ddEsc(it.credor || it.cartorio || it.nomeBanco || '—')}</td><td>${ddEsc(it.modalidade || '')}</td><td>${Number(it.valor) ? fmt(it.valor) : '—'}</td></tr>`);
    }
  }
  if (!linhas.length) return '';
  return `<details class="mt-2"><summary class="muted small">Ver ocorrências detalhadas (${linhas.length})</summary>
    <div class="table-wrap mt-2"><table class="table small"><thead><tr><th>Frente</th><th>Data</th><th>Credor/cartório</th><th>Modalidade</th><th>Valor</th></tr></thead><tbody>${linhas.join('')}</tbody></table></div></details>`;
}

function lupaRiscoHtml(d, rotulo) {
  const s = d.resumo || {};
  const sc = s.score || null;
  const lc = s.limiteCredito || null;
  const cab = sc ? `<div class="lupa-status">
      <span>Score <b style="color:${lupaScoreCor(sc.pontuacao)}">${sc.pontuacao ?? '—'}</b></span>
      <span>Faixa <b>${ddEsc(sc.faixa || '—')}</b></span>
      <span>Inadimplência prevista <b>${ddEsc(lupaPct(sc.probabilidadeInadimplencia))}</b></span>
    </div>` : `<div class="lupa-status"><span>${ddEsc(rotulo)}</span><b>${s.restricoes ? 'com restrições ativas' : 'sem restrições ativas'}</b></div>`;
  const crit = lc?.criterios ? `<div class="dd-sub">Critérios analisados</div>
    <p class="muted small">${[
      lc.criterios.documentoAtivo && 'documento ativo',
      lc.criterios.semRestricoes && 'sem restrições',
      lc.criterios.semProtestos && 'sem protestos',
      lc.criterios.baixoComprometimentoRenda && 'renda compatível',
    ].filter(Boolean).join(' · ') || 'nenhum critério aprovado'}</p>` : '';
  const total = Number(s.negativos?.total) || 0;
  return `
    ${cab}
    <div class="kv"><span>Nome na base de risco</span><b>${ddEsc(s.nome || '—')}</b></div>
    ${s.tipo === 'PJ' ? `<div class="kv"><span>Fundação</span><b>${ddEsc(s.fundacao || '—')}</b></div>` : `<div class="kv"><span>Nascimento</span><b>${ddEsc(s.nascimento || '—')}</b></div>`}
    <div class="kv"><span>Situação no órgão emissor</span><b>${ddEsc(s.situacaoDescricao || s.situacaoRfb || '—')}</b></div>
    <div class="kv"><span>Total de negativas</span><b>${total}${s.negativos?.valor ? ` · ${fmt(s.negativos.valor)}` : ''}</b></div>
    ${lupaFrentesHtml(s.frentes)}
    ${lc ? `<div class="dd-sub">Limite sugerido pela base de risco</div>
      <div class="kv"><span>Limite de crédito</span><b>${fmt(lc.valor)}</b></div>
      <div class="kv"><span>Recomendação</span><b>${ddEsc(lc.tipoRecomendacao || '—')}${lc.tipoRecomendacaoValor ? ` · ${fmt(lc.tipoRecomendacaoValor)}` : ''}</b></div>` : ''}
    ${crit}
    ${s.documentosRoubados?.length ? `<div class="kv"><span>Documentos comunicados como roubados</span><b>${s.documentosRoubados.length}</b></div>` : ''}
    ${s.registroConsultas?.total ? `<div class="kv"><span>Consultas registradas na base</span><b>${s.registroConsultas.total}</b></div>` : ''}
    ${sc?.mensagem ? `<p class="muted small mt-2">${ddEsc(sc.mensagem)}</p>` : ''}
    ${lupaOcorrenciasHtml(s.frentes)}
    <p class="muted small mt-2">Ambiente ${ddEsc(lupaNeutro(String(d.ambiente || '')) || 'de dados')} · custo por consulta ${fmt(d.custo || 0)}</p>`;
}

function lupaRecomendaHtml(d) {
  const s = d.resumo || {};
  const sc = s.score || null;
  return `
    <div class="lupa-status">
      <span>Score <b style="color:${lupaScoreCor(sc?.pontuacao)}">${ddEsc(sc?.pontuacao ?? '—')}</b></span>
      <span>Limite recomendado <b>${fmt(s.limiteRecomendado)}</b></span>
      <span>Risco <b>${ddEsc(s.tipoRecomendacao || '—')}</b></span>
    </div>
    <div class="kv"><span>Nome na base de risco</span><b>${ddEsc(s.nome || '—')}</b></div>
    ${s.nascimento ? `<div class="kv"><span>Nascimento</span><b>${ddEsc(s.nascimento)}</b></div>` : ''}
    ${s.fundacao ? `<div class="kv"><span>Fundação</span><b>${ddEsc(s.fundacao)}</b></div>` : ''}
    ${s.situacaoCpf ? `<div class="kv"><span>Situação do documento</span><b>${ddEsc(s.situacaoCpf)}</b></div>` : ''}
    ${s.faixaRenda ? `<div class="kv"><span>Renda estimada</span><b>${fmt(s.faixaRenda)}</b></div>` : ''}
    ${s.numeroProposta ? `<div class="kv"><span>Proposta</span><b>${ddEsc(s.numeroProposta)}</b></div>` : ''}
    <div class="kv"><span>Ocorrências negativas</span><b>${s.temNegativas ? 'sim' : 'não'}</b></div>
    ${s.datasNegativas?.dividasVencidas ? `<div class="kv"><span>Dívida vencida mais recente</span><b>${ddEsc(s.datasNegativas.dividasVencidas)}</b></div>` : ''}
    ${s.datasNegativas?.protestos ? `<div class="kv"><span>Protesto mais recente</span><b>${ddEsc(s.datasNegativas.protestos)}</b></div>` : ''}
    <div class="kv"><span>Consultas nos últimos 3 meses</span><b>${s.consultas?.m3 ?? s.consultas?.total ?? '—'}</b></div>
    ${s.mensagemScore ? `<p class="muted small mt-2">${ddEsc(s.mensagemScore)}</p>` : ''}
    <p class="muted small mt-2">Custo por consulta ${fmt(d.custo || 0)} · consulta de crédito sob demanda</p>`;
}

async function lupaRunBureau(opBase, doc, corpo) {
  const tipo = String(doc).length === 14 ? 'pj' : 'pf';
  const d = await api(`/integracao/soa?acao=${opBase}-${tipo}`, {
    method: 'POST',
    body: JSON.stringify({ documento: doc, ...(corpo || {}) }),
  });
  return lupaRiscoHtml(d, SERASA_PRODUTOS[opBase]?.rotulo || 'Risco');
}

function lupaGatilhoUf(id) {
  return `<p class="muted small">Esta frente exige a UF do documento.</p>
    <div class="search-row mt-2"><input class="field" id="lupaUf" maxlength="2" placeholder="UF (ex: PE)">
    <button class="btn btn-gradient" onclick="UI.lupaExecutar('${id}')">Consultar</button></div>`;
}

async function lupaRunCrednet(doc) {
  const uf = String(LUPA.campos.uf || $('lupaUf')?.value || '').toUpperCase().trim();
  if (!/^[A-Z]{2}$/.test(uf)) throw Object.assign(new Error('Informe a UF do documento (2 letras).'), { code: 'UF_INVALIDA' });
  return lupaRunBureau('crednet', doc, { uf, adicionais: [1, 2, 3, 4] });
}

function lupaGatilhoRecomenda() {
  return `<p class="muted small">Informe o valor da operação para receber o limite recomendado.</p>
    <div class="search-row mt-2"><input class="field" id="lupaValorOperacao" inputmode="decimal" placeholder="Valor da operação (R$)">
    <button class="btn btn-gradient" onclick="UI.lupaExecutar('recomenda')">Consultar</button></div>`;
}

async function lupaRunRecomenda(doc) {
  const bruto = String(LUPA.campos.valorOperacao || $('lupaValorOperacao')?.value || '').replace(/\./g, '').replace(',', '.');
  const valor = Number(bruto);
  if (!(valor > 0)) throw Object.assign(new Error('Informe o valor da operação em reais.'), { code: 'VALOR_OPERACAO_INVALIDO' });
  const tipo = String(doc).length === 14 ? 'pj' : 'pf';
  const d = await api(`/integracao/soa?acao=recomenda-${tipo}`, {
    method: 'POST',
    body: JSON.stringify({ documento: doc, valorOperacao: valor, tipoVenda: 1, politica: 1 }),
  });
  return lupaRecomendaHtml(d);
}

// Dossiê completo da base de risco (API do portal) — card neutro, sem nome de fornecedor nem URL.
async function lupaRunDossie(doc) {
  const pj = String(doc).length === 14;
  const d = await api(`/integracao/serasa-apis?acao=${pj ? 'relatorio-pj' : 'relatorio-pf'}`, {
    method: 'POST',
    body: JSON.stringify({ document: doc, reportName: pj ? 'RELATORIO_AVANCADO_PJ' : 'RELATORIO_AVANCADO_PF' }),
  });
  const r = d.resumo || {};
  return `<div class="lupa-status"><span>Dossiê</span><b>${ddEsc(lupaNeutro((r.reportNames || []).join(' · ')) || 'relatório retornando por contrato')}</b></div>
    ${r.nome ? `<div class="kv"><span>Titular</span><b>${ddEsc(r.nome)}</b></div>` : ''}
    ${sdPares(r.detalhesCadastro)}
    ${sdPares(r.endereco)}
    <div class="kv"><span>Registros negativos</span><b>${ddEsc(lupaNeutro(r.negativacoes) || '—')}</b></div>
    ${(r.blocos || []).length ? `<div class="dd-sub">Blocos do dossiê</div>${r.blocos.slice(0, 14).map((b) => `<div class="kv"><span>${ddEsc(b.bloco)}</span><b>${ddEsc(String(b.itens))} ${b.itens === 1 ? 'item' : 'itens'}</b></div>`).join('')}` : ''}
    <p class="muted small mt-2">Conteúdo do contrato de risco · consulta sob demanda</p>`;
}

function lupaSecoes(tipo, doc) {
  if (tipo === 'cnpj') return [
    { id: 'cad', ico: '🏢', t: 'Cadastro Empresarial', sub: 'Receita Federal · dados oficiais completos', run: () => lupaRunCnpjOficial(doc) },
    { id: 'divida', ico: '⚖️', t: 'Dívida Ativa da União', sub: 'inscrições, valores e situação', run: () => lupaRunDivida(doc) },
    { id: 'risco', ico: '🛡️', t: 'Verificação de Risco', sub: 'score e consistência cadastral', run: () => lupaRunRisco(doc, 'pj', () => lupaIndiceCnpj(doc)) },
    { id: 'big', ico: '🗂️', t: 'Big Data Cadastral', sub: 'base ampliada de pessoa jurídica · consulta sob demanda', custo: 0.16, auto: false, run: lupaRunDD('CadastroPessoaJuridica', 'Cnpj', doc) },
    { id: 'credito', ico: '💳', t: 'Análise Creditícia', sub: 'cadastral + sócios por crédito · consulta sob demanda', custo: 0.04, auto: false, run: () => lupaRunCredito(doc) },
    { id: 'score', ico: '📊', t: SERASA_PRODUTOS.crednet.rotulo, sub: SERASA_PRODUTOS.crednet.sub, custo: SERASA_PRODUTOS.crednet.custo, auto: false, gatilho: lupaGatilhoUf('score'), run: () => lupaRunCrednet(doc) },
    { id: 'passivo', ico: '🧮', t: SERASA_PRODUTOS.concentra.rotulo, sub: SERASA_PRODUTOS.concentra.sub, custo: SERASA_PRODUTOS.concentra.custo, auto: false, run: () => lupaRunBureau('concentre', doc, { adicionais: [1, 2, 3, 4] }) },
    { id: 'recomenda', ico: '🎯', t: 'Limite de Crédito Recomendado', sub: 'quanto a base empresta · exige valor da operação', custo: 24, auto: false, gatilho: lupaGatilhoRecomenda(), run: () => lupaRunRecomenda(doc) },
    { id: 'dossie', ico: '📑', t: 'Dossiê de Crédito', sub: 'relatório completo da base de risco · consulta sob demanda', auto: false, run: () => lupaRunDossie(doc) },
  ];
  if (tipo === 'cpf') return [
    { id: 'basico', ico: '👤', t: 'Validação do Documento', sub: 'estrutura e dígitos verificadores', run: () => lupaRunCpfBasico(doc) },
    { id: 'oficial', ico: '🪪', t: 'Cadastro na Receita Federal', sub: 'consulta oficial — exige data de nascimento', auto: false,
      gatilho: `<div class="search-row"><input class="field" id="lupaNasc" inputmode="numeric" placeholder="Nascimento (ddmmaaaa)"><button class="btn btn-gradient" onclick="UI.lupaExecutar('oficial')">Consultar</button></div>`,
      run: () => lupaRunCpfOficial(doc) },
    { id: 'divida', ico: '⚖️', t: 'Dívida Ativa da União', sub: 'inscrições, valores e situação', run: () => lupaRunDivida(doc) },
    { id: 'risco', ico: '🛡️', t: 'Verificação de Risco', sub: 'score e consistência cadastral', run: () => lupaRunRisco(doc, 'pf', () => lupaIndiceCpf(doc)) },
    { id: 'big', ico: '🗂️', t: 'Big Data Cadastral', sub: 'base ampliada de pessoa física · consulta sob demanda', custo: 0.16, auto: false, run: lupaRunDD('CadastroPessoaFisica', 'Cpf', doc) },
    { id: 'score', ico: '📊', t: SERASA_PRODUTOS.crednet.rotulo, sub: SERASA_PRODUTOS.crednet.sub, custo: SERASA_PRODUTOS.crednet.custo, auto: false, gatilho: lupaGatilhoUf('score'), run: () => lupaRunCrednet(doc) },
    { id: 'passivo', ico: '🧮', t: SERASA_PRODUTOS.concentra.rotulo, sub: SERASA_PRODUTOS.concentra.sub, custo: SERASA_PRODUTOS.concentra.custo, auto: false, run: () => lupaRunBureau('concentre', doc, { adicionais: [1, 2, 3, 4] }) },
    { id: 'recomenda', ico: '🎯', t: 'Limite de Crédito Recomendado', sub: 'quanto a base empresta · exige valor da operação', custo: 24, auto: false, gatilho: lupaGatilhoRecomenda(), run: () => lupaRunRecomenda(doc) },
    { id: 'dossie', ico: '📑', t: 'Dossiê de Crédito', sub: 'relatório completo da base de risco · consulta sob demanda', auto: false, run: () => lupaRunDossie(doc) },
  ];
  if (tipo === 'cep') return [
    { id: 'ender', ico: '📍', t: 'Endereço Completo', sub: 'logradouro, bairro, cidade e UF', run: () => lupaRunCep(doc) },
  ];
  if (tipo === 'nfe') return [
    { id: 'doc', ico: '🧾', t: 'Documento Fiscal', sub: 'NF-e localizada nas bases oficiais', run: () => lupaRunNfe(doc) },
  ];
  return [];
}

function lupaErro(e, id) {
  const msg = lupaNeutro(e.message) || 'Esta frente não retornou dados agora.';
  const code = e.code || e.data?.code || '';
  const checkout = e.data?.checkout_url || e.data?.error?.checkout_url;
  const orderNsu = e.data?.order_nsu || e.data?.error?.order_nsu;
  let h = `<p class="form-error">${ddEsc(msg)}</p>`;
  if (checkout && orderNsu && id) {
    h += `<button class="btn btn-gradient small mt-3" data-url="${ddEsc(checkout)}" onclick="UI.lupaAbrirPix(this)">Pagar PIX para liberar</button>
      <p class="muted small mt-2">Aguardando a confirmação do pagamento — o resultado aparece aqui sozinho.</p>`;
    lupaAguardarPagamento(orderNsu, id);
  } else if (checkout) {
    h += `<button class="btn btn-gradient small mt-3" data-url="${ddEsc(checkout)}" onclick="UI.lupaAbrirPix(this)">Pagar PIX para liberar</button>`;
  } else if (code === 'SALDO_INSUFICIENTE') {
    h += `<p class="muted small mt-2">O saldo da conta de consultas está esgotado — a recarga libera esta frente imediatamente.</p>`;
  }
  h += `<p class="muted small mt-2">As demais frentes continuam funcionando — tente novamente.</p>`;
  return h;
}

function lupaAbrirPix(btn) {
  const url = btn?.dataset?.url || '';
  if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
}

const LUPA_POLL = {};

function lupaAguardarPagamento(orderNsu, id) {
  if (LUPA_POLL[id]) clearInterval(LUPA_POLL[id]);
  const t0 = Date.now();
  LUPA_POLL[id] = setInterval(async () => {
    const el = $('lupa-b-' + id);
    if (!el || Date.now() - t0 > 20 * 60 * 1000) { clearInterval(LUPA_POLL[id]); LUPA_POLL[id] = null; return; }
    let r, pendente = false;
    try {
      r = await api('/integracao/apibrasil?acao=pagar-consulta', { method: 'POST', body: JSON.stringify({ order_nsu: orderNsu }) });
      pendente = r.status === 'pendente';
    } catch (err) {
      const code = err.code || err.data?.code || '';
      if (code === 'PAGAMENTO_PENDENTE') pendente = true;
      else { clearInterval(LUPA_POLL[id]); LUPA_POLL[id] = null; el.innerHTML = lupaErro(err); return; }
    }
    if (pendente) return;
    clearInterval(LUPA_POLL[id]); LUPA_POLL[id] = null;
    el.innerHTML = `${lupaCreditoHtml(r)}<p class="muted small mt-2">Pagamento confirmado — consulta concluída.</p>`;
  }, 10000);
}

function lupaCorpoInicial(s) {
  if (s.gatilho) return s.gatilho;
  if (s.auto === false) {
    return `<p class="muted small">Consulta sob demanda — debitada do saldo da sua conta de consultas.</p>
      <button class="btn btn-gradient small mt-3" onclick="UI.lupaExecutar('${s.id}')">Consultar agora</button>`;
  }
  return '<div class="lupa-skeleton"><i></i><i></i><i></i></div>';
}

async function buscaUnica() {
  const { tipo, doc } = lupaDetectarTipo($('lupaInput').value);
  if (tipo === 'vazio' || tipo === 'indefinido') return alert('Digite um CEP (8), CPF (11), CNPJ (14) ou chave de NF-e (44) dígitos.');
  LUPA.tipo = tipo; LUPA.doc = doc; LUPA.memo = {};
  const secs = lupaSecoes(tipo, doc);
  LUPA.secoes = secs;
  const box = $('lupaResults');
  box.innerHTML = `
    <div class="lupa-header-res"><span>Retrato completo de <b>${ddEsc(lupaMascara(tipo, doc))}</b></span><span class="tag tag-autorizada">${secs.length} frentes</span></div>
    ${secs.map((s) => `
      <div class="lupa-secao panel glass" id="lupa-s-${s.id}">
        <div class="lupa-secao-head">
          <span class="lupa-secao-ico">${s.ico}</span>
          <div class="lupa-secao-tit"><h4>${s.t}</h4><p class="muted small">${s.sub}</p></div>
          ${s.custo ? `<span class="lupa-custo">R$ ${s.custo.toFixed(2)}</span>` : ''}
        </div>
        <div class="lupa-secao-body" id="lupa-b-${s.id}">${lupaCorpoInicial(s)}</div>
      </div>`).join('')}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await Promise.allSettled(secs.filter((s) => s.auto !== false).map(async (s) => {
    try { $('lupa-b-' + s.id).innerHTML = await s.run(); }
    catch (e) { $('lupa-b-' + s.id).innerHTML = lupaErro(e, s.id); }
  }));
}

async function lupaExecutar(id) {
  const s = LUPA.secoes.find((x) => x.id === id);
  if (!s) return;
  // O esqueleto apaga o gatilho: os valores digitados precisam ser lidos antes
  LUPA.campos = { uf: $('lupaUf')?.value || '', valorOperacao: $('lupaValorOperacao')?.value || '' };
  $('lupa-b-' + id).innerHTML = '<div class="lupa-skeleton"><i></i><i></i><i></i></div>';
  try { $('lupa-b-' + id).innerHTML = await s.run(); }
  catch (e) { $('lupa-b-' + id).innerHTML = lupaErro(e, id); }
}

// ---------- Boot ----------
const UI = {
  calcFiscal, liberarNome, validarNome, adicionarProduto, renderItens, emitirNota,
  toggleScanner, pagarMaquininha, carregarNotas, consultarNota, cancelarNota, imprimirNota,
  sincronizarEntradas, consultarCnpj, consultarCpf, consultarCep,
  consultarPgfn, abrirPgfn, pgfnLinks,
  consultarSerasa, consultarApibrasil, apibrasilSaldo,
  consultarDirectdata, ddEndpointChange,
  consultarSerpro, serproServicoChange, baixarCndPdf,
  consultarSoa, soaServicoChange, soaSaldo, soaExtrato, soaAposPagamento, soaCopiarPix, soaCatalogos,
  consultarSd, sdServicoChange, sdAmbienteChange, sdReportNameChange, sdRecarregar,
  buscaUnica, lupaDetectarChange, lupaExecutar, lupaAbrirPix,
  carregarSaldoZapsign, toggleCertForm, criarCertificado, carregarProtocolos,
  enviarChat, analisarNotaIA, alterarUser, removerUser,
  carregarAssinatura, assinar, salvarWhatsapp, imprimirRecibo,
  mostrarPausa, fecharPausa, sair, togglePass,
  abrirBalancete, fecharBalancete, imprimirBalancete,
};
window.UI = UI;

function init() {
  initBackground($('bg-3d'));
  ddInit();
  serproServicoChange();
  soaPreencherServicos();

  // Navegação
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
    switchView(b.dataset.view);
    if (b.dataset.view === 'certificados') carregarSaldoZapsign();
    if (b.dataset.view === 'admin') carregarAdmin();
    if (b.dataset.view === 'dashboard') carregarDre();
    if (b.dataset.view === 'notas') carregarNotas();
    if (b.dataset.view === 'emissor') carregarAssinatura();
  }));

  // Autenticação
  $('login-form').addEventListener('submit', login);
  $('reg-form').addEventListener('submit', registrar);
  $('tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('tab-register').addEventListener('click', () => switchAuthTab('register'));
  $('btn-back-login').addEventListener('click', () => switchAuthTab('login'));
  $('btn-logout').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* ok */ }
    sair();
  });

  // Sessão existente
  if (TOKEN) {
    api('/auth/me')
      .then((data) => { USER = data.user; entrar(); })
      .catch(() => sair());
  }
}

init();
