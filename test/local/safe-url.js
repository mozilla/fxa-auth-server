/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const mocks = require('../mocks')

describe('instantiate:', () => {
  let log, safeUrl

  beforeEach(() => {
    log = mocks.mockLog()
    safeUrl = require('../../lib/safe-url')(log)
  })

  it('returned the expected interface', () => {
    assert.equal(typeof safeUrl, 'function')
    assert.equal(safeUrl.length, 2)
  })

  describe('endpoint with one param', () => {
    let endpoint

    beforeEach(() => {
      endpoint = safeUrl('foo', '/bar/:baz')
    })

    it('returned the expected interface', () => {
      assert.equal(typeof endpoint, 'function')
      assert.equal(endpoint.length, 1)
    })

    it('interpolates correctly', () => {
      assert.equal(endpoint({ baz: 'qux' }), '/bar/qux')
    })

    it('did not call log.error', () => {
      assert.equal(log.error.callCount, 0)
    })

    it('logs an error and throws when param is missing', () => {
      assert.throws(() => endpoint({}))
      assert.equal(log.error.callCount, 1)
      assert.deepEqual(log.error.args[0][0], {
        op: 'safeUrl.mismatch',
        keys: [],
        expected: [ 'baz' ],
        caller: 'foo'
      })
    })

    it('logs an error and throws when param has wrong key', () => {
      assert.throws(() => endpoint({ wibble: 'blee' }))
      assert.equal(log.error.callCount, 1)
      assert.deepEqual(log.error.args[0][0], {
        op: 'safeUrl.unexpected',
        key: 'wibble',
        expected: [ 'baz' ],
        caller: 'foo'
      })
    })

    it('logs an error and throws when param seems unsafe', () => {
      assert.throws(() => endpoint({ baz: 'qux\n' }))
      assert.equal(log.error.callCount, 1)
      assert.deepEqual(log.error.args[0][0], {
        op: 'safeUrl.unsafe',
        key: 'baz',
        value: 'qux\n',
        caller: 'foo'
      })
    })
  })

  describe('endpoint with two params', () => {
    let endpoint

    beforeEach(() => {
      endpoint = safeUrl('foo', '/bar/:baz/:qux')
    })

    it('interpolates correctly', () => {
      assert.equal(endpoint({ baz: 'wibble', qux: 'blee' }), '/bar/wibble/blee')
    })
  })
})

