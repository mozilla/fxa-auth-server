/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const ROOT_DIR = '../..'

const assert = require('insist')
const config = require(`${ROOT_DIR}/config`).getProperties()
const P = require(`${ROOT_DIR}/lib/promise`)

const log = { info () {}, error () {} }

const redis = require(`${ROOT_DIR}/lib/redis-pool`)({
  redis: Object.assign({}, config.redis, {  enabled: true })
}, log)

describe('pool.acquire:', () => {
  let connections

  before(() => {
    return P.all([ redis.acquire(), redis.acquire() ])
      .then(results => connections = results)
  })

  after(() => {
    return P.all(connections.map(connection => redis.release(connection)))
      .then(() => redis.drain())
      .then(() => redis.clear())
  })

  it('first connection reads null', () => {
    return connections[0].get('foo')
      .then(result => assert.ok(result === null))
  })

  it('second connection reads null', () => {
    return connections[1].get('foo')
      .then(result => assert.ok(result === null))
  })

  describe('connection.set:', () => {
    before(() => {
      return connections[0].set('foo', 'bar')
    })

    it('first connection reads data', () => {
      return connections[0].get('foo')
        .then(result => assert.equal(result, 'bar'))
    })

    it('second connection reads data', () => {
      return connections[1].get('foo')
        .then(result => assert.equal(result, 'bar'))
    })
  })

  describe('concurrent sets:', () => {
    before(() => {
      return P.all(connections.map((connection, index) => connection.set('foo', `${index}`)))
    })

    it('data was set', () => {
      return connections[0].get('foo')
        .then(result => assert.ok(result === '0' || result === '1'))
    })
  })

  describe('connection.update:', () => {
    before(() => {
      return connections[0].update('foo', oldValue => `${oldValue}2`)
    })

    it('first connection reads data', () => {
      return connections[0].get('foo')
        .then(result => assert.equal(result[1], '2'))
    })

    it('second connection reads data', () => {
      return connections[1].get('foo')
        .then(result => assert.equal(result[1], '2'))
    })
  })

  describe('update non-existent key:', () => {
    before(() => {
      return connections[0].update('wibble', () => 'blee')
    })

    it('data was updated', () => {
      return connections[1].get('wibble')
        .then(result => assert.equal(result, 'blee'))
    })
  })

  describe('update existing key to falsey value:', () => {
    before(() => {
      return connections[0].update('wibble', () => '')
    })

    it('data was updated', () => {
      return connections[1].get('wibble')
        .then(result => assert.ok(result === null))
    })
  })

  describe('concurrent updates of the same key:', () => {
    const errors = []
    let successIndex

    before(() => {
      return P.all(
        connections.map(
          (connection, index) => {
            return connection.update('foo', () => `${index}`)
              .then(() => successIndex = index)
              .catch(error => errors.push(error))
          }
        )
      )
    })

    it('one update failed', () => {
      assert.equal(errors.length, 1)
      assert.equal(errors[0].message, 'Unspecified error')
      assert.equal(errors[0].errno, 999)
    })

    it('the other update completed successfully', () => {
      return connections[0].get('foo')
        .then(result => assert.equal(result, successIndex))
    })
  })

  describe('concurrent updates of different keys:', () => {
    before(() => {
      return P.all([
        connections[0].update('foo', () => 'bar'),
        connections[1].update('baz', () => 'qux')
      ])
    })

    it('first update completed successfully', () => {
      return connections[1].get('foo')
        .then(result => assert.equal(result, 'bar'))
    })

    it('second update completed successfully', () => {
      return connections[0].get('baz')
        .then(result => assert.equal(result, 'qux'))
    })
  })

  describe('reentrant updates of different keys:', () => {
    let error

    before(() => {
      return P.all([
        connections[0].update('foo', oldValue => `${oldValue}2`),
        connections[0].update('baz', oldValue => `${oldValue}2`).catch(e => error = e)
      ])
    })

    it('first update completed successfully', () => {
      return connections[0].get('foo')
        .then(result => assert.equal(result, 'bar2'))
    })

    it('second update failed', () => {
      assert.ok(error)
      assert.equal(error.message, 'Unspecified error')
      assert.equal(error.errno, 999)
      return connections[0].get('baz')
        .then(result => assert.equal(result, 'qux'))
    })
  })

  describe('set concurrently with update:', () => {
    let error

    before(() => {
      return P.all([
        connections[0].update('foo', () => 'wibble').catch(e => error = e),
        connections[1].set('foo', 'blee')
      ])
    })

    it('update failed', () => {
      assert.ok(error)
      assert.equal(error.message, 'Unspecified error')
      assert.equal(error.errno, 999)
    })

    it('data was set', () => {
      return connections[0].get('foo')
        .then(result => assert.equal(result, 'blee'))
    })
  })

  describe('connection.del:', () => {
    before(() => {
      return connections[0].del('foo')
    })

    it('first connection reads null', () => {
      return connections[0].get('foo')
        .then(result => assert.ok(result === null))
    })

    it('second connection reads null', () => {
      return connections[1].get('foo')
        .then(result => assert.ok(result === null))
    })
  })

  describe('del concurrently with update:', () => {
    let error

    before(() => {
      return connections[0].set('foo', 'bar')
        .then(() => P.all([
          connections[0].update('foo', () => 'baz').catch(e => error = e),
          connections[1].del('foo')
        ]))
    })

    it('update failed', () => {
      assert.ok(error)
      assert.equal(error.message, 'Unspecified error')
      assert.equal(error.errno, 999)
    })

    it('data was deleted', () => {
      return connections[0].get('foo')
        .then(result => assert.ok(result === null))
    })
  })
})

