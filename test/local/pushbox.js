/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const ROOT_DIR = '../..'

const assert = require('insist')
const proxyquire = require('proxyquire')
const sinon = require('sinon')
const {mockLog} = require('../mocks')
const mockConfig = {
  pushbox: {
    enabled: true,
    url: 'https://foo.bar',
    key: 'foo'
  }
}
const mockDeviceIds = ['bogusid1', 'bogusid2', 'bogusid3']
const mockData = 'eyJmb28iOiAiYmFyIn0'
const mockUid = 'myuid'
const pushboxModulePath = `${ROOT_DIR}/lib/pushbox`

describe('pushbox', () => {
  it(
    'retrieve',
    () => {
      const FakePool = function() {}
      const getSpy = sinon.spy(() => Promise.resolve({
        last: true,
        index: '15',
        messages: [{
          index: '15',
          data: 'eyJmb28iOiJiYXIiLCAiYmFyIjogImJhciJ9'
        }]
      }))
      FakePool.prototype.get = getSpy
      const mocks = {
        './pool': FakePool
      }
      const pushbox = proxyquire(pushboxModulePath, mocks)(mockLog(), mockConfig)

      return pushbox.retrieve(mockUid, mockDeviceIds[0], 50, 10)
        .then(() => {
          assert.equal(getSpy.callCount, 1, 'get request was made')
          const args = getSpy.args[0]
          assert.equal(args.length, 3)
          assert.equal(args[0]._template.toString(), '/v1/store/:uid/:deviceId')
          assert.deepEqual(args[1], {uid: mockUid, deviceId: mockDeviceIds[0]})
          assert.deepEqual(args[2], {query: {limit:50, index:10}, headers: {Authorization: `FxA-Server-Key ${mockConfig.pushbox.key}`}})
        })
    }
  )

  it(
    'retrieve validates the pushbox server response',
    () => {
      const FakePool = function() {}
      const getSpy = sinon.spy(() => Promise.resolve({
        'bogus':'object'
      }))
      FakePool.prototype.get = getSpy
      const mocks = {
        './pool': FakePool
      }
      const pushbox = proxyquire(pushboxModulePath, mocks)(mockLog(), mockConfig)

      return pushbox.retrieve(mockUid, mockDeviceIds[0], 50, 10)
        .then(() => assert.ok(false, 'should not happen'), (err) => {
          assert.ok(err)
          assert.equal(err.message, 'Invalid Pushbox response')
        })
    }
  )

  it(
    'store',
    () => {
      const mockTopic = 'sendtab'
      const FakePool = function() {}
      const postSpy = sinon.spy(() => Promise.resolve({index: 'yay'}))
      FakePool.prototype.post = postSpy
      const mocks = {
        './pool': FakePool
      }
      const pushbox = proxyquire(pushboxModulePath, mocks)(mockLog(), mockConfig)

      return pushbox.store(mockUid, mockDeviceIds[0], mockTopic, mockData)
        .then(msgUrl => {
          assert.equal(postSpy.callCount, 1, 'post request was made')
          const args = postSpy.args[0]
          assert.equal(args.length, 4)
          assert.equal(args[0]._template.toString(), '/v1/store/:uid/:deviceId')
          assert.deepEqual(args[1], {uid: mockUid, deviceId: mockDeviceIds[0]})
          assert.deepEqual(args[2], {data: mockData, ttl: 2592000})
          assert.deepEqual(args[3], {headers: {Authorization: `FxA-Server-Key ${mockConfig.pushbox.key}`}})

          assert.equal(msgUrl, `${mockConfig.pushbox.url}/v1/store/myuid/bogusid1?index=yay&limit=1`, 'returned URL is correct')
        })
    }
  )

  it(
    'feature disabled',
    () => {
      const FakePool = function() {}
      const postSpy = sinon.spy()
      const getSpy = sinon.spy()
      FakePool.prototype.post = postSpy
      FakePool.prototype.get = getSpy
      const mocks = {
        './pool': FakePool
      }
      const config = Object.assign({}, mockConfig, {
        pushbox: {enabled: false}
      })
      const pushbox = proxyquire(pushboxModulePath, mocks)(mockLog(), config)

      return pushbox.store(mockUid, mockDeviceIds[0], 'sendtab', mockData)
        .then(() => assert.ok(false, 'should not happen'), (err) => {
          assert.ok(err)
          assert.equal(err.message, 'Feature not enabled')
        })
        .then(() => pushbox.retrieve(mockUid, mockDeviceIds[0], 50, 10))
        .then(() => assert.ok(false, 'should not happen'), (err) => {
          assert.ok(err)
          assert.equal(err.message, 'Feature not enabled')
        })
    }
  )

})
