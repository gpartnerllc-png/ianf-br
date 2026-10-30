// Serasa Experian - Verify (PF/PJ) + Financial Health Distributor
// Auth: Bearer access_token obtido em /security/iam/v1/client-identities/login (Basic clientId:clientSecret).
// Fallback: SERASA_TOKEN manual (JWT de sessão do portal, expira em ~1h).
// Cache do token em KV (key serasa:token) para reutilizar até perto da expiração.
const PROD_BASE = 'https://api.serasaexperian.com.br/id-fraud/verify-id/v1';

export function serasaEnabled(env) {
  return Boolean(env.SERASA_TOKEN || (env.SERASA_CLIENT_ID && env.SERASA_CLIENT_SECRET));
}

function base(env) {
  return (env.SERASA_BASE_URL || PROD_BASE).replace(/\/+$/, '');
}

function iamBase(env) {
  if (env.SERASA_IAM_BASE_URL) return env.SERASA_IAM_BASE_URL.replace(/\/+$/, '');
  try {
    return `https://${new URL(base(env)).host}/security/iam/v1/client-identities/login`;
  } catch {
    return 'https://api.serasaexperian.com.br/security/iam/v1/client-identities/login';
  }
}

// Obtém um token válido: KV cache → login client-identities → token manual
async function obterToken(env) {
  if (env.SERASA_CLIENT_ID && env.SERASA_CLIENT_SECRET) {
    try {
      const cached = await env.CACHE.get('serasa:token');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.token && parsed.exp > Date.now() + 60_000) return parsed.token;
      }
      const basic = btoa(`${env.SERASA_CLIENT_ID}:${env.SERASA_CLIENT_SECRET}`);
      const res = await fetch(iamBase(env), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
        body: '{}',
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.access_token) {
        const ttl = Math.max(60, Number(data.expires_in || 3600) - 120);
        await env.CACHE.put('serasa:token', JSON.stringify({ token: data.access_token, exp: Date.now() + ttl * 1000 }), { expirationTtl: ttl }).catch(() => {});
        return data.access_token;
      }
      const item = Array.isArray(data) ? data[0] : data;
      return { erro: `Falha ao obter token Serasa (client-identities): ${item?.message || `HTTP ${res.status}`}` };
    } catch (e) {
      return { erro: `Falha ao obter token Serasa: ${e.message}` };
    }
  }
  return env.SERASA_TOKEN || { erro: 'Serasa não configurada.' };
}

async function post(env, path, body, retry = true) {
  try {
    const token = await obterToken(env);
    if (typeof token !== 'string') {
      return { ok: false, code: 'SERASA_TOKEN_EXPIRADO', message: token.erro };
    }
    const res = await fetch(`${base(env)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Serasa responde erros como array: [{"code":"400","message":"MSG00017..."}] ou objeto aninhado
      const item = Array.isArray(data) ? data[0] : data;
      const msg = item?.message || item?.fault?.faultstring || `Serasa respondeu ${res.status}`;
      const code = item?.code ? String(item.code) : String(res.status);
      if ((res.status === 401 || code === '17') && retry && env.SERASA_CLIENT_ID) {
        await env.CACHE.delete('serasa:token').catch(() => {});
        return post(env, path, body, false);
      }
      if (res.status === 401 || code === '17') {
        return { ok: false, code: 'SERASA_TOKEN_EXPIRADO', message: `Token Serasa inválido ou expirado. ${msg}`, serasaCode: code };
      }
      return { ok: false, code: 'SERASA_ERRO', status: res.status, message: msg, serasaCode: code };
    }
    return { ok: true, data };
  } catch (e) {
    return { ok: false, code: 'SERASA_FALHA', message: e.message };
  }
}

export function verificarPessoa(env, person) {
  return post(env, '/people', { person, scoreParameters: ['VERIFY', 'REQUEST'] });
}

export function verificarEmpresa(env, business) {
  return post(env, '/business', { business, scoreParameters: ['VERIFY', 'REQUEST'] });
}

export function normalizarVerificacao(data = {}) {
  const grupos = (data.validationGroups || []).map((g) => ({
    code: g.code || '',
    message: g.message || '',
    rating: g.rating ?? null,
    details: (g.details || []).map((d) => ({
      value: d.value || '',
      type: d.type || '',
      code: d.code || '',
      message: d.message || '',
    })),
  }));
  return {
    verificationScore: data.verificationScore ?? null,
    verificationRisk: data.verificationRisk || '',
    validationGroups: grupos,
  };
}
