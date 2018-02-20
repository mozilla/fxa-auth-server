/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const ROOT_DIR = '../..'

const assert = require("../assert")
const crypto = require('crypto')
const Memcached = require('memcached')
const mocks = require('../mocks')
const P = require(`${ROOT_DIR}/lib/promise`)
const sinon = require('sinon')

const modulePath = `${ROOT_DIR}/lib/cache`

describe('cache:', () => {
  let sandbox, log, cache, token, digest

  beforeEach(() => {
    sandbox = sinon.sandbox.create()
    log = mocks.mockLog()
    cache = require(modulePath)(log, {
      memcached: {
        address: '127.0.0.1:1121',
        idle: 500,
        lifetime: 30
      }
    }, 'wibble')
    token = {
      uid: Buffer.alloc(32, 'cd'),
      id: 'deadbeef'
    }
    const hash = crypto.createHash('sha256')
    hash.update(token.uid)
    hash.update(token.id)
    digest = hash.digest('base64')
  })

  afterEach(() => sandbox.restore())

  it('exports the correct interface', () => {
    assert.ok(cache)
    assert.equal(typeof cache, 'object')
    assert.equal(Object.keys(cache).length, 3)
    assert.equal(typeof cache.del, 'function')
    assert.equal(cache.del.length, 1)
    assert.equal(typeof cache.get, 'function')
    assert.equal(cache.get.length, 1)
    assert.equal(typeof cache.set, 'function')
    assert.equal(cache.set.length, 2)
  })

  describe('memcached resolves:', () => {
    beforeEach(() => {
      sandbox.stub(Memcached.prototype, 'delAsync', () => P.resolve())
      sandbox.stub(Memcached.prototype, 'getAsync', () => P.resolve('mock get result'))
      sandbox.stub(Memcached.prototype, 'setAsync', () => P.resolve())
    })

    describe('del:', () => {
      beforeEach(() => {
        return cache.del(digest)
      })

      it('calls memcached.delAsync correctly', () => {
        assert.calledOnce(Memcached.prototype.delAsync)
        assert.calledWithExactly(Memcached.prototype.delAsync, digest)

        assert.notCalled(Memcached.prototype.getAsync)
        assert.notCalled(Memcached.prototype.setAsync)
        assert.notCalled(log.error)
      })
    })

    describe('get:', () => {
      let result

      beforeEach(() => {
        return cache.get(digest)
          .then(r => result = r)
      })

      it('returns the correct result', () => {
        assert.equal(result, 'mock get result')
      })

      it('calls memcached.getAsync correctly', () => {
        assert.calledOnce(Memcached.prototype.getAsync)
        assert.calledWithExactly(Memcached.prototype.getAsync, digest)

        assert.notCalled(Memcached.prototype.delAsync)
        assert.notCalled(Memcached.prototype.setAsync)
        assert.notCalled(log.error)
      })
    })

    describe('set:', () => {
      beforeEach(() => {
        return cache.set(digest, 'wibble')
      })

      it('calls memcached.setAsync correctly', () => {
        assert.calledOnce(Memcached.prototype.setAsync)
        assert.calledWithExactly(Memcached.prototype.setAsync, digest, 'wibble', 30)

        assert.notCalled(Memcached.prototype.delAsync)
        assert.notCalled(Memcached.prototype.getAsync)
        assert.notCalled(log.error)
      })
    })
  })

  describe('memcached rejects:', () => {
    beforeEach(() => {
      sandbox.stub(Memcached.prototype, 'delAsync', () => P.reject('foo'))
      sandbox.stub(Memcached.prototype, 'getAsync', () => P.reject('bar'))
      sandbox.stub(Memcached.prototype, 'setAsync', () => P.reject('baz'))
    })

    describe('del:', () => {
      let error

      beforeEach(() => {
        return cache.del(digest)
          .catch(e => error = e)
      })

      it('propagates the error', () => {
        assert.equal(error, 'foo')
      })
    })

    describe('get:', () => {
      let error

      beforeEach(() => {
        return cache.get(digest)
          .catch(e => error = e)
      })

      it('propagates the error', () => {
        assert.equal(error, 'bar')
      })
    })

    describe('set:', () => {
      let error

      beforeEach(() => {
        return cache.set(digest, 'wibble')
          .catch(e => error = e)
      })

      it('propagates the error', () => {
        assert.equal(error, 'baz')
      })
    })
  })
})

describe('null cache:', () => {
  let sandbox, log, cache, token

  beforeEach(() => {
    sandbox = sinon.sandbox.create()
    log = mocks.mockLog()
    cache = require(modulePath)(log, {
      memcached: {
        address: 'none',
        idle: 500,
        lifetime: 30
      }
    }, 'wibble')
    token = {
      uid: Buffer.alloc(32, 'cd'),
      id: 'deadbeef'
    }
    sandbox.stub(Memcached.prototype, 'delAsync', () => P.resolve())
    sandbox.stub(Memcached.prototype, 'getAsync', () => P.resolve())
    sandbox.stub(Memcached.prototype, 'setAsync', () => P.resolve())
  })

  afterEach(() => sandbox.restore())

  describe('del:', () => {
    beforeEach(() => {
      return cache.del(token)
    })

    it('did not call memcached.delAsync', () => {
      assert.notCalled(Memcached.prototype.delAsync)
    })
  })

  describe('get:', () => {
    beforeEach(() => {
      return cache.get(token)
    })

    it('did not call memcached.getAsync', () => {
      assert.notCalled(Memcached.prototype.getAsync)
    })
  })

  describe('set:', () => {
    beforeEach(() => {
      return cache.set(token, {})
    })

    it('did not call memcached.setAsync', () => {
      assert.notCalled(Memcached.prototype.setAsync)
    })
  })
})

