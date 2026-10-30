// DirectData - marketplace de consultas Big Data (apiv3.directd.com.br)
// Docs: https://www.directd.com.br/central-de-ajuda/apis
// Auth: Bearer token do painel (app.directd.com.br -> Configurações -> Integrações) via secret DIRECTDATA_TOKEN
// Padrão: GET /api/{Endpoint}?Param=valor -> { metaDados: {resultado, mensagem, consultaUid, tempoExecucaoMs}, retorno: {...} }
const DEFAULT_BASE = 'https://apiv3.directd.com.br';

export function directdataEnabled(env) {
  return Boolean(env.DIRECTDATA_TOKEN);
}

function base(env) {
  return (env.DIRECTDATA_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

const ENDPOINT_RE = /^[A-Za-z][A-Za-z0-9]{1,80}$/;
const PARAM_RE = /^[A-Za-z][A-Za-z0-9]{0,30}$/;

export function validarEndpoint(endpoint) {
  return ENDPOINT_RE.test(String(endpoint || ''));
}

export function validarParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  const limpos = {};
  for (const [k, v] of Object.entries(params)) {
    if (!PARAM_RE.test(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    if (!['string', 'number', 'boolean'].includes(typeof v)) continue;
    limpos[k] = String(v);
  }
  return limpos;
}

export async function consultar(env, endpoint, params = {}) {
  try {
    const qs = new URLSearchParams(validarParams(params)).toString();
    const url = `${base(env)}/api/${endpoint}${qs ? `?${qs}` : ''}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${env.DIRECTDATA_TOKEN}` },
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const meta = (data && typeof data === 'object' && data.metaDados) || {};
        return {
          ok: false,
          code: 'DIRECTDATA_ERRO',
          status: res.status,
          message: meta.mensagem || (res.status === 401 ? 'Token inválido, expirado ou IP não liberado na DirectData.' : `DirectData respondeu ${res.status}.`),
          metaDados: meta,
        };
      }
      return {
        ok: true,
        metaDados: (data && data.metaDados) || {},
        retorno: (data && data.retorno) ?? data,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, code: 'DIRECTDATA_TIMEOUT', message: 'Tempo esgotado aguardando a DirectData.' };
    }
    return { ok: false, code: 'DIRECTDATA_FALHA', message: e.message };
  }
}
