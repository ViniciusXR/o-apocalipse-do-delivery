'use strict';

/**
 * RF01 - Validacao/sanitizacao de entrada.
 *
 * Aborta ANTES de tocar no banco ou no gateway. Retorna a lista de erros;
 * vazia = payload valido.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarPedido(payload) {
  const erros = [];
  if (!payload || typeof payload !== 'object') {
    return ['payload ausente ou invalido'];
  }

  const { clienteEmail, valor, cartao } = payload;

  if (typeof clienteEmail !== 'string' || !EMAIL_REGEX.test(clienteEmail)) {
    erros.push('clienteEmail invalido');
  }

  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    erros.push('valor deve ser numerico e maior que zero');
  }

  if (
    !cartao ||
    typeof cartao !== 'object' ||
    !cartao.numero ||
    !cartao.validade ||
    !cartao.cvv
  ) {
    erros.push('cartao deve conter numero, validade e cvv');
  }

  return erros;
}

module.exports = { validarPedido, EMAIL_REGEX };
