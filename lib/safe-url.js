/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This module exports a safe URL-builder interface, ensuring that no
// unsafe input can leak into generated URLs.
//
// It takes the approach of throwing error.unexpectedError() when unsafe
// input is encountered, for extra visibility. An alternative approach
// would be to use encodeURIComponent instead to convert unsafe input on
// the fly. However, we have no valid use case for encoding weird data
// like that, since we explicitly hex-encode params that need it. So if
// any weird input is encountered, we should fail the request as soon as
// possible.
//
// Usage:
//
//   const safeUrl = require('./safe-url')(log)
//
//   const endpoint1 = safeUrl('/foo/:bar')
//   endpoint1({ bar: 'wibble' }) // returns "/foo/wibble"
//   endpoint1({ bar: 'blee' })   // returns "/foo/blee"
//   endpoint1({ bar: 'blee\n' }) // throws error.unexpectedError()
//
//   const endpoint2 = safeUrl('/foo/:bar/baz/:qux')
//   endpoint2({ bar: 'wibble', qux: 'blee' }) // returns "/foo/wibble/baz/blee"
//   endpoint2({ bar: 'wibble' })              // throws error.unexpectedError()

'use strict'

const error = require('./error')
const impl = require('safe-url-assembler')()

const SAFE_PATH_COMPONENT = /^[\w.]+$/

module.exports = log => {
  return (caller, path) => {
    const expected = path.split('/')
      .filter(part => part.indexOf(':') === 0)
      .map(part => part.substr(1))
    const expectedSet = new Set(expected)
    const template = impl.template(path)

    return params => {
      const keys = Object.keys(params)
      if (keys.length !== expected.length) {
        log.error({ op: 'safeUrl.mismatch', keys, expected, caller })
        throw error.unexpectedError()
      }

      keys.forEach(key => {
        if (! expectedSet.has(key)) {
          log.error({ op: 'safeUrl.unexpected', key, expected, caller })
          throw error.unexpectedError()
        }

        const value = params[key]

        if (! SAFE_PATH_COMPONENT.test(value)) {
          log.error({ op: 'safeUrl.unsafe', key, value, caller })
          throw error.unexpectedError()
        }
      })

      return template.param(params).toString()
    }
  }
}

