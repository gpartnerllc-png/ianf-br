// Serasa Experian - Verify (Verificação de Dados PF e PJ)
// Docs: https://developer.serasaexperian.com.br/api/verificacao-de-dados-pf-e-pj/documentacao
// Auth: Bearer JWT do IAM Serasa (secret SERASA_TOKEN; base configurável via SERASA_BASE_URL)
const PROD_BASE = 'https://api.serasaexperian.com.br/id-fraud/verify-id/v1';

export function serasaEnabled(env) {
  return Boolean(env.SERASA_TOKEN);
}

function base(env) {
  return (env.SERASA_BASE_URL || PROD_BASE).replace(/\/+$/, '');
}

async function post(env, path, body) {
  try {
    const res = await fetch(`${base(env)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SERASA_TOKEN}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // Serasa responde erros como array: [{"code":"400","message":"MSG00017..."}] ou objeto aninhado
      const item = Array.isArray(data) ? data[0] : data;
      const msg = item?.message || item?.fault?.faultstring || `Serasa respondeu ${res.status}`;
      const code = item?.code ? String(item.code) : String(res.status);
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
