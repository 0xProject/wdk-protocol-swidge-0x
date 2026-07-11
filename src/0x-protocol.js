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

import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'
import { NotImplementedError } from '@tetherto/wdk-wallet'

import ZeroExApiClient from './api-client.js'
import { ZeroExFeeLimitExceededError, ZeroExInsufficientLiquidityError, ZeroExReadOnlyError, ZeroExValidationError, ZeroExUnsupportedOperationError, ZeroExTransactionRevertedError, ZeroExTimeoutError } from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeTransaction} SwidgeTransaction */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */

/**
 * @typedef {Object} ZeroExProtocolConfig
 * @property {number | string} chainId - The EVM chain ID of the bound wallet account. Required.
 * @property {string} apiKey - The 0x API key. Required.
 * @property {string} [baseUrl] - The 0x API base URL. Defaults to 'https://api.0x.org'.
 * @property {number} [defaultSlippage] - Default slippage tolerance as a decimal (e.g. 0.005 = 0.5%). If omitted, no slippage parameter is sent and the 0x API default applies.
 * @property {boolean} [skipApproval] - Skip automatic ERC-20 approval before executing a swap.
 * @property {number | bigint} [maxNetworkFeeBps] - Maximum acceptable network fee in basis points of the input amount.
 * @property {number | bigint} [maxProtocolFeeBps] - Maximum acceptable protocol fee in basis points of the input amount.
 */

// 0x uses this checksummed sentinel for native ETH / chain native token.
// Must use the EIP-55 checksummed form — the 0x API rejects the all-lowercase variant.
const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const NATIVE_TOKEN_ADDRESS_LOWER = NATIVE_TOKEN_ADDRESS.toLowerCase()

// Identifiers callers may pass to mean "native token"
const NATIVE_TOKEN_ALIASES = new Set([
  '',
  'native',
  'eth',
  '0x0000000000000000000000000000000000000000',
  NATIVE_TOKEN_ADDRESS_LOWER
])

/** @type {SwidgeSupportedChain[]} */
const SUPPORTED_CHAINS = [
  { id: 2741, name: 'Abstract', type: 'evm', nativeToken: 'ETH' },
  { id: 42161, name: 'Arbitrum One', type: 'evm', nativeToken: 'ETH' },
  { id: 43114, name: 'Avalanche C-Chain', type: 'evm', nativeToken: 'AVAX' },
  { id: 8453, name: 'Base', type: 'evm', nativeToken: 'ETH' },
  { id: 80094, name: 'Berachain', type: 'evm', nativeToken: 'BERA' },
  { id: 56, name: 'BNB Smart Chain', type: 'evm', nativeToken: 'BNB' },
  { id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
  { id: 999, name: 'HyperEVM', type: 'evm', nativeToken: 'HYPE' },
  { id: 57073, name: 'Ink', type: 'evm', nativeToken: 'ETH' },
  { id: 59144, name: 'Linea', type: 'evm', nativeToken: 'ETH' },
  { id: 5000, name: 'Mantle', type: 'evm', nativeToken: 'MNT' },
  { id: 143, name: 'Monad', type: 'evm', nativeToken: 'MON' },
  { id: 10, name: 'OP Mainnet', type: 'evm', nativeToken: 'ETH' },
  { id: 9745, name: 'Plasma', type: 'evm', nativeToken: 'ETH' },
  { id: 137, name: 'Polygon', type: 'evm', nativeToken: 'POL' },
  { id: 534352, name: 'Scroll', type: 'evm', nativeToken: 'ETH' },
  { id: 146, name: 'Sonic', type: 'evm', nativeToken: 'S' },
  { id: 4217, name: 'Tempo', type: 'evm', nativeToken: 'ETH' },
  { id: 130, name: 'Unichain', type: 'evm', nativeToken: 'ETH' },
  { id: 480, name: 'World Chain', type: 'evm', nativeToken: 'ETH' }
]

/**
 * WDK Swidge protocol implementation backed by the 0x Swap API v2.
 *
 * This module supports same-chain EVM token swaps using the AllowanceHolder
 * flow. Cross-chain bridging via 0x is not yet supported.
 *
 * @extends {SwidgeProtocol}
 */
export default class ZeroExProtocol extends SwidgeProtocol {
  /**
   * Creates a new 0x swidge protocol without binding it to a wallet account.
   *
   * @overload
   * @param {undefined} [account]
   * @param {ZeroExProtocolConfig} [config]
   */

  /**
   * Creates a new read-only 0x swidge protocol (quote and discovery only).
   *
   * @overload
   * @param {IWalletAccountReadOnly} account
   * @param {ZeroExProtocolConfig} [config]
   */

  /**
   * Creates a new 0x swidge protocol bound to a full wallet account.
   *
   * @overload
   * @param {IWalletAccount} account
   * @param {ZeroExProtocolConfig} [config]
   */
  constructor (account, config = {}) {
    super(account, config)

    if (!config.apiKey) {
      throw new ZeroExValidationError('ZeroExProtocol requires config.apiKey.')
    }
    if (config.chainId == null) {
      throw new ZeroExValidationError('ZeroExProtocol requires config.chainId identifying the EVM chain of the bound account.')
    }

    /**
     * @protected
     * @type {ZeroExProtocolConfig}
     */
    this._config = config

    /**
     * @protected
     * @type {ZeroExApiClient}
     */
    this._api = new ZeroExApiClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    })
  }

  /**
   * Returns a non-binding indicative price for a swap.
   *
   * Calls `/swap/allowance-holder/price` which does not require a taker address,
   * making it safe to call with a read-only or absent account.
   *
   * @param {SwidgeOptions} options
   * @returns {Promise<SwidgeQuote>}
   * @throws {ZeroExInsufficientLiquidityError} If no route is available.
   */
  async quoteSwidge (options) {
    this._assertExactlyOneAmount(options)

    const chainId = Number(this._config.chainId)

    if (options.toChain != null && Number(options.toChain) !== chainId) {
      throw new ZeroExUnsupportedOperationError(
        `Cross-chain bridging is not supported. toChain (${options.toChain}) must match the configured chainId (${chainId}).`
      )
    }
    const sellToken = this._normalizeToken(options.fromToken)
    const buyToken = this._normalizeToken(options.toToken)

    /** @type {Record<string, string | number>} */
    const params = { sellToken, buyToken }

    const isExactIn = options.fromTokenAmount != null
    if (isExactIn) {
      params.sellAmount = BigInt(options.fromTokenAmount).toString()
    } else {
      params.buyAmount = BigInt(options.toTokenAmount).toString()
    }

    const slippage = options.slippage ?? this._config.defaultSlippage
    if (slippage != null) {
      params.slippageBps = Math.round(slippage * 10000)
    }

    // Taker is optional for /price but enables allowance/balance issue checks
    const taker = await this._resolveTaker(options)
    if (taker) params.taker = taker

    const response = await this._api.price(chainId, params)

    if (!response.liquidityAvailable) {
      throw new ZeroExInsufficientLiquidityError({ sellToken, buyToken, chainId })
    }

    const fromTokenAmount = BigInt(response.sellAmount)
    const toTokenAmount = isExactIn ? BigInt(response.buyAmount) : BigInt(options.toTokenAmount)

    let toTokenAmountMin
    if (response.minBuyAmount) {
      toTokenAmountMin = BigInt(response.minBuyAmount)
    } else if (isExactIn) {
      const slip = slippage ?? 0
      toTokenAmountMin = BigInt(Math.floor(Number(toTokenAmount) * (1 - slip)))
    } else {
      // Exact-out: the requested amount is the guaranteed minimum
      toTokenAmountMin = toTokenAmount
    }

    return {
      fromTokenAmount,
      toTokenAmount,
      toTokenAmountMin,
      fees: this._mapFees(response, chainId),
      estimatedDuration: undefined,
      // The /price endpoint does not return an expiry timestamp; quotes via /quote expire ~30s
      // after fetching but that is enforced server-side, not surfaced in the response.
      expiry: undefined,
      // 0x returns estimatedPriceImpact as a percentage string (e.g. "0.5" = 0.5%)
      priceImpact: response.estimatedPriceImpact != null
        ? Number(response.estimatedPriceImpact) / 100
        : undefined
    }
  }

  /**
   * Executes a token swap via the 0x Swap API v2 (AllowanceHolder flow).
   *
   * If the sell token requires an ERC-20 allowance, the method approves the
   * AllowanceHolder contract first and waits for the approval to be mined.
   *
   * @param {SwidgeOptions} options
   * @param {SwidgeProtocolConfig} [config] - Per-call overrides for fee caps.
   * @returns {Promise<SwidgeResult>}
   * @throws {ZeroExReadOnlyError} If no full account was provided at construction.
   * @throws {ZeroExFeeLimitExceededError} If a fee cap is exceeded.
   */
  async swidge (options, config) {
    if (!this._account || typeof this._account.sendTransaction !== 'function') {
      throw new ZeroExReadOnlyError()
    }

    const chainId = Number(this._config.chainId)

    if (options.toChain != null && Number(options.toChain) !== chainId) {
      throw new ZeroExUnsupportedOperationError(
        `Cross-chain bridging is not supported. toChain (${options.toChain}) must match the configured chainId (${chainId}).`
      )
    }
    this._assertExactlyOneAmount(options)

    const sellToken = this._normalizeToken(options.fromToken)
    const buyToken = this._normalizeToken(options.toToken)
    const taker = await this._account.getAddress()

    /** @type {Record<string, string | number>} */
    const params = { sellToken, buyToken, taker }

    const isExactIn = options.fromTokenAmount != null
    if (isExactIn) {
      params.sellAmount = BigInt(options.fromTokenAmount).toString()
    } else {
      params.buyAmount = BigInt(options.toTokenAmount).toString()
    }

    const slippage = options.slippage ?? this._config.defaultSlippage
    if (slippage != null) {
      params.slippageBps = Math.round(slippage * 10000)
    }

    if (options.recipient) params.recipient = options.recipient

    const quote = await this._api.quote(chainId, params)

    if (!quote.liquidityAvailable) {
      throw new ZeroExInsufficientLiquidityError({ sellToken, buyToken, chainId })
    }

    this._checkFeeLimits(quote, sellToken, config)

    const sellAmount = BigInt(quote.sellAmount)
    const isNative = NATIVE_TOKEN_ALIASES.has(sellToken.toLowerCase())

    /** @type {SwidgeTransaction[]} */
    const transactions = []

    // Handle ERC-20 approval if required
    if (!isNative && !this._config.skipApproval && quote.issues?.allowance != null) {
      if (typeof this._account.approve !== 'function') {
        throw new ZeroExValidationError(
          'Cannot approve the sell token: the wallet account does not support ERC-20 approvals.'
        )
      }
      const approval = await this._account.approve({
        token: sellToken,
        spender: quote.issues.allowance.spender,
        amount: sellAmount
      })
      if (approval?.hash) {
        transactions.push({ hash: approval.hash, chain: chainId, type: 'approval' })
        await this._waitForReceipt(this._account, approval.hash)
      }
    }

    const result = await this._account.sendTransaction({
      to: quote.transaction.to,
      value: BigInt(quote.transaction.value ?? 0),
      data: quote.transaction.data
    })

    const hash = result.hash
    transactions.push({ hash, chain: chainId, type: 'source' })

    return {
      id: `${chainId}:${hash}`,
      hash,
      fees: this._mapFees(quote, chainId),
      transactions,
      fromTokenAmount: BigInt(quote.sellAmount),
      toTokenAmount: BigInt(quote.buyAmount),
      toTokenAmountMin: quote.minBuyAmount ? BigInt(quote.minBuyAmount) : undefined
    }
  }

  /**
   * Returns the current status of a submitted swap.
   *
   * Status is resolved by checking the on-chain transaction receipt via the
   * bound account. If the account does not support receipt lookups, or no
   * receipt is found yet, the status is reported as `pending`.
   *
   * The `id` must be in the format `'<chainId>:<txHash>'` as returned by
   * {@link swidge}, or a bare transaction hash combined with `options.fromChain`.
   *
   * @param {string} id
   * @param {SwidgeStatusOptions} [options]
   * @returns {Promise<SwidgeStatusResult>}
   * @throws {Error} If `id` is invalid.
   */
  async getSwidgeStatus (id, options) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new ZeroExValidationError('Invalid swidge identifier.')
    }

    let chainId, hash
    const separator = id.indexOf(':')
    if (separator !== -1) {
      chainId = Number(id.slice(0, separator))
      hash = id.slice(separator + 1)
    } else {
      const fromChain = options?.fromChain ?? this._config.chainId
      if (fromChain == null) {
        throw new ZeroExValidationError(
          "Cannot resolve the source chain: pass an id in the '<chainId>:<hash>' format, or provide the fromChain status option."
        )
      }
      chainId = Number(fromChain)
      hash = id
    }

    if (!hash.startsWith('0x') || hash.length < 10) {
      throw new ZeroExValidationError(`Invalid transaction hash in swidge identifier: '${hash}'.`)
    }

    /** @type {SwidgeTransaction[]} */
    const transactions = [{ hash, chain: chainId, type: 'source' }]

    if (!this._account || typeof this._account.getTransactionReceipt !== 'function') {
      return { status: 'pending', transactions }
    }

    let receipt
    try {
      receipt = await this._account.getTransactionReceipt(hash)
    } catch {
      return { status: 'pending', transactions }
    }

    if (!receipt) {
      return { status: 'pending', transactions }
    }

    const success = receipt.status === 1 || receipt.status === 1n || receipt.status === true
    return {
      status: success ? 'completed' : 'failed',
      transactions
    }
  }

  /**
   * Returns the EVM chains supported by the 0x Swap API v2.
   *
   * @returns {Promise<SwidgeSupportedChain[]>}
   */
  async getSupportedChains () {
    return SUPPORTED_CHAINS
  }

  /**
   * Not implemented: the 0x Swap API accepts any liquid ERC-20 by contract address
   * and does not expose a token list endpoint. Pass token addresses directly to
   * `quoteSwidge` and `swidge`.
   *
   * @returns {Promise<never>}
   * @throws {NotImplementedError}
   */
  async getSupportedTokens () {
    throw new NotImplementedError('getSupportedTokens()')
  }

  // ---------------------------------------------------------------------------
  // Protected helpers
  // ---------------------------------------------------------------------------

  /**
   * Asserts that exactly one of fromTokenAmount (exact-in) or toTokenAmount
   * (exact-out) is provided.
   *
   * @protected
   * @param {SwidgeOptions} options
   * @throws {ZeroExValidationError} If neither or both amounts are provided.
   */
  _assertExactlyOneAmount (options) {
    const hasIn = options.fromTokenAmount != null
    const hasOut = options.toTokenAmount != null
    if (!hasIn && !hasOut) {
      throw new ZeroExValidationError('Either fromTokenAmount (exact-in) or toTokenAmount (exact-out) must be provided.')
    }
    if (hasIn && hasOut) {
      throw new ZeroExValidationError('Provide either fromTokenAmount (exact-in) or toTokenAmount (exact-out), not both.')
    }
  }

  /**
   * Resolves the taker address from the bound account or the options recipient.
   *
   * @protected
   * @param {SwidgeOptions} options
   * @returns {Promise<string | undefined>}
   */
  async _resolveTaker (options) {
    if (this._account) {
      try {
        return await this._account.getAddress()
      } catch {
        // read-only accounts may not expose an address
      }
    }
    return options.recipient
  }

  /**
   * Normalises a token identifier to the format expected by the 0x API.
   * Native-token aliases are mapped to the 0x sentinel address.
   *
   * @protected
   * @param {string} token
   * @returns {string}
   */
  _normalizeToken (token) {
    if (typeof token !== 'string') return token
    return NATIVE_TOKEN_ALIASES.has(token.toLowerCase()) ? NATIVE_TOKEN_ADDRESS : token
  }

  /**
   * Maps a 0x API response to an array of {@link SwidgeFee} objects.
   *
   * Fee mapping:
   * - `totalNetworkFee` → `network` (denominated in the chain's native token)
   * - `fees.zeroExFee`  → `protocol`
   * - `fees.integratorFee` → `affiliate`
   *
   * @protected
   * @param {Object} response - 0x API price or quote response.
   * @param {number} chainId
   * @returns {SwidgeFee[]}
   */
  _mapFees (response, chainId) {
    const fees = []
    const chain = SUPPORTED_CHAINS.find(c => c.id === Number(chainId))
    const nativeToken = chain?.nativeToken ?? 'ETH'

    if (response.totalNetworkFee) {
      fees.push({
        type: 'network',
        amount: BigInt(response.totalNetworkFee),
        token: nativeToken,
        chain: chainId,
        included: false,
        description: 'Network gas fee'
      })
    }

    if (response.fees?.zeroExFee?.feeAmount) {
      fees.push({
        type: 'protocol',
        amount: BigInt(response.fees.zeroExFee.feeAmount),
        token: response.fees.zeroExFee.feeToken,
        chain: chainId,
        included: response.fees.zeroExFee.billingType === 'on-chain',
        description: '0x protocol fee'
      })
    }

    if (response.fees?.integratorFee?.feeAmount) {
      fees.push({
        type: 'affiliate',
        amount: BigInt(response.fees.integratorFee.feeAmount),
        token: response.fees.integratorFee.feeToken,
        chain: chainId,
        included: response.fees.integratorFee.billingType === 'on-chain',
        description: 'Integrator fee'
      })
    }

    return fees
  }

  /**
   * Checks that the quoted fees do not exceed the configured caps.
   *
   * Fee caps are only enforced when the fee is denominated in the same token as
   * the sell token, since cross-token comparison requires price data that is not
   * available in the API response.
   *
   * @protected
   * @param {Object} quote - 0x API quote response.
   * @param {string} sellToken - Normalised sell token address.
   * @param {SwidgeProtocolConfig} [callConfig] - Per-call override config.
   * @throws {ZeroExFeeLimitExceededError}
   */
  _checkFeeLimits (quote, sellToken, callConfig) {
    const maxNetworkFeeBps = callConfig?.maxNetworkFeeBps ?? this._config.maxNetworkFeeBps
    const maxProtocolFeeBps = callConfig?.maxProtocolFeeBps ?? this._config.maxProtocolFeeBps

    if (maxNetworkFeeBps == null && maxProtocolFeeBps == null) return

    const sellAmount = Number(quote.sellAmount)
    if (!sellAmount) return

    // Network fee: only comparable when selling the native token
    if (maxNetworkFeeBps != null && quote.totalNetworkFee) {
      if (sellToken.toLowerCase() === NATIVE_TOKEN_ADDRESS_LOWER) {
        const bps = (Number(quote.totalNetworkFee) / sellAmount) * 10000
        if (bps > Number(maxNetworkFeeBps)) {
          throw new ZeroExFeeLimitExceededError('network', bps, Number(maxNetworkFeeBps))
        }
      }
    }

    // Protocol fee: comparable only when fee token matches sell token
    if (maxProtocolFeeBps != null && quote.fees?.zeroExFee?.feeAmount) {
      const feeToken = (quote.fees.zeroExFee.feeToken ?? '').toLowerCase()
      if (feeToken === sellToken.toLowerCase()) {
        const bps = (Number(quote.fees.zeroExFee.feeAmount) / sellAmount) * 10000
        if (bps > Number(maxProtocolFeeBps)) {
          throw new ZeroExFeeLimitExceededError('protocol', bps, Number(maxProtocolFeeBps))
        }
      }
    }
  }

  /**
   * Polls the account for a transaction receipt, waiting until it appears or
   * the timeout elapses.
   *
   * @protected
   * @param {IWalletAccount} account
   * @param {string} hash
   * @param {{ intervalMs?: number, timeoutMs?: number }} [opts]
   * @returns {Promise<Object | undefined>}
   * @throws {Error} If the transaction reverts or the timeout elapses.
   */
  async _waitForReceipt (account, hash, { intervalMs = 2000, timeoutMs = 180000 } = {}) {
    if (typeof account.getTransactionReceipt !== 'function') return undefined

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const receipt = await account.getTransactionReceipt(hash)
      if (receipt) {
        const success = receipt.status === 1 || receipt.status === 1n || receipt.status === true
        if (!success) {
          throw new ZeroExTransactionRevertedError(hash)
        }
        return receipt
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    throw new ZeroExTimeoutError(hash)
  }
}
