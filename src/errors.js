'use strict';

/**
 * Erros de dominio do checkout. Separar os tipos permite que a politica de
 * retry distinga uma FALHA DE INFRAESTRUTURA (deve retentar) de uma FALHA DE
 * NEGOCIO (cartao recusado -> nao adianta retentar).
 */

class InfraError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'InfraError';
    this.isInfra = true;
    if (cause) this.cause = cause;
  }
}

class TimeoutError extends InfraError {
  constructor(message = 'Operacao excedeu o timeout') {
    super(message);
    this.name = 'TimeoutError';
    this.isTimeout = true;
  }
}

class BusinessError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BusinessError';
    this.isBusiness = true;
    this.status = status;
  }
}

class CircuitOpenError extends InfraError {
  constructor(message = 'Circuit breaker aberto: chamada bloqueada') {
    super(message);
    this.name = 'CircuitOpenError';
    this.isCircuitOpen = true;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.isValidation = true;
  }
}

module.exports = {
  InfraError,
  TimeoutError,
  BusinessError,
  CircuitOpenError,
  ValidationError,
};
