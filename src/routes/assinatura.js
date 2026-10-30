import { ok, err, readBody, audit, getIp } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';
import { infinitepayEnabled, criarLinkCheckout, consultarPagamento, VALOR_ASSINATURA_CENTS, DIAS_PERIODO } from '../lib/infinitepay.js';

export async function obterAssinatura(env, userId) {
  return env.DB.prepare('SELECT * FROM assinaturas WHERE user_id = ?').bind(userId).first();
}

export function assinaturaAtiva(ass, role) {
  if (role === 'admin') return true;
  if (!ass || ass.status !== 'ativo' || !ass.data_vencimento) return false;
  return new Date(ass.data_vencimento) > new Date();
}

// Confirmação REAL de pagamento: aplica renovação +30 dias e registra a receita (com dedup por order_nsu)
async function aplicarPagamento(env, ass, { orderNsu, transactionNsu = '', valorCents = 0 }) {
  const jaRegistrado = await env.DB.prepare(
    `SELECT id FROM lancamentos WHERE user_id = ? AND slot = 'assinatura' AND descricao LIKE '%' || ? || '%' LIMIT 1`
  ).bind(ass.user_id, orderNsu).first();
  if (jaRegistrado) return false;

  const agora = new Date();
  const base = ass.data_vencimento && new Date(ass.data_vencimento) > agora ? new Date(ass.data_vencimento) : agora;
  const venc = new Date(base);
  venc.setDate(venc.getDate() + DIAS_PERIODO);
  const cents = valorCents > 0 ? valorCents : ass.valor_cents;

  await env.DB.prepare(`
    UPDATE assinaturas SET
      status = 'ativo',
      data_inicio = COALESCE(data_inicio, ?),
      data_vencimento = ?,
      ultimo_pagamento = ?,
      lembretes = '[]',
      updated_at = ?
    WHERE id = ?
  `).bind(agora.toISOString(), venc.toISOString(), agora.toISOString(), agora.toISOString(), ass.id).run();

  await env.DB.prepare(
    `INSERT INTO lancamentos (user_id, tipo, slot, valor, descricao, nome_cliente)
     VALUES (?, 'receita', 'assinatura', ?, ?, 'Infinitepay')`
  ).bind(ass.user_id, cents / 100, `Assinatura mensal IANF · ${orderNsu}${transactionNsu ? ' · ' + transactionNsu : ''}`).run();

  await audit(env, { userId: ass.user_id, acao: 'ASSINATURA_PAGA', detalhe: `${orderNsu} - vence ${venc.toISOString().slice(0, 10)}` });
  return true;
}

// GET /api/assinatura - situação atual + verificação em tempo real do pagamento junto à InfinitePay
export async function handleAssinatura(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  let ass = await obterAssinatura(env, auth.user.id);

  // Link aberto? Confere direto na InfinitePay se o pagamento já foi executado (nunca na palavra do usuário)
  if (ass && ['pendente', 'atrasado'].includes(ass.status) && ass.order_nsu && infinitepayEnabled(env)) {
    try {
      const slug = String(ass.checkout_url || '').split('/').filter(Boolean).pop() || '';
      const check = await consultarPagamento(env, { orderNsu: ass.order_nsu, slug });
      const status = String(check?.status || '').toLowerCase();
      const pago = check?.paid === true || ['paid', 'settled', 'concluido', 'aprovado'].includes(status);
      if (pago) {
        await aplicarPagamento(env, ass, {
          orderNsu: ass.order_nsu,
          transactionNsu: String(check.transaction_nsu || check.transactionNsu || ''),
          valorCents: Number(check.paid_amount ?? check.amount ?? 0),
        });
        ass = await obterAssinatura(env, auth.user.id);
        await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'ASSINATURA_CONFIRMADA', detalhe: `verificação direta ${ass.order_nsu}` });
      }
    } catch (e) {
      console.error('[IANF] Verificação de pagamento:', e.message);
    }
  }

  let motivo = 'sem_assinatura';
  if (auth.user.role === 'admin') motivo = 'admin';
  else if (ass && ass.status === 'ativo' && ass.data_vencimento && new Date(ass.data_vencimento) > new Date()) motivo = 'ativa';
  else if (ass && ass.status === 'pendente' && ass.checkout_url) motivo = 'aguardando_pagamento';
  else if (ass && ass.status === 'atrasado') motivo = 'atrasada';
  else if (ass && ass.status === 'cancelado') motivo = 'cancelada';

  return ok({
    assinatura: ass || null,
    ativa: assinaturaAtiva(ass, auth.user.role),
    motivo,
    valor: VALOR_ASSINATURA_CENTS / 100,
    valorCents: VALOR_ASSINATURA_CENTS,
    whatsapp: auth.user.whatsapp || '',
  });
}

// POST /api/assinatura - gera o link de pagamento (assinatura ou renovação)
export async function handleAssinar(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  if (!infinitepayEnabled(env)) {
    return err('Pagamento por assinatura ainda não configurado.', 503, 'INFINITEPAY_OFF');
  }

  // Webhook exige HTTPS: em ambiente local usa a URL de produção (ou omite)
  let host = new URL(request.url).origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(host)) host = env.IANF_URL || '';
  const webhookUrl = host.startsWith('https://') ? `${host}/api/webhooks/infinitepay` : undefined;

  const orderNsu = `IANF-SUB-${auth.user.id}-${Date.now()}`;
  const validUntil = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const link = await criarLinkCheckout(env, {
    valorCents: VALOR_ASSINATURA_CENTS,
    descricao: 'Assinatura mensal IANF - Franquia',
    orderNsu,
    cliente: { name: auth.user.name || auth.user.email, email: auth.user.email },
    webhookUrl,
    validUntil,
  }).catch((e) => {
    console.error('[IANF] Infinitepay criar link:', e.message);
    return null;
  });

  if (!link) return err('Não foi possível gerar o link de pagamento agora. Tente novamente em instantes.', 502, 'INFINITEPAY_FALHA');
  const checkoutUrl = link.url || link.checkout_url || link.link;
  if (!checkoutUrl) return err('Resposta inesperada da operadora de pagamento.', 502, 'INFINITEPAY_FALHA');

  const agora = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO assinaturas (user_id, plano, valor_cents, status, checkout_url, order_nsu, updated_at)
    VALUES (?, 'franquia_mensal', ?, 'pendente', ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plano = 'franquia_mensal', valor_cents = ?, status = 'pendente', checkout_url = ?, order_nsu = ?, updated_at = ?
  `).bind(
    auth.user.id, VALOR_ASSINATURA_CENTS, checkoutUrl, orderNsu, agora,
    VALOR_ASSINATURA_CENTS, checkoutUrl, orderNsu, agora
  ).run();

  await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'ASSINATURA_LINK', detalhe: orderNsu, ip: getIp(request) });
  return ok({ checkout_url: checkoutUrl, order_nsu: orderNsu, valor: VALOR_ASSINATURA_CENTS / 100 });
}

// PUT /api/assinatura/whatsapp - número para os avisos de vencimento
export async function handleAssinaturaWhatsapp(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const w = String(body.whatsapp || '').replace(/\D/g, '');
  if (w.length < 10 || w.length > 13) return err('Informe um WhatsApp válido com DDD.', 400, 'WHATSAPP_INVALIDO');
  await env.DB.prepare('UPDATE users SET whatsapp = ? WHERE id = ?').bind(w, auth.user.id).run();
  return ok({ whatsapp: w });
}

// GET /api/assinatura/recibo - comprovante de compra da assinatura (A4, pronto para impressão)
export async function handleAssinaturaRecibo(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  const lanc = await env.DB.prepare(
    `SELECT * FROM lancamentos WHERE user_id = ? AND slot = 'assinatura' ORDER BY id DESC LIMIT 1`
  ).bind(auth.user.id).first();
  if (!lanc) return err('Nenhum pagamento de assinatura encontrado ainda.', 404, 'SEM_RECIBO');

  const esc = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const data = new Date(lanc.created_at);
  const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const nome = esc(auth.user.name || auth.user.email);
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo - Assinatura IANF</title>
<style>
  body { font-family: 'Courier New', monospace; color: #000; font-size: 12px; margin: 24px; }
  .recibo { max-width: 720px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; border: 1.5px solid #000; padding: 10px; margin-bottom: 8px; }
  h1 { font-size: 18px; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  td, th { border: 1px solid #000; padding: 6px 8px; text-align: left; }
  .total { font-size: 16px; font-weight: bold; }
  .info { border: 1.5px solid #000; padding: 8px; margin-top: 10px; }
  .ass { display: flex; justify-content: space-between; margin-top: 60px; text-align: center; }
  .linha { border-top: 1px solid #000; width: 200px; display: inline-block; }
  @media print { body { margin: 0; } }
</style></head>
<body><div class="recibo">
  <div class="head">
    <div>
      <h1>IANF - SISTEMA DE BALANÇOS</h1>
      <b>Comprovante de Compra - Assinatura da Franquia</b><br>
      Reforma Tribut&aacute;ria 2026 &middot; CBS + IBS
    </div>
    <div style="text-align:right">
      <b>RECIBO N&ordm; ${lanc.id}</b><br>
      Emiss&atilde;o: ${data.toLocaleString('pt-BR')}
    </div>
  </div>
  <table>
    <tr><th style="width:140px">CLIENTE</th><td>${nome}</td></tr>
    <tr><th>E-MAIL</th><td>${esc(auth.user.email)}</td></tr>
    <tr><th>FORMA</th><td>Infinitepay (PIX ou Cart&atilde;o de Cr&eacute;dito)</td></tr>
  </table>
  <table>
    <tr><th>DESCRI&Ccedil;&Atilde;O DO SERVI&Ccedil;O</th><th style="width:140px">VALOR (R$)</th></tr>
    <tr><td>Assinatura mensal IANF - Franquia (uso completo do sistema)</td><td style="text-align:right">${fmt(lanc.valor)}</td></tr>
    <tr><td class="total">TOTAL PAGO</td><td class="total" style="text-align:right">${fmt(lanc.valor)}</td></tr>
  </table>
  <div class="info">
    <b>INFORMA&Ccedil;&Otilde;ES DO PER&Iacute;ODO</b><br>
    Pagamento processado pela InfinitePay em ${data.toLocaleString('pt-BR')}.<br>
    A pr&oacute;xima mensalidade &eacute; comunicada via WhatsApp (5 dias antes e no dia do vencimento).
  </div>
  <div class="ass"><span class="linha"></span><span class="linha"></span></div>
</div></body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

// POST /api/webhooks/infinitepay - eventos de pagamento (público, sem sessão)
export async function handleInfinitepayWebhook(env, request) {
  const body = await readBody(request);
  const evento = String(body.event || body.type || body.status || '').toLowerCase();
  const orderNsu = String(body.order_nsu || body.orderNsu || body.data?.order_nsu || body.data?.orderNsu || '');
  const transactionNsu = String(body.transaction_nsu || body.transactionNsu || body.data?.transaction_nsu || body.data?.transactionNsu || '');
  const slug = String(body.slug || body.data?.slug || '');
  const paidAmount = Number(body.paid_amount ?? body.amount ?? 0) || 0;

  await audit(env, { acao: 'WEBHOOK_INFINITEPAY', detalhe: `${evento || 'desconhecido'} ${orderNsu}` });

  if (!orderNsu) return ok({ recebido: true });

  const pago = ['paid', 'settled', 'approved', 'concluido', 'autorizado'].includes(evento);

  let ass = await env.DB.prepare('SELECT * FROM assinaturas WHERE order_nsu = ?').bind(orderNsu).first();
  // Link pago antes de ser substituído por um mais novo: localiza pelo slug na URL
  if (!ass && slug) {
    ass = await env.DB.prepare("SELECT * FROM assinaturas WHERE checkout_url LIKE '%' || ? || '%'").bind(slug).first();
  }
  if (!ass) {
    // Cobrança PIX de consulta (pagamentos_consulta)
    const pgc = await env.DB.prepare('SELECT * FROM pagamentos_consulta WHERE order_nsu = ?').bind(orderNsu).first();
    if (pgc) {
      if (pago && pgc.status !== 'pago') {
        await env.DB.prepare("UPDATE pagamentos_consulta SET status = 'pago', transaction_nsu = ?, paid_at = ? WHERE id = ?")
          .bind(transactionNsu, new Date().toISOString(), pgc.id).run();
        await audit(env, { userId: pgc.user_id, acao: 'CONSULTA_PAGA_WEBHOOK', detalhe: orderNsu });
      }
      return ok({ recebido: true });
    }
    console.warn('[IANF] Webhook Infinitepay sem cobrança correspondente:', orderNsu, slug);
    return ok({ recebido: true });
  }

  if (pago) {
    await aplicarPagamento(env, ass, { orderNsu, transactionNsu, valorCents: paidAmount });
  } else if (['canceled', 'refunded', 'payment_failed', 'estornado'].includes(evento)) {
    await env.DB.prepare('UPDATE assinaturas SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), ass.id).run();
    await audit(env, { userId: ass.user_id, acao: 'ASSINATURA_EVENTO', detalhe: `${evento} ${orderNsu}` });
  }

  return ok({ recebido: true });
}

// ---------- Avisos WhatsApp ----------
async function enviarWhatsapp(env, numero, mensagem) {
  const url = env.WHATSAPP_API_URL;
  if (!url || !numero) {
    if (!url) console.warn('[IANF] WHATSAPP_API_URL não configurado - aviso não enviado.');
    return false;
  }
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (env.WHATSAPP_API_KEY) headers.Authorization = `Bearer ${env.WHATSAPP_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: numero, message: mensagem }),
    });
    if (!res.ok) console.error('[IANF] Falha no envio WhatsApp:', res.status);
    return res.ok;
  } catch (e) {
    console.error('[IANF] Erro no envio WhatsApp:', e.message);
    return false;
  }
}

function diaDeHoje() {
  return new Date().toISOString().slice(0, 10);
}

function diffDiasData(vencimentoIso) {
  const hoje = new Date(diaDeHoje() + 'T00:00:00Z');
  const venc = new Date(String(vencimentoIso || '').slice(0, 10) + 'T00:00:00Z');
  if (isNaN(venc)) return null;
  return Math.round((venc - hoje) / 86400000);
}

// Cron diário: lembra (5 dias antes e no dia), gera cobrança nova no vencimento e pausa inadimplentes
export async function processarAssinaturasDiarias(env) {
  const { results } = await env.DB.prepare(
    `SELECT a.*, u.name, u.email, u.whatsapp, u.role
     FROM assinaturas a JOIN users u ON u.id = a.user_id
     WHERE a.status IN ('ativo','atrasado')`
  ).all();

  for (const ass of results) {
    if (ass.role === 'admin' || !ass.data_vencimento) continue;
    const diff = diffDiasData(ass.data_vencimento);
    if (diff === null) continue;

    if (diff < 0) {
      if (ass.status !== 'atrasado') {
        await env.DB.prepare("UPDATE assinaturas SET status = 'atrasado', updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), ass.id).run();
        await audit(env, { userId: ass.user_id, email: ass.email, acao: 'ASSINATURA_PAUSADA', detalhe: `vencimento ${ass.data_vencimento}` });
        await enviarWhatsapp(env, ass.whatsapp,
          `⚠️ IANF: sua assinatura foi PAUSADA por falta de pagamento (venceu em ${ass.data_vencimento.slice(0, 10)}). Renove agora para reativar o sistema: ${env.IANF_URL || 'ianf.contatodroppfy.workers.dev'}`);
      }
      continue;
    }

    if (diff <= 5) {
      const chave = `${diaDeHoje()}:${diff}`;
      let lembretes = [];
      try { lembretes = JSON.parse(ass.lembretes || '[]'); } catch { lembretes = []; }
      if (lembretes.includes(chave)) continue;

      // No dia do vencimento, gera automaticamente a cobrança do próximo mês
      let linkPagamento = ass.checkout_url;
      if (diff === 0 && infinitepayEnabled(env)) {
        try {
          const orderNsu = `IANF-SUB-${ass.user_id}-${Date.now()}`;
          const novo = await criarLinkCheckout(env, {
            valorCents: ass.valor_cents || VALOR_ASSINATURA_CENTS,
            descricao: 'Assinatura mensal IANF - Franquia',
            orderNsu,
            cliente: { name: ass.name || ass.email, email: ass.email },
            webhookUrl: env.IANF_URL ? `${env.IANF_URL}/api/webhooks/infinitepay` : undefined,
            validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          });
          const novaUrl = novo?.url || novo?.checkout_url;
          if (novaUrl) {
            linkPagamento = novaUrl;
            await env.DB.prepare('UPDATE assinaturas SET checkout_url = ?, order_nsu = ?, updated_at = ? WHERE id = ?')
              .bind(novaUrl, orderNsu, new Date().toISOString(), ass.id).run();
          }
        } catch (e) {
          console.error('[IANF] Falha ao gerar cobrança mensal:', e.message);
        }
      }

      const msg = diff === 0
        ? `💳 IANF: HOJE vence sua mensalidade (R$ ${((ass.valor_cents || VALOR_ASSINATURA_CENTS) / 100).toFixed(2).replace('.', ',')}). Pague agora para não ter o sistema pausado: ${linkPagamento}`
        : `⏰ IANF: sua mensalidade (R$ ${((ass.valor_cents || VALOR_ASSINATURA_CENTS) / 100).toFixed(2).replace('.', ',')}) vence em ${diff} dia(s) (${ass.data_vencimento.slice(0, 10)}). Garanta seu pagamento: ${linkPagamento}`;

      const enviado = await enviarWhatsapp(env, ass.whatsapp, msg);
      if (enviado) {
        lembretes.push(chave);
        await env.DB.prepare('UPDATE assinaturas SET lembretes = ? WHERE id = ?')
          .bind(JSON.stringify(lembretes), ass.id).run();
      }
    }
  }

  console.log(`[IANF] Rotina de assinaturas concluída: ${results.length} verificada(s).`);
}
