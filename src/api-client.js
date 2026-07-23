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

import { ZeroExApiError } from './errors.js'

const DEFAULT_BASE_URL = 'https://api.0x.org'

/**
 * Thin HTTP wrapper for the 0x Swap API v2 (AllowanceHolder flow).
 */
export default class ZeroExApiClient {
  /**
   * @param {{ apiKey: string, baseUrl?: string }} options
   */
  constructor ({ apiKey, baseUrl = DEFAULT_BASE_URL } = {}) {
    if (!apiKey) {
      throw new Error('ZeroExApiClient requires an apiKey.')
    }
    /** @private */
    this._apiKey = apiKey
    /** @private */
    this._baseUrl = baseUrl
  }

  /**
   * Fetches an indicative price. Does not require a taker address.
   *
   * @param {number} chainId
   * @param {Record<string, string | number | undefined>} params
   * @returns {Promise<Object>}
   */
  async price (chainId, params) {
    return this._get('/swap/allowance-holder/price', { chainId, ...params })
  }

  /**
   * Fetches a firm quote. Requires a taker address in params.
   *
   * @param {number} chainId
   * @param {Record<string, string | number | undefined>} params
   * @returns {Promise<Object>}
   */
  async quote (chainId, params) {
    return this._get('/swap/allowance-holder/quote', { chainId, ...params })
  }

  /**
   * @private
   * @param {string} path
   * @param {Record<string, string | number | undefined>} params
   * @returns {Promise<Object>}
   */
  async _get (path, params) {
    const url = new URL(`${this._baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }

    const res = await fetch(url.toString(), {
      headers: {
        '0x-api-key': this._apiKey,
        '0x-version': 'v2'
      }
    })

    let body
    try {
      body = await res.json()
    } catch {
      body = {}
    }

    if (!res.ok) {
      throw new ZeroExApiError(
        body?.reason ?? body?.message ?? `0x API error ${res.status}`,
        res.status,
        body
      )
    }

    return body
  }
}
