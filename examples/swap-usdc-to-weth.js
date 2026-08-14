// Example: Swap 0.5 USDC for WETH on Base mainnet using the 0x Swap API v2.
//
// Prerequisites:
//   1. Set ZERO_EX_API_KEY in your environment, or put it in a .env file and
//      pass --env-file (nothing here loads .env automatically).
//   2. Install dependencies: npm install
//   3. To execute (not just quote), also set MNEMONIC. Without it this script
//      stops after the quote and sends no transaction.
//
// Run: node --env-file=.env examples/swap-usdc-to-weth.js
//  or: ZERO_EX_API_KEY=... node examples/swap-usdc-to-weth.js
//
// Environment:
//   ZERO_EX_API_KEY  Required. Get one at https://dashboard.0x.org/create-account
//   MNEMONIC         BIP-39 seed phrase. Setting it enables real execution.
//   BASE_RPC         Base RPC url (default: https://mainnet.base.org)
//   SELL_AMOUNT      Sell amount in USDC base units, 6 decimals
//                    (default: 500000 = 0.5 USDC)

import ZeroExProtocol from '../index.js'
import { explorerUrl } from './explorers.js'

const CHAIN_ID = 8453 // Base mainnet
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const WETH = '0x4200000000000000000000000000000000000006'
const SELL_AMOUNT = BigInt(process.env.SELL_AMOUNT ?? 500_000n) // default: 0.5 USDC (6 decimals)

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

console.log(
  `\nFetching indicative price for ${Number(SELL_AMOUNT) / 1e6} USDC → WETH on chain ${CHAIN_ID}…`
)

const quote = await protocol.quoteSwidge({
  fromToken: USDC,
  toToken: WETH,
  fromTokenAmount: SELL_AMOUNT
})

const wethReceived = Number(quote.toTokenAmount) / 1e18
const wethMin = Number(quote.toTokenAmountMin) / 1e18

console.log(`\n  Sell:         ${Number(SELL_AMOUNT) / 1e6} USDC`)
console.log(`  Buy:          ~${wethReceived.toFixed(8)} WETH`)
console.log(`  Min received: ${wethMin.toFixed(8)} WETH (after slippage)`)
console.log('  Fees:')
for (const fee of quote.fees) {
  console.log(`    [${fee.type}] ${formatFeeAmount(fee.amount, fee.token)}`)
}

// ─── Step 3: Execute (requires a funded wallet — opt in with MNEMONIC) ───────
//
// Executing sends a REAL Base mainnet transaction that spends real funds. It
// only runs when MNEMONIC is set.

const mnemonic = process.env.MNEMONIC
const rpcUrl = process.env.BASE_RPC ?? 'https://mainnet.base.org'

if (!mnemonic) {
  console.log('\nDone (quote only). Set MNEMONIC to execute the swap on-chain.')
  process.exit(0)
}

const { default: WalletManagerEvm } = await import('@tetherto/wdk-wallet-evm')

const manager = new WalletManagerEvm(mnemonic, {
  provider: rpcUrl,
  chainId: CHAIN_ID
})
const account = await manager.getAccount(0)

console.log('\nExecuting from account:', await account.getAddress())

// Preflight: a short, readable failure beats a revert deep inside gas estimation.
const usdcBalance = await account.getTokenBalance(USDC)
if (usdcBalance < SELL_AMOUNT) {
  console.error(
    `\nInsufficient USDC: the account holds ${Number(usdcBalance) / 1e6} but the swap sells ` +
    `${Number(SELL_AMOUNT) / 1e6}.\nFund the account, or set SELL_AMOUNT to at most ${usdcBalance} ` +
    '(base units) to sell what it already has.'
  )
  process.exit(1)
}

const ethBalance = await account.getBalance()
if (ethBalance === 0n) {
  console.error('\nThe account holds no ETH — it cannot pay gas for the approval and swap.')
  process.exit(1)
}

const execProtocol = new ZeroExProtocol(account, {
  chainId: CHAIN_ID,
  apiKey,
  defaultSlippage: 0.005
})

const result = await execProtocol.swidge({
  fromToken: USDC,
  toToken: WETH,
  fromTokenAmount: SELL_AMOUNT
})

console.log('Swap submitted:', result.hash)

const link = explorerUrl(CHAIN_ID, result.hash)
if (link) console.log('Explorer:      ', link)

// Poll for confirmation
let status
do {
  await new Promise(resolve => setTimeout(resolve, 3000))
  const s = await execProtocol.getSwidgeStatus(result.id)
  status = s.status
  console.log('Status:', status)
} while (status === 'pending')

console.log('\nDone.')
