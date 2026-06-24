'use strict';

/**
 * Cliente minimo da API admin do Toxiproxy (HTTP, default :8474).
 * Evita dependencia extra usando o fetch nativo do Node 18+.
 */
const HOST = process.env.TOXIPROXY_HOST || '127.0.0.1';
const PORT = Number(process.env.TOXIPROXY_PORT || 8474);
const BASE = `http://${HOST}:${PORT}`;

// Definicao dos proxies: o app aponta para "listen" e o Toxiproxy encaminha
// para "upstream" (o simulador real).
const PROXIES = [
  { name: 'gateway', listen: '127.0.0.1:21001', upstream: '127.0.0.1:4001', enabled: true },
  { name: 'cache', listen: '127.0.0.1:21002', upstream: '127.0.0.1:4002', enabled: true },
];

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(
      `Nao consegui falar com o Toxiproxy em ${BASE}. ` +
        `O 'toxiproxy-server' esta rodando? Detalhe: ${err.message}`
    );
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Toxiproxy ${method} ${path} -> ${res.status}: ${text}`);
  }
  return data;
}

const populate = () => api('POST', '/populate', PROXIES);
const listProxies = () => api('GET', '/proxies');
const reset = () => api('POST', '/reset');
const setEnabled = (name, enabled) => api('POST', `/proxies/${name}`, { enabled });
const addToxic = (proxy, toxic) => api('POST', `/proxies/${proxy}/toxics`, toxic);
const removeToxic = (proxy, toxicName) => api('DELETE', `/proxies/${proxy}/toxics/${toxicName}`);
const listToxics = (proxy) => api('GET', `/proxies/${proxy}/toxics`);

module.exports = {
  BASE,
  PROXIES,
  api,
  populate,
  listProxies,
  reset,
  setEnabled,
  addToxic,
  removeToxic,
  listToxics,
};
