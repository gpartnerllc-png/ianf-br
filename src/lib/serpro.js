// Cliente Serpro - APIs governamentais oficiais (caminhos exatos das specs OpenAPI de apicenter.estaleiro.serpro.gov.br)
// Requer assinatura ativa no portal: https://loja.serpro.gov.br
// Credenciais via secrets: SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET · demonstração via SERPRO_TRIAL_TOKEN
// Token OAuth2 renovado automaticamente (cache em KV 'serpro:token')

const GATEWAY = 'https://gateway.apiserpro.serpro.gov.br';
const TOKEN_KEY = 'serpro:token';

// Tabela de serviços: base PROD + base DEMO/TRIAL (conforme servers de cada spec OpenAPI)
// envPro/envDemo permitem sobrescrever cada base via vars do Worker.
const SVCS = {
  cnpj:        { prod: '/consulta-cnpj-df/v2',            demo: '/consulta-cnpj-df-trial/v2',        envPro: 'SERPRO_CNPJ_PATH', envDemo: 'SERPRO_CNPJ_TRIAL_PATH' },
  cpf:         { prod: '/consulta-cpf-df/v3',             demo: null,                               envPro: 'SERPRO_CPF_PATH' },
  nfe:         { prod: '/consulta-nfe-df/api',            demo: '/consulta-nfe-df-trial/api',         envPro: 'SERPRO_NFE_PATH', envDemo: 'SERPRO_NFE_TRIAL_PATH' },
  escalonada:  { prod: '/nfe/1',                          demo: null,                               envPro: 'SERPRO_ESCALONADA_PATH' },
  cnd:         { prod: '/consulta-cnd/v1',                demo: null,                               envPro: 'SERPRO_CND_PATH' },
  due:         { prod: '/api-consulta-due/api',           demo: '/api-consulta-due-trial/api',        envPro: 'SERPRO_DUE_PATH', envDemo: 'SERPRO_DUE_TRIAL_PATH' },
  divida:      { prod: '/consulta-divida-ativa-df/api',   demo: '/consulta-divida-ativa-trial/api',   envPro: 'SERPRO_DIVIDA_PATH', envDemo: 'SERPRO_DIVIDA_TRIAL_PATH' },
  dividaNdf:   { prod: '/consulta-divida-ativa/api',      demo: null,                               envPro: 'SERPRO_DIVIDA_NDF_PATH' },
  faturamento: { prod: '/consulta-faturamento/v1',        demo: '/consulta-faturamento-trial/v1',     envPro: 'SERPRO_FATURAMENTO_PATH', envDemo: 'SERPRO_FATURAMENTO_TRIAL_PATH' },
  renda:       { prod: '/renda-pf/v1',                    demo: '/renda-pf-trial/v1',                 envPro: 'SERPRO_RENDA_PATH', envDemo: 'SERPRO_RENDA_TRIAL_PATH' },
  restituicao: { prod: '/restituicao-pf/v1',              demo: '/consulta-restituicao-trial/v1',     envPro: 'SERPRO_RESTITUICAO_PATH', envDemo: 'SERPRO_RESTITUICAO_TRIAL_PATH' },
  carimbo:     { prod: '/checkstamp/1',                   demo: '/checkstamp-trial/1',                envPro: 'SERPRO_CARIMBO_PATH', envDemo: 'SERPRO_CARIMBO_TRIAL_PATH' },
  cartorio:    { prod: '/consulta-cpf-cnpj/v2',           demo: '/consulta-cpf-cnpj-trial/v1',        envPro: 'SERPRO_CPF_CNPJ_PATH', envDemo: 'SERPRO_CPF_CNPJ_TRIAL_PATH' },
  ccir:        { prod: '/consulta-ccir',                  demo: '/consulta-ccir-trial',               envPro: 'SERPRO_CCIR_PATH', envDemo: 'SERPRO_CCIR_TRIAL_PATH' },
  compras:     { prod: '/integra-compras/v1',             demo: '/integra-compras-hom/v1',            envPro: 'SERPRO_COMPRAS_PATH', envDemo: 'SERPRO_COMPRAS_HOM_PATH' },
  pilar:       { prod: '/pilar',                          demo: '/pilar-trial',                       envPro: 'SERPRO_PILAR_PATH', envDemo: 'SERPRO_PILAR_TRIAL_PATH' },
  portal:      { prod: '/antecipagov',                    demo: '/antecipagov-trial',                 envPro: 'SERPRO_ANTECIPA_PATH', envDemo: 'SERPRO_ANTECIPA_TRIAL_PATH' },
  datavalid:   { prod: '/datavalid',                      demo: '/datavalid-demonstracao',            envPro: 'SERPRO_DATAVALID_PATH', envDemo: 'SERPRO_DATAVALID_TRIAL_PATH' },
  biovalid:    { prod: '/biovalid/v1',                    demo: null,                               envPro: 'SERPRO_BIOVALID_PATH' },
  contador:    { prod: '/integra-contador/v1',            demo: null,                               envPro: 'SERPRO_CONTADOR_PATH' },
  ia:          { prod: '/serpro-ia/v1/analise',           demo: null,                               envPro: 'SERPRO_IA_PATH' },
  // Comex: várias APIs com bases próprias - tratadas por funções dedicadas
};

function baseProd(env, svc) {
  const c = SVCS[svc];
  return (c.envPro && env[c.envPro]) || c.prod;
}
function baseDemo(env, svc) {
  const c = SVCS[svc];
  if (!c.demo) return null;
  return (c.envDemo && env[c.envDemo]) || c.demo;
}

export function serproEnabled(env) {
  return Boolean(env.SERPRO_CONSUMER_KEY && env.SERPRO_CONSUMER_SECRET);
}

let tokenMem = null;

async function obterToken(env, forcar = false) {
  if (!forcar) {
    if (tokenMem && tokenMem.exp > Date.now()) return tokenMem.token;
    const cached = await env.KV.get(TOKEN_KEY).catch(() => null);
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (c.exp > Date.now()) {
          tokenMem = c;
          return c.token;
        }
      } catch { /* cache inválido */ }
    }
  }
  try {
    const res = await fetch(`${GATEWAY}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${env.SERPRO_CONSUMER_KEY}:${env.SERPRO_CONSUMER_SECRET}`)}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data.access_token || data.accessToken;
    if (!token) return null;
    const ttl = Math.max(60, (Number(data.expires_in) || 300) - 120);
    tokenMem = { token, exp: Date.now() + ttl * 1000 };
    await env.KV.put(TOKEN_KEY, JSON.stringify(tokenMem), { expirationTtl: ttl }).catch(() => {});
    return token;
  } catch {
    return null;
  }
}

function interpretarErro(res, text, data) {
  if (res.status === 403 && /subscription/i.test(String(data?.description || data?.message || ''))) {
    return { ok: false, code: 'SERPRO_SEM_ASSINATURA', message: 'Credenciais válidas, mas este produto Serpro não está assinado para a sua conta. Assine em loja.serpro.gov.br e vincule a API ao consumer.', status: res.status };
  }
  return { ok: false, code: 'SERPRO_ERRO', message: data?.description || data?.message || data?.errorResponse || text?.slice(0, 300) || `Erro ${res.status}`, status: res.status };
}

async function rawRequest(env, path, token, { method = 'GET', body = null, headers = {} } = {}) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${GATEWAY}${path}`, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) return interpretarErro(res, text, data);
  return { ok: true, data };
}

async function serproRequest(env, path, opts = {}) {
  if (!serproEnabled(env)) {
    return { ok: false, code: 'SERPRO_NAO_CONFIGURADO', message: 'Serpro não configurado. Contrate o serviço em loja.serpro.gov.br e defina os secrets SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET.' };
  }
  let token = await obterToken(env);
  if (!token) return { ok: false, code: 'SERPRO_AUTH', message: 'Falha ao autenticar no Serpro. Verifique as credenciais.' };
  try {
    let r = await rawRequest(env, path, token, opts);
    if (!r.ok && r.status === 401) {
      token = await obterToken(env, true);
      if (token) r = await rawRequest(env, path, token, opts);
    }
    return r;
  } catch (e) {
    return { ok: false, code: 'SERPRO_REDE', message: 'Falha de conexão com o Serpro: ' + e.message };
  }
}

// Ambiente de DEMONSTRAÇÃO (chave Bearer pública das docs em apicenter.estaleiro.serpro.gov.br)
async function trialRequest(env, path, opts = {}) {
  const t = env.SERPRO_TRIAL_TOKEN;
  if (!t) return { ok: false, code: 'SERPRO_SEM_TRIAL', message: 'Chave de demonstração não configurada (secret SERPRO_TRIAL_TOKEN).' };
  try {
    return await rawRequest(env, path, t, opts);
  } catch (e) {
    return { ok: false, code: 'SERPRO_REDE', message: 'Falha de conexão com o Serpro: ' + e.message };
  }
}

// Chamada com fallback automático: tenta o ambiente oficial (OAuth2) e, se falhar,
// tenta o ambiente de demonstração da mesma API (quando existir e a trial key estiver configurada).
// Resultado sempre marca o ambiente: { ambiente: 'prod' | 'demo' }.
// opts.demoSub permite um caminho diferente no trial (ex.: NF-e /status vs /v1/nfe/status).
async function autoRequest(env, svc, sub, { demoSub = null, ...opts } = {}) {
  const r = await serproRequest(env, `${baseProd(env, svc)}${sub}`, opts);
  if (r.ok) return { ...r, ambiente: 'prod' };
  const demo = baseDemo(env, svc);
  if (demo && env.SERPRO_TRIAL_TOKEN && r.code !== 'SERPRO_NAO_CONFIGURADO' && r.code !== 'SERPRO_AUTH') {
    const d = await trialRequest(env, `${demo}${demoSub || sub}`, opts);
    if (d.ok) return { ...d, ambiente: 'demo', erroProd: r.message, codigoProd: r.code };
  }
  return { ...r, ambiente: 'prod' };
}

// Normaliza a resposta de status das APIs ({"status":"OK"} e variações)
function normalizarStatus(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  return d.status || d.situacao || d.health || JSON.stringify(d).slice(0, 200);
}

export const serpro = {
  auto: autoRequest,
  baseProd: (env, svc) => baseProd(env, svc),
  baseDemo: (env, svc) => baseDemo(env, svc),
  servicos: Object.keys(SVCS),

  // Consulta CNPJ v2 / trial v2 (basica | qsa | empresa)
  consultarCnpj: (env, cnpj, modo = 'basica') => {
    const m = ['basica', 'qsa', 'empresa'].includes(modo) ? modo : 'basica';
    return autoRequest(env, 'cnpj', `/${m}/${cnpj}`);
  },
  cnpjStatus: (env) => autoRequest(env, 'cnpj', '/status'),

  // Consulta CPF v3 (ni + nascimento ddmmaaaa)
  consultarCpf: (env, cpf, nasc = '') =>
    autoRequest(env, 'cpf', `/cpf/${cpf}/${nasc}`),
  situacaoCpf: (env, cpf, nasc = '') =>
    autoRequest(env, 'cpf', `/cpf/${cpf}/${nasc}`),
  cpfStatus: (env) => autoRequest(env, 'cpf', '/status'),

  // Consulta NF-e pela chave de acesso (44 dígitos) - prod usa /v1/nfe/{chave}
  consultarNfe: (env, chave) => autoRequest(env, 'nfe', `/v1/nfe/${chave}`),
  nfeStatus: (env) => autoRequest(env, 'nfe', '/status', { demoSub: '/v1/nfe/status' }),
  // Escalonada (processamento assíncrono em lote)
  nfeEscalonadaConsultar: (env, chave) => autoRequest(env, 'escalonada', `/${chave}`),
  // NF-e push - monitoramento de chaves de acesso
  nfePushClientes: (env) => autoRequest(env, 'nfe', '/v1/nfe/push/clientes'),
  nfePushListar: (env) => autoRequest(env, 'nfe', '/v1/nfe/push/solicitacoes'),
  nfePushCriar: (env, chaves) => autoRequest(env, 'nfe', '/v1/nfe/push/solicitacoes', { method: 'POST', body: { chavesMonitoracao: chaves } }),
  nfePushExcluir: (env, id) => autoRequest(env, 'nfe', `/v1/nfe/push/solicitacoes/${id}`, { method: 'DELETE' }),

  // CND - Certidão Negativa de Débitos (PGFN)
  consultarCnd: (env, { tipoContribuinte, contribuinte, codigoIdentificacao, gerarPdf = false }) =>
    autoRequest(env, 'cnd', '/certidao', {
      method: 'POST',
      body: {
        TipoContribuinte: tipoContribuinte,
        ContribuinteConsulta: contribuinte,
        CodigoIdentificacao: codigoIdentificacao || null,
        GerarCertidaoPdf: Boolean(gerarPdf),
      },
    }),
  cndStatus: (env) => autoRequest(env, 'cnd', '/status'),

  // DUE - Declaração Única de Exportação
  consultarDue: (env, numero, chave) => autoRequest(env, 'due', `/v2/due/${numero}/${chave}`),
  dueStatus: (env) => autoRequest(env, 'due', '/status'),

  // Faturamento (Compartilha RFB / e-CAC)
  consultarFaturamento: (env, token, niContratante) =>
    autoRequest(env, 'faturamento', `/Consultar/${token}/${niContratante}`),
  autorizacoesFaturamento: (env, niContratante, niTitularDados) =>
    autoRequest(env, 'faturamento', `/Autorizacoes/${niContratante}/${niTitularDados}`),
  faturamentoStatus: (env) => autoRequest(env, 'faturamento', '/Status/'),

  // Renda PF (Declaração IRPF via Compartilha e-CAC)
  rendaCpf: (env, token) => autoRequest(env, 'renda', `/Consultar/${token}`),
  rendaAutorizacoes: (env, niContratante, niTitularDados) =>
    autoRequest(env, 'renda', `/Autorizacoes/${niContratante}/${niTitularDados}`),
  rendaStatus: (env) => autoRequest(env, 'renda', '/status').then((r) => (r.ok ? { ...r, data: normalizarStatus(r.data) } : r)),

  // Restituição do IRPF
  restituicaoCpf: (env, token) => autoRequest(env, 'restituicao', `/Consultar/${token}`),
  restituicaoAutorizacoes: (env, niContratante, niTitularDados) =>
    autoRequest(env, 'restituicao', `/Autorizacoes/${niContratante}/${niTitularDados}`),
  restituicaoStatus: (env) => autoRequest(env, 'restituicao', '/status').then((r) => (r.ok ? { ...r, data: normalizarStatus(r.data) } : r)),

  // Compras.gov.br - chat de mensagens e diligências da compra
  comprasChat: (env, chaveCompra, { diligencias = false, desde = '', page = '', size = '' } = {}) => {
    const qs = new URLSearchParams({ ordem: 'desc' });
    if (desde) qs.set('desde', desde);
    if (page) qs.set('page', page);
    if (size) qs.set('size', size);
    return autoRequest(env, 'compras', `/chat/${chaveCompra}${diligencias ? '/diligencias' : ''}?${qs.toString()}`);
  },

  // Integra Contador (procuração eletrônica e-CAC) - DadosEntrada JSON genérico
  contador: (env, operacao, { jwtToken = '', autenticarProcuradorToken = '', dados = {} } = {}) => {
    const headers = {};
    if (jwtToken) headers.jwt_token = jwtToken;
    if (autenticarProcuradorToken) headers.autenticar_procurador_token = autenticarProcuradorToken;
    return serproRequest(env, `${baseProd(env, 'contador')}/${operacao}`, {
      method: 'POST',
      body: { DadosEntrada: dados },
      headers,
    });
  },

  // Carimbo de Tempo - verifica a assinatura x-signature de outras APIs Serpro
  carimboTempo: (env, { base64, document: docs } = {}) => {
    const body = { timestamp: { base64 } };
    if (Array.isArray(docs)) body.document = docs;
    return autoRequest(env, 'carimbo', '/check', { method: 'POST', body });
  },

  // Integra Comex - operações de leitura (requer jwt_token SAPI quando aplicável)
  comexContainer: (env, numeros, jwtToken = '') => {
    const headers = jwtToken ? { jwt_token: jwtToken } : {};
    return serproRequest(env, `${env.SERPRO_COMEX_CONTAINER_PATH || '/integra-comex-carga-srv-consultaconteiner/v1'}/conteiner/situacao`, {
      method: 'POST',
      body: numeros.map((n) => ({ numero: n })),
      headers,
    });
  },
  comexPresenca: (env, { nic, recinto }, jwtToken = '') => {
    const headers = jwtToken ? { jwt_token: jwtToken } : {};
    const qs = new URLSearchParams({ nic, recinto });
    return serproRequest(env, `${env.SERPRO_COMEX_PRESENCA_PATH || '/siscarga-consulta-presenca/api'}/consulta?${qs.toString()}`, { headers });
  },
  comexHabilitacao: (env, cnpj, jwtToken = '') => {
    const headers = jwtToken ? { jwt_token: jwtToken } : {};
    return serproRequest(env, `${env.SERPRO_COMEX_HABILITACAO_PATH || '/cint-api'}/api/sapi/habilitacao/${cnpj}`, { headers });
  },

  // Dívida Ativa da União (PGFN via Serpro) - GET {base}/v1/devedor/{ni}
  consultarDividaAtiva: async (env, ni) => {
    let r = await autoRequest(env, 'divida', `/v1/devedor/${ni}`);
    if (!r.ok && (r.status === 404 || r.status === 405)) {
      r = await autoRequest(env, 'divida', '/divida-ativa', { method: 'POST', body: { ni } });
    }
    return r;
  },
  // Inscrição da Dívida Ativa pelo número
  consultarInscricao: (env, numero) => autoRequest(env, 'divida', `/v1/inscricao/${numero}`),
  dividaStatus: (env) => autoRequest(env, 'divida', '/status'),

  // Consulta CPF/CNPJ v2 (Cartório Data) - modos cpf | basica | qsa | empresa
  consultarCpfCnpj: (env, modo, ni) => {
    const m = ['cpf', 'basica', 'qsa', 'empresa'].includes(modo) ? modo : 'basica';
    return autoRequest(env, 'cartorio', `/${m}/${ni}`);
  },

  // CCIR - Certificado de Cadastro de Imóvel Rural (INCRA)
  ccirPorCodigo: (env, codigo) => autoRequest(env, 'ccir', `/v1/consultarDadosCcirPorCodigoImovel/${codigo}`),
  ccirPorNi: (env, cpfCnpj) => autoRequest(env, 'ccir', `/v1/consultarCodigoImovelPorNI/${cpfCnpj}`),
  ccirEmitir: (env, codigo) => autoRequest(env, 'ccir', `/v1/emitirCcirPorCodigoImovel/${codigo}`),
  ccirStatus: (env) => autoRequest(env, 'ccir', '/v1/status').then((r) => (r.ok ? { ...r, data: normalizarStatus(r.data) } : r)),

  // Antecipa Gov - Portal de operações (LEITURA)
  antecipaLer: (env, sub) => autoRequest(env, 'portal', sub),
  // Antecipa Gov - PILAR (antecipação a fornecedores / UASG)
  pilarLer: (env, sub) => autoRequest(env, 'pilar', sub),

  // Datavalid v5 - validação de identidade
  datavalidValidar: (env, payload) => autoRequest(env, 'datavalid', '/v5/pessoa-fisica/validacao', { method: 'POST', body: payload }),
  datavalidStatus: (env) => autoRequest(env, 'datavalid', '/v5/status'),

  // BioValid - biometria facial (token + prova de vida)
  biovalidToken: (env, { cpf, expiraEm = '', tentativas = '' }) => {
    const qs = new URLSearchParams({ cpf });
    if (expiraEm) qs.set('expira_em', expiraEm);
    if (tentativas) qs.set('qtd_tentativas', tentativas);
    return serproRequest(env, `${baseProd(env, 'biovalid')}/token?${qs.toString()}`, { method: 'POST' });
  },
  biovalidLiveness: (env, { cpf, pin, device, selfie = '', sexo = '', cnh = '' }) => {
    const body = {};
    if (selfie) body.selfie = selfie;
    if (sexo) body.sexo = sexo;
    if (cnh) body.cnh = cnh;
    return serproRequest(env, `${baseProd(env, 'biovalid')}/liveness`, {
      method: 'PUT',
      body,
      headers: { 'x-cpf': cpf, 'x-pin': pin, 'x-device': device },
    });
  },

  // Serpro IA - análise e inteligência sobre dados fiscais
  ia: (env, { prompt, contexto }) =>
    serproRequest(env, baseProd(env, 'ia'), { method: 'POST', body: { prompt, contexto } }),
};
