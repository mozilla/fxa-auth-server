/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const getRoute = require('../../routes_helpers').getRoute
const mocks = require('../../mocks')
const P = require('../../../lib/promise')

describe('/signinCodes/consume:', () => {
  let log, db, customs, routes, route, request

  describe('success:', () => {
    beforeEach(() => setup())

    it('called log.begin correctly', () => {
      assert.equal(log.begin.callCount, 1)
      const args = log.begin.args[0]
      assert.equal(args.length, 2)
      assert.equal(args[0], 'signinCodes.consume')
      assert.equal(args[1], request)
    })

    it('called request.validateMetricsContext correctly', () => {
      assert.equal(request.validateMetricsContext.callCount, 1)
      const args = request.validateMetricsContext.args[0]
      assert.equal(args.length, 0)
    })

    it('called customs.checkIpOnly correctly', () => {
      assert.equal(customs.checkIpOnly.callCount, 1)
      const args = customs.checkIpOnly.args[0]
      assert.equal(args.length, 2)
      assert.equal(args[0], request)
      assert.equal(args[1], 'consumeSigninCode')
    })

    it('called db.consumeSigninCode correctly', () => {
      assert.equal(db.consumeSigninCode.callCount, 1)
      const args = db.consumeSigninCode.args[0]
      assert.equal(args.length, 1)
      assert.ok(Buffer.isBuffer(args[0]))
      assert.equal(args[0].toString('base64'), '++//ff0=')
    })

    it('called log.flowEvent correctly', () => {
      assert.equal(log.flowEvent.callCount, 1)

      const args = log.flowEvent.args[0]
      assert.equal(args.length, 1)
      assert.equal(args[0].event, 'signinCode.consumed')
      assert.equal(args[0].flow_id, request.payload.metricsContext.flowId)
    })
  })

  describe('db error:', () => {
    beforeEach(() => setup({ db: { consumeSigninCode: 'foo' } }))

    it('called log.begin', () => {
      assert.equal(log.begin.callCount, 1)
    })

    it('called request.validateMetricsContext', () => {
      assert.equal(request.validateMetricsContext.callCount, 1)
    })

    it('called customs.checkIpOnly', () => {
      assert.equal(customs.checkIpOnly.callCount, 1)
    })

    it('called db.consumeSigninCode', () => {
      assert.equal(db.consumeSigninCode.callCount, 1)
    })

    it('did not call log.flowEvent', () => {
      assert.equal(log.flowEvent.callCount, 0)
    })
  })

  describe('customs error:', () => {
    beforeEach(() => setup({ customs: { checkIpOnly: 'foo' } }))

    it('called log.begin', () => {
      assert.equal(log.begin.callCount, 1)
    })

    it('called request.validateMetricsContext', () => {
      assert.equal(request.validateMetricsContext.callCount, 1)
    })

    it('called customs.checkIpOnly', () => {
      assert.equal(customs.checkIpOnly.callCount, 1)
    })

    it('did not call db.consumeSigninCode', () => {
      assert.equal(db.consumeSigninCode.callCount, 0)
    })

    it('did not call log.flowEvent', () => {
      assert.equal(log.flowEvent.callCount, 0)
    })
  })

  function setup (errors) {
    errors = errors || {}

    log = mocks.spyLog()
    db = mocks.mockDB(null, errors.db)
    customs = mocks.mockCustoms(errors.customs)
    routes = makeRoutes({ log, db, customs })
    route = getRoute(routes, '/signinCodes/consume')
    request = mocks.mockRequest({
      log: log,
      payload: {
        code: '--__ff0',
        metricsContext: {
          flowBeginTime: Date.now(),
          flowId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        }
      }
    })
    return runTest(route, request)
  }
})

function makeRoutes (options) {
  options = options || {}
  const log = options.log || mocks.mockLog()
  const db = options.db || mocks.mockDb()
  const customs = options.customs || mocks.mockCustoms()
  return require('../../../lib/routes/signin-codes')(log, db, { signinCodeSize: 6 }, customs)
}

function runTest (route, request) {
  return new P((resolve, reject) => {
    route.handler(request, response => {
      if (response instanceof Error) {
        reject(response)
      } else {
        resolve(response)
      }
    })
  })
}

