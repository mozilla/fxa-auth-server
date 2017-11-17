/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const LIB_DIR = '../../lib'

const assert = require('insist')
const mocks = require('../mocks')
const P = require(`${LIB_DIR}/promise`)
const proxyquire = require('proxyquire')
const sinon = require('sinon')

describe('redis disabled:', () => {
  let genericPool, log, redis, result

  before(() => {
    genericPool = { createPool: sinon.spy() }
    log = mocks.mockLog()
    redis = { createClient: sinon.spy() }
    result = proxyquire(`${LIB_DIR}/redis-pool`, {
      'generic-pool': genericPool,
      redis
    })({ redis: { enabled: false } }, log)
  })

  it('did not call redis.createClient', () => {
    assert.equal(redis.createClient.callCount, 0)
  })

  it('called log.info correctly', () => {
    assert.equal(log.info.callCount, 1)
    assert.equal(log.info.args[0].length, 1)
    assert.deepEqual(log.info.args[0][0], { op: 'redis.disabled' })
  })

  it('returned undefined', () => {
    assert.equal(result, undefined)
  })
})

describe('redis enabled:', () => {
  let genericPool, log, redis, redisCreateClient, redisConnection, redisPool

  beforeEach(() => {
    genericPool = { createPool: sinon.spy(() => 'mock createPool result') }
    log = mocks.mockLog()
    redis = {
      on: sinon.spy(),
      quit: sinon.spy()
    }
    redisCreateClient = sinon.spy(() => redis)
    redisConnection = sinon.spy(() => 'mock redisConnection result')
    redisPool = proxyquire(`${LIB_DIR}/redis-pool`, {
      'generic-pool': genericPool,
      redis: { createClient: redisCreateClient },
      './redis-connection': redisConnection
    })({
      redis: {
        enabled: true,
        host: 'foo',
        port: 'bar',
        sessionsKeyPrefix: 'baz',
        maxConnections: 'qux',
        maxPending: 'wibble',
        timeout: 'blee'
      }
    }, log)
  })

  it('called log.info correctly', () => {
    assert.equal(log.info.callCount, 1)
    assert.equal(log.info.args[0].length, 1)
    assert.deepEqual(log.info.args[0][0], {
      op: 'redis.enabled',
      config: {
        host: 'foo',
        port: 'bar',
        prefix: 'baz',
        enable_offline_queue: false
      }
    })
  })

  it('called genericPool.createPool correctly', () => {
    assert.equal(genericPool.createPool.callCount, 1)
    const args = genericPool.createPool.args[0]
    assert.equal(args.length, 2)
    assert.equal(typeof args[0].create, 'function')
    assert.equal(typeof args[0].destroy, 'function')
    // Can't deepEqual args[1] because of Promise
    assert.equal(args[1].max, 'qux')
    assert.equal(args[1].min, 2)
    assert.equal(args[1].maxWaitingClients, 'wibble')
    assert.equal(args[1].acquireTimeoutMillis, 'blee')
    assert.equal(args[1].autostart, true)
    assert.equal(args[1].Promise, P)
  })

  it('returned genericPool.createPool result', () => {
    assert.equal(redisPool, 'mock createPool result')
  })

  describe('redisFactory.create:', () => {
    let promise, connection

    beforeEach(() => {
      promise = genericPool.createPool.args[0][0].create()
      promise.then(result => connection = result)
    })

    it('called redis.createClient correctly', () => {
      assert.equal(redisCreateClient.callCount, 1)
      const args = redisCreateClient.args[0]
      assert.equal(args.length, 1)
      assert.deepEqual(args[0], {
        host: 'foo',
        port: 'bar',
        prefix: 'baz',
        enable_offline_queue: false
      })
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

    it('returned an unresolved promise', () => {
      assert.equal(typeof promise.then, 'function')
      assert.equal(typeof promise.catch, 'function')
      assert.equal(connection, undefined)
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
        assert.equal(connection, 'mock redisConnection result')
      })

      it('did not call log.error', () => {
        assert.equal(log.error.callCount, 0)
      })
    })

    describe('redis error event:', () => {
      beforeEach(() => redis.on.args[1][1]({ message: 'foo', stack: 'bar' }))

      it('should log the error', () => {
        assert.equal(log.error.callCount, 1)
        assert.equal(log.error.args[0].length, 1)
        assert.deepEqual(log.error.args[0][0], {
          op: 'redis.error',
          err: 'foo',
          stack: 'bar'
        })
      })
    })
  })

  describe('redisFactory.destroy:', () => {
    let promise, resolved

    beforeEach(() => {
      promise = genericPool.createPool.args[0][0].destroy(redis)
      promise.then(() => resolved = true)
    })

    it('called redisClient.quit correctly', () => {
      assert.equal(redis.quit.callCount, 1)
      assert.equal(redis.quit.args[0].length, 0)
    })

    it('called redisClient.on correctly', () => {
      assert.equal(redis.on.callCount, 1)
      const args = redis.on.args[0]
      assert.equal(args.length, 2)
      assert.equal(args[0], 'end')
      assert.equal(typeof args[1], 'function')
    })

    it('returned an unresolved promise', () => {
      assert.equal(typeof promise.then, 'function')
      assert.equal(typeof promise.catch, 'function')
      assert.equal(resolved, undefined)
    })

    describe('redis ready event:', () => {
      beforeEach(done => {
        redis.on.args[0][1]()
        setImmediate(done)
      })

      it('resolved the redisFactory.create promise', () => {
        assert.equal(resolved, true)
      })
    })
  })
})

