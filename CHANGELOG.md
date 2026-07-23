# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-23

### Added

- Initial implementation of `ZeroExProtocol` extending `SwidgeProtocol` from `@tetherto/wdk-wallet`.
- `quoteSwidge`: indicative price via the 0x Swap API v2 AllowanceHolder `/price` endpoint.
- `swidge`: swap execution via `/quote`, automatic ERC-20 approval, and transaction submission.
- `getSwidgeStatus`: on-chain receipt polling via the bound wallet account.
- `getSupportedChains`: hardcoded list of 20 0x-supported EVM chains.
- `getSupportedTokens`: throws `NotImplementedError` (0x accepts any liquid ERC-20 by address).
- Fee mapping: `totalNetworkFee` → `network`, `zeroExFee` → `protocol`, `integratorFee` → `affiliate`.
- `maxNetworkFeeBps` and `maxProtocolFeeBps` fee caps at both protocol and per-call level.
- Full unit test coverage for all public methods and error paths.
- Apache 2.0 license.
