// End-to-end smoke test of the ZeroExProtocol module against the live 0x API on Base mainnet.
//
// The scope is decided by the credentials you provide:
//   - no MNEMONIC -> quote-only (live API, no signing, no funds, safe).
//   - MNEMONIC    -> real execution: a small Base mainnet transaction.
//
// Usage:
//   ZERO_EX_API_KEY=... node tests/e2e/swap-base.js                        # quote-only
//   ZERO_EX_API_KEY=... MNEMONIC="word word ..." node tests/e2e/swap-base.js  # execute
//
// Environment:
//   ZERO_EX_API_KEY   Required. Get one at https://dashboard.0x.org/create-account
//   MNEMONIC          BIP-39 seed phrase. Enables real swap execution.
//   BASE_RPC          Base RPC URL (default: https://mainnet.base.org)
//   FROM_TOKEN        Sell token address (default: USDC on Base)
//   TO_TOKEN          Buy token address (default: WETH on Base)
//   AMOUNT            Sell amount in base units (default: 1000000 = 1 USDC)
//   MAX_PROTOCOL_FEE_BPS / MAX_NETWORK_FEE_BPS
//                     Optional fee caps in basis points. Unset = no cap.

import ZeroExProtocol from '../../index.js'

const CHAIN_ID = 8453 // Base mainnet
const BASE_RPC = process.env.BASE_RPC ?? 'https://mainnet.base.org'

const FROM_TOKEN = process.env.FROM_TOKEN ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC on Base
const TO_TOKEN = process.env.TO_TOKEN ?? '0x4200000000000000000000000000000000000006' // WETH on Base
const AMOUNT = BigInt(process.env.AMOUNT ?? '1000000') // 1 USDC (6 decimals)

const apiKey = process.env.ZERO_EX_API_KEY
if (!apiKey) {
  console.error('ZERO_EX_API_KEY is not set.')
  process.exit(1)
}

const MNEMONIC = process.env.MNEMONIC

const log = (...args) => console.log(...args)
const fmt = n => (typeof n === 'bigint' ? n.toString() : n)

async function main () {
  let account, willExecute

  if (MNEMONIC) {
    const { WalletAccountEvm } = await import('@tetherto/wdk-wallet-evm')
    account = new WalletAccountEvm(MNEMONIC, "0'/0/0", { provider: BASE_RPC, chainId: CHAIN_ID })
    willExecute = true
    log('Account: WalletAccountEvm (HD, from MNEMONIC) — execution enabled.\n')
  } else {
    willExecute = false
    log('No MNEMONIC — quote-only mode. No transaction will be sent.\n')
  }

  const protocol = new ZeroExProtocol(account, { chainId: CHAIN_ID, apiKey })

  const from = account ? await account.getAddress() : '(none)'
  log('Source account:', from)
  log(`Route: ${fmt(AMOUNT)} ${FROM_TOKEN} -> ${TO_TOKEN} on Base (chain ${CHAIN_ID})\n`)

  // ---- Phase 0: discovery ----
  const chains = await protocol.getSupportedChains()
  log(`Discovery: ${chains.length} chains supported.`)
  const base = chains.find(c => c.id === CHAIN_ID)
  log('  Base:', base)
  log('')

  // ---- Phase 1: quote (live API, no signing) ----
  const options = {
    fromToken: FROM_TOKEN,
    toToken: TO_TOKEN,
    fromTokenAmount: AMOUNT,
    slippage: 0.005,
    recipient: from === '(none)' ? undefined : from
  }

  log('Quoting...')
  const quote = await protocol.quoteSwidge(options)
  log('Quote:')
  log('  fromTokenAmount  :', fmt(quote.fromTokenAmount))
  log('  toTokenAmount    :', fmt(quote.toTokenAmount))
  log('  toTokenAmountMin :', fmt(quote.toTokenAmountMin))
  log('  priceImpact      :', quote.priceImpact)
  log('  fees             :', quote.fees.map(f => `${fmt(f.amount)} ${f.token} (${f.type})`).join(', '))
  log('')

  if (!willExecute) {
    log('No MNEMONIC — stopping after quote. No transaction sent.')
    return
  }

  // ---- Phase 2: execution ----
  log('=== EXECUTION ===')
  const execConfig = {}
  if (process.env.MAX_PROTOCOL_FEE_BPS) execConfig.maxProtocolFeeBps = Number(process.env.MAX_PROTOCOL_FEE_BPS)
  if (process.env.MAX_NETWORK_FEE_BPS) execConfig.maxNetworkFeeBps = Number(process.env.MAX_NETWORK_FEE_BPS)

  const result = await protocol.swidge(options, execConfig)
  log('Swidge submitted:')
  log('  id   :', result.id)
  log('  hash :', result.hash)
  log('  txs  :', result.transactions.map(t => `${t.type}:${t.hash}`).join(', '))
  log('')

  // ---- Phase 3: poll status until terminal ----
  const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired'])
  log('Tracking status (polling getSwidgeStatus)...')
  for (let i = 0; i < 60; i++) {
    const status = await protocol.getSwidgeStatus(result.id)
    log(`  [${i}] status=${status.status}`)
    if (TERMINAL.has(status.status)) {
      log('\nFinal status:', status.status)
      log('Transactions:', status.transactions)
      return
    }
    await new Promise(r => setTimeout(r, 5000))
  }
  log('\nStill pending after polling window — check the id later:', result.id)
}

main().catch(err => {
  console.error('\nE2E failed:', err.message)
  process.exitCode = 1
})
