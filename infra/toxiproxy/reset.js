'use strict';

/**
 * Remove todos os toxicos e reabilita todos os proxies (volta ao estado limpo).
 * Use entre os experimentos para isolar os cenarios.
 */
const { reset, listProxies } = require('./client');

(async () => {
  await reset();
  const proxies = await listProxies();
  console.log('Toxiproxy resetado. Estado atual:');
  for (const p of Object.values(proxies)) {
    const toxics = (p.toxics || []).map((t) => t.name).join(', ') || 'nenhum';
    console.log(`  - ${p.name}: enabled=${p.enabled}, toxicos=[${toxics}]`);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
