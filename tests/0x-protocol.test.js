import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import ZeroExProtocol from '../index.js'
import { ZeroExApiError, ZeroExFeeLimitExceededError, ZeroExInsufficientLiquidityError } from '../src/errors.js'
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

    test('works without an account (quote-only)', async () => {
      const readOnlyProtocol = new ZeroExProtocol(undefined, { chainId: 1, apiKey: 'key' })
      await expect(
        readOnlyProtocol.quoteSwidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).resolves.toBeDefined()
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
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
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

    test('throws when no account is bound', async () => {
      const p = new ZeroExProtocol(undefined, { chainId: 1, apiKey: 'key' })
      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).rejects.toThrow('read-only account')
    })

    test('throws when account lacks sendTransaction (read-only)', async () => {
      const readOnly = { getAddress: jest.fn(async () => TAKER) }
      const p = new ZeroExProtocol(readOnly, { chainId: 1, apiKey: 'key' })
      await expect(
        p.swidge({ fromToken: USDC, toToken: WETH, fromTokenAmount: 1n })
      ).rejects.toThrow()
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
        targetChain: 42161,
        recipient: TAKER,
        amount: 100000000n
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ fromToken: USDC, toToken: USDC, toChain: 42161 })
      )
    })

    test('quoteBridge delegates to quoteSwidge', async () => {
      const spy = jest.spyOn(protocol, 'quoteSwidge')
      await protocol.quoteBridge({
        token: USDC,
        targetChain: 42161,
        recipient: TAKER,
        amount: 100000000n
      })
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ fromToken: USDC, toToken: USDC, toChain: 42161 })
      )
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
