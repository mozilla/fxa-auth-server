/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var sinon = require('sinon')

var test = require('tap').test
var mocks = require('../mocks')
var getRoute = require('../routes_helpers').getRoute
var proxyquire = require('proxyquire')

var P = require('../../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')
var isA = require('joi')
var error = require('../../lib/error')
var log = require('../../lib/log')

var TEST_EMAIL = 'foo@gmail.com'

var makeRoutes = function (options, requireMocks) {
  options = options || {}

  var config = options.config || {}
  config.verifierVersion = config.verifierVersion || 0
  config.smtp = config.smtp || {}
  config.memcached = config.memcached || {
    address: '127.0.0.1:1121',
    idle: 500,
    lifetime: 30
  }
  config.i18n = {
    supportedLanguages: ['en'],
    defaultLanguage: 'en'
  }
  config.lastAccessTimeUpdates = {}
  config.signinConfirmation = config.signinConfirmation || {}
  config.signinUnblock = config.signinUnblock || {}

  var log = options.log || mocks.mockLog()
  var Password = options.Password || require('../../lib/crypto/password')(log, config)
  var db = options.db || mocks.mockDB()
  var isPreVerified = require('../../lib/preverifier')(error, config)
  var customs = options.customs || {
    check: function () {
      return P.resolve(true)
    }
  }
  var checkPassword = options.checkPassword || require('../../lib/routes/utils/password_check')(log, config, Password, customs, db)
  var push = options.push || require('../../lib/push')(log, db, {})
  return proxyquire('../../lib/routes/account', requireMocks || {})(
    log,
    require('../../lib/crypto/random'),
    P,
    uuid,
    isA,
    error,
    db,
    options.mailer || {},
    Password,
    config,
    customs,
    isPreVerified,
    checkPassword,
    push,
    options.devices || require('../../lib/devices')(log, db, push)
  )
}

function runTest(route, request, assertions) {
  return new P(function (resolve) {
    route.handler(request, function (response) {
      resolve(response)
    })
  })
    .then(assertions)
}

test('IP Profiling', function (t) {
  t.plan(2)
  var config = {
    newLoginNotificationEnabled: true,
    securityHistory: {
      enabled: true,
      ipProfiling: {
        enabled: true
      }
    },
    signinConfirmation: {
      enabledEmailAddresses: /^.*$/,
      enabled: true
    },
    signinUnblock: {
      enabled: false
    }
  }
  // We want to test what's actually written to stdout by the logger.
  const mockLog = log('ERROR', 'test', {
    stdout: {
      on: sinon.spy(),
      write: sinon.spy()
    },
    stderr: {
      on: sinon.spy(),
      write: sinon.spy()
    }
  })
  mockLog.activityEvent = sinon.spy(() => {
    return P.resolve()
  })
  mockLog.flowEvent = sinon.spy(() => {
    return P.resolve()
  })
  const mockMetricsContext = mocks.mockMetricsContext({
    gather: sinon.spy(function (data) {
      return P.resolve(this.payload && this.payload.metricsContext)
    })
  })
  const mockRequest = mocks.mockRequest({
    log: mockLog,
    metricsContext: mockMetricsContext,
    payload: {
      authPW: crypto.randomBytes(32).toString('hex'),
      email: TEST_EMAIL,
      service: 'sync',
      reason: 'signin',
      metricsContext: {
        context: 'fx_desktop_v3',
        flowBeginTime: Date.now(),
        flowId: 'F1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF103',
        entrypoint: 'preferences',
        utmContent: 'some-content-string'
      }
    },
    query: {
      keys: 'true'
    }
  })
  var keyFetchTokenId = crypto.randomBytes(16)
  var sessionTokenId = crypto.randomBytes(16)
  var uid = uuid.v4('binary')
  var mockDB = mocks.mockDB({
    email: TEST_EMAIL,
    emailVerified: true,
    keyFetchTokenId: keyFetchTokenId,
    sessionTokenId: sessionTokenId,
    uid: uid
  })
  var mockMailer = mocks.mockMailer()
  var mockPush = mocks.mockPush()
  var mockCustoms = {
    check: () => P.resolve(),
    flag: () => P.resolve()
  }

  mockDB.emailRecord = function () {
    return P.resolve({
      authSalt: crypto.randomBytes(32),
      data: crypto.randomBytes(32),
      email: TEST_EMAIL,
      emailVerified: true,
      kA: crypto.randomBytes(32),
      lastAuthAt: function () {
        return Date.now()
      },
      uid: uid,
      wrapWrapKb: crypto.randomBytes(32)
    })
  }

  t.test('disabled', function (t) {
    config.securityHistory.ipProfiling.enabled = false

    var accountRoutes = makeRoutes({
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: mockCustoms,
      db: mockDB,
      log: mockLog,
      mailer: mockMailer,
      push: mockPush
    })

    mockDB.securityEvents = function () {
      return P.resolve([
        {
          name: 'account.login',
          createdAt: Date.now(),
          verified: true
        }
      ])
    }

    var route = getRoute(accountRoutes, '/account/login')

    return runTest(route, mockRequest, function (response) {
      t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
    }).then(function () {
      mockMailer.sendVerifyLoginEmail.reset()
    })
  })

  t.test('enabled', function (t) {
    t.plan(2)
    config.securityHistory.ipProfiling.enabled = true

    var accountRoutes = makeRoutes({
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: mockCustoms,
      db: mockDB,
      log: mockLog,
      mailer: mockMailer,
      push: mockPush
    })

    t.test('no previously verified session', function (t) {
      mockDB.securityEvents = function () {
        return P.resolve([
          {
            name: 'account.login',
            createdAt: Date.now(),
            verified: false
          }
        ])
      }

      var route = getRoute(accountRoutes, '/account/login')
      return runTest(route, mockRequest, function (response) {
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 1, 'mailer.sendVerifyLoginEmail was called')
        t.equal(response.verified, false, 'session not verified')

      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
      })
    })

    t.test('previously verified session', function (t) {
      mockDB.securityEvents = function () {
        return P.resolve([
          {
            name: 'account.login',
            createdAt: Date.now(),
            verified: true
          }
        ])
      }

      var route = getRoute(accountRoutes, '/account/login')
      return runTest(route, mockRequest, function (response) {
        t.equal(mockMailer.sendVerifyLoginEmail.callCount, 0, 'mailer.sendVerifyLoginEmail was not called')
        t.equal(mockMailer.sendNewDeviceLoginNotification.callCount, 1, 'mailer.sendNewDeviceLoginNotification was called')
        t.equal(response.verified, true, 'session verified')

      }).then(function () {
        mockMailer.sendVerifyLoginEmail.reset()
      })
    })
  })
})
