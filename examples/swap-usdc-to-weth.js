// Example: Swap 100 USDC for WETH on Ethereum mainnet using the 0x Swap API v2.
//
// Prerequisites:
//   1. Set ZERO_EX_API_KEY in your environment (or in a .env file).
//   2. Install dependencies: npm install
//   3. Provide a funded EVM wallet account (see note below).
//
// Run: node examples/swap-usdc-to-weth.js

import ZeroExProtocol from '../index.js'

const CHAIN_ID = 1 // Ethereum mainnet
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const SELL_AMOUNT = 100_000_000n // 100 USDC (6 decimals)

const TOKEN_INFO = {
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': { symbol: 'ETH', decimals: 18 },
  eth: { symbol: 'ETH', decimals: 18 },
  [USDC.toLowerCase()]: { symbol: 'USDC', decimals: 6 },
  usdc: { symbol: 'USDC', decimals: 6 },
  [WETH.toLowerCase()]: { symbol: 'WETH', decimals: 18 },
  weth: { symbol: 'WETH', decimals: 18 }
}

function formatFeeAmount (amount, tokenAddress) {
  const info = TOKEN_INFO[tokenAddress.toLowerCase()]
  if (!info) return `${amount} (${tokenAddress.slice(0, 10)}…)`
  const value = Number(amount) / 10 ** info.decimals
  return `${value.toFixed(6)} ${info.symbol}`
}

const apiKey = process.env.ZERO_EX_API_KEY
if (!apiKey) {
  console.error('Error: ZERO_EX_API_KEY environment variable is not set.')
  process.exit(1)
}

// ─── Step 1: Construct the protocol (quote-only, no wallet needed) ────────────

const protocol = new ZeroExProtocol(undefined, {
  chainId: CHAIN_ID,
  apiKey,
  defaultSlippage: 0.005 // 0.5%
})

// ─── Step 2: Get an indicative quote ─────────────────────────────────────────

console.log(`\nFetching indicative price for ${SELL_AMOUNT} USDC → WETH on chain ${CHAIN_ID}…`)

const quote = await protocol.quoteSwidge({
  fromToken: USDC,
  toToken: WETH,
  fromTokenAmount: SELL_AMOUNT
})

const ethReceived = Number(quote.toTokenAmount) / 1e18
const ethMin = Number(quote.toTokenAmountMin) / 1e18
const priceImpactPct = quote.priceImpact != null ? (quote.priceImpact * 100).toFixed(4) : 'n/a'

console.log(`\n  Sell:         ${Number(SELL_AMOUNT) / 1e6} USDC`)
console.log(`  Buy:          ~${ethReceived.toFixed(6)} WETH`)
console.log(`  Min received: ${ethMin.toFixed(6)} WETH (after slippage)`)
console.log(`  Price impact: ${priceImpactPct}%`)
console.log('  Fees:')
for (const fee of quote.fees) {
  console.log(`    [${fee.type}] ${formatFeeAmount(fee.amount, fee.token)}`)
}

// ─── Step 3: Execute (requires a full wallet account) ────────────────────────
//
// To actually execute the swap, bind a WDK EVM wallet account:
//
//   import { WalletManager } from '@tetherto/wdk-wallet'
//   import EvmWallet from '@tetherto/wdk-wallet-evm'
//
//   const manager = new WalletManager({ wallets: [new EvmWallet()] })
//   await manager.load({ mnemonic: process.env.MNEMONIC })
//   const wallet = manager.getWallet('evm')
//   const account = await wallet.getAccount(0)
//
//   const execProtocol = new ZeroExProtocol(account, {
//     chainId: CHAIN_ID,
//     apiKey,
//     defaultSlippage: 0.005
//   })
//
//   const result = await execProtocol.swidge({
//     fromToken: USDC,
//     toToken: WETH,
//     fromTokenAmount: SELL_AMOUNT
//   })
//
//   console.log('Swap submitted:', result.hash)
//   console.log('Tracking id:  ', result.id)
//
//   // Poll for confirmation
//   let status
//   do {
//     await new Promise(r => setTimeout(r, 3000))
//     const s = await execProtocol.getSwidgeStatus(result.id)
//     status = s.status
//     console.log('Status:', status)
//   } while (status === 'pending')

console.log('\nDone. Uncomment the execution block above to submit the swap.')
