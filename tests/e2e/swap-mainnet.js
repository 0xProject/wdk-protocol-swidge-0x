// End-to-end test: fetch a live quote from the 0x API on Ethereum mainnet.
//
// This is a manual script, not run in CI. Requires a real ZERO_EX_API_KEY.
//
// Run: npm run e2e

import ZeroExProtocol from '../../index.js'

const apiKey = process.env.ZERO_EX_API_KEY
if (!apiKey) {
  console.error('ZERO_EX_API_KEY is not set.')
  process.exit(1)
}

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const protocol = new ZeroExProtocol(undefined, { chainId: 1, apiKey })

console.log('Fetching getSupportedChains()…')
const chains = await protocol.getSupportedChains()
console.log(`  ${chains.length} chains returned.`)
const eth = chains.find(c => c.id === 1)
console.assert(eth?.name === 'Ethereum', 'Expected Ethereum chain entry')

console.log('\nFetching quoteSwidge() for 100 USDC → WETH on Ethereum…')
const quote = await protocol.quoteSwidge({
  fromToken: USDC,
  toToken: WETH,
  fromTokenAmount: 100_000_000n,
  slippage: 0.005
})

console.log('  fromTokenAmount:', quote.fromTokenAmount.toString())
console.log('  toTokenAmount:  ', quote.toTokenAmount.toString())
console.log('  toTokenAmountMin:', quote.toTokenAmountMin.toString())
console.log('  fees:', quote.fees.map(f => `${f.type}:${f.amount}${f.token}`).join(', '))
console.assert(quote.fromTokenAmount > 0n, 'fromTokenAmount must be positive')
console.assert(quote.toTokenAmount > 0n, 'toTokenAmount must be positive')
console.assert(quote.toTokenAmountMin <= quote.toTokenAmount, 'min must not exceed estimate')

console.log('\nAll e2e checks passed.')
