import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import ZeroExProtocol from '../index.js'
import ZeroExApiClient from '../src/api-client.js'
import { ZeroExApiError, ZeroExFeeLimitExceededError, ZeroExInsufficientLiquidityError, ZeroExReadOnlyError, ZeroExValidationError, ZeroExUnknownTransactionError, ZeroExTransactionRevertedError, ZeroExTimeoutError } from '../src/errors.js'
import { NotImplementedError } from '@tetherto/wdk-wallet'

const BASE_URL = 'https://api.0x.org'
const CHAIN_ID = 1

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const TAKER = '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6'
const ALLOWANCE_HOLDER = '0xdef1c0ded9bec7f1a1670819833240f027b25eff'
const SETTLER = '0x0000000000001ff3684f28c67538d4d072c22734'

const PRICE_RESPONSE = {
  blockNumber: '21000000',
  buyAmount: '1000000000000000',
  buyToken: WETH,
  fees: {
    integratorFee: null,
    zeroExFee: {
      billingType: 'on-chain',
      feeAmount: '1000000',
      feeToken: USDC,
      feeType: 'volume'
    }
  },
  gas: '150000',
  gasPrice: '20000000000',
  grossBuyAmount: '1010000000000000',
  issues: {
    allowance: { actual: '0', spender: ALLOWANCE_HOLDER },
    balance: null,
    simulationIncomplete: false,
    invalidSourcesPassed: []
  },
  liquidityAvailable: true,
  minBuyAmount: '990000000000000',
  route: { fills: [], tokens: [] },
  sellAmount: '100000000',
  sellToken: USDC,
  tokenMetadata: {},
  totalNetworkFee: '3000000000000000',
  estimatedPriceImpact: '0.5',
  zid: 'test-zid'
}

const QUOTE_RESPONSE = {
  ...PRICE_RESPONSE,
  transaction: {
    to: SETTLER,
    data: '0xswapcalldata',
    gas: '150000',
    gasPrice: '20000000000',
    value: '0'
  }
}

function mockFetch (routes) {
  return jest.fn(async (url) => {
    const path = new URL(url).pathname
    for (const [match, handler] of Object.entries(routes)) {
      if (path === match || path.startsWith(match)) {
        const result = typeof handler === 'function' ? handler(url) : handler
        const body = result?.__status ? result.body : result
        const status = result?.__status ?? 200
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => body
        }
      }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
}

describe('ZeroExProtocol', () => {
  let account, protocol

  beforeEach(() => {
    account = {
      getAddress: jest.fn(async () => TAKER),
      sendTransaction: jest.fn(async () => ({ hash: '0xswaph4sh', fee: 1n })),
      approve: jest.fn(async () => ({ hash: '0xapprovalh4sh', fee: 1n })),
      // Default: receipt found immediately with success status.
      // getSwidgeStatus tests override this per-test as needed.
      getTransactionReceipt: jest.fn(async () => ({ status: 1 }))
    }

    global.fetch = mockFetch({
      '/swap/allowance-holder/price': PRICE_RESPONSE,
      '/swap/allowance-holder/quote': QUOTE_RESPONSE
    })

    protocol = new ZeroExProtocol(account, { chainId: CHAIN_ID, apiKey: 'test-key' })
  })

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    test('throws when apiKey is missing', () => {
      expect(() => new ZeroExProtocol(account, { chainId: 1 })).toThrow('apiKey')
    })

    test('throws when chainId is missing', () => {
      expect(() => new ZeroExProtocol(account, { apiKey: 'key' })).toThrow('chainId')
    })

    test('accepts no account for quote-only use', () => {
      expect(() => new ZeroExProtocol(undefined, { chainId: 1, apiKey: 'key' })).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // quoteSwidge
  // ---------------------------------------------------------------------------

  describe('quoteSwidge', () => {
    test('returns a correct SwidgeQuote for exact-in', async () => {
      const quote = await protocol.quoteSwidge({
        fromToken: USDC,
        toToken: WETH,
        fromTokenAmount: 100000000n
      })

      expect(quote).toMatchObject({
        fromTokenAmount: 100000000n,
        toTokenAmount: 1000000000000000n,
        toTokenAmountMin: 990000000000000n,
        priceImpact: 0.005
      })
      expect(quote.fees).toHaveLength(2) // network + protocol
    })

    test('passes slippage as slippageBps to the API', async () => {
      await protocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100n, slippage: 0.01 })

      const call = global.fetch.mock.calls[0][0]
      expect(new URL(call).searchParams.get('slippageBps')).toBe('100')
    })

    test('passes taker when account is bound', async () => {
      await protocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100n })

      const call = global.fetch.mock.calls[0][0]
      expect(new URL(call).searchParams.get('taker')).toBe(TAKER)
    })

    test('supports exact-out mode via toTokenAmount', async () => {
      const quote = await protocol.quoteSwidge({
        fromToken: USDC,
        toToken: WETH,
        toTokenAmount: 1000000000000000n
      })

      const call = global.fetch.mock.calls[0][0]
      expect(new URL(call).searchParams.get('buyAmount')).toBe('1000000000000000')
      expect(quote.toTokenAmount).toBe(1000000000000000n)
    })

    test('throws ZeroExInsufficientLiquidityError when no route', async () => {
      global.fetch = mockFetch({
        '/swap/allowance-holder/price': { ...PRICE_RESPONSE, liquidityAvailable: false }
      })

      await expect(
        protocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).rejects.toThrow(ZeroExInsufficientLiquidityError)
    })

    test('throws when neither fromTokenAmount nor toTokenAmount given', async () => {
      await expect(
        protocol.quoteSwidge({ fromToken: USDC, toToken: WETH })
      ).rejects.toThrow()
    })

    test('throws when both fromTokenAmount and toTokenAmount given', async () => {
      await expect(
        protocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n, toTokenAmount: 1n })
      ).rejects.toThrow(ZeroExValidationError)
    })

    test('throws when toChain differs from configured chainId', async () => {
      await expect(
        protocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n, toChain: 42161 })
      ).rejects.toThrow('Cross-chain bridging is not supported')
    })

    test('works without an account (quote-only)', async () => {
      const readOnlyProtocol = new ZeroExProtocol(undefined, { chainId: 1, apiKey: 'key' })
      await expect(
        readOnlyProtocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).resolves.toBeDefined()
    })

    test('derives toTokenAmountMin from slippage when minBuyAmount is absent (exact-in)', async () => {
      const { minBuyAmount, ...noMin } = PRICE_RESPONSE
      global.fetch = mockFetch({ '/swap/allowance-holder/price': noMin })

      const quote = await protocol.quoteSwidge({
        fromToken: USDC,
        toToken: WETH,
        fromTokenAmount: 100000000n,
        slippage: 0.01
      })

      expect(quote.toTokenAmountMin > 0n).toBe(true)
      expect(quote.toTokenAmountMin < quote.toTokenAmount).toBe(true)
    })

    test('sets toTokenAmountMin to the requested amount for exact-out without minBuyAmount', async () => {
      const { minBuyAmount, ...noMin } = PRICE_RESPONSE
      global.fetch = mockFetch({ '/swap/allowance-holder/price': noMin })

      const quote = await protocol.quoteSwidge({
        fromToken: USDC,
        toToken: WETH,
        toTokenAmount: 500000000000000n
      })

      expect(quote.toTokenAmountMin).toBe(500000000000000n)
    })

    test('wraps 0x API errors', async () => {
      global.fetch = mockFetch({
        '/swap/allowance-holder/price': {
          __status: 400,
          body: { reason: 'VALIDATION_ERROR' }
        }
      })

      await expect(
        protocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).rejects.toThrow(ZeroExApiError)
    })

    test('normalises native token aliases', async () => {
      await protocol.quoteSwidge({ fromToken: 'native', toToken: WETH, fromTokenAmount: 1n })

      const call = global.fetch.mock.calls[0][0]
      expect(new URL(call).searchParams.get('sellToken')).toBe(
        '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
      )
    })
  })

  // ---------------------------------------------------------------------------
  // swidge
  // ---------------------------------------------------------------------------

  describe('swidge', () => {
    test('executes a swap and returns SwidgeResult', async () => {
      const result = await protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })

      expect(result.id).toBe(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.hash).toBe('0xswaph4sh')
      expect(result.fromTokenAmount).toBe(100000000n)
      expect(result.toTokenAmount).toBe(1000000000000000n)
      expect(result.fees).toHaveLength(2)
      expect(result.transactions).toHaveLength(2) // approval + source
    })

    test('sends the correct transaction data to the account', async () => {
      await protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })

      expect(account.sendTransaction).toHaveBeenCalledWith({
        to: SETTLER,
        value: 0n,
        data: '0xswapcalldata'
      })
    })

    test('approves the AllowanceHolder spender from issues.allowance', async () => {
      await protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })

      expect(account.approve).toHaveBeenCalledWith({
        token: USDC,
        spender: ALLOWANCE_HOLDER,
        amount: 100000000n
      })
    })

    test('skips approval when issues.allowance is null', async () => {
      global.fetch = mockFetch({
        '/swap/allowance-holder/quote': {
          ...QUOTE_RESPONSE,
          issues: { ...QUOTE_RESPONSE.issues, allowance: null }
        }
      })

      await protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })

      expect(account.approve).not.toHaveBeenCalled()
      expect(result => result.transactions?.length).toBeDefined()
    })

    test('skips approval when skipApproval config is set', async () => {
      const p = new ZeroExProtocol(account, { chainId: 1, apiKey: 'key', skipApproval: true })
      await p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      expect(account.approve).not.toHaveBeenCalled()
    })

    test('skips approval for native ETH', async () => {
      await protocol.swidge({
        fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        toToken: WETH,
        fromTokenAmount: 10n ** 18n
      })

      expect(account.approve).not.toHaveBeenCalled()
    })

    test('throws when toChain differs from configured chainId', async () => {
      await expect(
        protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n, toChain: 42161 })
      ).rejects.toThrow('Cross-chain bridging is not supported')
    })

    test('throws when both fromTokenAmount and toTokenAmount given', async () => {
      await expect(
        protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n, toTokenAmount: 1n })
      ).rejects.toThrow(ZeroExValidationError)
    })

    test('throws ZeroExInsufficientLiquidityError when quote has no liquidity', async () => {
      global.fetch = mockFetch({
        '/swap/allowance-holder/quote': { ...QUOTE_RESPONSE, liquidityAvailable: false }
      })

      await expect(
        protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      ).rejects.toThrow(ZeroExInsufficientLiquidityError)

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('throws ZeroExTransactionRevertedError when the approval tx reverts', async () => {
      account.getTransactionReceipt.mockResolvedValue({ status: 0 })

      await expect(
        protocol.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      ).rejects.toThrow(ZeroExTransactionRevertedError)

      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('_waitForReceipt throws ZeroExTimeoutError when no receipt appears before the deadline', async () => {
      const acc = { getTransactionReceipt: jest.fn(async () => null) }

      await expect(
        protocol._waitForReceipt(acc, '0xdeadbeef', { intervalMs: 1, timeoutMs: 5 })
      ).rejects.toThrow(ZeroExTimeoutError)
    })

    test('throws ZeroExReadOnlyError when no account is bound', async () => {
      const p = new ZeroExProtocol(undefined, { chainId: 1, apiKey: 'key' })
      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).rejects.toThrow(ZeroExReadOnlyError)
    })

    test('throws ZeroExReadOnlyError when account lacks sendTransaction (read-only)', async () => {
      const readOnly = { getAddress: jest.fn(async () => TAKER) }
      const p = new ZeroExProtocol(readOnly, { chainId: 1, apiKey: 'key' })
      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).rejects.toThrow(ZeroExReadOnlyError)
    })

    test('throws ZeroExFeeLimitExceededError when protocol fee cap exceeded', async () => {
      const p = new ZeroExProtocol(account, {
        chainId: 1,
        apiKey: 'key',
        maxProtocolFeeBps: 5 // 5 bps = 0.05%, fee is 1% → should throw
      })

      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      ).rejects.toThrow(ZeroExFeeLimitExceededError)
    })

    test('per-call config overrides instance fee caps', async () => {
      const p = new ZeroExProtocol(account, {
        chainId: 1,
        apiKey: 'key',
        maxProtocolFeeBps: 5
      })

      // Override with a higher cap per call → should not throw
      await expect(
        p.swidge(
          { fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n },
          { maxProtocolFeeBps: 500 }
        )
      ).resolves.toBeDefined()
    })

    test('protocol fee cap fails closed when fee token differs from sell token', async () => {
      // zeroExFee is denominated in WETH, not the USDC sell token → not evaluable
      global.fetch = mockFetch({
        '/swap/allowance-holder/quote': {
          ...QUOTE_RESPONSE,
          fees: { ...QUOTE_RESPONSE.fees, zeroExFee: { ...QUOTE_RESPONSE.fees.zeroExFee, feeToken: WETH } }
        }
      })
      const p = new ZeroExProtocol(account, { chainId: 1, apiKey: 'key', maxProtocolFeeBps: 100 })

      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      ).rejects.toThrow(ZeroExFeeLimitExceededError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('network fee cap: converts native fee via an extra /price call and passes under the cap', async () => {
      // quote: 1e8 USDC in, 3e15 native fee. Conversion /price says that fee is
      // worth 100000 USDC-base-units → 100000 / 1e8 * 10000 = 10 bps.
      global.fetch = mockFetch({
        '/swap/allowance-holder/quote': QUOTE_RESPONSE,
        '/swap/allowance-holder/price': { liquidityAvailable: true, buyAmount: '100000' }
      })
      const p = new ZeroExProtocol(account, { chainId: 1, apiKey: 'key', maxNetworkFeeBps: 50 })

      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      ).resolves.toBeDefined()

      // Verify the conversion call was native → sell token
      const priceCall = global.fetch.mock.calls.find(c => new URL(c[0]).pathname.endsWith('/price'))
      const params = new URL(priceCall[0]).searchParams
      expect(params.get('sellToken')).toBe('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
      expect(params.get('buyToken')).toBe(USDC)
      expect(params.get('sellAmount')).toBe('3000000000000000')
    })

    test('network fee cap: throws when the converted fee exceeds the cap', async () => {
      // Conversion says the fee is worth 5e6 USDC-base-units → 500 bps > 50 cap
      global.fetch = mockFetch({
        '/swap/allowance-holder/quote': QUOTE_RESPONSE,
        '/swap/allowance-holder/price': { liquidityAvailable: true, buyAmount: '5000000' }
      })
      const p = new ZeroExProtocol(account, { chainId: 1, apiKey: 'key', maxNetworkFeeBps: 50 })

      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      ).rejects.toThrow(ZeroExFeeLimitExceededError)
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test('network fee cap: fails closed when the native→token conversion has no route', async () => {
      global.fetch = mockFetch({
        '/swap/allowance-holder/quote': QUOTE_RESPONSE,
        '/swap/allowance-holder/price': { liquidityAvailable: false }
      })
      const p = new ZeroExProtocol(account, { chainId: 1, apiKey: 'key', maxNetworkFeeBps: 50 })

      const error = await p
        .swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
        .catch(e => e)
      expect(error).toBeInstanceOf(ZeroExFeeLimitExceededError)
      expect(error.actualBps).toBeNull()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // getSwidgeStatus
  // ---------------------------------------------------------------------------

  describe('getSwidgeStatus', () => {
    test('returns pending when no receipt exists', async () => {
      account.getTransactionReceipt.mockResolvedValue(null)
      const result = await protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('pending')
      expect(result.transactions[0].hash).toBe('0xswaph4sh')
    })

    test('returns completed on a successful receipt', async () => {
      account.getTransactionReceipt.mockResolvedValue({ status: 1 })
      const result = await protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('completed')
    })

    test('returns failed on a reverted receipt', async () => {
      account.getTransactionReceipt.mockResolvedValue({ status: 0 })
      const result = await protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('failed')
    })

    test('resolves chain from options.fromChain when id has no prefix', async () => {
      account.getTransactionReceipt.mockResolvedValue({ status: 1 })
      const result = await protocol.getSwidgeStatus('0xswaph4sh', { fromChain: CHAIN_ID })
      expect(result.status).toBe('completed')
    })

    test('falls back to config.chainId when id has no prefix and no fromChain', async () => {
      account.getTransactionReceipt.mockResolvedValue(null)
      const result = await protocol.getSwidgeStatus('0xswaph4sh')
      expect(result.status).toBe('pending')
    })

    test('throws on empty id', async () => {
      await expect(protocol.getSwidgeStatus('')).rejects.toThrow('Invalid')
    })

    test('throws on invalid hash', async () => {
      await expect(protocol.getSwidgeStatus('1:notahash')).rejects.toThrow('Invalid transaction hash')
    })

    test('returns pending when account has no getTransactionReceipt', async () => {
      const bareAccount = { getAddress: jest.fn(async () => TAKER) }
      const p = new ZeroExProtocol(bareAccount, { chainId: 1, apiKey: 'key' })
      const result = await p.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('pending')
    })

    test('throws ZeroExUnknownTransactionError when getTransactionByHash returns null', async () => {
      account.getTransactionByHash = jest.fn(async () => null)
      await expect(
        protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      ).rejects.toThrow(ZeroExUnknownTransactionError)
      // Unknown tx must never reach a receipt lookup
      expect(account.getTransactionReceipt).not.toHaveBeenCalled()
    })

    test('returns pending when tx exists but has no receipt yet', async () => {
      account.getTransactionByHash = jest.fn(async () => ({ hash: '0xswaph4sh' }))
      account.getTransactionReceipt.mockResolvedValue(null)
      const result = await protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('pending')
    })

    test('returns completed when tx exists and receipt succeeds', async () => {
      account.getTransactionByHash = jest.fn(async () => ({ hash: '0xswaph4sh' }))
      account.getTransactionReceipt.mockResolvedValue({ status: 1 })
      const result = await protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('completed')
    })

    test('returns pending (not unknown) when getTransactionByHash lookup throws', async () => {
      account.getTransactionByHash = jest.fn(async () => { throw new Error('rpc down') })
      const result = await protocol.getSwidgeStatus(`${CHAIN_ID}:0xswaph4sh`)
      expect(result.status).toBe('pending')
    })
  })

  // ---------------------------------------------------------------------------
  // getSupportedChains
  // ---------------------------------------------------------------------------

  describe('getSupportedChains', () => {
    test('returns 20 chains', async () => {
      const chains = await protocol.getSupportedChains()
      expect(chains).toHaveLength(20)
    })

    test('all chains have type evm', async () => {
      const chains = await protocol.getSupportedChains()
      expect(chains.every(c => c.type === 'evm')).toBe(true)
    })

    test('all chains have required fields', async () => {
      const chains = await protocol.getSupportedChains()
      for (const chain of chains) {
        expect(typeof chain.id).toBe('number')
        expect(typeof chain.name).toBe('string')
        expect(typeof chain.nativeToken).toBe('string')
      }
    })

    test('includes Ethereum (chainId 1)', async () => {
      const chains = await protocol.getSupportedChains()
      expect(chains.find(c => c.id === 1)).toMatchObject({ name: 'Ethereum', nativeToken: 'ETH' })
    })
  })

  // ---------------------------------------------------------------------------
  // getSupportedTokens
  // ---------------------------------------------------------------------------

  describe('getSupportedTokens', () => {
    test('throws NotImplementedError', async () => {
      await expect(protocol.getSupportedTokens()).rejects.toThrow(NotImplementedError)
    })
  })

  // ---------------------------------------------------------------------------
  // Legacy delegation (swap, quoteSwap, bridge, quoteBridge)
  // ---------------------------------------------------------------------------

  describe('legacy delegation', () => {
    test('swap delegates to swidge', async () => {
      const spy = jest.spyOn(protocol, 'swidge')
      await protocol.swap({ tokenIn: USDC, tokenOut: WETH, tokenInAmount: 100000000n })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ fromToken: USDC, toToken: WETH, fromTokenAmount: 100000000n })
      )
    })

    test('quoteSwap delegates to quoteSwidge', async () => {
      const spy = jest.spyOn(protocol, 'quoteSwidge')
      await protocol.quoteSwap({ tokenIn: USDC, tokenOut: WETH, tokenInAmount: 100000000n })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ fromToken: USDC, toToken: WETH })
      )
    })

    test('bridge delegates to swidge with same fromToken/toToken', async () => {
      const spy = jest.spyOn(protocol, 'swidge')
      await protocol.bridge({
        token: USDC,
        targetChain: CHAIN_ID,
        recipient: TAKER,
        amount: 100000000n
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ fromToken: USDC, toToken: USDC, toChain: CHAIN_ID })
      )
    })

    test('bridge throws for cross-chain targetChain', async () => {
      await expect(
        protocol.bridge({ token: USDC, targetChain: 42161, recipient: TAKER, amount: 100000000n })
      ).rejects.toThrow('Cross-chain bridging is not supported')
    })

    test('quoteBridge delegates to quoteSwidge', async () => {
      const spy = jest.spyOn(protocol, 'quoteSwidge')
      await protocol.quoteBridge({
        token: USDC,
        targetChain: CHAIN_ID,
        recipient: TAKER,
        amount: 100000000n
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ fromToken: USDC, toToken: USDC, toChain: CHAIN_ID })
      )
    })

    test('quoteBridge throws for cross-chain targetChain', async () => {
      await expect(
        protocol.quoteBridge({ token: USDC, targetChain: 42161, recipient: TAKER, amount: 100000000n })
      ).rejects.toThrow('Cross-chain bridging is not supported')
    })

    test('quoteSwap returns fee as sum of SwidgeFee amounts', async () => {
      const result = await protocol.quoteSwap({
        tokenIn: USDC,
        tokenOut: WETH,
        tokenInAmount: 100000000n
      })
      expect(result.fee).toBeGreaterThan(0n)
      expect(result.tokenInAmount).toBe(100000000n)
      expect(result.tokenOutAmount).toBe(1000000000000000n)
    })
  })
})

describe('ZeroExApiClient', () => {
  test('throws without an apiKey', () => {
    expect(() => new ZeroExApiClient({})).toThrow('apiKey')
  })
})
