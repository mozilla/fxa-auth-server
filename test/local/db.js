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

  let results, pool, log, tokens, db

  beforeEach(() => {
    results = {}
    pool = {
      get: sinon.spy(() => P.resolve(results.pool)),
      post: sinon.spy(() => P.resolve()),
      del: sinon.spy(() => P.resolve())
    }
    log = mocks.mockLog()
    tokens = require(`${LIB_DIR}/tokens`)(log, { tokenLifetimes })
    const DB = proxyquire(`${LIB_DIR}/db`, {
      './pool': function () { return pool },
      './redis-pool': () => {}
    })({ tokenLifetimes }, log, tokens, {})
    return DB.connect({})
      .then(result => db = result)
  })

  it('should not call redis when reading sessions', () => {
    results.pool = []
    return db.sessions('fakeUid')
      .then(result => {
        assert.equal(pool.get.callCount, 1)
        assert.equal(pool.get.args[0].length, 1)
        assert.equal(pool.get.args[0][0], '/account/fakeUid/sessions')
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
        assert.deepEqual(result, [])
      })
  })

  it('should not call redis when deleting account', () => {
    return db.deleteAccount({ uid: 'fakeUid' })
      .then(() => {
        assert.equal(pool.del.callCount, 1)
        assert.equal(pool.del.args[0].length, 1)
        assert.equal(pool.del.args[0][0], '/account/fakeUid')
      })
  })

  it('should not call redis when deleting sessionTokens', () => {
    return db.deleteSessionToken({ id: 'foo', uid: 'bar'})
      .then(() => {
        assert.equal(pool.del.callCount, 1)
        assert.equal(pool.del.args[0].length, 1)
        assert.equal(pool.del.args[0][0], '/sessionToken/foo')
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
      })
  })

  it('should not call redis when updating sessionTokens', () => {
    return db.updateSessionToken({ id: 'foo', uid: 'bar' })
      .then(() => {
        assert.equal(pool.get.callCount, 0)
        assert.equal(pool.post.callCount, 0)
      })
  })
})

describe('redis enabled', () => {
  const tokenLifetimes = {
    sessionTokenWithoutDevice: 2419200000
  }

  let pool, redis, acquire, release, log, tokens, db

  beforeEach(() => {
    pool = {
      get: sinon.spy(() => P.resolve([])),
      post: sinon.spy(() => P.resolve()),
      del: sinon.spy(() => P.resolve())
    }
    redis = {
      get: sinon.spy(() => P.resolve('{}')),
      set: sinon.spy(() => P.resolve()),
      del: sinon.spy(() => P.resolve()),
      update: sinon.spy(() => P.resolve())
    }
    acquire = sinon.spy(() => P.resolve(redis))
    release = sinon.spy()
    log = mocks.mockLog()
    tokens = require(`${LIB_DIR}/tokens`)(log, { tokenLifetimes })
    const DB = proxyquire(`${LIB_DIR}/db`, {
      './pool': function () { return pool },
      './redis-pool': (...args) => {
        assert.equal(args.length, 2, 'redisPool was passed two arguments')
        assert.equal(args[0].redis, 'mock redis config', 'redisPool was passed config')
        assert.equal(args[1], log, 'redisPool was passed log')
        return { acquire, release }
      }
    })({
      tokenLifetimes,
      redis: 'mock redis config',
      lastAccessTimeUpdates: {
        enabled: true,
        sampleRate: 1,
        earliestSaneTimestamp: 1
      }
    }, log, tokens, {})
    return DB.connect({})
      .then(result => {
        assert.equal(acquire.callCount, 1, 'redisPool.acquire was called once')
        assert.equal(acquire.args[0].length, 0, 'redisPool.acquire was passed no arguments')

        db = result
      })
  })

  it('should not call redis or the db in db.devices if uid is falsey', () => {
    return db.devices('')
      .then(
        result => assert.equal(result, 'db.devices should reject with error.unknownAccount'),
        err => {
          assert.equal(pool.get.callCount, 0)
          assert.equal(redis.get.callCount, 0)
          assert.equal(err.errno, 102)
          assert.equal(err.message, 'Unknown account')
        }
      )
  })

  it('should call redis and the db in db.devices if uid is not falsey', () => {
    return db.devices('wibble')
      .then(() => {
        assert.equal(pool.get.callCount, 1)
        assert.equal(redis.get.callCount, 1)
        assert.equal(redis.get.args[0].length, 1)
        assert.equal(redis.get.args[0][0], 'wibble')
      })
  })

  it('should call redisConnection.get in db.sessions', () => {
    return db.sessions('wibble')
      .then(() => {
        assert.equal(redis.get.callCount, 1)
        assert.equal(redis.get.args[0].length, 1)
        assert.equal(redis.get.args[0][0], 'wibble')

        assert.equal(log.error.callCount, 0)
      })
  })

  it('should call redisConnection.del in db.deleteAccount', () => {
    return db.deleteAccount({ uid: 'wibble' })
      .then(() => {
        assert.equal(redis.del.callCount, 1)
        assert.equal(redis.del.args[0].length, 1)
        assert.equal(redis.del.args[0][0], 'wibble')
      })
  })

  it('should call redisConnection.del in db.resetAccount', () => {
    return db.resetAccount({ uid: 'wibble' }, {})
      .then(() => {
        assert.equal(redis.del.callCount, 1)
        assert.equal(redis.del.args[0].length, 1)
        assert.equal(redis.del.args[0][0], 'wibble')
      })
  })

  it('should call redisPool.acquire, redisConnection.update and redisPool.release in db.updateSessionToken', () => {
    return db.updateSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
      .then(() => {
        assert.equal(acquire.callCount, 2)
        assert.equal(acquire.args[1].length, 0)

        assert.equal(redis.update.callCount, 1)
        assert.equal(redis.update.args[0].length, 2)
        assert.equal(redis.update.args[0][0], 'blee')
        assert.equal(typeof redis.update.args[0][1], 'function')

        assert.equal(release.callCount, 1)
        assert.equal(release.args[0].length, 1)
        assert.equal(release.args[0][0], redis)
      })
  })

  it('should call redisPool.acquire, redisConnection.update and redisPool.release in db.deleteSessionToken', () => {
    return db.deleteSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
      .then(() => {
        assert.equal(acquire.callCount, 2)
        assert.equal(acquire.args[1].length, 0)

        assert.equal(redis.update.callCount, 1)
        assert.equal(redis.update.args[0].length, 2)
        assert.equal(redis.update.args[0][0], 'blee')
        assert.equal(typeof redis.update.args[0][1], 'function')

        assert.equal(release.callCount, 1)
        assert.equal(release.args[0].length, 1)
        assert.equal(release.args[0][0], redis)
      })
  })

  describe('redisConnection.get rejects', () => {
    beforeEach(() => {
      redis.get = sinon.spy(() => P.reject({ message: 'mock redis.get error' }))
    })

    it('should log the error in db.sessions', () => {
      return db.sessions('wibble')
        .then(() => {
          assert.equal(redis.get.callCount, 1)

          assert.equal(log.error.callCount, 1)
          assert.equal(log.error.args[0].length, 1)
          assert.deepEqual(log.error.args[0][0], {
            op: 'redis.get.error',
            key: 'wibble',
            err: 'mock redis.get error'
          })
        })
    })

    it('should log the error in db.devices', () => {
      return db.devices('wibble')
        .then(() => {
          assert.equal(redis.get.callCount, 1)

          assert.equal(log.error.callCount, 1)
          assert.equal(log.error.args[0].length, 1)
          assert.deepEqual(log.error.args[0][0], {
            op: 'redis.get.error',
            key: 'wibble',
            err: 'mock redis.get error'
          })
        })
    })
  })

  describe('redisConnection.update rejects', () => {
    beforeEach(() => {
      redis.update = sinon.spy(() => P.reject({ message: 'mock redis.update error' }))
    })

    it('should release the connection in db.updateSessionToken', () => {
      return db.updateSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
        .then(
          () => assert.equal(false, 'db.updateSessionToken should have rejected'),
          error => {
            assert.equal(error.message, 'mock redis.update error')
            assert.equal(acquire.callCount, 2)
            assert.equal(redis.update.callCount, 1)
            assert.equal(release.callCount, 1)
          }
        )
    })

    it('should release the connection in db.deleteSessionToken', () => {
      return db.deleteSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
        .then(
          () => assert.equal(false, 'db.deleteSessionToken should have rejected'),
          error => {
            assert.equal(error.message, 'mock redis.update error')
            assert.equal(acquire.callCount, 2)
            assert.equal(redis.update.callCount, 1)
            assert.equal(release.callCount, 1)
          }
        )
    })
  })

  describe('deleteSessionToken reads falsey value from redis:', () => {
    let result

    beforeEach(() => {
      return db.deleteSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
        .then(() => result = redis.update.args[0][1]())
    })

    it('returned undefined', () => {
      assert.equal(result, undefined)
    })
  })

  describe('deleteSessionToken reads empty object from redis:', () => {
    let result

    beforeEach(() => {
      return db.deleteSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
        .then(() => result = redis.update.args[0][1]('{"wibble":{}}'))
    })

    it('returned undefined', () => {
      assert.equal(result, undefined)
    })
  })

  describe('deleteSessionToken reads populated object from redis:', () => {
    let result

    beforeEach(() => {
      return db.deleteSessionToken({ id: 'wibble', uid: 'blee' }, P.resolve())
        .then(() => result = redis.update.args[0][1]('{"frang":{}}'))
    })

    it('returned object', () => {
      assert.equal(result, '{"frang":{}}')
    })
  })
})

