// Cliente Serpro - APIs governamentais oficiais (PIN: CPF/CNPJ; Serpro IA)
// Requer assinatura ativa no portal: https://loja.serpro.gov.br
// Credenciais via secrets: SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET

const GATEWAY = 'https://gateway.apiserpro.serpro.gov.br';

export function serproEnabled(env) {
  return Boolean(env.SERPRO_CONSUMER_KEY && env.SERPRO_CONSUMER_SECRET);
}

let tokenCache = null;

async function obterToken(env) {
  if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.token;
  const credentials = `${env.SERPRO_CONSUMER_KEY}:${env.SERPRO_CONSUMER_SECRET}`;
  try {
    const res = await fetch(`${GATEWAY}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(credentials)}`,
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data.access_token || data.accessToken;
    tokenCache = { token, exp: Date.now() + ((data.expires_in || 300) - 30) * 1000 };
    return token;
  } catch {
    return null;
  }
}

async function serproRequest(env, path, { method = 'GET', body = null } = {}) {
  if (!serproEnabled(env)) {
    return { ok: false, code: 'SERPRO_NAO_CONFIGURADO', message: 'Serpro não configurado. Contrate o serviço em loja.serpro.gov.br e defina os secrets SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET.' };
  }
  const token = await obterToken(env);
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
    const res = await fetch(`${GATEWAY}${path}`, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) {
      return { ok: false, code: 'SERPRO_ERRO', message: data?.message || `Erro ${res.status}`, status: res.status };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, code: 'SERPRO_REDE', message: 'Falha de conexão com o Serpro: ' + e.message };
  }
}

export const serpro = {
  // Consulta CNPJ (dados completos da Receita via Serpro PIN)
  consultarCnpj: (env, cnpj) =>
    serproRequest(env, `/consulta-cnpj-df/v2/basica/${cnpj}`, {
      method: 'POST',
      body: {},
    }),
  // Consulta CPF (Serpro PIN)
  consultarCpf: (env, cpf) =>
    serproRequest(env, `/consulta-cpf-df-trial/v1/cpf/${cpf}`, {
      method: 'POST',
      body: {},
    }),
  // Consulta situação do CPF na Receita
  situacaoCpf: (env, cpf) =>
    serproRequest(env, `/consulta-cpf-df-trial/v1/status/${cpf}`, {
      method: 'POST',
      body: {},
    }),
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
