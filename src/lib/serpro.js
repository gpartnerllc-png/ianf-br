// Cliente Serpro - APIs governamentais oficiais (PIN: CPF/CNPJ; Dívida Ativa; Serpro IA)
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

async function serproRequest(env, path, { method = 'GET', body = null } = {}) {
  if (!serproEnabled(env)) {
    return { ok: false, code: 'SERPRO_NAO_CONFIGURADO', message: 'Serpro não configurado. Contrate o serviço em loja.serpro.gov.br e defina os secrets SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET.' };
  }
  let token = await obterToken(env);
  if (!token) return { ok: false, code: 'SERPRO_AUTH', message: 'Falha ao autenticar no Serpro. Verifique as credenciais.' };
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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
  // Consulta CNPJ (dados completos da Receita via Serpro PIN)
  consultarCnpj: (env, cnpj) =>
    serproRequest(env, `/consulta-cnpj-df/v2/basica/${cnpj}`),
  // Consulta CPF (Serpro PIN)
  consultarCpf: (env, cpf) =>
    serproRequest(env, `/consulta-cpf-df-trial/v1/cpf/${cpf}`),
  // Consulta situação do CPF na Receita
  situacaoCpf: (env, cpf) =>
    serproRequest(env, `/consulta-cpf-df-trial/v1/status/${cpf}`),
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
