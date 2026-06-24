'use strict';

const { buildApp } = require('./app');
const { config } = require('./config');

const { app } = buildApp();

const server = app.listen(config.port, () => {
  console.log(`Servidor da EntregasJa rodando na porta ${config.port}`);
  console.log(`  gateway -> ${config.gatewayUrl}`);
  console.log(`  cache   -> ${config.cacheUrl}`);
  console.log(`  timeout=${config.gatewayTimeoutMs}ms retry=${config.retry.maxAttempts} backoff=${config.retry.backoffMs}ms breaker@${config.breaker.errorThreshold * 100}%`);
});

// Degradacao graciosa tambem no processo: nao morrer por erros nao tratados.
process.on('unhandledRejection', (reason) => {
  console.error('[processo] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[processo] uncaughtException:', err);
});

function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando...`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
