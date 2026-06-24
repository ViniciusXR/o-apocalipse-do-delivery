'use strict';

/**
 * Cria/atualiza os proxies "gateway" e "cache" no Toxiproxy e limpa qualquer
 * toxico residual. Rode UMA vez depois de subir o toxiproxy-server.
 *
 *   gateway  127.0.0.1:21001 -> 127.0.0.1:4001
 *   cache    127.0.0.1:21002 -> 127.0.0.1:4002
 *
 * Lembre de subir o app apontando para os proxies:
 *   GATEWAY_URL=http://127.0.0.1:21001  CACHE_URL=http://127.0.0.1:21002
 */
const { populate, reset, listProxies, BASE } = require('./client');

(async () => {
  await populate();
  await reset(); // garante estado limpo (sem toxicos, proxies habilitados)
  const proxies = await listProxies();
  console.log(`Toxiproxy pronto em ${BASE}. Proxies:`);
  for (const p of Object.values(proxies)) {
    console.log(`  - ${p.name}: ${p.listen} -> ${p.upstream} (enabled=${p.enabled})`);
  }
  console.log('\nSuba o app em modo caos:');
  console.log('  npm run stack:chaos');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
