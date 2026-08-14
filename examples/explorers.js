// Block explorers for the chains ZeroExProtocol supports, so an example can link a
// submitted swap rather than just printing its hash.
//
// This is presentation metadata for the examples only — it is deliberately not part
// of the published module. `getSupportedChains()` returns WDK's `SwidgeSupportedChain`
// shape (id, name, type, nativeToken), and widening that is not this module's job.
//
// Every entry follows EIP-3091, where <base>/tx/<hash> is the canonical transaction
// path. HyperEVM (999) is absent: it publishes no explorer in the chain registry, and
// 999 collides with an unrelated testnet there.

export const EXPLORERS = {
  1: 'https://etherscan.io', // Ethereum
  10: 'https://optimistic.etherscan.io', // OP Mainnet
  56: 'https://bscscan.com', // BNB Smart Chain
  130: 'https://uniscan.xyz', // Unichain
  137: 'https://polygonscan.com', // Polygon
  143: 'https://monadvision.com', // Monad
  146: 'https://sonicscan.org', // Sonic
  480: 'https://worldscan.org', // World Chain
  2741: 'https://abscan.org', // Abstract
  4217: 'https://explore.tempo.xyz', // Tempo
  5000: 'https://mantlescan.xyz', // Mantle
  8453: 'https://basescan.org', // Base
  9745: 'https://plasmascan.to', // Plasma
  42161: 'https://arbiscan.io', // Arbitrum One
  43114: 'https://snowscan.xyz', // Avalanche C-Chain
  57073: 'https://explorer.inkonchain.com', // Ink
  59144: 'https://lineascan.build', // Linea
  80094: 'https://berascan.com', // Berachain
  534352: 'https://scrollscan.com' // Scroll
}

/**
 * Builds a block explorer link for a transaction.
 *
 * @param {number} chainId - The EVM chain the transaction was sent on.
 * @param {string} hash - The transaction hash.
 * @returns {string | undefined} The explorer url, or undefined if the chain has no known explorer.
 */
export function explorerUrl (chainId, hash) {
  const base = EXPLORERS[chainId]
  return base ? `${base}/tx/${hash}` : undefined
}
