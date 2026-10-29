// Cliente da API Spedy - emissão de NF-e / NFC-e / NFS-e, notas recebidas e webhooks
// Docs: https://docs.spedy.com.br | Auth: header X-Api-Key

export function spedyBase(env) {
  return env.SPEDY_SANDBOX === 'true' ? 'https://sandbox-api.spedy.com.br' : 'https://api.spedy.com.br';
}

export function spedyEnabled(env) {
  return Boolean(env.SPEDY_API_KEY);
}

async function spedyRequest(env, path, { method = 'GET', body = null } = {}) {
  if (!spedyEnabled(env)) {
    return { ok: false, code: 'SPEDY_NAO_CONFIGURADO', message: 'Integração Spedy não configurada. Defina o secret SPEDY_API_KEY.' };
  }
  const headers = { 'X-Api-Key': env.SPEDY_API_KEY, Accept: 'application/json' };
  const opts = { method, headers };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${spedyBase(env)}${path}`, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
    if (!res.ok) {
      const msg = (data && (data.message || data.title || data.detail)) || `Erro ${res.status}`;
      return { ok: false, code: 'SPEDY_ERRO', message: msg, status: res.status, data };
    }
    return { ok: true, data: data ?? {}, status: res.status };
  } catch (e) {
    return { ok: false, code: 'SPEDY_REDE', message: 'Falha de conexão com a Spedy: ' + e.message };
  }
}

export const spedy = {
  // ----- Empresas -----
  listarEmpresas: (env) => spedyRequest(env, '/v1/companies'),
  criarEmpresa: (env, payload) => spedyRequest(env, '/v1/companies', { method: 'POST', body: payload }),
  obterEmpresa: (env, id) => spedyRequest(env, `/v1/companies/${id}`),
  adicionarCertificado: (env, id, formData) => {
    // formData: FormData com arquivo .pfx e senha
    return fetch(`${spedyBase(env)}/v1/companies/${id}/certificates`, {
      method: 'POST',
      headers: { 'X-Api-Key': env.SPEDY_API_KEY },
      body: formData,
    }).then(async (res) => {
      const data = await res.json().catch(() => null);
      return res.ok ? { ok: true, data } : { ok: false, code: 'SPEDY_ERRO', message: data?.message || `Erro ${res.status}` };
    });
  },

  // ----- Vendas (orders) -----
  listarVendas: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/orders${qs ? `?${qs}` : ''}`);
  },
  criarVenda: (env, payload) => spedyRequest(env, '/v1/orders', { method: 'POST', body: payload }),
  obterVenda: (env, id) => spedyRequest(env, `/v1/orders/${id}`),
  emitirNotasDaVenda: (env, id) => spedyRequest(env, `/v1/orders/${id}/invoices/issue`, { method: 'POST', body: {} }),

  // ----- NFS-e (serviço) -----
  listarNfse: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/service-invoices${qs ? `?${qs}` : ''}`);
  },
  criarNfse: (env, payload) => spedyRequest(env, '/v1/service-invoices', { method: 'POST', body: payload }),
  obterNfse: (env, id) => spedyRequest(env, `/v1/service-invoices/${id}`),
  cancelarNfse: (env, id) => spedyRequest(env, `/v1/service-invoices/${id}`, { method: 'DELETE' }),
  pdfNfse: (env, id) => spedyRequest(env, `/v1/service-invoices/${id}/pdf`),
  xmlNfse: (env, id) => spedyRequest(env, `/v1/service-invoices/${id}/xml`),
  consultarNfse: (env, id) => spedyRequest(env, `/v1/service-invoices/${id}/check-status`, { method: 'POST', body: {} }),
  cidadesNfse: (env) => spedyRequest(env, '/v1/service-invoices/cities'),

  // ----- NF-e (produto) -----
  listarNfe: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/product-invoices${qs ? `?${qs}` : ''}`);
  },
  criarNfe: (env, payload) => spedyRequest(env, '/v1/product-invoices', { method: 'POST', body: payload }),
  obterNfe: (env, id) => spedyRequest(env, `/v1/product-invoices/${id}`),
  cancelarNfe: (env, id) => spedyRequest(env, `/v1/product-invoices/${id}`, { method: 'DELETE' }),
  pdfNfe: (env, id) => spedyRequest(env, `/v1/product-invoices/${id}/pdf`),
  xmlNfe: (env, id) => spedyRequest(env, `/v1/product-invoices/${id}/xml`),
  consultarNfe: (env, id) => spedyRequest(env, `/v1/product-invoices/${id}/check-status`, { method: 'POST', body: {} }),

  // ----- NFC-e (consumidor) -----
  listarNfce: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/consumer-invoices${qs ? `?${qs}` : ''}`);
  },
  criarNfce: (env, payload) => spedyRequest(env, '/v1/consumer-invoices', { method: 'POST', body: payload }),
  cancelarNfce: (env, id) => spedyRequest(env, `/v1/consumer-invoices/${id}`, { method: 'DELETE' }),
  pdfNfce: (env, id) => spedyRequest(env, `/v1/consumer-invoices/${id}/pdf`),

  // ----- Notas recebidas (entradas) -----
  listarEntradasNfe: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/inbound-product-invoices${qs ? `?${qs}` : ''}`);
  },
  obterEntradaNfe: (env, id) => spedyRequest(env, `/v1/inbound-product-invoices/${id}`),
  pdfEntradaNfe: (env, id) => spedyRequest(env, `/v1/inbound-product-invoices/${id}/pdf`),
  xmlEntradaNfe: (env, id) => spedyRequest(env, `/v1/inbound-product-invoices/${id}/xml`),
  manifestarEntrada: (env, id, evento) => spedyRequest(env, `/v1/inbound-product-invoices/${id}/manifest`, { method: 'POST', body: { event: evento } }),
  sincronizarEntradas: (env) => spedyRequest(env, '/v1/inbound-product-invoices/sync', { method: 'POST', body: {} }),
  statusSincronizacao: (env) => spedyRequest(env, '/v1/inbound-product-invoices/sync-status'),

  // ----- Clientes e produtos -----
  listarClientes: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/customers${qs ? `?${qs}` : ''}`);
  },
  criarCliente: (env, payload) => spedyRequest(env, '/v1/customers', { method: 'POST', body: payload }),
  listarProdutos: (env, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return spedyRequest(env, `/v1/products${qs ? `?${qs}` : ''}`);
  },
  criarProduto: (env, payload) => spedyRequest(env, '/v1/products', { method: 'POST', body: payload }),
};

// Monta payload de venda (order) no formato da API Spedy
export function montarOrderPayload({ cliente, itens, valorTotal, autoIssueMode = 'afterPayment', paymentMethod = 'pix' }) {
  return {
    transactionId: crypto.randomUUID(),
    customer: {
      name: cliente.nome || 'Cliente IANF',
      federalTaxNumber: cliente.doc || undefined,
      email: cliente.email || undefined,
      phone: cliente.telefone || undefined,
      address: cliente.endereco || undefined,
    },
    amount: valorTotal,
    date: new Date().toISOString(),
    autoIssueMode,
    paymentMethod,
    profileType: 'producer',
    items: itens.map((it, i) => ({
      product: { name: it.descricao || `Item ${i + 1}`, code: it.codigo || `ITEM-${i + 1}`, price: it.preco },
      quantity: it.quantidade || 1,
      price: it.preco,
      amount: (it.preco || 0) * (it.quantidade || 1),
    })),
  };
}

// Monta payload de NFS-e com split IBS/CBS da Reforma Tributária
export function montarNfsePayload({ cliente, descricao, valor, cidade, cnaeCode, ibsCbs = null, number = null }) {
  const payload = {
    integrationId: crypto.randomUUID(),
    description: descricao.slice(0, 2000),
    total: { invoiceAmount: valor, netAmount: valor },
    receiver: {
      name: cliente.nome,
      federalTaxNumber: cliente.doc || undefined,
      email: cliente.email || undefined,
      address: cliente.endereco || undefined,
    },
    effectiveDate: new Date().toISOString().slice(0, 10),
    sendEmailToCustomer: Boolean(cliente.email),
    issue: true,
  };
  if (cidade?.code) payload.location = { code: cidade.code, name: cidade.name, state: cidade.uf };
  if (cnaeCode) payload.cnaeCode = cnaeCode;
  if (number) payload.number = number;
  if (ibsCbs) {
    payload.ibsCbs = {
      cst: ibsCbs.cst || 0,
      classification: ibsCbs.classification || 1,
    };
    payload.total.ibsStateRate = ibsCbs.ibsEstado;
    payload.total.ibsCityRate = ibsCbs.ibsMunicipio;
    payload.total.cbsRate = ibsCbs.cbs;
    payload.total.ibsCbsBaseTax = valor;
  }
  return payload;
}
