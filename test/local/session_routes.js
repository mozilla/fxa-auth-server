/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require('ass')

var error = require('../../lib/error')
var getRoute = require('../routes_helpers').getRoute
var isA = require('joi')
var mocks = require('../mocks')
var P = require('../../lib/promise')
var sinon = require('sinon')
var test = require('../ptaptest')

test(
  '/session/destroy emits removes metrics context',
  function (t) {
    var mockMetricsContext = {
      remove: sinon.spy()
    }
    var mockRequest = {
      auth: {
        credentials: {}
      },
      headers: {},
      payload: {},
      query: {}
    }
    var sessionRoutes = makeRoutes({
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(sessionRoutes, '/session/destroy')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockMetricsContext.remove.callCount, 1)
        t.equal(mockMetricsContext.remove.args[0].length, 1)
        t.equal(mockMetricsContext.remove.args[0][0], mockRequest.auth.credentials)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

function makeRoutes (options) {
  options = options || {}

  var log = options.log || mocks.mockLog()
  var config = options.config || {}

  return require('../../lib/routes/session')(
    log,
    isA,
    error,
    options.db || {
      deleteSessionToken: function () {
        return P.resolve()
      }
    },
    options.metricsContext || require('../../lib/metrics/context')(log, config)
  )
}

