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

describe('db, session tokens expire:', () => {
  const tokenLifetimes = {
    sessionTokenWithoutDevice: 2419200000
  }

  let results, pool, log, tokens, db

  beforeEach(() => {
    results = {}
    pool = {
      get: sinon.spy(() => P.resolve(results.pool)),
      post: sinon.spy(() => P.resolve()),
      put: sinon.spy(() => P.resolve())
    }
    log = mocks.mockLog()
    tokens = require(`${LIB_DIR}/tokens`)(log, { tokenLifetimes })
    const DB = proxyquire(`${LIB_DIR}/db`, {
      './pool': function () { return pool }
    })({ tokenLifetimes, redis: {} }, log, tokens, {})
    return DB.connect({})
      .then(result => db = result)
  })

  describe('sessions:', () => {
    let sessions

    beforeEach(() => {
      const now = Date.now()
      results.pool = [
        { createdAt: now, tokenId: 'foo' },
        { createdAt: now - tokenLifetimes.sessionTokenWithoutDevice - 1, tokenId: 'bar' },
        { createdAt: now - tokenLifetimes.sessionTokenWithoutDevice + 1000, tokenId: 'baz' },
        { createdAt: now - tokenLifetimes.sessionTokenWithoutDevice - 1, tokenId: 'qux', deviceId: 'wibble' }
      ]
      return db.sessions()
        .then(result => sessions = result)
    })

    it('returned the correct result', () => {
      assert(Array.isArray(sessions))
      assert.equal(sessions.length, 3)
      assert.equal(sessions[0].id, 'foo')
      assert.equal(sessions[1].id, 'baz')
      assert.equal(sessions[2].id, 'qux')
    })
  })
})

describe('db, session tokens do not expire:', () => {
  const tokenLifetimes = {
    sessionTokenWithoutDevice: 0
  }

  let results, pool, log, tokens, db

  beforeEach(() => {
    results = {}
    pool = {
      get: sinon.spy(() => P.resolve(results.pool)),
      post: sinon.spy(() => P.resolve()),
      put: sinon.spy(() => P.resolve())
    }
    log = mocks.mockLog()
    tokens = require(`${LIB_DIR}/tokens`)(log, { tokenLifetimes })
    const DB = proxyquire(`${LIB_DIR}/db`, {
      './pool': function () { return pool }
    })({ tokenLifetimes, redis: {} }, log, tokens, {})
    return DB.connect({})
      .then(result => db = result)
  })

  describe('sessions:', () => {
    let sessions

    beforeEach(() => {
      const now = Date.now()
      results.pool = [
        { createdAt: now, tokenId: 'foo' },
        { createdAt: now - tokenLifetimes.sessionTokenWithoutDevice - 1, tokenId: 'bar' },
        { createdAt: now - tokenLifetimes.sessionTokenWithoutDevice + 1000, tokenId: 'baz' },
        { createdAt: now - tokenLifetimes.sessionTokenWithoutDevice - 1, tokenId: 'qux', deviceId: 'wibble' }
      ]
      return db.sessions()
        .then(result => sessions = result)
    })

    it('returned the correct result', () => {
      assert.equal(sessions.length, 4)
      assert.equal(sessions[0].id, 'foo')
      assert.equal(sessions[1].id, 'bar')
      assert.equal(sessions[2].id, 'baz')
      assert.equal(sessions[3].id, 'qux')
    })
  })
})

describe('db with redis disabled', () => {
  const tokenLifetimes = {
    sessionTokenWithoutDevice: 2419200000
  }

  let results, pool, redis, log, tokens, db

  beforeEach(() => {
    results = {}
    pool = {
      get: sinon.spy(() => P.resolve(results.pool)),
      post: sinon.spy(() => P.resolve()),
      del: sinon.spy(() => P.resolve())
    }

    redis = {
      on: sinon.spy(),
      getAsync: sinon.spy(),
      setAsync: sinon.spy(),
      delAsync: sinon.spy(),
      watchAsync: sinon.spy(),
      multi: sinon.spy()
    }

    log = mocks.mockLog()
    tokens = require(`${LIB_DIR}/tokens`)(log, { tokenLifetimes })
    const DB = proxyquire(`${LIB_DIR}/db`, {
      './pool': function () { return pool },
      redis: { createClient: () => redis }
    })({ tokenLifetimes, redis: {enabled: false} }, log, tokens, {})
    return DB.connect({})
      .then(result => {
        assert.equal(redis.on.callCount, 0, 'redis.on was not called')

        db = result
      })
  })

  it('should not call redis when reading sessions', () => {
    results.pool = []
    return db.sessions('fakeUid')
      .then(result => {
        assert.equal(pool.get.callCount, 1)
        assert.equal(pool.get.args[0].length, 1)
        assert.equal(pool.get.args[0][0], '/account/fakeUid/sessions')
        assert.equal(redis.getAsync.callCount, 0)
        assert.deepEqual(result, [])
      })
  })

  it('should not call redis when reading devices', () => {
    results.pool = []
    return db.devices('fakeUid')
      .then(result => {
        assert.equal(pool.get.callCount, 1)
        assert.equal(pool.get.args[0].length, 1)
        assert.equal(pool.get.args[0][0], '/account/fakeUid/devices')
        assert.equal(redis.getAsync.callCount, 0)
        assert.deepEqual(result, [])
      })
  })

  it('should not call redis when deleting account', () => {
    return db.deleteAccount({ uid: 'fakeUid' })
      .then(() => {
        assert.equal(pool.del.callCount, 1)
        assert.equal(pool.del.args[0].length, 1)
        assert.equal(pool.del.args[0][0], '/account/fakeUid')
        assert.equal(redis.delAsync.callCount, 0)
      })
  })

  it('should not call redis when deleting sessionTokens', () => {
    return db.deleteSessionToken({ id: 'foo', uid: 'bar'})
      .then(() => {
        assert.equal(pool.del.callCount, 1)
        assert.equal(pool.del.args[0].length, 1)
        assert.equal(pool.del.args[0][0], '/sessionToken/foo')
        assert.equal(redis.getAsync.callCount, 0)
        assert.equal(redis.setAsync.callCount, 0)
        assert.equal(redis.watchAsync.callCount, 0)
        assert.equal(redis.multi.callCount, 0)
      })
  })

  it('should not call redis when resetting account', () => {
    const start = Date.now()
    return db.resetAccount({ uid: 'fakeUid' }, {})
      .then(() => {
        const end = Date.now()
        assert.equal(pool.post.callCount, 1)
        assert.equal(pool.post.args[0].length, 2)
        assert.equal(pool.post.args[0][0], '/account/fakeUid/reset')
        assert.equal(Object.keys(pool.post.args[0][1]).length, 1)
        assert.ok(pool.post.args[0][1].verifierSetAt >= start)
        assert.ok(pool.post.args[0][1].verifierSetAt <= end)
        assert.equal(redis.delAsync.callCount, 0)
      })
  })

  it('should not call redis when updating sessionTokens', () => {
    return db.updateSessionToken({ id: 'foo', uid: 'bar' })
      .then(() => {
        assert.equal(pool.get.callCount, 0)
        assert.equal(pool.post.callCount, 0)
        assert.equal(redis.getAsync.callCount, 0)
        assert.equal(redis.setAsync.callCount, 0)
        assert.equal(redis.watchAsync.callCount, 0)
        assert.equal(redis.multi.callCount, 0)
      })
  })
})

describe('redis enabled', () => {
  const tokenLifetimes = {
    sessionTokenWithoutDevice: 2419200000
  }

  let pool, redis, redisMulti, log, tokens, db

  beforeEach(() => {
    pool = {
      get: sinon.spy(() => P.resolve([])),
      post: sinon.spy(() => P.resolve()),
      del: sinon.spy(() => P.resolve())
    }
    redis = {
      on: sinon.spy(),
      getAsync: sinon.spy(() => P.resolve('{}')),
      setAsync: sinon.spy(() => P.resolve()),
      delAsync: sinon.spy(() => P.resolve()),
      watchAsync: sinon.spy(() => P.resolve()),
      multi: sinon.spy(() => redisMulti),
      unwatch: sinon.spy()
    }
    redisMulti = {
      execAsync: sinon.spy(() => P.resolve(true)),
      set: sinon.spy()
    }
    const createClient = sinon.spy(() => redis)
    log = mocks.mockLog()
    tokens = require(`${LIB_DIR}/tokens`)(log, { tokenLifetimes })
    const DB = proxyquire(`${LIB_DIR}/db`, {
      './pool': function () { return pool },
      redis: { createClient }
    })({
      tokenLifetimes,
      redis: {
        enabled: true,
        host: 'foo',
        port: 'bar',
        sessionsKeyPrefix: 'baz'
      },
      lastAccessTimeUpdates: {
        enabled: true,
        sampleRate: 1,
        earliestSaneTimestamp: 1
      }
    }, log, tokens, {})
    return DB.connect({})
      .then(result => {
        assert.equal(createClient.callCount, 1, 'redis.createClient was called once')
        assert.equal(createClient.args[0].length, 1, 'redis.createClient was passed one argument')
        assert.deepEqual(createClient.args[0][0], {
          host: 'foo',
          port: 'bar',
          prefix: 'baz',
          enable_offline_queue: false
        }, 'redis.createClient was passed correct settings')

        assert.equal(redis.on.callCount, 1, 'redis.on was called once')
        assert.equal(redis.on.args[0].length, 2, 'redis.on was passed two arguments')
        assert.equal(redis.on.args[0][0], 'error', 'redis.on was called for the `error` event')
        assert.equal(typeof redis.on.args[0][1], 'function', 'redis.on was passed event handler')

        db = result
      })
  })

  it('should not call redis or the db in db.devices if uid is falsey', () => {
    return db.devices('')
      .then(
        result => assert.equal(result, 'db.devices should reject with error.unknownAccount'),
        err => {
          assert.equal(pool.get.callCount, 0)
          assert.equal(redis.getAsync.callCount, 0)
          assert.equal(err.errno, 102)
          assert.equal(err.message, 'Unknown account')
        }
      )
  })

  it('should call redis and the db in db.devices if uid is not falsey', () => {
    return db.devices('wibble')
      .then(() => {
        assert.equal(pool.get.callCount, 1)
        assert.equal(redis.getAsync.callCount, 1)
      })
  })

  describe('redis error:', () => {
    beforeEach(() => redis.on.args[0][1]({ message: 'foo', stack: 'bar' }))

    it('should log the error', () => {
      assert.equal(log.error.callCount, 1, 'log.error was called once')
      assert.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
      assert.deepEqual(log.error.args[0][0], {
        op: 'db.redis.error',
        err: 'foo',
        stack: 'bar'
      }, 'log.error was passed the error details')
    })
  })

  describe('redis.exec error:', () => {
    beforeEach(() => {
      redis.getAsync = sinon.spy(() => P.resolve('{"wibble":{"x":"y"}}'))
      redisMulti.execAsync = sinon.spy(() => P.reject({ message: 'mock error' }))
    })

    it('db.updateSessionToken should fail', () => {
      return db.updateSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve({}))
        .then(
          () => assert.equal(false, 'db.updateSessionToken should reject'),
          err => {
            assert.deepEqual(err, { message: 'mock error' }, 'db.updateSessionToken rejected with error object')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.watchAsync.args[0].length, 1, 'redis.watch was passed one argument')
            assert.equal(redis.watchAsync.args[0][0], 'blee', 'redis.watch was passed uid')

            assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
            assert.equal(redis.getAsync.args[0].length, 1, 'redis.get was passed one argument')
            assert.equal(redis.getAsync.args[0][0], 'blee', 'redis.get was passed uid')

            assert.equal(redis.multi.callCount, 1, 'redis.multi was called once')
            assert.equal(redis.multi.args[0].length, 0, 'redis.multi was passed no arguments')

            assert.equal(redisMulti.set.callCount, 1, 'multi.set was called once')
            assert.equal(redisMulti.set.args[0].length, 2, 'multi.set was passed two arguments')
            assert.equal(redisMulti.set.args[0][0], 'blee', 'multi.set was passed uid')
            assert.deepEqual(JSON.parse(redisMulti.set.args[0][1]), {
              wibble: {
                tokenId: 'wibble',
                uid: 'blee'
              }
            }, 'multi.set was passed stringified tokens')

            assert.equal(redisMulti.execAsync.callCount, 1, 'multi.exec was called once')
            assert.equal(redisMulti.execAsync.args[0].length, 0, 'multi.exec was passed no arguments')

            assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
            assert.equal(redis.unwatch.args[0].length, 0, 'redis.unwatch was passed no arguments')

            assert.equal(log.error.callCount, 1, 'log.error was called once')
            assert.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
            assert.deepEqual(log.error.args[0][0], {
              op: 'db.redis.multi.error',
              method: 'updateSessionToken',
              err: 'mock error'
            }, 'log.error was passed the error details')

            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
          }
        )
    })

    it('db.deleteSessionToken should fail', () => {
      return db.deleteSessionToken({ id: 'wibble', uid: 'blee' })
        .then(
          () => assert.equal(false, 'db.deleteSessionToken should reject'),
          err => {
            assert.deepEqual(err, { message: 'mock error' }, 'db.deleteSessionToken rejected with error object')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.watchAsync.args[0].length, 1, 'redis.watch was passed one argument')
            assert.equal(redis.watchAsync.args[0][0], 'blee', 'redis.watch was passed uid')

            assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
            assert.equal(redis.getAsync.args[0].length, 1, 'redis.get was passed one argument')
            assert.equal(redis.getAsync.args[0][0], 'blee', 'redis.get was passed uid')

            assert.equal(redis.multi.callCount, 1, 'redis.multi was called once')
            assert.equal(redis.multi.args[0].length, 0, 'redis.multi was passed no arguments')

            assert.equal(redisMulti.set.callCount, 1, 'multi.set was called once')
            assert.equal(redisMulti.set.args[0].length, 2, 'multi.set was passed two arguments')
            assert.equal(redisMulti.set.args[0][0], 'blee', 'multi.set was passed uid')
            assert.equal(redisMulti.set.args[0][1], '{}', 'multi.set was passed stringified tokens')

            assert.equal(redisMulti.execAsync.callCount, 1, 'multi.exec was called once')
            assert.equal(redisMulti.execAsync.args[0].length, 0, 'multi.exec was passed no arguments')

            assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
            assert.equal(redis.unwatch.args[0].length, 0, 'redis.unwatch was passed no arguments')

            assert.equal(log.error.callCount, 1, 'log.error was called once')
            assert.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
            assert.deepEqual(log.error.args[0][0], {
              op: 'db.redis.multi.error',
              method: 'deleteSessionToken',
              err: 'mock error'
            }, 'log.error was passed the error details')

            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
            assert.equal(pool.del.callCount, 0, 'pool.del was not called')
          }
        )
    })
  })

  describe('redis.exec returns null:', () => {
    beforeEach(() => {
      redis.getAsync = sinon.spy(() => P.resolve('{"foo":{}}'))
      redisMulti.execAsync = sinon.spy(() => P.resolve(null))
    })

    it('db.updateSessionToken should fail', () => {
      return db.updateSessionToken({ id: 'foo', uid: 'bar' }, P.resolve({}))
        .then(
          () => assert.equal(false, 'db.updateSessionToken should reject'),
          err => {
            assert.equal(err.message, 'Unspecified error', 'db.updateSessionToken rejected with unspecified error message')
            assert.equal(err.errno, 999, 'db.updateSessionToken rejected with unspecified errno')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
            assert.equal(redis.multi.callCount, 1, 'redis.multi was called once')
            assert.equal(redisMulti.set.callCount, 1, 'multi.set was called once')
            assert.equal(redisMulti.execAsync.callCount, 1, 'multi.exec was called once')

            assert.equal(log.error.callCount, 1, 'log.error was called once')
            assert.deepEqual(log.error.args[0][0], {
              op: 'db.redis.watch.error',
              method: 'updateSessionToken'
            }, 'log.error was passed the error details')

            assert.equal(redis.unwatch.callCount, 0, 'redis.unwatch was not called')
            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
          }
        )
    })

    it('db.deleteSessionToken should fail', () => {
      return db.deleteSessionToken({ id: 'foo', uid: 'bar' })
        .then(
          () => assert.equal(false, 'db.deleteSessionToken should reject'),
          err => {
            assert.equal(err.message, 'Unspecified error', 'db.deleteSessionToken rejected with unspecified error message')
            assert.equal(err.errno, 999, 'db.deleteSessionToken rejected with unspecified errno')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
            assert.equal(redis.multi.callCount, 1, 'redis.multi was called once')
            assert.equal(redisMulti.set.callCount, 1, 'multi.set was called once')
            assert.equal(redisMulti.execAsync.callCount, 1, 'multi.exec was called once')

            assert.equal(log.error.callCount, 1, 'log.error was called once')
            assert.deepEqual(log.error.args[0][0], {
              op: 'db.redis.watch.error',
              method: 'deleteSessionToken'
            }, 'log.error was passed the error details')

            assert.equal(redis.unwatch.callCount, 0, 'redis.unwatch was not called')
            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
            assert.equal(pool.del.callCount, 0, 'pool.del was not called')
          }
        )
    })
  })

  describe('redis.watch error:', () => {
    beforeEach(() => redis.watchAsync = sinon.spy(() => P.reject({ message: 'wibble' })))

    it('db.updateSessionToken should fail', () => {
      return db.updateSessionToken({ id: 'foo', uid: 'bar' }, P.resolve({}))
        .then(
          () => assert.equal(false, 'db.updateSessionToken should reject'),
          err => {
            assert.deepEqual(err, { message: 'wibble' }, 'db.updateSessionToken rejected with error object')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
            assert.equal(log.error.callCount, 1, 'log.error was called once')

            assert.equal(redis.getAsync.callCount, 0, 'redis.get was not called')
            assert.equal(redis.multi.callCount, 0, 'redis.multi was not called')
            assert.equal(redisMulti.set.callCount, 0, 'multi.set was not called')
            assert.equal(redisMulti.execAsync.callCount, 0, 'multi.exec was not called')
            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
          }
        )
    })

    it('db.deleteSessionToken should fail', () => {
      return db.deleteSessionToken({ id: 'foo', uid: 'bar' })
        .then(
          () => assert.equal(false, 'db.deleteSessionToken should reject'),
          err => {
            assert.deepEqual(err, { message: 'wibble' }, 'db.deleteSessionToken rejected with error object')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
            assert.equal(log.error.callCount, 1, 'log.error was called once')

            assert.equal(redis.getAsync.callCount, 0, 'redis.get was not called')
            assert.equal(redis.multi.callCount, 0, 'redis.multi was not called')
            assert.equal(redisMulti.set.callCount, 0, 'multi.set was not called')
            assert.equal(redisMulti.execAsync.callCount, 0, 'multi.exec was not called')
            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
            assert.equal(pool.del.callCount, 0, 'pool.del was not called')
          }
        )
    })
  })

  describe('redis.get does not return a matching token', () => {
    beforeEach(() => redis.getAsync = sinon.spy(() => P.resolve('{"foo":{},"bar":{}}')))

    it('db.updateSessionToken should work normally', () => {
      return db.updateSessionToken({ id: 'baz', qux: 'bar' }, P.resolve({}))
        .then(() => {
          assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
          assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
          assert.equal(redis.multi.callCount, 1, 'redis.multi was called once')
          assert.equal(redisMulti.set.callCount, 1, 'multi.set was called once')
          assert.equal(redisMulti.execAsync.callCount, 1, 'multi.exec was called once')

          assert.equal(redis.unwatch.callCount, 0, 'redis.unwatch was not called')
          assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
          assert.equal(log.error.callCount, 0, 'log.error was not called')
        })
    })

    it('db.deleteSessionToken should do nothing', () => {
      return db.deleteSessionToken({ id: 'baz', uid: 'qux' })
        .then(() => {
          assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
          assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
          assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
          assert.equal(pool.del.callCount, 1, 'pool.del was called once')

          assert.equal(redis.multi.callCount, 0, 'redis.multi was not called')
          assert.equal(redisMulti.set.callCount, 0, 'multi.set was not called')
          assert.equal(redisMulti.execAsync.callCount, 0, 'multi.exec was not called')
          assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
          assert.equal(log.error.callCount, 0, 'log.error was not called')
        })
    })
  })

  describe('redis.get error:', () => {
    beforeEach(() => redis.getAsync = sinon.spy(() => P.reject({ message: 'wibble' })))

    it('db.updateSessionToken should fail', () => {
      return db.updateSessionToken({ id: 'foo', uid: 'bar' }, P.resolve({}))
        .then(
          () => assert.equal(false, 'db.updateSessionToken should reject'),
          err => {
            assert.deepEqual(err, { message: 'wibble' }, 'db.updateSessionToken rejected with error object')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
            assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
            assert.equal(log.error.callCount, 1, 'log.error was called once')

            assert.equal(redis.multi.callCount, 0, 'redis.multi was not called')
            assert.equal(redisMulti.set.callCount, 0, 'multi.set was not called')
            assert.equal(redisMulti.execAsync.callCount, 0, 'multi.exec was not called')
            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
          }
        )
    })

    it('db.deleteSessionToken should fail', () => {
      return db.deleteSessionToken({ id: 'foo', uid: 'bar' })
        .then(
          () => assert.equal(false, 'db.deleteSessionToken should reject'),
          err => {
            assert.deepEqual(err, { message: 'wibble' }, 'db.deleteSessionToken rejected with error object')

            assert.equal(redis.watchAsync.callCount, 1, 'redis.watch was called once')
            assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
            assert.equal(redis.unwatch.callCount, 1, 'redis.unwatch was called once')
            assert.equal(log.error.callCount, 1, 'log.error was called once')

            assert.equal(redis.multi.callCount, 0, 'redis.multi was not called')
            assert.equal(redisMulti.set.callCount, 0, 'multi.set was not called')
            assert.equal(redisMulti.execAsync.callCount, 0, 'multi.exec was not called')
            assert.equal(redis.setAsync.callCount, 0, 'redis.set was not called')
            assert.equal(pool.del.callCount, 0, 'pool.del was not called')
          }
        )
    })

    it('db.sessions should log the error', () => {
      return db.sessions('blee')
        .then(() => {
          assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
          assert.equal(redis.getAsync.args[0].length, 1, 'redis.get was passed one argument')
          assert.equal(redis.getAsync.args[0][0], 'blee', 'redis.get was passed uid')

          assert.equal(log.error.callCount, 1, 'log.error was called once')
          assert.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
          assert.deepEqual(log.error.args[0][0], {
            op: 'db.redis.get.error',
            method: 'sessions',
            err: 'wibble'
          }, 'log.error was passed the error details')
        })
    })

    it('db.devices should log the error', () => {
      return db.devices('blee')
        .then(() => {
          assert.equal(redis.getAsync.callCount, 1, 'redis.get was called once')
          assert.equal(redis.getAsync.args[0].length, 1, 'redis.get was passed one argument')
          assert.equal(redis.getAsync.args[0][0], 'blee', 'redis.get was passed uid')

          assert.equal(log.error.callCount, 1, 'log.error was called once')
          assert.equal(log.error.args[0].length, 1, 'log.error was passed one argument')
          assert.deepEqual(log.error.args[0][0], {
            op: 'db.redis.get.error',
            method: 'devices',
            err: 'wibble'
          }, 'log.error was passed the error details')
        })
    })
  })

  describe('redis.del error:', () => {
    beforeEach(() => redis.delAsync = sinon.spy(() => P.reject('mock error')))

    it('db.deleteAccount should fail', () => {
      return db.deleteAccount({ uid: 'foo' }, P.resolve({}))
        .then(
          () => assert.equal(false, 'db.deleteAccount should reject'),
          err => {
            assert.equal(err, 'mock error', 'db.deleteAccount rejected with error')

            assert.equal(redis.delAsync.callCount, 1, 'redis.del was called once')
            assert.equal(redis.delAsync.args[0].length, 1, 'redis.del was passed one argument')
            assert.equal(redis.delAsync.args[0][0], 'foo', 'redis.del was passed uid')

            assert.equal(pool.del.callCount, 0, 'pool.del was not called')
          }
        )
    })

    it('db.resetAccount should fail', () => {
      return db.resetAccount({ uid: 'bar' }, P.resolve({}))
        .then(
          () => assert.equal(false, 'db.resetAccount should reject'),
          err => {
            assert.equal(err, 'mock error', 'db.resetAccount rejected with error')

            assert.equal(redis.delAsync.callCount, 1, 'redis.del was called once')
            assert.equal(redis.delAsync.args[0].length, 1, 'redis.del was passed one argument')
            assert.equal(redis.delAsync.args[0][0], 'bar', 'redis.del was passed uid')

            assert.equal(pool.post.callCount, 0, 'pool.del was not called')
          }
        )
    })
  })
})

