# @0x/wdk-protocol-swidge-0x

[![Powered by WDK](https://img.shields.io/badge/Powered%20by-WDK-7B3FE4)](https://docs.wdk.tether.io)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

WDK **Swidge** protocol module for EVM token swaps via the [0x Swap API v2](https://0x.org/docs/api).

This module implements the [`SwidgeProtocol`](https://github.com/tetherto/wdk-wallet/blob/main/src/protocols/swidge-protocol.js) interface from `@tetherto/wdk-wallet`, letting any WDK-based wallet perform same-chain EVM swaps through 0x's aggregated liquidity — with automatic ERC-20 approval handling and on-chain status tracking.

> **Note:** Cross-chain bridging via 0x is not yet supported. `toChain` must equal the source chain.

---

## Installation

```bash
npm install @0x/wdk-protocol-swidge-0x
```

---

## Configuration

| Option | Type | Required | Description |
|---|---|---|---|
| `chainId` | `number \| string` | ✅ | EVM chain ID of the bound wallet account |
| `apiKey` | `string` | ✅ | 0x API key — get one at [dashboard.0x.org](https://dashboard.0x.org/create-account) |
| `baseUrl` | `string` | | API base URL. Defaults to `https://api.0x.org` |
| `defaultSlippage` | `number` | | Default slippage as a decimal (e.g. `0.005` = 0.5%). Defaults to no slippage param sent |
| `skipApproval` | `boolean` | | Skip automatic ERC-20 approval before swapping |
| `maxNetworkFeeBps` | `number \| bigint` | | Maximum network fee in basis points of the input amount |
| `maxProtocolFeeBps` | `number \| bigint` | | Maximum protocol fee in basis points of the input amount |

Store your API key in an environment variable — never commit it to source control:

```bash
# .env
ZERO_EX_API_KEY=your_api_key_here
```

---

## Usage

```js
import ZeroExProtocol from '@0x/wdk-protocol-swidge-0x'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

// ── 1. Get an indicative quote (no wallet needed) ──────────────────────────

const protocol = new ZeroExProtocol(undefined, {
  chainId: 1, // Ethereum mainnet
  apiKey: process.env.ZERO_EX_API_KEY,
  defaultSlippage: 0.005 // 0.5%
})

const quote = await protocol.quoteSwidge({
  fromToken: USDC,
  toToken: WETH,
  fromTokenAmount: 100_000_000n // 100 USDC (6 decimals)
})

console.log('Estimated WETH out:', quote.toTokenAmount)
console.log('Minimum WETH out:  ', quote.toTokenAmountMin)

// ── 2. Execute (requires a full WDK EVM wallet account) ───────────────────

// import { WalletManager } from '@tetherto/wdk-wallet'
// import EvmWallet from '@tetherto/wdk-wallet-evm'
// const manager = new WalletManager({ wallets: [new EvmWallet()] })
// await manager.load({ mnemonic: process.env.MNEMONIC })
// const account = await manager.getWallet('evm').getAccount(0)

const execProtocol = new ZeroExProtocol(account, {
  chainId: 1,
  apiKey: process.env.ZERO_EX_API_KEY,
  defaultSlippage: 0.005
})

const result = await execProtocol.swidge({
  fromToken: USDC,
  toToken: WETH,
  fromTokenAmount: 100_000_000n
})

console.log('Swap submitted:', result.hash)

// ── 3. Poll for status ────────────────────────────────────────────────────

let status
do {
  await new Promise(r => setTimeout(r, 3000))
  const s = await execProtocol.getSwidgeStatus(result.id)
  status = s.status
  console.log('Status:', status)
} while (status === 'pending')
```

See [`examples/swap-usdc-to-weth.js`](examples/swap-usdc-to-weth.js) for a runnable example.

---

## Supported chains

| Chain | Chain ID |
|---|---|
| Abstract | 2741 |
| Arbitrum One | 42161 |
| Avalanche C-Chain | 43114 |
| Base | 8453 |
| Berachain | 80094 |
| BNB Smart Chain | 56 |
| Ethereum | 1 |
| HyperEVM | 999 |
| Ink | 57073 |
| Linea | 59144 |
| Mantle | 5000 |
| Monad | 143 |
| OP Mainnet | 10 |
| Plasma | 9745 |
| Polygon | 137 |
| Scroll | 534352 |
| Sonic | 146 |
| Tempo | 4217 |
| Unichain | 130 |
| World Chain | 480 |

Call `getSupportedChains()` to retrieve the full list at runtime.

---

## Token discovery

The 0x Swap API accepts **any liquid ERC-20 token by contract address**. There is no supported token list — `getSupportedTokens()` throws `NotImplementedError`. Pass token addresses directly to `quoteSwidge` and `swidge`.

For native ETH (or any chain's native token), use `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` or the alias `'native'`.

---

## Status mapping

| 0x / On-chain state | `SwidgeStatus` |
|---|---|
| No transaction receipt yet | `pending` |
| Receipt with success status | `completed` |
| Receipt with reverted status | `failed` |

> The module has no server-side status endpoint. Status is determined by polling the on-chain receipt via the bound wallet account's `getTransactionReceipt` method. If the account does not expose this method, status is always reported as `pending`.

---

## Fee mapping

| 0x response field | `SwidgeFeeType` | Notes |
|---|---|---|
| `totalNetworkFee` | `network` | Denominated in the chain's native token (e.g. ETH) |
| `fees.zeroExFee` | `protocol` | 0x protocol fee |
| `fees.integratorFee` | `affiliate` | Integrator / referral fee |

Fee caps (`maxNetworkFeeBps`, `maxProtocolFeeBps`) are only enforced when the fee token matches the sell token. Cross-token comparisons are skipped because price data is not available in the API response.

---

## Error types

| Class | When thrown |
|---|---|
| `ZeroExApiError` | The 0x API returned a non-2xx response |
| `ZeroExInsufficientLiquidityError` | `liquidityAvailable: false` in the price response |
| `ZeroExFeeLimitExceededError` | A quoted fee exceeds a configured `maxNetworkFeeBps` or `maxProtocolFeeBps` cap |
| `NotImplementedError` | `getSupportedTokens()` is called |

---

## WDK interface

This module implements `SwidgeProtocol` from `@tetherto/wdk-wallet ^1.0.0-beta.11`.

The `swap`, `quoteSwap`, `bridge`, and `quoteBridge` methods are inherited from the base class and delegate to `swidge` / `quoteSwidge` respectively.

---

## Development

```bash
npm install       # install dependencies
npm test          # run unit tests
npm run lint      # check code style (JavaScript Standard Style)
npm run build:types  # generate TypeScript declarations in types/
```

End-to-end test against the live 0x API (read-only, no wallet needed):

```bash
ZERO_EX_API_KEY=... npm run e2e
```

To test real swap execution, add a BIP-39 mnemonic:

```bash
ZERO_EX_API_KEY=... MNEMONIC="word word ..." npm run e2e
```

---

## Unsupported options

The following fields from `SwidgeCommonOptions` are accepted by the interface but not supported by this module:

| Option | Reason |
|---|---|
| `toChain` | Cross-chain bridging is not implemented. Passing a `toChain` that differs from the configured `chainId` throws an error. |
| `refundAddress` | The 0x AllowanceHolder flow has no refund path. This field is silently ignored. |

---

## Support

Open an issue at [github.com/0xProject/wdk-protocol-swidge-0x/issues](https://github.com/0xProject/wdk-protocol-swidge-0x/issues).

---

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
