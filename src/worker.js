import { json, err, ok, audit, getIp, readBody } from './lib/utils.js';
import { bootstrapAdmin, handleRegister, handleLogin, handleLogout, handleMe, handleTrocarSenha } from './routes/auth.js';
import { handleCalcular, handleRegimes, handleDre, handleDreComparativo, handleLancamentos, handleLancamentoItem, handleEmpresas, handleEmpresaItem } from './routes/fiscal.js';
import { handleNotas, handleNotaItem, handleSincronizarEntradas, handleConsultarNota } from './routes/notas.js';
import { handleStatus, handleCnpj, handleCpf, handleCep, handleSpedy, handleZapsign, handleZapsignProtocolo, handleZapsignVerificar, handleSerpro, handlePgfn, handleSerasa, handleApibrasil } from './routes/integracao.js';
import { handleUsers, handleUserItem, handleAuditoria, handleMetricas } from './routes/admin.js';
import { handleInsight, handleChat, handleClassificar, handleAnalisarNota } from './routes/ai.js';
import { handleAssinatura, handleAssinar, handleAssinaturaWhatsapp, handleAssinaturaRecibo, handleInfinitepayWebhook, processarAssinaturasDiarias } from './routes/assinatura.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Bootstrap do admin inicial (uma vez)
    ctx.waitUntil(bootstrapAdmin(env));

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Webhook da Spedy (assinatura verificada)
    if (url.pathname === '/api/webhooks/spedy') {
      return handleSpedyWebhook(env, request);
    }

    // Webhook da InfinitePay (pagamentos da assinatura)
    if (url.pathname === '/api/webhooks/infinitepay') {
      return handleInfinitepayWebhook(env, request);
    }

    // ====== API ======
    if (url.pathname.startsWith('/api/')) {
      try {
        return await routeApi(env, request, url);
      } catch (e) {
        console.error('[IANF] Erro na API:', e);
        return json({ ok: false, error: { code: 'INTERNO', message: 'Erro interno do servidor.' } }, 500);
      }
    }

    // ====== Assets estáticos (frontend) ======
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      return new Response('IANF: frontend indisponível.', { status: 500 });
    }
  },

  // Rotina diária de assinaturas: lembretes WhatsApp (5 dias antes / no dia),
  // cobrança automática no vencimento e pausa de inadimplentes
  async scheduled(event, env, ctx) {
    ctx.waitUntil(processarAssinaturasDiarias(env));
  },
};

async function routeApi(env, request, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;

  // ---- Públicas ----
  if (path === '/api/status' && method === 'GET') return handleStatus(env);
  if (path === '/api/auth/register' && method === 'POST') return handleRegister(env, request);
  if (path === '/api/auth/login' && method === 'POST') return handleLogin(env, request);
  if (path === '/api/auth/logout' && method === 'POST') return handleLogout(env, request);
  if (path === '/api/auth/me' && method === 'GET') return handleMe(env, request);
  if (path === '/api/auth/senha' && method === 'PUT') return handleTrocarSenha(env, request);
  if (path === '/api/fiscal/calcular' && method === 'POST') return handleCalcular(env, request);
  if (path === '/api/fiscal/regimes' && method === 'GET') return handleRegimes(env);

  // ---- Autenticadas ----
  if (path === '/api/dre' && method === 'GET') return handleDre(env, request);
  if (path === '/api/dre/comparativo' && method === 'GET') return handleDreComparativo(env, request);
  if (path === '/api/lancamentos' && ['GET', 'POST'].includes(method)) return handleLancamentos(env, request);

  let match = path.match(/^\/api\/lancamentos\/(\d+)$/);
  if (match) return handleLancamentoItem(env, request, match[1]);

  if (path === '/api/empresas' && ['GET', 'POST'].includes(method)) return handleEmpresas(env, request);
  match = path.match(/^\/api\/empresas\/(\d+)$/);
  if (match) return handleEmpresaItem(env, request, match[1]);

  if (path === '/api/notas' && ['GET', 'POST'].includes(method)) return handleNotas(env, request);
  match = path.match(/^\/api\/notas\/(\d+)$/);
  if (match && method === 'GET') return handleNotaItem(env, request, match[1]);
  if (match && method === 'DELETE') return handleNotaItem(env, request, match[1]);
  if (path === '/api/notas/sincronizar-entradas' && method === 'POST') return handleSincronizarEntradas(env, request);
  match = path.match(/^\/api\/notas\/(\d+)\/consultar$/);
  if (match && method === 'POST') return handleConsultarNota(env, request, match[1]);

  if (path === '/api/integracao/cnpj' && method === 'GET') return handleCnpj(env, request);
  if (path === '/api/integracao/cpf' && method === 'GET') return handleCpf(env, request);
  if (path === '/api/integracao/cep' && method === 'GET') return handleCep(env, request);
  if (path === '/api/integracao/spedy' && method === 'GET') return handleSpedy(env, request);
  if (path === '/api/integracao/zapsign' && method === 'GET') return handleZapsign(env, request);
  if (path === '/api/integracao/zapsign/protocolo' && method === 'POST') return handleZapsignProtocolo(env, request);
  if (path === '/api/integracao/zapsign/verificar' && method === 'POST') return handleZapsignVerificar(env, request);
  if (path === '/api/integracao/serpro' && method === 'GET') return handleSerpro(env, request);
  if (path === '/api/integracao/pgfn' && method === 'GET') return handlePgfn(env, request);
  if (path === '/api/integracao/serasa' && method === 'POST') return handleSerasa(env, request);
  if (path === '/api/integracao/apibrasil' && method === 'POST') return handleApibrasil(env, request);

  if (path === '/api/ia/insight' && method === 'GET') return handleInsight(env, request);
  if (path === '/api/ia/chat' && method === 'POST') return handleChat(env, request);
  if (path === '/api/ia/classificar' && method === 'POST') return handleClassificar(env, request);
  if (path === '/api/ia/analisar-nota' && method === 'POST') return handleAnalisarNota(env, request);

  if (path === '/api/assinatura' && method === 'GET') return handleAssinatura(env, request);
  if (path === '/api/assinatura' && method === 'POST') return handleAssinar(env, request);
  if (path === '/api/assinatura/whatsapp' && method === 'PUT') return handleAssinaturaWhatsapp(env, request);
  if (path === '/api/assinatura/recibo' && method === 'GET') return handleAssinaturaRecibo(env, request);

  if (path === '/api/admin/users' && method === 'GET') return handleUsers(env, request);
  match = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (match) return handleUserItem(env, request, match[1]);
  if (path === '/api/admin/auditoria' && method === 'GET') return handleAuditoria(env, request);
  if (path === '/api/admin/metricas' && method === 'GET') return handleMetricas(env, request);

  return err('Rota não encontrada.', 404, 'ROTA_INEXISTENTE');
}

// Webhook de eventos da Spedy (autorização/rejeição/cancelamento de notas)
async function handleSpedyWebhook(env, request) {
  const body = await readBody(request);
  const signature = request.headers.get('webhook-signature') || '';

  // Verificação de assinatura (Standard Webhooks HMAC-SHA256 com secret opcional)
  if (env.SPEDY_WEBHOOK_SECRET) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.SPEDY_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(await request.clone().text()));
    const computed = Array.from(new Uint8Array(signatureBytes), (b) => b.toString(16).padStart(2, '0')).join('');
    if (computed !== signature.toLowerCase()) {
      return json({ ok: false, error: { code: 'ASSINATURA_INVALIDA', message: 'Assinatura do webhook inválida.' } }, 401);
    }
  }

  const eventType = body.type || body.event || body.eventType || 'desconhecido';
  const invoiceId = body.data?.id || body.id || '';
  await audit(env, { acao: 'WEBHOOK_SPEDY', detalhe: `${eventType} - ${invoiceId}` });

  // Atualiza status da nota local
  try {
    if (invoiceId) {
      const status = String(body.data?.status || body.status || '').toLowerCase();
      if (['autorizada', 'authorized', 'approved'].includes(status)) {
        await env.DB.prepare("UPDATE notas SET status = 'autorizada' WHERE provider_id = ?").bind(invoiceId).run();
      } else if (['rejeitada', 'rejected', 'cancelada', 'canceled'].includes(status)) {
        await env.DB.prepare("UPDATE notas SET status = ? WHERE provider_id = ?").bind(status, invoiceId).run();
      }
    }
  } catch (e) {
    console.error('[IANF] Erro ao processar webhook:', e.message);
  }

  return ok({ recebido: true });
}
