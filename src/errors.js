// Copyright 2026 0x Labs
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

/**
 * Thrown when the 0x API responds with a non-2xx status code.
 */
export class ZeroExApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status - HTTP status code.
   * @param {unknown} body - Parsed response body.
   */
  constructor (message, status, body) {
    super(message)
    this.name = 'ZeroExApiError'
    /** @type {number} */
    this.status = status
    /** @type {unknown} */
    this.body = body
  }
}

/**
 * Thrown when the 0x API reports no liquidity for a requested swap route.
 */
export class ZeroExInsufficientLiquidityError extends ZeroExApiError {
  /**
   * @param {{ sellToken: string, buyToken: string, chainId: number }} params
   */
  constructor ({ sellToken, buyToken, chainId }) {
    super(
      `No liquidity available for the requested swap: ${sellToken} → ${buyToken} on chain ${chainId}.`,
      0,
      null
    )
    this.name = 'ZeroExInsufficientLiquidityError'
  }
}

/**
 * Thrown when swidge is called without a full signing account.
 */
export class ZeroExReadOnlyError extends Error {
  constructor () {
    super('Cannot execute a swap: the protocol was created without an account or with a read-only account.')
    this.name = 'ZeroExReadOnlyError'
  }
}

/**
 * Thrown when invalid or missing input parameters are passed to an interface method.
 */
export class ZeroExValidationError extends Error {
  /**
   * @param {string} message
   */
  constructor (message) {
    super(message)
    this.name = 'ZeroExValidationError'
  }
}

/**
 * Thrown when an operation is not supported by this module (e.g. cross-chain bridging).
 */
export class ZeroExUnsupportedOperationError extends Error {
  /**
   * @param {string} message
   */
  constructor (message) {
    super(message)
    this.name = 'ZeroExUnsupportedOperationError'
  }
}

/**
 * Thrown when a swap transaction reverts on-chain.
 */
export class ZeroExTransactionRevertedError extends Error {
  /**
   * @param {string} hash - The transaction hash that reverted.
   */
  constructor (hash) {
    super(`Transaction '${hash}' reverted.`)
    this.name = 'ZeroExTransactionRevertedError'
    /** @type {string} */
    this.hash = hash
  }
}

/**
 * Thrown when polling for a transaction receipt exceeds the timeout.
 */
export class ZeroExTimeoutError extends Error {
  /**
   * @param {string} hash - The transaction hash that timed out.
   */
  constructor (hash) {
    super(`Timed out waiting for transaction '${hash}' to be mined.`)
    this.name = 'ZeroExTimeoutError'
    /** @type {string} */
    this.hash = hash
  }
}

/**
 * Thrown when a quoted fee exceeds a configured fee cap.
 */
export class ZeroExFeeLimitExceededError extends Error {
  /**
   * @param {'network' | 'protocol'} feeType
   * @param {number} actualBps - Actual fee in basis points.
   * @param {number} limitBps - Configured maximum in basis points.
   */
  constructor (feeType, actualBps, limitBps) {
    super(
      `The quoted ${feeType} fee (${actualBps.toFixed(2)} bps) exceeds the configured maximum of ${limitBps} bps.`
    )
    this.name = 'ZeroExFeeLimitExceededError'
    /** @type {'network' | 'protocol'} */
    this.feeType = feeType
    /** @type {number} */
    this.actualBps = actualBps
    /** @type {number} */
    this.limitBps = limitBps
  }
}
