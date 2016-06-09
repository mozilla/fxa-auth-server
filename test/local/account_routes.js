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
var TEST_EMAIL_INVALID = 'example@dotless-domain'

var makeRoutes = function (options) {
  options = options || {}

  var config = options.config || {}
  config.verifierVersion = config.verifierVersion || 0
  config.smtp = config.smtp ||  {}
  config.memcached = config.memcached || {
    address: '127.0.0.1:1121',
    idle: 500,
    lifetime: 30
  }

  var log = options.log || mocks.mockLog()
  var Password = options.Password || require('../../lib/crypto/password')(log, config)
  var db = options.db || mocks.mockDb()
  var isPreVerified = require('../../lib/preverifier')(error, config)
  var customs = options.customs || {
    check: function () { return P.resolve(true) }
  }
  var checkPassword = options.checkPassword || require('../../lib/routes/utils/password_check')(log, config, Password, customs, db)
  var push = options.push || require('../../lib/push')(log, db)
  var metricsContext = options.metricsContext || log.metricsContext || require('../../lib/metrics/context')(log, config)
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

test(
  'account with unverified invalid email gets deleted on status poll',
  function (t) {
    var mockDB = mocks.mockDb()
    var mockRequest = {
      auth: {
        credentials: {
          email: TEST_EMAIL_INVALID,
          emailVerified: false
        }
      }
    }

    var accountRoutes = makeRoutes({
      db: mockDB
    })
    var route = getRoute(accountRoutes, '/recovery_email/status')

    return new P(function(resolve) {
      route.handler(mockRequest, function(response) {
        resolve(response)
      })
    })
    .then(function(response) {
      t.equal(mockDB.deleteAccount.callCount, 1)
      t.equal(mockDB.deleteAccount.firstCall.args[0].email, TEST_EMAIL_INVALID)
      t.equal(response.errno, error.ERRNO.INVALID_TOKEN)
    })
  }
)

test(
  'account with verified invalid email does not get deleted on status poll',
  function (t) {
    var mockDB = mocks.mockDb()
    var mockRequest = {
      auth: {
        credentials: {
          email: TEST_EMAIL_INVALID,
          emailVerified: true
        }
      }
    }

    var accountRoutes = makeRoutes({
      db: mockDB
    })
    var route = getRoute(accountRoutes, '/recovery_email/status')

    return new P(function(resolve) {
      route.handler(mockRequest, function(response) {
        resolve(response)
      })
    })
    .then(function(response) {
      t.equal(mockDB.deleteAccount.callCount, 0)
      t.deepEqual(response, {
        email: TEST_EMAIL_INVALID,
        verified: true
      })
    })
  }
)

test(
  '/recovery_email/status logs query reason',
  function (t) {
    var pushCalled = false
    var mockLog = mocks.mockLog({
      increment: function (name) {
        if (name === 'recovery_email_reason.push') {
          pushCalled = true
        }
      }
    })
    var mockRequest = {
      auth: {
        credentials: {
          email: TEST_EMAIL,
          emailVerified: true
        }
      },
      query: {
        reason: 'push'
      }
    }
    var accountRoutes = makeRoutes({
      log: mockLog
    })

    getRoute(accountRoutes, '/recovery_email/status')
      .handler(mockRequest, function() {
        t.equal(pushCalled, true)
        t.end()
      })
  }
)

test(
  'device should be notified when the account is reset',
  function (t) {
    var uid = uuid.v4('binary')
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex')
        }
      },
      payload: {
        authPW: crypto.randomBytes(32).toString('hex')
      }
    }
    var mockDB = mocks.mockDb({
      account: sinon.spy(function () {
        return P.resolve({
          uid: uid,
          verifierSetAt: 0,
          email: TEST_EMAIL
        })
      })
    })
    var mockCustoms = {
      reset: sinon.spy(function (email) {
        return P.resolve()
      })
    }
    var mockPush = {
      notifyUpdate: sinon.spy(function () {})
    }
    var accountRoutes = makeRoutes({
      db: mockDB,
      customs: mockCustoms,
      push: mockPush
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/reset')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function(response) {
      t.equal(mockDB.resetAccount.callCount, 1)

      t.equal(mockPush.notifyUpdate.callCount, 1)
      t.equal(mockPush.notifyUpdate.firstCall.args[0], uid.toString('hex'))
      t.equal(mockPush.notifyUpdate.firstCall.args[1], 'passwordReset')

      t.equal(mockDB.account.callCount, 1)
      t.equal(mockCustoms.reset.callCount, 1)
    })
  }
)

test(
  'device updates dont write to the db if nothing has changed',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16)
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
          deviceId: deviceId,
          deviceName: 'my awesome device',
          deviceType: 'desktop',
          deviceCallbackURL: '',
          deviceCallbackPublicKey: '',
        }
      },
      payload: {
        id: deviceId.toString('hex'),
        name: 'my awesome device'
      }
    }
    var mockDB = mocks.mockDb()
    var mockLog = mocks.spyLog()
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog
    })
    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function(response) {
      t.equal(mockDB.updateDevice.callCount, 0, 'updateDevice was not called')

      t.equal(mockLog.increment.callCount, 1, 'a counter was incremented')
      t.equal(mockLog.increment.firstCall.args[0], 'device.update.spurious')

      t.deepEqual(response, mockRequest.payload)
    })
  }
)

test(
  'device updates log metrics about what has changed',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16)
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
          tokenId: 'lookmumasessiontoken',
          deviceId: 'aDifferentDeviceId',
          deviceName: 'my awesome device',
          deviceType: 'desktop',
          deviceCallbackURL: '',
          deviceCallbackPublicKey: '',
        }
      },
      payload: {
        id: deviceId.toString('hex'),
        name: 'my even awesomer device',
        type: 'phone',
        pushCallback: 'https://push.services.mozilla.com/123456',
        pushPublicKey: 'SomeEncodedBinaryStuffThatDoesntGetValidedByThisTest'
      }
    }
    var mockDB = mocks.mockDb({
      updateDevice: sinon.spy(function (uid, sessionTokenId, deviceInfo) {
        return P.resolve(deviceInfo)
      })
    })
    var mockLog = mocks.spyLog()
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      metricsContext: {
        remove: function () {}
      },
      push: {
        notifyDeviceConnected: function () {}
      }
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function() {
      t.equal(mockDB.updateDevice.callCount, 1, 'updateDevice was called')

      t.equal(mockLog.increment.callCount, 5, 'the counters were incremented')
      t.equal(mockLog.increment.getCall(0).args[0], 'device.update.sessionToken')
      t.equal(mockLog.increment.getCall(1).args[0], 'device.update.name')
      t.equal(mockLog.increment.getCall(2).args[0], 'device.update.type')
      t.equal(mockLog.increment.getCall(3).args[0], 'device.update.pushCallback')
      t.equal(mockLog.increment.getCall(4).args[0], 'device.update.pushPublicKey')
    })
  }
)

test(
  'device should be notified when another device is registered',
  function (t) {
    var device = {
      name: 'My Phone',
      type: 'mobile',
      pushCallback: 'https://updates.push.services.mozilla.com/update/abcdef01234567890abcdefabcdef01234567890abcdef'
    }
    var uid = uuid.v4('binary')
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex')
        }
      },
      payload: device
    }
    var mockDB = mocks.mockDb({
      createDevice: sinon.spy(function () {
        device.id = crypto.randomBytes(16)
        return P.resolve(device)
      })
    })
    var mockPush = {
      notifyDeviceConnected: sinon.spy(function () {})
    }
    var accountRoutes = makeRoutes({
      db: mockDB,
      metricsContext: {
        remove: function () {}
      },
      push: mockPush
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function(response) {
      t.equal(mockDB.createDevice.callCount, 1)

      t.equal(mockPush.notifyDeviceConnected.callCount, 1)
      t.equal(mockPush.notifyDeviceConnected.firstCall.args[0], mockRequest.auth.credentials.uid)
      t.equal(mockPush.notifyDeviceConnected.firstCall.args[1], device.name)
      t.equal(mockPush.notifyDeviceConnected.firstCall.args[2], device.id.toString('hex'))
    })
  }
)

test(
  'device should be notified when it is remotely disconnected',
  function (t) {
    var deviceId = 'deviceId'
    var uid = uuid.v4('binary')
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex')
        }
      },
      payload: {
        id: deviceId
      }
    }
    var mockDB = {
      deleteDevice: sinon.spy(function () {
        return P.resolve({})
      })
    }
    var mockPush = {
      notifyDeviceDisconnected: sinon.spy(function () {
        return P.resolve(true)
      })
    }
    var accountRoutes = makeRoutes({
      db: mockDB,
      push: mockPush
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device/destroy')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function(response) {
      t.equal(mockDB.deleteDevice.callCount, 1)

      t.equal(mockPush.notifyDeviceDisconnected.callCount, 1)
      t.equal(mockPush.notifyDeviceDisconnected.firstCall.args[0], mockRequest.auth.credentials.uid)
      t.equal(mockPush.notifyDeviceDisconnected.firstCall.args[1], deviceId)
    })
  }
)

test(
  'device updates can be disabled via config',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16)
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
          deviceId: deviceId
        }
      },
      payload: {
        id: deviceId.toString('hex'),
        name: 'new device name'
      }
    }
    var accountRoutes = makeRoutes({
      config: {
        deviceUpdatesEnabled: false
      }
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(
      function(response) {
        t.fail('should have thrown')
      },
      function(err) {
        t.equal(err.output.statusCode, 503, 'correct status code is returned')
        t.equal(err.errno, error.ERRNO.FEATURE_NOT_ENABLED, 'correct errno is returned')
      }
    )
  }
)

test(
  'login event from /account/create includes metrics context data',
  function (t) {
    var mockRequest = {
      app: {
        acceptLangage: 'en-US'
      },
      headers: {
        'user-agent': 'test-user-agent'
      },
      payload: {
        email: TEST_EMAIL,
        authPW: crypto.randomBytes(32).toString('hex'),
        service: 'sync',
        metricsContext: {
          entrypoint: 'preferences',
          utmContent: 'some-content-string'
        }
      }
    }
    var mockDB = mocks.mockDb({
      emailRecord: sinon.spy(function () {
        return P.reject(new error.unknownAccount())
      }),
      createAccount: sinon.spy(function () {
        return P.resolve({
          uid: uuid.v4('binary'),
          email: TEST_EMAIL,
          emailVerified: false
        })
      })
    })
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
    var mockMetricsContext = mocks.mockMetricsContext({
      copy: sinon.spy(function (data, metadata) {
        Object.keys(metadata).forEach(function (key) {
          data[key] = metadata[key]
        })
        return P.resolve(data)
      }),
      validate: function () {
        return true
      }
    })
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      metricsContext: mockMetricsContext
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/create')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function () {
      t.equal(mockDB.createAccount.callCount, 1, 'createAccount was called')

      t.equal(mockLog.stdout.write.callCount, 1, 'an sqs event was logged')
      var eventData = JSON.parse(mockLog.stdout.write.getCall(0).args[0])
      t.equal(eventData.event, 'login', 'it was a login event')
      t.equal(eventData.data.service, 'sync', 'it was for sync')
      t.equal(eventData.data.email, TEST_EMAIL, 'it was for the correct email')
      t.equal(eventData.data.metricsContext.entrypoint, 'preferences', 'it contained the entrypoint metrics field')
      t.equal(eventData.data.metricsContext.utm_content, 'some-content-string', 'it contained the utm_content metrics field')

    }).finally(function () {
      mockLog.close()
    })
  }
)

test(
  'login event from /account/login includes metrics context data',
  function (t) {
    var mockRequest = {
      app: {
        acceptLangage: 'en-US'
      },
      headers: {
        'user-agent': 'test-user-agent'
      },
      query: {
        keys: false
      },
      payload: {
        email: TEST_EMAIL,
        authPW: crypto.randomBytes(32).toString('hex'),
        service: 'sync',
        reason: 'signin',
        metricsContext: {
          entrypoint: 'preferences',
          utmContent: 'some-content-string'
        }
      }
    }
    var uid = uuid.v4('binary')
    var mockDB = mocks.mockDb({
      emailRecord: sinon.spy(function () {
        return P.resolve({
          uid: uid,
          email: TEST_EMAIL,
          emailVerified: true
        })
      }),
      createSessionToken: sinon.spy(function () {
        return P.resolve({
          uid: uid,
          email: TEST_EMAIL,
          emailVerified: true,
          lastAuthAt: function () { return 0 }
        })
      }),
      sessions: sinon.spy(function () {
        return P.resolve([{}, {}, {}])
      })
    })
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
    var mockMetricsContext = mocks.mockMetricsContext({
      copy: sinon.spy(function (data, metadata) {
        Object.keys(metadata).forEach(function (key) {
          data[key] = metadata[key]
        })
        return P.resolve(data)
      }),
      validate: function () {
        return true
      }
    })
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      },
      metricsContext: mockMetricsContext
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function () {
      t.equal(mockDB.emailRecord.callCount, 1, 'db.emailRecord was called')
      t.equal(mockDB.createSessionToken.callCount, 1, 'db.createSessionToken was called')
      t.equal(mockDB.sessions.callCount, 1, 'db.sessions was called')

      t.equal(mockLog.stdout.write.callCount, 1, 'an sqs event was logged')
      var eventData = JSON.parse(mockLog.stdout.write.getCall(0).args[0])
      t.equal(eventData.event, 'login', 'it was a login event')
      t.equal(eventData.data.service, 'sync', 'it was for sync')
      t.equal(eventData.data.email, TEST_EMAIL, 'it was for the correct email')
      t.equal(eventData.data.metricsContext.entrypoint, 'preferences', 'it contained the entrypoint metrics field')
      t.equal(eventData.data.metricsContext.utm_content, 'some-content-string', 'it contained the utm_content metrics field')
    }).finally(function () {
      mockLog.close()
    })
  }
)

test(
  'device creation emits SNS event',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16).toString('hex')
    var mockLog = mocks.mockLog({
      event: sinon.spy()
    })
    var timestamp = Date.now()
    var mockDB = {
      createDevice: sinon.spy(function (uid, sessionTokenId, deviceInfo) {
        deviceInfo.createdAt = timestamp
        deviceInfo.id = deviceId
        return P.resolve(deviceInfo)
      }),
      devices: sinon.spy(function () {
        return P.resolve([])
      })
    }
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
        }
      },
      payload: {
        name: 'new device name',
        type: 'phone',
      }
    }
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(
      function(response) {
        t.equal(mockLog.event.callCount, 1)
        t.equal(mockLog.event.args[0].length, 3)
        t.equal(mockLog.event.args[0][0], 'device:create')
        t.deepEqual(mockLog.event.args[0][2], {
          uid: uid.toString('hex'),
          id: deviceId,
          type: 'phone',
          timestamp: timestamp
        })
      },
      function(err) {
        t.fail('should have succeeded', err)
      }
    )
  }
)

test(
  'device deletion emits SNS event',
  function (t) {
    var uid = uuid.v4('binary')
    var deviceId = crypto.randomBytes(16).toString('hex')
    var mockLog = mocks.mockLog({
      event: sinon.spy()
    })
    var mockDB = {
      deleteDevice: sinon.spy(function (uid, sessionTokenId) {
        return P.resolve(true)
      }),
      devices: sinon.spy(function () {
        return P.resolve([{
          id: deviceId,
          name: 'My Phone',
          type: 'mobile'
        }])
      }),
    }
    var mockRequest = {
      auth: {
        credentials: {
          uid: uid.toString('hex'),
        }
      },
      payload: {
        id: deviceId
      }
    }
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog
    })

    return new P(function(resolve) {
      getRoute(accountRoutes, '/account/device/destroy')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(
      function(response) {
        t.equal(mockLog.event.callCount, 1)
        t.equal(mockLog.event.args[0].length, 3)
        t.equal(mockLog.event.args[0][0], 'device:delete')
        var details = mockLog.event.args[0][2]
        t.equal(details.uid, uid.toString('hex'))
        t.equal(details.id, deviceId)
        t.ok(Date.now() - details.timestamp < 100)
      },
      function(err) {
        t.fail('should have succeeded', err)
      }
    )
  }
)

test(
  '/account/create validates metrics context data',
  function (t) {
    var mockRequest = {
      app: {
        acceptLangage: 'en-US'
      },
      headers: {
        'user-agent': 'test-user-agent'
      },
      payload: {
        email: TEST_EMAIL,
        authPW: crypto.randomBytes(32).toString('hex'),
        service: 'sync',
        metricsContext: {
          flowBeginTime: Date.now(),
          flowId: 'F1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF103',
          entrypoint: 'preferences'
        }
      }
    }
    var mockLog = mocks.mockLog()
    mockLog.metricsContext = mocks.mockMetricsContext()
    var mockDB = {
      emailRecord: sinon.spy(function () {
        return P.resolve({})
      })
    }
    var accountRoutes = makeRoutes({
      log: mockLog,
      db: mockDB
    })
    return new P(function (resolve, reject) {
      getRoute(accountRoutes, '/account/create')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function () {
      t.equal(mockLog.metricsContext.validate.callCount, 1, 'metricsContext.validate was called')
      var call = mockLog.metricsContext.validate.getCall(0)
      t.equal(call.args.length, 1, 'validate was called with a single argument')
      t.deepEqual(call.args[0], mockRequest, 'validate was called with the request')
    })
  }
)

test(
  '/account/login validates metrics context data',
  function (t) {
    var mockRequest = {
      app: {
        acceptLangage: 'en-US'
      },
      headers: {
        'user-agent': 'test-user-agent'
      },
      query: {
        keys: false
      },
      payload: {
        email: TEST_EMAIL,
        authPW: crypto.randomBytes(32).toString('hex'),
        service: 'sync',
        reason: 'signin',
        metricsContext: {
          flowBeginTime: Date.now(),
          flowId: 'F1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF1031DF103',
          entrypoint: 'preferences'
        }
      }
    }
    var mockDB = {
      emailRecord: sinon.spy(function () {
        return P.resolve({})
      }),
      createSessionToken: sinon.spy(function () {
        return P.resolve({})
      }),
      sessions: sinon.spy(function () {
        return P.resolve([{}, {}, {}])
      })
    }
    var mockLog = mocks.mockLog()
    mockLog.metricsContext = mocks.mockMetricsContext()
    var accountRoutes = makeRoutes({
      db: mockDB,
      log: mockLog,
      checkPassword: function () {
        return P.resolve(true)
      }
    })
    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, function(response) {
          resolve(response)
        })
    })
    .then(function () {
      t.equal(mockLog.metricsContext.validate.callCount, 1, 'metricsContext.validate was called')
      var call = mockLog.metricsContext.validate.getCall(0)
      t.equal(call.args.length, 1, 'validate was called with a single argument')
      t.deepEqual(call.args[0], mockRequest, 'validate was called with the request')
    })
  }
)

test(
  '/account/create emits account.created activity event and saves metrics context',
  function (t) {
    var keyFetchToken, sessionToken, uid
    var mockLog = mocks.spyLog()
    var mockMetricsContext = mocks.mockMetricsContext({
      validate: function () {
        return true
      }
    })
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex')
      },
      query: {
        keys: 'true'
      }
    }
    var accountRoutes = makeRoutes({
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: mocks.mockDb({
        createAccount: function (account) {
          uid = account.uid
          return P.resolve(account)
        },
        createKeyFetchToken: function (kft) {
          keyFetchToken = kft
          keyFetchToken.data = crypto.randomBytes(32)
          keyFetchToken.tokenId = crypto.randomBytes(32)
          return P.resolve(keyFetchToken)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          return P.reject(error.unknownAccount(mockRequest.payload.email))
        }
      }),
      log: mockLog,
      mailer: {
        sendVerifyCode: function () {
          return P.resolve()
        }
      },
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/create')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.created')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: uid.toString('hex')
        })

        t.equal(mockMetricsContext.save.callCount, 2)
        t.equal(mockMetricsContext.save.args[0].length, 3)
        t.equal(mockMetricsContext.save.args[0][0], sessionToken)
        t.deepEqual(mockMetricsContext.save.args[0][1], ['device.created', 'account.verified', 'account.signed'])
        t.equal(mockMetricsContext.save.args[0][2], mockRequest.payload.metricsContext)
        t.equal(mockMetricsContext.save.args[1].length, 3)
        t.equal(mockMetricsContext.save.args[1][0], keyFetchToken)
        t.equal(mockMetricsContext.save.args[1][1], 'account.keyfetch')
        t.equal(mockMetricsContext.save.args[1][2], mockRequest.payload.metricsContext)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/login emits account.login activity event and saves metrics context',
  function (t) {
    var keyFetchToken, sessionToken, uid
    var mockLog = mocks.spyLog()
    var mockMetricsContext = mocks.mockMetricsContext({
      validate: function () {
        return true
      }
    })
    var mockRequest = {
      app: {
        acceptLanguage: 'en',
        clientAddress: '127.0.0.1'
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
        authPW: crypto.randomBytes(32).toString('hex')
      },
      query: {
        keys: 'true'
      }
    }
    var accountRoutes = makeRoutes({
      checkPassword: function () {
        return P.resolve(true)
      },
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: mocks.mockDb({
        createKeyFetchToken: function (kft) {
          keyFetchToken = kft
          keyFetchToken.data = crypto.randomBytes(32)
          keyFetchToken.tokenId = crypto.randomBytes(32)
          return P.resolve(keyFetchToken)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        emailRecord: function () {
          uid = crypto.randomBytes(16)
          return P.resolve({
            authAt: Date.now(),
            email: mockRequest.payload.email,
            emailVerified: true,
            uid: uid
          })
        }
      }),
      log: mockLog,
      metricsContext: mockMetricsContext,
      Password: function () {
        return {
          unwrap: function () {
            return P.resolve('bar')
          }
        }
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/login')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.login')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: uid.toString('hex')
        })

        t.equal(mockMetricsContext.save.callCount, 2)
        t.equal(mockMetricsContext.save.args[0].length, 3)
        t.equal(mockMetricsContext.save.args[0][0], sessionToken)
        t.deepEqual(mockMetricsContext.save.args[0][1], ['device.created', 'account.signed'])
        t.equal(mockMetricsContext.save.args[0][2], mockRequest.payload.metricsContext)
        t.equal(mockMetricsContext.save.args[1].length, 3)
        t.equal(mockMetricsContext.save.args[1][0], keyFetchToken)
        t.equal(mockMetricsContext.save.args[1][1], 'account.keyfetch')
        t.equal(mockMetricsContext.save.args[1][2], mockRequest.payload.metricsContext)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/keys emits account.keyfetch activity event and removes metrics context',
  function (t) {
    var mockLog = mocks.spyLog()
    var mockMetricsContext = mocks.mockMetricsContext()
    var mockRequest = {
      app: {},
      auth: {
        credentials: {
          emailVerified: true,
          keyBundle: crypto.randomBytes(96),
          uid: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {},
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: mocks.mockDb(),
      log: mockLog,
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/keys')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.keyfetch')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex')
        })

        t.equal(mockMetricsContext.remove.callCount, 1)
        t.equal(mockMetricsContext.remove.args[0].length, 2)
        t.equal(mockMetricsContext.remove.args[0][0], mockRequest.auth.credentials)
        t.equal(mockMetricsContext.remove.args[0][1], 'account.keyfetch')
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/device/destroy emits device.deleted activity event',
  function (t) {
    var mockLog = mocks.spyLog()
    var mockRequest = {
      app: {},
      auth: {
        credentials: {
          tokenId: crypto.randomBytes(16),
          uid: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {
        id: crypto.randomBytes(16).toString('hex')
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: mocks.mockDb(),
      log: mockLog,
      push: {
        notifyDeviceDisconnected: function () {
          return P.resolve()
        }
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/device/destroy')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'device.deleted')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex'),
          device_id: mockRequest.payload.id
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/recovery_email/verify_code emits account.verified activity event',
  function (t) {
    var mockLog = mocks.spyLog()
    var mockRequest = {
      app: {
        acceptLanguage: 'en'
      },
      auth: {},
      headers: {},
      payload: {
        uid: crypto.randomBytes(16).toString('hex'),
        code: crypto.randomBytes(16).toString('hex')
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      config: {
        smtp: {
          resendBlackoutPeriod: 60000
        }
      },
      customs: {
        check: function () {
          return P.resolve()
        }
      },
      db: mocks.mockDb({
        account: function (uid) {
          return P.resolve({
            createdAt: Date.now(),
            email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
            emailCode: Buffer(mockRequest.payload.code, 'hex'),
            emailVerified: false,
            locale: 'en',
            uid: uid
          })
        }
      }),
      log: mockLog,
      mailer: {
        sendPostVerifyEmail: function () {}
      },
      push: {
        notifyUpdate: function () {}
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/recovery_email/verify_code')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.verified')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.payload.uid.toString('hex')
        })
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/reset emits account.reset activity event and saves metrics context',
  function (t) {
    var keyFetchToken, sessionToken
    var mockLog = mocks.spyLog()
    var mockMetricsContext = mocks.mockMetricsContext()
    var mockRequest = {
      app: {},
      auth: {
        credentials: {
          email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
          uid: crypto.randomBytes(16),
          verifierSetAt: Date.now()
        }
      },
      headers: {
        'user-agent': 'foo'
      },
      payload: {
        authPW: crypto.randomBytes(32).toString('hex'),
        metricsContext: {},
        sessionToken: 'true'
      },
      query: {
        keys: 'true'
      }
    }
    var accountRoutes = makeRoutes({
      config: {
        domain: 'example.org'
      },
      customs: {
        reset: function () {}
      },
      db: mocks.mockDb({
        account: function (uid) {
          return P.resolve({
            email: crypto.randomBytes(16).toString('hex') + '@restmail.net',
            emailVerified: true,
            uid: uid,
            verifierSetAt: Date.now(),
            wrapWrapKb: 'bar'
          })
        },
        createKeyFetchToken: function (kft) {
          keyFetchToken = kft
          keyFetchToken.data = crypto.randomBytes(32)
          keyFetchToken.tokenId = crypto.randomBytes(32)
          return P.resolve(keyFetchToken)
        },
        createSessionToken: function (st) {
          sessionToken = st
          sessionToken.data = crypto.randomBytes(32)
          sessionToken.tokenId = crypto.randomBytes(32)
          sessionToken.lastAuthAt = function () {}
          return P.resolve(sessionToken)
        },
        resetAccount: function () {}
      }),
      log: mockLog,
      metricsContext: mockMetricsContext,
      Password: function () {
        return {
          verifyHash: function () {
            return P.resolve('baz')
          },
          unwrap: function () {
            return P.resolve('qux')
          }
        }
      },
      push: {
        notifyUpdate: function () {}
      }
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/reset')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'account.reset')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex')
        })

        t.equal(mockMetricsContext.save.callCount, 2)
        t.equal(mockMetricsContext.save.args[0].length, 3)
        t.equal(mockMetricsContext.save.args[0][0], sessionToken)
        t.deepEqual(mockMetricsContext.save.args[0][1], ['device.created', 'account.signed'])
        t.equal(mockMetricsContext.save.args[0][2], mockRequest.payload.metricsContext)
        t.equal(mockMetricsContext.save.args[1].length, 3)
        t.equal(mockMetricsContext.save.args[1][0], keyFetchToken)
        t.equal(mockMetricsContext.save.args[1][1], 'account.keyfetch')
        t.equal(mockMetricsContext.save.args[1][2], mockRequest.payload.metricsContext)
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/device emits device.created activity event and removes metrics context',
  function (t) {
    var deviceId
    var mockLog = mocks.spyLog()
    var mockMetricsContext = mocks.mockMetricsContext()
    var mockRequest = {
      auth: {
        credentials: {
          uid: crypto.randomBytes(16),
          tokenId: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {
        name: 'foo',
        type: 'mobile'
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: mocks.mockDb({
        createDevice: function (uid, sessionTokenId, device) {
          deviceId = crypto.randomBytes(16)
          device.id = deviceId
          return P.resolve(device)
        },
        devices: function () {
          return P.resolve([])
        }
      }),
      log: mockLog,
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'device.created')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex'),
          device_id: deviceId.toString('hex')
        })

        t.equal(mockMetricsContext.remove.callCount, 1)
        t.equal(mockMetricsContext.remove.args[0].length, 2)
        t.equal(mockMetricsContext.remove.args[0][0], mockRequest.auth.credentials)
        t.equal(mockMetricsContext.remove.args[0][1], 'device.created')
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

test(
  '/account/device emits device.updated activity event and removes metrics context',
  function (t) {
    var deviceId = crypto.randomBytes(16)
    var mockLog = mocks.spyLog()
    var mockMetricsContext = mocks.mockMetricsContext()
    var mockRequest = {
      auth: {
        credentials: {
          deviceId: deviceId,
          deviceName: 'old device',
          type: 'mobile',
          uid: crypto.randomBytes(16),
          tokenId: crypto.randomBytes(16)
        }
      },
      headers: {},
      payload: {
        id: deviceId,
        name: 'new device',
        type: 'mobile'
      },
      query: {}
    }
    var accountRoutes = makeRoutes({
      db: mocks.mockDb({
        devices: function () {
          return P.resolve([])
        },
        updateDevice: function (uid, sessionTokenId, device) {
          return P.resolve(device)
        }
      }),
      log: mockLog,
      metricsContext: mockMetricsContext
    })

    return new P(function (resolve) {
      getRoute(accountRoutes, '/account/device')
        .handler(mockRequest, resolve)
    })
    .then(
      function () {
        t.equal(mockLog.activityEvent.callCount, 1)
        t.equal(mockLog.activityEvent.args[0].length, 3)
        t.equal(mockLog.activityEvent.args[0][0], 'device.updated')
        t.equal(mockLog.activityEvent.args[0][1], mockRequest)
        t.deepEqual(mockLog.activityEvent.args[0][2], {
          uid: mockRequest.auth.credentials.uid.toString('hex'),
          device_id: deviceId.toString('hex')
        })

        t.equal(mockMetricsContext.remove.callCount, 1)
        t.equal(mockMetricsContext.remove.args[0].length, 2)
        t.equal(mockMetricsContext.remove.args[0][0], mockRequest.auth.credentials)
        t.equal(mockMetricsContext.remove.args[0][1], 'device.updated')
      },
      function () {
        t.fail('request should have succeeded')
      }
    )
  }
)

