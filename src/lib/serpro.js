// Cliente Serpro - APIs governamentais oficiais
// CNPJ v2 · CPF v3 · NF-e · CND · DUE · Faturamento · Compras · Integra Contador · Carimbo de Tempo · Integra Comex · Dívida Ativa · Serpro IA
// Requer assinatura ativa no portal: https://loja.serpro.gov.br
// Credenciais via secrets: SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET
// Token OAuth2 renovado automaticamente (cache em KV 'serpro:token')

const GATEWAY = 'https://gateway.apiserpro.serpro.gov.br';
const TOKEN_KEY = 'serpro:token';

export function serproEnabled(env) {
  return Boolean(env.SERPRO_CONSUMER_KEY && env.SERPRO_CONSUMER_SECRET);
}

let tokenMem = null;

async function obterToken(env, forcar = false) {
  if (!forcar) {
    if (tokenMem && tokenMem.exp > Date.now()) return tokenMem.token;
    const cached = await env.CACHE.get(TOKEN_KEY).catch(() => null);
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
    await env.CACHE.put(TOKEN_KEY, JSON.stringify(tokenMem), { expirationTtl: ttl }).catch(() => {});
    return token;
  } catch {
    return null;
  }
}

async function serproRequest(env, path, { method = 'GET', body = null, headers = {} } = {}) {
  if (!serproEnabled(env)) {
    return { ok: false, code: 'SERPRO_NAO_CONFIGURADO', message: 'Serpro não configurado. Contrate o serviço em loja.serpro.gov.br e defina os secrets SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET.' };
  }
  let token = await obterToken(env);
  if (!token) return { ok: false, code: 'SERPRO_AUTH', message: 'Falha ao autenticar no Serpro. Verifique as credenciais.' };
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    let res = await fetch(`${GATEWAY}${path}`, opts);
    // Token expirado/revogado? Renova uma vez e tenta de novo
    if (res.status === 401) {
      token = await obterToken(env, true);
      if (token) {
        opts.headers.Authorization = `Bearer ${token}`;
        res = await fetch(`${GATEWAY}${path}`, opts);
      }
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) {
      if (res.status === 403 && /subscription/i.test(String(data?.description || data?.message || ''))) {
        return { ok: false, code: 'SERPRO_SEM_ASSINATURA', message: 'Credenciais válidas, mas este produto Serpro não está assinado para a sua conta. Assine em loja.serpro.gov.br e vincule a API ao consumer.', status: res.status };
      }
      return { ok: false, code: 'SERPRO_ERRO', message: data?.description || data?.message || `Erro ${res.status}`, status: res.status };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, code: 'SERPRO_REDE', message: 'Falha de conexão com o Serpro: ' + e.message };
  }
}

export const serpro = {
  // Consulta CNPJ v2 (basica | qsa | empresa)
  consultarCnpj: (env, cnpj, modo = 'basica') => {
    const base = env.SERPRO_CNPJ_PATH || '/consulta-cnpj-df/v2';
    const m = ['basica', 'qsa', 'empresa'].includes(modo) ? modo : 'basica';
    return serproRequest(env, `${base}/${m}/${cnpj}`);
  },
  // Consulta CPF v3 (ni + nascimento ddmmaaaa)
  consultarCpf: (env, cpf, nasc = '') =>
    serproRequest(env, `${env.SERPRO_CPF_PATH || '/consulta-cpf-df/v3'}/cpf/${cpf}/${nasc}`),
  // Situação do CPF = mesma consulta v3 (o retorno traz situacao{codigo,descricao})
  situacaoCpf: (env, cpf, nasc = '') =>
    serproRequest(env, `${env.SERPRO_CPF_PATH || '/consulta-cpf-df/v3'}/cpf/${cpf}/${nasc}`),
  // Consulta NF-e pela chave de acesso (44 dígitos)
  consultarNfe: (env, chave) =>
    serproRequest(env, `${env.SERPRO_NFE_PATH || '/consulta-nfe-df/api/v1'}/nfe/${chave}`),
  // CND - Certidão Negativa de Débitos (PGFN)
  consultarCnd: (env, { tipoContribuinte, contribuinte, codigoIdentificacao, gerarPdf = false }) =>
    serproRequest(env, `${env.SERPRO_CND_PATH || '/consulta-cnd/v1'}/certidao`, {
      method: 'POST',
      body: {
        TipoContribuinte: tipoContribuinte,
        ContribuinteConsulta: contribuinte,
        CodigoIdentificacao: codigoIdentificacao || null,
        GerarCertidaoPdf: Boolean(gerarPdf),
      },
    }),
  // DUE - Declaração Única de Exportação
  consultarDue: (env, numero, chave) =>
    serproRequest(env, `${env.SERPRO_DUE_PATH || '/api-consulta-due/api'}/v2/due/${numero}/${chave}`),
  // Faturamento (Compartilha RFB / e-CAC)
  consultarFaturamento: (env, token, niContratante) =>
    serproRequest(env, `${env.SERPRO_FATURAMENTO_PATH || '/consulta-faturamento/v1'}/Consultar/${token}/${niContratante}`),
  autorizacoesFaturamento: (env, niContratante, niTitularDados) =>
    serproRequest(env, `${env.SERPRO_FATURAMENTO_PATH || '/consulta-faturamento/v1'}/Autorizacoes/${niContratante}/${niTitularDados}`),
  // Compras.gov.br - chat de mensagens e diligências da compra
  comprasChat: (env, chaveCompra, { diligencias = false, desde = '', page = '', size = '' } = {}) => {
    const qs = new URLSearchParams({ ordem: 'desc' });
    if (desde) qs.set('desde', desde);
    if (page) qs.set('page', page);
    if (size) qs.set('size', size);
    const base = env.SERPRO_COMPRAS_PATH || '/integra-compras/v1';
    return serproRequest(env, `${base}/chat/${chaveCompra}${diligencias ? '/diligencias' : ''}?${qs.toString()}`);
  },
  // Integra Contador (procuração eletrônica e-CAC) - DadosEntrada JSON genérico
  contador: (env, operacao, { jwtToken = '', autenticarProcuradorToken = '', dados = {} } = {}) => {
    const headers = {};
    if (jwtToken) headers.jwt_token = jwtToken;
    if (autenticarProcuradorToken) headers.autenticar_procurador_token = autenticarProcuradorToken;
    return serproRequest(env, `${env.SERPRO_CONTADOR_PATH || '/integra-contador/v1'}/${operacao}`, {
      method: 'POST',
      body: { DadosEntrada: dados },
      headers,
    });
  },
  // Carimbo de Tempo - verifica a assinatura x-signature de outras APIs Serpro
  carimboTempo: (env, { base64, document: docs } = {}) => {
    const body = { timestamp: { base64 } };
    if (Array.isArray(docs)) body.document = docs;
    return serproRequest(env, '/checkstamp/1/check', { method: 'POST', body });
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
  // Dívida Ativa da União (PGFN via Serpro) - API oficial do catálogo gov.br Conecta
  // Contrato: https://www.loja.serpro.gov.br/consulta-divida-ativa
  // Endpoint configurável via env SERPRO_DIVIDA_PATH
  consultarDividaAtiva: async (env, ni) => {
    const path = env.SERPRO_DIVIDA_PATH || '/consulta-divida-ativa-df/api/v1/divida-ativa';
    let r = await serproRequest(env, path, { method: 'POST', body: { ni } });
    if (!r.ok && (r.status === 404 || r.status === 405)) {
      r = await serproRequest(env, `${path}/${ni}`, { method: 'GET' });
    }
    return r;
  },
  // Serpro IA - análise e inteligência sobre dados fiscais
  // (endpoint configurável via env SERPRO_IA_PATH, ex.: /ia/v1/chat)
  ia: (env, { prompt, contexto }) =>
    serproRequest(env, env.SERPRO_IA_PATH || '/serpro-ia/v1/analise', {
      method: 'POST',
      body: { prompt, contexto },
    }),
};
