/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const getRoute = require('../../routes_helpers').getRoute
const isA = require('joi')
const mocks = require('../../mocks')
const P = require('../../../lib/promise')

function makeRoutes (options) {
  options = options || {}
  const log = options.log || mocks.mockLog()
  return require('../../../lib/routes/sms')(log, isA)
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

describe('/sms', () => {
  let log, request

  beforeEach(() => {
    log = mocks.spyLog()
    request = mocks.mockRequest({
      payload: {
        phoneNumber: '12002000000',
        messageId: 42,
        metricsContext: {
          flowBeginTime: Date.now(),
          flowId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        }
      }
    })
    const routes = makeRoutes({ log })
    const route = getRoute(routes, '/sms')
    return runTest(route, request)
  })

  it('called log.begin correctly', () => {
    assert.equal(log.begin.callCount, 1)
    const args = log.begin.args[0]
    assert.equal(args.length, 2)
    assert.equal(args[0], 'sms.send')
    assert.equal(args[1], request)
  })

  it('called request.validateMetricsContext correctly', () => {
    assert.equal(request.validateMetricsContext.callCount, 1)
    const args = request.validateMetricsContext.args[0]
    assert.equal(args.length, 0)
  })
})

