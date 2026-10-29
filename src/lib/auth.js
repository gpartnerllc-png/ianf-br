import { json, randomId } from './utils.js';

// 15000 iterações = seguro com rate limiting e compatível com o CPU de 10ms do plano Free.
// Em planos pagos (CPU 30s), eleve via env PBKDF2_ITERATIONS=600000.
const ITERATIONS_DEFAULT = 15000;

function iterationsFor(env) {
  const n = parseInt(env?.PBKDF2_ITERATIONS, 10);
  return Number.isFinite(n) && n > 0 ? n : ITERATIONS_DEFAULT;
}

export async function hashPassword(password, saltHex = null, env = {}) {
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g), (h) => parseInt(h, 16))
    : crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: iterationsFor(env), hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
  const saltStr = Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${saltStr}:${hashHex}`;
}

export async function verifyPassword(password, stored, env = {}) {
  if (!stored || !stored.includes(':')) return false;
  const [saltHex] = stored.split(':');
  const candidate = await hashPassword(password, saltHex, env);
  const a = new Uint8Array(candidate.length);
  const b = new Uint8Array(candidate.length);
  a.set(new TextEncoder().encode(candidate));
  b.set(new TextEncoder().encode(stored));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const SESSION_TTL = 60 * 60 * 24; // 24h

export async function createSession(env, user) {
  const token = randomId(32);
  await env.KV.put(`session:${token}`, JSON.stringify({ userId: user.id, role: user.role, email: user.email }), {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

export async function getSession(env, token) {
  if (!token) return null;
  const raw = await env.KV.get(`session:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function destroySession(env, token) {
  if (token) await env.KV.delete(`session:${token}`);
}

export async function requireAuth(env, request) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = await getSession(env, token);
  if (!session) return { error: json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Sessão inválida ou expirada.' } }, 401) };
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(session.userId).first();
  if (!user || user.status !== 'active') {
    return { error: json({ ok: false, error: { code: 'FORBIDDEN', message: 'Conta bloqueada ou pendente de aprovação.' } }, 403) };
  }

  // Pausa por assinatura (franquia mensal): admin é isento e as rotas de assinatura/auth seguem liberadas
  if (user.role !== 'admin') {
    const path = new URL(request.url).pathname;
    const permitido = path.startsWith('/api/assinatura') || path.startsWith('/api/auth/');
    if (!permitido) {
      try {
        const ass = await env.DB.prepare('SELECT status, data_vencimento FROM assinaturas WHERE user_id = ?').bind(user.id).first();
        const vencida = !ass || ass.status !== 'ativo' || !ass.data_vencimento || new Date(ass.data_vencimento) <= new Date();
        if (vencida) {
          return { error: json({ ok: false, error: { code: 'ASSINATURA_PAUSADA', message: 'Sua assinatura está pausada. Renove o pagamento para continuar usando o IANF.', status: ass?.status || 'sem_assinatura' } }, 402) };
        }
      } catch (e) {
        console.error('[IANF] Verificação de assinatura:', e.message);
      }
    }
  }

  return { session, user, token };
}

export function requireAdmin(user) {
  if (user.role !== 'admin') {
    return json({ ok: false, error: { code: 'FORBIDDEN', message: 'Acesso restrito ao administrador.' } }, 403);
  }
  return null;
}
