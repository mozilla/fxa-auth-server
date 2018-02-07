/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const ROOT_DIR = '../../..'

const assert = require('insist')
const proxyquire = require('proxyquire')
const sinon = require('sinon')

const FIREFOX_CLIENT = {
  name: 'Firefox'
}
const OAUTH_CLIENT = {
  id: '24bdbfa45cd300c5',
  name: 'FxA OAuth Console',
  trusted: true
}

describe('lib/senders/client_name:', () => {

  describe('fetchClientData:', () => {
    let mocks = {}
    let fetchClientData
    let mockLog

    beforeEach(() => {
      fetchClientData = require(`${ROOT_DIR}/lib/senders/client_name`).fetchClientData
      mockLog = {
        fatal: sinon.spy(),
        trace: sinon.spy(),
        critical: sinon.spy()
      }
    })

    it('returns Firefox if no client id', () => {
      return fetchClientData().then((res) => {
        assert.deepEqual(res, FIREFOX_CLIENT)
      })
    })

    it('returns Firefox if no client id', () => {
      return fetchClientData('sync').then((res) => {
        assert.deepEqual(res, FIREFOX_CLIENT)
      })
    })

    it('falls back to Firefox if error', () => {
      mocks = {
        'request': function (options, cb) {
          cb(new Error('Request failed'))
        },
        './log': function() {
          return mockLog
        }
      }

      fetchClientData = proxyquire(`${ROOT_DIR}/lib/senders/client_name`, mocks).fetchClientData

      return fetchClientData('24bdbfa45cd300c5').then((res) => {
        assert.deepEqual(res, FIREFOX_CLIENT)
        assert.ok(mockLog.critical.calledOnce, 'called critical log')
      })
    })

    it('fetches and memory caches client information', () => {
      mocks = {
        'request': function (options, cb) {
          assert.equal(options.url, 'http://localhost:9010/v1/client/24bdbfa45cd300c5')
          assert.equal(options.method, 'GET')
          assert.equal(options.json, true)
          cb(null, {}, OAUTH_CLIENT)
        },
        './log': function() {
          return mockLog
        }
      }

      fetchClientData = proxyquire(`${ROOT_DIR}/lib/senders/client_name`, mocks).fetchClientData

      return fetchClientData('24bdbfa45cd300c5').then((res) => {
        assert.deepEqual(res, OAUTH_CLIENT)
        assert.equal(mockLog.trace.getCall(0).args[0].op, 'fetchClientData.start')
        assert.equal(mockLog.trace.getCall(1).args[0].op, 'fetchClientData.usedServer')
        assert.equal(mockLog.trace.getCall(2), null)

        // second call is cached
        return fetchClientData('24bdbfa45cd300c5')
      }).then((res) => {
        assert.equal(mockLog.trace.getCall(2).args[0].op, 'fetchClientData.start')
        assert.equal(mockLog.trace.getCall(3).args[0].op, 'fetchClientData.usedCache')
        assert.deepEqual(res, OAUTH_CLIENT)
      })

    })

  })
})

