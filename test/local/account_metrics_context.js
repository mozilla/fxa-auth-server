/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require('ass')

var sinon = require('sinon')

var test = require('../ptaptest')
var mocks = require('../mocks')
var getRoute = require('../routes_helpers').getRoute

var P = require('../../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')
var isA = require('joi')
var error = require('../../lib/error')
var log = require('../../lib/log')

var TEST_EMAIL = 'foo@gmail.com'
var TEST_ALLOW_EMAIL = 'foo@restmail.net'

var VALID_FLOWID = '448bf8ce8de255578882c6c72ce7126c5859cb441545f77fc33f1a1cd1b3feec'
var INVALID_FLOWID = '448bf8ce8de255578882c6c72ce7126c5859cb441545f77fc33f1a1cd1b3fbad'

var TEST_UAAGENT = 'test-user-agent'
var TEST_ALLOW_UAAGENT = 'Firefox.+SBrowser'

var makeRoutes = function (options) {
  options = options || {}

  var config = options.config || {}
  config.verifierVersion = config.verifierVersion || 0
  config.smtp = config.smtp || {}
  config.metrics = config.metrics || {}

  var log = options.log || mocks.mockLog()
  var Password = require('../../lib/crypto/password')(log, config)
  var db = options.db || {}
  var isPreVerified = require('../../lib/preverifier')(error, config)
  var customs = options.customs || {
      check: function () {
        return P.resolve(true)
      }
    }
  var checkPassword = options.checkPassword || require('../../lib/routes/utils/password_check')(log, config, Password, customs, db)
  var push = options.push || require('../../lib/push')(log, db)
  var metricsContext = require('../../lib/metrics/context')(log, config)
  return require('../../lib/routes/account')(
    log,
    crypto,
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
    metricsContext
  )
}

function createMockRequest(email, flowId, userAgent) {
  return {
    app: {
      acceptLangage: 'en-US'
    },
    headers: {
      'user-agent': userAgent || TEST_UAAGENT
    },
    query: {
      keys: false
    },
    payload: {
      email: email,
      authPW: crypto.randomBytes(32).toString('hex'),
      service: 'sync',
      reason: 'signin',
      metricsContext: {
        flowId: flowId,
        flowBeginTime: 1451566800000,
        entrypoint: 'preferences',
        utmContent: 'some-content-string'
      }
    }
  }
}

function createMockDB(email) {
  var uid = uuid.v4('binary')
  return {
    emailRecord: sinon.spy(function () {
      return P.resolve({
        uid: uid,
        email: email,
        emailVerified: true
      })
    }),
    createSessionToken: sinon.spy(function () {
      return P.resolve({
        uid: uid,
        email: email,
        emailVerified: true,
        data: crypto.randomBytes(16),
        lastAuthAt: function () {
          return 0
        }
      })
    }),
    sessions: sinon.spy(function () {
      return P.resolve([{}, {}, {}])
    })
  }
}

test(
  'login event, allow email with valid metrics context data',
  function (t) {
    var mockRequest = createMockRequest(TEST_ALLOW_EMAIL, VALID_FLOWID, TEST_UAAGENT)
    var mockDB = createMockDB(TEST_ALLOW_EMAIL)
    // We want to test what's actually written to stdout by the logger.
    var mockLog = log('ERROR', 'test', {
      stdout: {
        on: sinon.spy(),
        write: sinon.spy()
      },
      stderr: {
        on: sinon.spy(),
        write: sinon.spy()
      }
    })

    var config = require('../../config').getProperties()
    config.metrics.force_flow_validation = true
    config.metrics.flow_id_expiry = 1451566800010

    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: {
        flag: function () {
          return P.resolve()
        },
        check: function () {
          return P.resolve(true)
        }
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function (response) {
          resolve(response)
        })
    })
      .then(function (response) {
        t.ok(response.sessionToken, 'sessionToken received')
        t.ok(response.uid, 'uid received')
        t.ok(response.verified, 'verified received')
      })
      .catch(function (err) {
        t.fail(err)
      })
      .finally(function () {
        mockLog.close()
      })
  }
)

test(
  'login event, allow email with invalid metrics context data',
  function (t) {
    var mockRequest = createMockRequest(TEST_ALLOW_EMAIL, INVALID_FLOWID)
    var mockDB = createMockDB(TEST_ALLOW_EMAIL)
    // We want to test what's actually written to stdout by the logger.
    var mockLog = log('ERROR', 'test', {
      stdout: {
        on: sinon.spy(),
        write: sinon.spy()
      },
      stderr: {
        on: sinon.spy(),
        write: sinon.spy()
      }
    })

    var config = require('../../config').getProperties()
    config.metrics.force_flow_validation = true
    config.metrics.flow_id_expiry = 1451566800010

    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: {
        flag: function () {
          return P.resolve()
        },
        check: function () {
          return P.resolve(true)
        }
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function (response) {
          resolve(response)
        })
    })
      .then(function (response) {
        t.ok(response.sessionToken, 'sessionToken received')
        t.ok(response.uid, 'uid received')
        t.ok(response.verified, 'verified received')
      })
      .catch(function (err) {
        t.fail(err)
      })
      .finally(function () {
        mockLog.close()
      })
  }
)

test(
  'login event, block request with invalid metrics context data',
  function (t) {
    var mockRequest = createMockRequest(TEST_EMAIL, INVALID_FLOWID)
    var mockDB = createMockDB(TEST_EMAIL)
    // We want to test what's actually written to stdout by the logger.
    var mockLog = log('ERROR', 'test', {
      stdout: {
        on: sinon.spy(),
        write: sinon.spy()
      },
      stderr: {
        on: sinon.spy(),
        write: sinon.spy()
      }
    })

    var config = require('../../config').getProperties()
    config.metrics.force_flow_validation = true
    config.metrics.flow_id_expiry = 1451566800010

    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: {
        flag: function () {
          return P.resolve()
        },
        check: function () {
          return P.resolve(true)
        }
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function (response) {
          resolve(response)
        })
    })
      .then(function () {
        t.fail('Failed to block request')
      })
      .catch(function (err) {
        t.equal(err.errno, 125, 'request error')
        t.equal(err.message, 'The request was blocked for security reasons', 'request error message')
      })
      .finally(function () {
        mockLog.close()
      })
  }
)

test(
  'login event, allow request with valid metrics context data',
  function (t) {
    var mockRequest = createMockRequest(TEST_EMAIL, VALID_FLOWID)
    var mockDB = createMockDB(TEST_EMAIL)
    // We want to test what's actually written to stdout by the logger.
    var mockLog = log('ERROR', 'test', {
      stdout: {
        on: sinon.spy(),
        write: sinon.spy()
      },
      stderr: {
        on: sinon.spy(),
        write: sinon.spy()
      }
    })

    var config = require('../../config').getProperties()
    config.metrics.force_flow_validation = true
    config.metrics.flow_id_expiry = 1451566800010

    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: {
        flag: function () {
          return P.resolve()
        },
        check: function () {
          return P.resolve(true)
        }
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function (response) {
          resolve(response)
        })
    })
      .then(function (response) {
        t.ok(response.sessionToken, 'sessionToken received')
        t.ok(response.uid, 'uid received')
        t.ok(response.verified, 'verified received')
      })
      .catch(function (err) {
        t.fail(err)
      })
      .finally(function () {
        mockLog.close()
      })
  }
)

test(
  'login event, allow user agent, invalid metrics context data',
  function (t) {
    var mockRequest = createMockRequest(TEST_EMAIL, INVALID_FLOWID, TEST_ALLOW_UAAGENT)
    var mockDB = createMockDB(TEST_EMAIL)
    // We want to test what's actually written to stdout by the logger.
    var mockLog = log('ERROR', 'test', {
      stdout: {
        on: sinon.spy(),
        write: sinon.spy()
      },
      stderr: {
        on: sinon.spy(),
        write: sinon.spy()
      }
    })

    var config = require('../../config').getProperties()
    config.metrics.force_flow_validation = true
    config.metrics.flow_id_expiry = 1451566800010

    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: {
        flag: function () {
          return P.resolve()
        },
        check: function () {
          return P.resolve(true)
        }
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function (response) {
          resolve(response)
        })
    })
      .then(function (response) {
        t.ok(response.sessionToken, 'sessionToken received')
        t.ok(response.uid, 'uid received')
        t.ok(response.verified, 'verified received')
      })
      .catch(function (err) {
        t.fail(err)
      })
      .finally(function () {
        mockLog.close()
      })
  }
)

test(
  'login event, allow user agent, valid metrics context data',
  function (t) {
    var mockRequest = createMockRequest(TEST_EMAIL, VALID_FLOWID, TEST_ALLOW_UAAGENT)
    var mockDB = createMockDB(TEST_EMAIL)
    // We want to test what's actually written to stdout by the logger.
    var mockLog = log('ERROR', 'test', {
      stdout: {
        on: sinon.spy(),
        write: sinon.spy()
      },
      stderr: {
        on: sinon.spy(),
        write: sinon.spy()
      }
    })

    var config = require('../../config').getProperties()
    config.metrics.force_flow_validation = true
    config.metrics.flow_id_expiry = 1451566800010

    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      config: config,
      customs: {
        flag: function () {
          return P.resolve()
        },
        check: function () {
          return P.resolve(true)
        }
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function (response) {
          resolve(response)
        })
    })
      .then(function (response) {
        t.ok(response.sessionToken, 'sessionToken received')
        t.ok(response.uid, 'uid received')
        t.ok(response.verified, 'verified received')
      })
      .catch(function (err) {
        t.fail(err)
      })
      .finally(function () {
        mockLog.close()
      })
  }
)
