/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const LIB_DIR = '../../../lib'

const assert = require('insist')
const mocks = require('../../mocks')
const P = require(`${LIB_DIR}/promise`)
const proxyquire = require('proxyquire')
const sinon = require('sinon')

describe('redis/pool:', () => {
  let log, redis, redisCreateClient, redisConnection, connection, genericPool, genericPoolCreatePool, redisPool

  beforeEach(() => {
    log = mocks.mockLog()
    redis = {
      on: sinon.spy()
    }
    redisCreateClient = sinon.spy(() => redis)
    connection = {
      isValid: sinon.spy(() => 'mock isValid result'),
      destroy: sinon.spy(() => 'mock destroy result')
    }
    redisConnection = sinon.spy(() => connection)
    genericPool = {
      on: sinon.spy(),
      acquire: sinon.spy(() => P.resolve(connection)),
      release: sinon.spy()
    }
    genericPoolCreatePool = sinon.spy(() => genericPool)
    redisPool = proxyquire(`${LIB_DIR}/redis/pool`, {
      'generic-pool': { createPool: genericPoolCreatePool },
      redis: { createClient: redisCreateClient },
      './connection': redisConnection
    })({
      host: 'foo',
      port: 'bar',
      sessionsKeyPrefix: 'baz',
      retryCount: 3,
      initialBackoff: 100,
      maxConnections: 'qux',
      minConnections: 'wibble',
      maxPending: 'blee'
    }, log)
  })

  it('called genericPool.createPool correctly', () => {
    assert.equal(genericPoolCreatePool.callCount, 1)
    const args = genericPoolCreatePool.args[0]
    assert.equal(args.length, 2)
    assert.equal(typeof args[0].create, 'function')
    assert.equal(typeof args[0].destroy, 'function')
    assert.equal(typeof args[0].validate, 'function')
    // Can't deepEqual args[1] because of Promise
    assert.equal(args[1].acquireTimeoutMillis, 700)
    assert.equal(args[1].autostart, true)
    assert.equal(args[1].max, 'qux')
    assert.equal(args[1].maxWaitingClients, 'blee')
    assert.equal(args[1].min, 'wibble')
    assert.equal(args[1].Promise, P)
    assert.equal(args[1].testOnBorrow, true)
  })

  it('called pool.on correctly', () => {
    assert.equal(genericPool.on.callCount, 1)
    const args = genericPool.on.args[0]
    assert.equal(args.length, 2)
    assert.equal(args[0], 'factoryCreateError')
    assert.equal(typeof args[1], 'function')
  })

  it('returned pool object', () => {
    assert.equal(Object.keys(redisPool).length, 2)
    assert.equal(typeof redisPool.acquire, 'function')
    assert.equal(typeof redisPool.close, 'function')
  })

  it('did not call connection.isValid', () => {
    assert.equal(connection.isValid.callCount, 0)
  })

  it('did not call connection.destroy', () => {
    assert.equal(connection.destroy.callCount, 0)
  })

  it('did not call pool.acquire', () => {
    assert.equal(genericPool.acquire.callCount, 0)
  })

  describe('redisFactory.create:', () => {
    let result

    beforeEach(done => {
      genericPoolCreatePool.args[0][0].create()
        .then(r => result = r)
      setImmediate(done)
    })

    it('called redis.createClient correctly', () => {
      assert.equal(redisCreateClient.callCount, 1)
      const args = redisCreateClient.args[0]
      assert.equal(args.length, 1)
      assert.equal(Object.keys(args[0]).length, 5)
      assert.equal(args[0].host, 'foo')
      assert.equal(args[0].port, 'bar')
      assert.equal(args[0].prefix, 'baz')
      assert.equal(args[0].enable_offline_queue, false)
      assert.equal(typeof args[0].retry_strategy, 'function')
    })

    it('called redisClient.on correctly', () => {
      assert.equal(redis.on.callCount, 2)

      let args = redis.on.args[0]
      assert.equal(args.length, 2)
      assert.equal(args[0], 'ready')
      assert.equal(typeof args[1], 'function')

      args = redis.on.args[1]
      assert.equal(args.length, 2)
      assert.equal(args[0], 'error')
      assert.equal(typeof args[1], 'function')
    })

    it('did not resolve', () => {
      assert.equal(result, undefined)
    })

    it('did not call redisConnection', () => {
      assert.equal(redisConnection.callCount, 0)
    })

    describe('redis ready event:', () => {
      beforeEach(done => {
        redis.on.args[0][1]()
        setImmediate(done)
      })

      it('called redisConnection correctly', () => {
        assert.equal(redisConnection.callCount, 1)
        const args = redisConnection.args[0]
        assert.equal(args.length, 2)
        assert.equal(args[0], log)
        assert.equal(args[1], redis)
      })

      it('resolved the redisFactory.create promise', () => {
        assert.equal(result, connection)
      })

      it('did not call log.error', () => {
        assert.equal(log.error.callCount, 0)
      })
    })

    describe('redis error event:', () => {
      beforeEach(() => redis.on.args[1][1]({ message: 'foo' }))

      it('should log the error', () => {
        assert.equal(log.error.callCount, 1)
        assert.equal(log.error.args[0].length, 1)
        assert.deepEqual(log.error.args[0][0], {
          op: 'redis.error',
          err: 'foo'
        })
      })
    })
  })

  describe('redisFactory.validate:', () => {
    let result

    beforeEach(() => {
      result = genericPoolCreatePool.args[0][0].validate(connection)
    })

    it('called connection.isValid correctly', () => {
      assert.equal(connection.isValid.callCount, 1)
      assert.equal(connection.isValid.args[0].length, 0)
    })

    it('returned the isValid result', () => {
      assert.equal(result, 'mock isValid result')
    })
  })

  describe('redisFactory.destroy:', () => {
    let result

    beforeEach(() => {
      result = genericPoolCreatePool.args[0][0].destroy(connection)
    })

    it('called connection.destroy correctly', () => {
      assert.equal(connection.destroy.callCount, 1)
      assert.equal(connection.destroy.args[0].length, 0)
    })

    it('returned the destroy result', () => {
      assert.equal(result, 'mock destroy result')
    })
  })

  describe('factoryCreateError event handler:', () => {
    beforeEach(() => {
      genericPool.on.args[0][1]({ message: 'mock factory create error' })
    })

    it('called log.error correctly', () => {
      assert.equal(log.error.callCount, 1)
      const args = log.error.args[0]
      assert.equal(args.length, 1)
      assert.deepEqual(args[0], {
        op: 'redisFactory.error',
        err: 'mock factory create error'
      })
    })
  })

  describe('redisPool.acquire:', () => {
    let result

    beforeEach(() => {
      result = redisPool.acquire()
    })

    it('called pool.acquire correctly', () => {
      assert.equal(genericPool.acquire.callCount, 1)
      assert.equal(genericPool.acquire.args[0].length, 0)
    })

    it('did not return a promise', () => {
      assert.equal(typeof result.then, 'undefined')
    })

    it('did not call pool.release', () => {
      assert.equal(genericPool.release.callCount, 0)
    })

    it('returned a disposer for the connection', () => {
      assert.equal(typeof result.then, 'undefined')
      return P.using(result, r => assert.equal(r, connection))
        .then(() => {
          assert.equal(genericPool.release.callCount, 1)
          const args = genericPool.release.args[0]
          assert.equal(args.length, 1)
          assert.equal(args[0], connection)
        })
    })
  })
})

