// Serasa Experian - APIs do portal developer.serasaexperian.com.br
// Um único motor para as famílias REST do portal: relatórios de crédito PF/PJ, Serasa Recomenda,
// Verify, Monitoramento (MDCF/Me Proteja/Alerta PME), Saúde Financeira (SDSN) e Infomais.
// Ambientes: demo (mock público do sandbox, funciona sem contrato) · sandbox · uat · prod.
// Auth: mesmo Bearer client-identities da lib serasa.js (obterToken); no ambiente demo basta um bearer qualquer.
// Atenção: o gateway do sandbox estoura 500 "Unresolved variable : request.header.origin" sem header Origin.

import { obterToken, serasaEnabled } from './serasa.js';

const HOSTS = {
  demo: 'https://sandbox-api.serasaexperian.com.br/mock',
  sandbox: 'https://sandbox-api.serasaexperian.com.br',
  uat: 'https://uat-api.serasaexperian.com.br',
  prod: 'https://api.serasaexperian.com.br',
};

export const SERASA_AMBIENTES = {
  demo: 'demonstração',
  sandbox: 'sandbox',
  uat: 'homologação',
  prod: 'oficial',
};

export function serasaAmbientesDisponiveis(env) {
  return serasaEnabled(env) ? Object.keys(HOSTS) : ['demo'];
}

// Base por família: o host muda com o ambiente (e pode ser sobrescrito por env), o caminho nem sempre.
function baseSofisticada(env, amb, prefixo, body) {
  if (prefixo === INFOMAIS && amb !== 'demo') {
    const pedida = texto(body && body.ambInfomais, 12).toLowerCase();
    const elegido = ['sandbox', 'uat', 'prod'].includes(pedida) ? pedida : 'uat';
    return { host: host(env, elegido), amb: elegido };
  }
  if (prefixo === RECOMENDA && amb !== 'demo') {
    const override = env.SERASA_RECOMENDA_BASE_URL;
    if (override) return { host: String(override).replace(/\/+$/, ''), amb };
  }
  return { host: host(env, amb), amb };
}

const OVERRIDE_VARS = {
  demo: 'SERASA_DEMO_BASE_URL',
  sandbox: 'SERASA_SANDBOX_BASE_URL',
  uat: 'SERASA_UAT_BASE_URL',
  prod: 'SERASA_PROD_BASE_URL',
};

function host(env, amb) {
  const override = env[OVERRIDE_VARS[amb]];
  return String(override || HOSTS[amb] || HOSTS.demo).replace(/\/+$/, '');
}

// ============ CATÁLOGO DE PRODUTOS (reportName oficial por família) ============

export const SERASA_RELATORIOS_PF = [
  { v: 'RELATORIO_DADOS_AVULSOS_PF', t: 'Dados Avulsos PF' },
  { v: 'RELATORIO_BASICO_PF', t: 'Relatório Básico PF' },
  { v: 'RELATORIO_BASICO_TOP_PF', t: 'Relatório Básico Top PF' },
  { v: 'RELATORIO_BASICO_PF_PME', t: 'Relatório Básico PF PME' },
  { v: 'RELATORIO_INTERMEDIARIO_PF', t: 'Relatório Intermediário PF' },
  { v: 'RELATORIO_INTERMEDIARIO_TOP_SCORE_PF', t: 'Intermediário Top Score PF' },
  { v: 'RELATORIO_AVANCADO_PF', t: 'Relatório Avançado PF' },
  { v: 'RELATORIO_AVANCADO_TOP_SCORE_PF', t: 'Avançado Top Score PF' },
  { v: 'RELATORIO_AVANCADO_TOP_SCORE_PF_PME', t: 'Avançado Top Score PF PME' },
  { v: 'RELATORIO_AGRUPE_PF', t: 'Agrupe PF (grupo econômico)' },
  { v: 'RELATORIO_AGRUPE_POS_CONSULTA_PF', t: 'Agrupe Pós-Consulta PF' },
];

export const SERASA_RELATORIOS_PJ = [
  { v: 'RELATORIO_DADOS_AVULSOS_PJ', t: 'Dados Avulsos PJ' },
  { v: 'RELATORIO_BASICO_PJ', t: 'Relatório Básico PJ' },
  { v: 'RELATORIO_BASICO_TOP_PJ', t: 'Relatório Básico Top PJ' },
  { v: 'RELATORIO_BASICO_PJ_PME', t: 'Relatório Básico PJ PME' },
  { v: 'RELATORIO_INTERMEDIARIO_PJ', t: 'Relatório Intermediário PJ' },
  { v: 'RELATORIO_INTERMEDIARIO_TOP_SCORE_PJ', t: 'Intermediário Top Score PJ' },
  { v: 'RELATORIO_AVANCADO_PJ', t: 'Relatório Avançado PJ' },
  { v: 'RELATORIO_AVANCADO_PJ_ANALITICO', t: 'Avançado PJ Analítico' },
  { v: 'RELATORIO_AVANCADO_PLUS_PJ', t: 'Avançado Plus PJ' },
  { v: 'RELATORIO_AVANCADO_PLUS_PJ_ANALITICO', t: 'Avançado Plus PJ Analítico' },
  { v: 'RELATORIO_AVANCADO_TOP_SCORE_PJ', t: 'Avançado Top Score PJ' },
  { v: 'RELATORIO_AVANCADO_TOP_SCORE_PJ_ANALITICO', t: 'Avançado Top Score PJ Analítico' },
  { v: 'RELATORIO_AVANCADO_PJ_PME', t: 'Avançado PJ PME' },
  { v: 'RELATORIO_AGRUPE_PJ', t: 'Agrupe PJ (grupo econômico)' },
  { v: 'RELATORIO_CREDIT_RATING_PJ', t: 'Credit Rating PJ' },
  { v: 'RELATORIO_ANALISE_CADASTRAL_PJ', t: 'Análise Cadastral PJ' },
  { v: 'RELATORIO_ANALISE_CADASTRAL_FINANCEIRA_PJ', t: 'Análise Cadastral + Financeira PJ' },
  { v: 'RELATORIO_ANALISE_DE_BALANCO_PJ', t: 'Análise de Balanço PJ' },
  { v: 'RELATORIO_RATING_TERCEIRO_SETOR', t: 'Rating Terceiro Setor' },
];

const CREDITOS_PF = '/credit-services/person-information-report/v1';
const CREDITOS_PJ = '/credit-services/business-information-report/v1';
const RECOMENDA = '/credit/recomenda/v1';
const VERIFY = '/id-fraud/verify-id/v1';
const MONITORING = '/credit-services/monitoring/v1';
const SELF = '/credit-services/self-monitoring/v1';
const ALERTA = '/credit-services/pme-monitoring-integration/v1';
const SDSN = '/serasaempreendedor/financial-health-distributor';
const INFOMAIS = '/ms-da/enrichment/v1';

const RE_RELATORIO = /^[A-Z][A-Z0-9_]{4,60}$/;
const RE_ID = /^[A-Za-z0-9_-]{4,80}$/;

function texto(v, max = 120) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function numero(v) {
  const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ============ SERVIÇOS ============
// ctx = { doc, body, amb, query, headers }
// cada serviço devolve { metodo, path, query?, headers?, body? } ou { erro, code }

function creditoQuery(ctx, relatorios) {
  const q = {};
  let reportName = texto(ctx.body.reportName, 60);
  if (!reportName || reportName === 'OUTRO') reportName = texto(ctx.body.reportNameOutro, 60).toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (!RE_RELATORIO.test(reportName)) {
    return { erro: `Selecione um relatório válido (${relatorios.length} disponíveis) ou digite o nome técnico.`, code: 'RELATORIO_INVALIDO' };
  }
  q.reportName = reportName;
  const uf = texto(ctx.body.uf, 2).toUpperCase();
  if (uf) q.federalUnit = /^[A-Z]{2}$/.test(uf) ? uf : undefined;
  const features = texto(ctx.body.features, 400);
  if (features) {
    const lista = features.split(/[,\s]+/).map((f) => f.trim()).filter((f) => /^[A-Za-z0-9_.-]{2,60}$/.test(f)).slice(0, 20);
    if (lista.length) q.optionalFeatures = lista.join(',');
  }
  const params = texto(ctx.body.reportParameters, 200);
  if (params && /^[A-Za-z0-9_=,.:\s-]{2,200}$/.test(params)) q.reportParameters = params;
  const reqId = texto(ctx.body.reportRequestId, 40);
  if (reqId && RE_ID.test(reqId)) q.reportRequestId = reqId;
  return { query: q, reportName };
}

export const SERASA_SERVICOS = {
  'relatorio-pf': {
    grupo: 'Relatórios de crédito (PF)', t: 'Relatório de crédito pessoa física', doc: 'pf',
    relatorios: SERASA_RELATORIOS_PF, campos: ['reportName', 'uf', 'features', 'parametros'],
    montar: (ctx) => {
      const r = creditoQuery(ctx, SERASA_RELATORIOS_PF);
      if (r.erro) return r;
      return { metodo: 'GET', path: `${CREDITOS_PF}/creditreport`, query: r.query, headers: { 'X-Document-Id': ctx.doc } };
    },
  },
  'relatorio-pj': {
    grupo: 'Relatórios de crédito (PJ)', t: 'Relatório de crédito pessoa jurídica', doc: 'pj',
    relatorios: SERASA_RELATORIOS_PJ, campos: ['reportName', 'uf', 'features', 'parametros'],
    montar: (ctx) => {
      const r = creditoQuery(ctx, SERASA_RELATORIOS_PJ);
      if (r.erro) return r;
      return { metodo: 'GET', path: `${CREDITOS_PJ}/reports`, query: r.query, headers: { 'X-Document-Id': ctx.doc } };
    },
  },
  'recomenda-pf': {
    grupo: 'Serasa Recomenda', t: 'Recomenda PF · nova proposta', doc: 'pf', mutacao: true,
    campos: ['valorOperacao', 'tipoVenda', 'politica'],
    montar: (ctx) => {
      const valor = numero(ctx.body.valorOperacao);
      const body = { cpf: ctx.doc };
      if (valor != null && valor > 0) body.valorOperacao = valor;
      const tipoVenda = Number(ctx.body.tipoVenda);
      if (tipoVenda === 2 || tipoVenda === 1) body.codTipoVenda = tipoVenda;
      const politica = Number(ctx.body.politica);
      if (politica === 2 || politica === 1) body.politica = politica;
      const dataOp = texto(ctx.body.dataOperacao, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dataOp)) body.dataOperacao = dataOp;
      return { metodo: 'POST', path: `${RECOMENDA}/pessoa-fisica/propostas`, body };
    },
  },
  'recomenda-pj': {
    grupo: 'Serasa Recomenda', t: 'Recomenda PJ · nova proposta', doc: 'pj', mutacao: true,
    campos: ['valorOperacao', 'tipoVenda', 'politica'],
    montar: (ctx) => {
      const valor = numero(ctx.body.valorOperacao);
      const body = { cnpj: ctx.doc };
      if (valor != null && valor > 0) body.valorOperacao = valor;
      const tipoVenda = Number(ctx.body.tipoVenda);
      if (tipoVenda === 2 || tipoVenda === 1) body.codTipoVenda = tipoVenda;
      const politica = Number(ctx.body.politica);
      if (politica === 2 || politica === 1) body.politica = politica;
      return { metodo: 'POST', path: `${RECOMENDA}/empresa/propostas`, body };
    },
  },
  'recomenda-pf-lista': {
    grupo: 'Serasa Recomenda', t: 'Recomenda PF · propostas', doc: null, campos: ['busca', 'dataInicio', 'dataFim', 'pagina'],
    montar: (ctx) => {
      const q = {};
      const busca = texto(ctx.body.busca || ctx.doc, 40);
      if (busca && /^\d{6,14}$/.test(busca.replace(/\D/g, ''))) q.busca = busca.replace(/\D/g, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto(ctx.body.dataInicio, 10))) q.dataInicio = texto(ctx.body.dataInicio, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto(ctx.body.dataFim, 10))) q.dataFim = texto(ctx.body.dataFim, 10);
      q.paginaAtual = Math.min(Math.max(Number(ctx.body.pagina) || 1, 1), 9999);
      q.tamanhoPagina = Math.min(Math.max(Number(ctx.body.tamanhoPagina) || 10, 1), 50);
      return { metodo: 'GET', path: `${RECOMENDA}/pessoa-fisica/propostas`, query: q };
    },
  },
  'recomenda-proposta': {
    grupo: 'Serasa Recomenda', t: 'Recomenda · consultar proposta', doc: null, campos: ['numeroProposta'],
    montar: (ctx) => {
      const id = texto(ctx.body.numeroProposta, 40);
      if (!RE_ID.test(id)) return { erro: 'Informe o número da proposta.', code: 'PROPOSTA_INVALIDA' };
      const tipo = Number(ctx.body.tipoDeDocumento) === 2 ? 'empresa' : 'pessoa-fisica';
      return { metodo: 'GET', path: `${RECOMENDA}/${tipo}/propostas/${encodeURIComponent(id)}` };
    },
  },
  'recomenda-relatorios': {
    grupo: 'Serasa Recomenda', t: 'Recomenda PJ · relatórios', doc: null, campos: ['cnpj', 'dataInicio', 'dataFim'],
    montar: (ctx) => {
      const q = {};
      const cnpj = texto(ctx.body.cnpj || ctx.doc, 20).replace(/\D/g, '');
      if (/^\d{14}$/.test(cnpj)) q.cnpj = cnpj;
      const nome = texto(ctx.body.nome, 80);
      if (nome) q.nome = nome;
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto(ctx.body.dataInicio, 10))) q.dataInicio = texto(ctx.body.dataInicio, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(texto(ctx.body.dataFim, 10))) q.dataFim = texto(ctx.body.dataFim, 10);
      return { metodo: 'GET', path: `${RECOMENDA}/empresa/reports`, query: q };
    },
  },
  'verify-lote': {
    grupo: 'Verificação de dados (Verify)', t: 'Verify · lote de pessoas', doc: null, mutacao: true, campos: ['lote'],
    montar: (ctx) => {
      const itens = (Array.isArray(ctx.body.pessoas) ? ctx.body.pessoas : [])
        .map((p) => ({ document: texto(p?.document, 20).replace(/\D/g, ''), name: texto(p?.name, 120) || undefined, birthDate: /^\d{4}-\d{2}-\d{2}$/.test(p?.birthDate || '') ? p.birthDate : undefined }))
        .filter((p) => /^\d{11}$|^\d{14}$/.test(p.document))
        .slice(0, 20);
      if (!itens.length) return { erro: 'Informe ao menos uma pessoa com CPF/CNPJ válido no lote.', code: 'LOTE_VAZIO' };
      return { metodo: 'POST', path: `${VERIFY}/people/batch`, body: { people: itens, scoreParameters: ['VERIFY', 'REQUEST'] } };
    },
  },
  'verify-pep': {
    grupo: 'Verificação de dados (Verify)', t: 'Verify · arquivos PEP (pessoas expostas)', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${VERIFY}/pep/files/informations` }),
  },
  'verify-pep-historico': {
    grupo: 'Verificação de dados (Verify)', t: 'Verify · histórico de download PEP', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${VERIFY}/pep/files/download/history` }),
  },
  'mdcf-monitoring': {
    grupo: 'Monitoramento', t: 'MDCF · monitoramentos da carteira', doc: null, campos: ['q', 'pagina'],
    montar: (ctx) => listaMonitoramento(ctx, `${MONITORING}/api/monitoring`),
  },
  'mdcf-alertas': {
    grupo: 'Monitoramento', t: 'MDCF · alertas', doc: null, campos: ['q', 'pagina'],
    montar: (ctx) => listaMonitoramento(ctx, `${MONITORING}/api/alerts`),
  },
  'mdcf-atributos': {
    grupo: 'Monitoramento', t: 'MDCF · atributos monitorados', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${MONITORING}/api/attributes` }),
  },
  'mdcf-contrato': {
    grupo: 'Monitoramento', t: 'MDCF · dados do contrato', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${MONITORING}/api/contract` }),
  },
  'mdcf-carteira': {
    grupo: 'Monitoramento', t: 'MDCF · carteiras', doc: null, campos: ['pagina'],
    montar: (ctx) => listaMonitoramento(ctx, `${MONITORING}/api/wallet`),
  },
  'mdcf-relatorio': {
    grupo: 'Monitoramento', t: 'MDCF · relatório de integração', doc: 'ambos', campos: [],
    montar: (ctx) => ({ metodo: 'GET', path: `${MONITORING}/api/reports/integration`, headers: { 'X-Document-Id': ctx.doc } }),
  },
  'self-assinaturas': {
    grupo: 'Monitoramento', t: 'Me Proteja · assinaturas', doc: null, campos: ['q', 'pagina'],
    montar: (ctx) => listaMonitoramento(ctx, `${SELF}/subscription`),
  },
  'self-webhooks': {
    grupo: 'Monitoramento', t: 'Me Proteja · webhooks cadastrados', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${SELF}/webhook` }),
  },
  'alerta-indiretas': {
    grupo: 'Monitoramento', t: 'Serasa Alerta PME · empresas indiretas', doc: null, campos: ['pagina'],
    montar: (ctx) => listaMonitoramento(ctx, `${ALERTA}/integration/indirect-companies`),
  },
  'sdsn-assinaturas': {
    grupo: 'Saúde financeira (SDSN)', t: 'SDSN · assinaturas do distribuidor', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${SDSN}/subscriptions` }),
  },
  'sdsn-por-doc': {
    grupo: 'Saúde financeira (SDSN)', t: 'SDSN · assinatura por CNPJ', doc: 'pj', campos: [],
    montar: (ctx) => ({ metodo: 'GET', path: `${SDSN}/subscription/${ctx.doc}` }),
  },
  'sdsn-webhook': {
    grupo: 'Saúde financeira (SDSN)', t: 'SDSN · endpoint de webhook', doc: null, campos: [],
    montar: () => ({ metodo: 'GET', path: `${SDSN}/webhook` }),
  },
  'infomais-pf': {
    grupo: 'Enriquecimento (Infomais)', t: 'Infomais · enriquecimento pessoa física', doc: 'pf', campos: ['ambInfomais'],
    montar: (ctx) => ({ metodo: 'POST', path: `${INFOMAIS}/enrichments/people`, body: { document: ctx.doc, attributes: [] } }),
  },
  'infomais-pj': {
    grupo: 'Enriquecimento (Infomais)', t: 'Infomais · enriquecimento pessoa jurídica', doc: 'pj', campos: ['ambInfomais'],
    montar: (ctx) => ({ metodo: 'POST', path: `${INFOMAIS}/enrichments/organizations`, body: { document: ctx.doc, attributes: [] } }),
  },
};

function listaMonitoramento(ctx, path) {
  const q = {};
  const busca = texto(ctx.body.q, 60);
  if (busca) q.q = busca;
  const limit = Math.min(Math.max(Number(ctx.body.limit) || 25, 1), 100);
  const pagina = Math.max(Number(ctx.body.pagina) || 1, 1);
  q.limit = limit;
  q.offset = (pagina - 1) * limit;
  return { metodo: 'GET', path, query: q };
}

export function serasaServicoExiste(acao) {
  return Boolean(SERASA_SERVICOS[acao]);
}

// ============ EXECUÇÃO ============

export async function chamarSerasaApi(env, acao, body = {}, ambPedida = 'demo') {
  const svc = SERASA_SERVICOS[acao];
  if (!svc) return { ok: false, code: 'SERASA_SERVICO_INVALIDO', message: 'Serviço Serasa desconhecido.' };

  const ambientes = serasaAmbientesDisponiveis(env);
  const amb = ambientes.includes(ambPedida) ? ambPedida : ambientes[0];
  if (amb !== 'demo' && !serasaEnabled(env)) {
    return { ok: false, code: 'SERASA_NAO_CONFIGURADO', message: 'Para sair da demonstração é preciso a credencial client-identities emitida pela Serasa Experian (representante comercial ou Central de Atendimento (11) 3003-7372). Com ela, defina os secrets SERASA_CLIENT_ID e SERASA_CLIENT_SECRET.' };
  }

  const doc = texto(body.document, 20).replace(/\D/g, '');
  if (svc.doc === 'pf' && !/^\d{11}$/.test(doc)) return { ok: false, code: 'CPF_INVALIDO', message: 'Informe um CPF válido (11 dígitos).' };
  if (svc.doc === 'pj' && !/^\d{14}$/.test(doc)) return { ok: false, code: 'CNPJ_INVALIDO', message: 'Informe um CNPJ válido (14 dígitos).' };
  if (svc.doc === 'ambos' && !/^\d{11}$|^\d{14}$/.test(doc)) return { ok: false, code: 'DOCUMENTO_INVALIDO', message: 'Informe CPF (11) ou CNPJ (14) dígitos.' };
  if (doc && !/^\d{11}$|^\d{14}$/.test(doc)) return { ok: false, code: 'DOCUMENTO_INVALIDO', message: 'Documento inválido.' };

  const ctx = { doc, body: body || {}, amb };
  const pedido = svc.montar(ctx);
  if (!pedido) return { ok: false, code: 'SERASA_SERVICO_INVALIDO', message: 'Não foi possível montar a requisição.' };
  if (pedido.erro) return { ok: false, code: pedido.code || 'PARAMETROS_INVALIDOS', message: pedido.erro };

  const familias = [CREDITOS_PF, CREDITOS_PJ, RECOMENDA, VERIFY, MONITORING, SELF, ALERTA, SDSN, INFOMAIS];
  const prefixo = familias.find((p) => pedido.path.startsWith(p)) || '';
  const destino = baseSofisticada(env, amb, prefixo, body);
  const ambienteUsado = destino.amb;

  let token;
  if (ambienteUsado === 'demo') token = env.SERASA_MOCK_TOKEN || 'demo-sandbox';
  else {
    const iamHost = new URL(destino.host).host;
    const t = await obterToken(env, {
      iamUrl: `https://${iamHost}/security/iam/v1/client-identities/login`,
      cacheKey: `serasa:token:${ambienteUsado}`,
    });
    if (typeof t !== 'string') return { ok: false, code: 'SERASA_TOKEN_EXPIRADO', message: t.erro };
    token = t;
  }

  const url = new URL(destino.host + pedido.path);
  for (const [k, v] of Object.entries(pedido.query || {})) if (v != null && v !== '') url.searchParams.set(k, v);

  const origin = new URL(destino.host).host;
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    Origin: `https://${origin}`,
  };
  for (const [k, v] of Object.entries(pedido.headers || {})) if (v) headers[k] = v;
  const retailer = texto(body.retailer, 20).replace(/\D/g, '') || texto(env.SERASA_RETAILER_CNPJ, 20);
  if (/^\d{14}$/.test(retailer)) headers['X-Retailer-Document-Id'] = retailer;
  const centro = texto(body.custoCentro || env.SERASA_COST_CENTER, 40);
  if (centro && /^[A-Za-z0-9_.-]{2,40}$/.test(centro)) headers['X-Cost-Center'] = centro;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  let bruto;
  try {
    res = await fetch(url.toString(), {
      method: pedido.metodo,
      headers,
      body: pedido.metodo === 'GET' || pedido.metodo === 'DELETE' ? undefined : JSON.stringify(pedido.body || {}),
      signal: controller.signal,
    });
    bruto = await res.text();
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, code: e.name === 'AbortError' ? 'SERASA_TIMEOUT' : 'SERASA_FALHA', message: e.name === 'AbortError' ? 'Tempo esgotado aguardando a Serasa.' : e.message };
  }
  clearTimeout(timer);

  let data = null;
  try {
    data = bruto && bruto.trim() ? JSON.parse(bruto) : null;
  } catch {
    data = { textoBruto: bruto.slice(0, 4000) };
  }

  if (!res.ok) {
    const item = Array.isArray(data) ? data[0] : data;
    const msg = item?.message || item?.detail || item?.fault?.faultstring
      || (typeof item?.error === 'string' ? item.error : item?.error?.message)
      || item?.errorMessage || `A Serasa respondeu ${res.status}.`;
    const code = res.status === 401 || res.status === 403
      ? (ambienteUsado === 'demo' ? 'SERASA_DEMO_RECUSADA' : 'SERASA_TOKEN_EXPIRADO')
      : res.status === 404 ? 'SERASA_SEM_PRODUTO'
      : res.status === 412 || res.status === 422 ? 'SERASA_PRE_CONDICAO'
      : res.status === 429 ? 'SERASA_LIMITE' : 'SERASA_ERRO';
    const dica = res.status === 403
      ? ' O produto não está liberado no contrato desta credencial.'
      : res.status === 404 ? ' Caminho não existe neste ambiente (produto não contratado ou nome do relatório fora do catálogo).'
      : res.status === 412 ? ' Falta uma condição prévia: documento no header, UF ou feature do contrato.'
      : '';
    return { ok: false, code, status: res.status, message: `${String(msg).slice(0, 300)}${dica}`, dados: data, ambiente: SERASA_AMBIENTES[ambienteUsado] };
  }

  return { ok: true, data: data == null ? {} : data, acao, amb: ambienteUsado, ambiente: SERASA_AMBIENTES[ambienteUsado], origem: url.origin + pedido.path };
}

// ============ NORMALIZAÇÃO PARA A TELA ============

function resumoObjeto(v) {
  if (Array.isArray(v)) return `lista com ${v.length} ${v.length === 1 ? 'item' : 'itens'}`;
  if (v && typeof v === 'object') return `${Object.keys(v).length} campos`;
  return String(v == null ? '—' : v);
}

const ROTULOS = {
  consumerName: 'Nome', companyName: 'Razão social', fantasyName: 'Nome fantasia',
  documentNumber: 'Documento', motherName: 'Nome da mãe', birthDate: 'Nascimento',
  profession: 'Profissão', educationLevelDescription: 'Escolaridade', maritalStatusDescription: 'Estado civil',
  statusRegistration: 'Situação do registro', socialName: 'Nome social', age: 'Idade', gender: 'Sexo',
  income: 'Renda estimada', zipCode: 'CEP', street: 'Logradouro', city: 'Cidade', state: 'UF',
  district: 'Bairro', number: 'Número', fullName: 'Nome completo',
  valorLimiteRecomendado: 'Limite recomendado', numeroProposta: 'Nº da proposta',
  tipoRecomendacao: 'Tipo de recomendação', orientacaoVenda: 'Orientação de venda',
  faixaRendaEstimada: 'Faixa de renda', nivelRisco: 'Nível de risco', mensagemScore: 'Mensagem do score',
  status: 'Status', expiresAt: 'Expiração', billingPlanCode: 'Plano', businessDocument: 'CNPJ monitorado',
  verificationScore: 'Score de verificação', verificationRisk: 'Risco de verificação',
};

function paresDe(rotulos, obj, limite = 14) {
  const saida = [];
  for (const [chave, rotulo] of Object.entries(rotulos)) {
    const v = obj?.[chave];
    if (v == null || v === '' || typeof v === 'object') continue;
    saida.push({ rotulo, valor: String(v).slice(0, 120) });
    if (saida.length >= limite) break;
  }
  return saida;
}

export function normalizarRelatorioCredito(data = {}) {
  const relatorios = Array.isArray(data.reports) ? data.reports : [];
  const blocos = [];
  const destaques = [];
  for (const r of relatorios) {
    for (const [chave, valor] of Object.entries(r)) {
      if (chave === 'reportName') continue;
      if (valor && typeof valor === 'object') {
        const itens = Array.isArray(valor) ? valor.length : Object.keys(valor).length;
        blocos.push({ bloco: chave, reportName: r.reportName || '', itens });
      } else if (valor != null && valor !== '') {
        destaques.push({ rotulo: chave, valor: String(valor).slice(0, 120) });
      }
    }
  }
  const primeiro = relatorios[0] || {};
  const registro = primeiro.registration || primeiro.agrupeReport?.content?.[0] || primeiro.businessRegistration || {};
  const localizacao = primeiro.localization || {};
  const endereco = Array.isArray(localizacao.addresses) ? localizacao.addresses[0] : (localizacao.address || localizacao || {});
  const score = primeiro.scores || primeiro.score || primeiro.creditScore || null;
  const negativos = primeiro.negativeData || primeiro.negatives || null;
  return {
    tipo: 'relatorio',
    reportNames: [...new Set(relatorios.map((r) => r.reportName).filter(Boolean))],
    documento: registro.documentNumber || primeiro.documentNumber || '',
    nome: registro.consumerName || registro.companyName || registro.fullName || primeiro.consumerName || '',
    detalhesCadastro: paresDe(ROTULOS, registro),
    endereco: paresDe(ROTULOS, endereco),
    score: score && typeof score === 'object'
      ? (Array.isArray(score) ? score.map((s) => ({ rotulo: s.model || s.name || 'score', valor: String(s.value ?? s.score ?? '').slice(0, 40) })) : paresDe({ ...ROTULOS, value: 'Pontuação', model: 'Modelo', score: 'Pontuação' }, score))
      : (score != null ? [{ rotulo: 'Score', valor: String(score) }] : []),
    negativacoes: negativos ? resumoObjeto(negativos) : 'não retornado',
    blocos,
    opcionais: Object.keys(data.optionalFeatures || {}),
    totalRegistros: relatorios.length,
  };
}

export function normalizarRecomendaResposta(data = {}) {
  const d = data && data.data ? data.data : data;
  const lista = Array.isArray(d) ? d : Array.isArray(d?.propostas) ? d.propostas : null;
  if (lista) {
    return {
      tipo: 'lista',
      total: data?.total ?? data?.totalCount ?? lista.length,
      itens: lista.slice(0, 50).map((p) => ({
        rotulo: `Proposta ${p.numeroProposta || p.id || ''}`.trim(),
        documento: p.cpf || p.cnpj || '',
        nome: p.nome || '',
        limite: p.valorLimiteRecomendado ?? null,
        status: p.status || '',
      })),
    };
  }
  const score = d?.score || {};
  return {
    tipo: 'proposta',
    codigo: data?.code ?? null,
    mensagem: data?.message || '',
    numeroProposta: d?.numeroProposta || '',
    nome: d?.nome || '',
    documento: d?.cpf || d?.cnpj || '',
    limiteRecomendado: d?.valorLimiteRecomendado ?? null,
    score: score.serasaScore ?? d?.score ?? null,
    taxa: score.taxa ?? null,
    nivelRisco: d?.codNivelRisco ?? d?.nivelRisco ?? null,
    tipoRecomendacao: d?.tipoRecomendacao || '',
    faixaRenda: d?.faixaRendaEstimada ?? null,
    orientacaoVenda: d?.orientacaoVenda ?? null,
    habitosPagamento: resumoObjeto(d?.habitosPagamentos),
    negatives: {
      anotacoesNegativas: resumoObjeto(d?.anotacoesNegativas),
      anotacoesSpc: resumoObjeto(d?.anotacoesConsultasSpc),
      cheques: resumoObjeto(d?.chequesDevolvidos),
      participacoes: resumoObjeto(d?.participacoesSocietaria),
      consultas: resumoObjeto(d?.consultasDetalhadasSerasa),
    },
    criterios: Array.isArray(d?.criteriosAnalisados) ? d.criteriosAnalisados.map((c) => String(c).slice(0, 120)) : resumoObjeto(d?.criteriosAnalisados),
    endereco: resumoObjeto(d?.enderecoPessoal),
  };
}

export function normalizarListaGenerica(data = {}) {
  const resultados = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : Array.isArray(data.content) ? data.content : [];
  const pag = data.pagination || {};
  return {
    tipo: 'lista',
    total: data.totalCount ?? pag.totalCount ?? data.totalItems ?? resultados.length,
    pagina: pag.page ?? data.page ?? null,
    itens: resultados.slice(0, 50).map((item) => {
      const alvo = item && item.result && typeof item.result === 'object' ? item.result : item;
      return {
        id: String(alvo?.id || alvo?.document || alvo?.number || '').slice(0, 40),
        rotulo: String(alvo?.name || alvo?.document || alvo?.description || alvo?.type || 'registro').slice(0, 80),
        status: String(alvo?.status || alvo?.situation || '').slice(0, 40),
        data: String(alvo?.createdAt || alvo?.expiresAt || alvo?.date || '').slice(0, 24),
        campos: paresDe(ROTULOS, alvo || {}, 6),
      };
    }),
    outros: Object.keys(data).filter((k) => !['results', 'content', 'pagination', 'data'].includes(k)).slice(0, 12),
  };
}

export function normalizarInfomais(data = {}) {
  const end = Array.isArray(data.addresses) ? data.addresses : [];
  const tels = Array.isArray(data.phones) ? data.phones : [];
  const socios = Array.isArray(data.businessPartners) ? data.businessPartners : [];
  return {
    tipo: 'infomais',
    documento: data.document || '',
    nome: data.name?.fullName || '',
    campos: paresDe(ROTULOS, { ...data, income: data.income, age: data.age }, 10),
    endereco: end.slice(0, 3).map((e) => [e.type, e.street, e.number, e.district, e.city, e.state, e.zipCode].filter(Boolean).join(' · ')),
    telefones: tels.slice(0, 5).map((t) => `(${t.areaCode || ''}) ${t.number || ''}${t.mobile ? ' · celular' : ''}`),
    socios: socios.slice(0, 10).map((s) => `${s.name || s.document} · ${s.participationPercentage ?? ''}%`),
    renda: data.income || '',
    classeSocial: [data.socialClass?.socialClass, data.socialClass?.subSocialClass].filter(Boolean).join(' / '),
    mosaic: [data.mosaic?.code, data.mosaic?.group, data.mosaic?.description].filter(Boolean).join(' · '),
    poderCompra: data.purchasingPower ? `${data.purchasingPower.description || ''} ${data.purchasingPower.range || ''}`.trim() : '',
    registro: data.registrationStatus ? `${data.registrationStatus.status || ''} ${data.registrationStatus.name || ''}`.trim() : '',
    risco: data.riskTriage ? `${data.riskTriage.riskCode || ''} ${data.riskTriage.riskRange || ''}`.trim() : '',
    afinidades: Object.entries(data).filter(([k]) => /^afinidade/.test(k)).map(([k, v]) => `${k.replace('afinidade', '')}: ${v}`).slice(0, 8),
  };
}

// Lista de serviços pronta para a interface (sem funções)
export function catalogoSerasaApis() {
  return Object.entries(SERASA_SERVICOS).map(([k, s]) => ({
    acao: k,
    grupo: s.grupo,
    titulo: s.t,
    doc: s.doc || null,
    mutacao: Boolean(s.mutacao),
    campos: s.campos || [],
    relatorios: s.relatorios || null,
  }));
}


