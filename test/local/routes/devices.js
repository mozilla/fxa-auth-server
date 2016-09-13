/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var sinon = require('sinon')

var test = require('tap').test
var mocks = require('../../mocks')
var getRoute = require('../../routes_helpers').getRoute
var makeRoutes = require('../../routes_helpers').makeAccountRoutes
var runTest = require('../../routes_helpers').runTest

var P = require('../../../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')

var error = require('../../../lib/error')

test('/account/device', function (t) {
  t.plan(4)
  var config = {}
  var uid = uuid.v4('binary')
  var deviceId = crypto.randomBytes(16)
  var mockRequest = mocks.mockRequest({
    credentials: {
      deviceCallbackPublicKey: '',
      deviceCallbackURL: '',
      deviceId: deviceId,
      deviceName: 'my awesome device',
      deviceType: 'desktop',
      tokenId: crypto.randomBytes(16),
      uid: uid
    },
    payload: {
      id: deviceId.toString('hex'),
      name: 'my awesome device'
    }
  })
  var mockDevices = mocks.mockDevices()
  var mockLog = mocks.spyLog()
  var accountRoutes = makeRoutes({
    config: config,
    devices: mockDevices,
    log: mockLog
  })
  var route = getRoute(accountRoutes, '/account/device')

  t.test('identical data', function (t) {
    return runTest(route, mockRequest, function (response) {
      t.equal(mockLog.increment.callCount, 1, 'a counter was incremented')
      t.equal(mockLog.increment.firstCall.args[0], 'device.update.spurious')

      t.deepEqual(response, mockRequest.payload)
    })
    .then(function () {
      mockLog.increment.reset()
    })
  })

  t.test('different data', function (t) {
    mockRequest.auth.credentials.deviceId = crypto.randomBytes(16)
    var payload = mockRequest.payload
    payload.name = 'my even awesomer device'
    payload.type = 'phone'
    payload.pushCallback = 'https://push.services.mozilla.com/123456'
    payload.pushPublicKey = 'SomeEncodedBinaryStuffThatDoesntGetValidedByThisTest'

    return runTest(route, mockRequest, function (response) {
      t.equal(mockLog.increment.callCount, 5, 'the counters were incremented')
      t.equal(mockLog.increment.getCall(0).args[0], 'device.update.sessionToken')
      t.equal(mockLog.increment.getCall(1).args[0], 'device.update.name')
      t.equal(mockLog.increment.getCall(2).args[0], 'device.update.type')
      t.equal(mockLog.increment.getCall(3).args[0], 'device.update.pushCallback')
      t.equal(mockLog.increment.getCall(4).args[0], 'device.update.pushPublicKey')

      t.equal(mockDevices.upsert.callCount, 1, 'devices.upsert was called once')
      var args = mockDevices.upsert.args[0]
      t.equal(args.length, 3, 'devices.upsert was passed three arguments')
      t.equal(args[0], mockRequest, 'first argument was request object')
      t.deepEqual(args[1].tokenId, mockRequest.auth.credentials.tokenId, 'second argument was session token')
      t.deepEqual(args[1].uid, uid, 'sessionToken.uid was correct')
      t.deepEqual(args[2], mockRequest.payload, 'third argument was payload')
    })
    .then(function () {
      mockLog.increment.reset()
      mockDevices.upsert.reset()
    })
  })

  t.test('with no id in payload', function (t) {
    mockRequest.payload.id = undefined

    return runTest(route, mockRequest, function (response) {
      t.equal(mockLog.increment.callCount, 0, 'log.increment was not called')

      t.equal(mockDevices.upsert.callCount, 1, 'devices.upsert was called once')
      var args = mockDevices.upsert.args[0]
      t.equal(args[2].id, mockRequest.auth.credentials.deviceId.toString('hex'), 'payload.id defaulted to credentials.deviceId')
    })
    .then(function () {
      mockLog.increment.reset()
      mockDevices.upsert.reset()
    })
  }, t)

  t.test('device updates disabled', function (t) {
    config.deviceUpdatesEnabled = false

    return runTest(route, mockRequest, function () {
      t.fail('should have thrown')
    })
    .catch(function (err) {
      t.equal(err.output.statusCode, 503, 'correct status code is returned')
      t.equal(err.errno, error.ERRNO.FEATURE_NOT_ENABLED, 'correct errno is returned')
    })
  })
})

test('/account/devices/notify', function (t) {
  t.plan(5)
  var config = {}
  var uid = uuid.v4('binary')
  var mockRequest = mocks.mockRequest({
    credentials: {
      uid: uid.toString('hex')
    }
  })
  var pushPayload = {
    isValid: true,
    version: 1,
    command: 'sync:collection_changed',
    data: {
      collections: ['clients']
    }
  }
  var mockPush = mocks.mockPush()
  var validate = sinon.spy(function (payload) { return payload.isValid })
  var mockAjv = function () {
    return {
      compile: function () {
        return validate
      }
    }
  }
  var sandbox = sinon.sandbox.create()
  var mockCustoms = {
    checkAuthenticated: sandbox.spy(function () {
      return P.resolve()
    })
  }
  var accountRoutes = makeRoutes({
    config: config,
    customs: mockCustoms,
    push: mockPush
  }, {
    ajv: mockAjv
  })
  var route = getRoute(accountRoutes, '/account/devices/notify')

  t.test('bad payload', function (t) {
    mockRequest.payload = {
      to: ['bogusid1'],
      payload: {
        isValid: false
      }
    }
    return runTest(route, mockRequest, function () {
      t.fail('should have thrown')
    })
    .catch(function (err) {
      t.equal(validate.callCount, 1, 'ajv validator function was called')
      t.equal(mockPush.pushToDevices.callCount, 0, 'mockPush.pushToDevices was not called')
      t.equal(err.errno, 107, 'Correct errno for invalid push payload')
    })
  })

  t.test('all devices', function (t) {
    mockRequest.payload = {
      to: 'all',
      excluded: ['bogusid'],
      TTL: 60,
      payload: pushPayload
    }
    return runTest(route, mockRequest, function (response) {
      t.equal(mockCustoms.checkAuthenticated.callCount, 1, 'mockCustoms.checkAuthenticated was called once')
      t.equal(mockPush.pushToAllDevices.callCount, 1, 'mockPush.pushToAllDevices was called once')
      var args = mockPush.pushToAllDevices.args[0]
      t.equal(args.length, 3, 'mockPush.pushToAllDevices was passed three arguments')
      t.equal(args[0], uid.toString('hex'), 'first argument was the device uid')
      t.equal(args[1], 'devicesNotify', 'second argument was the devicesNotify reason')
      t.deepEqual(args[2], {
        data: new Buffer(JSON.stringify(pushPayload)),
        excludedDeviceIds: ['bogusid'],
        TTL: 60
      }, 'third argument was the push options')
    })
  })

  t.test('specific devices', function (t) {
    mockCustoms.checkAuthenticated.reset()
    mockRequest.payload = {
      to: ['bogusid1', 'bogusid2'],
      TTL: 60,
      payload: pushPayload
    }
    return runTest(route, mockRequest, function (response) {
      t.equal(mockCustoms.checkAuthenticated.callCount, 1, 'mockCustoms.checkAuthenticated was called once')
      t.equal(mockPush.pushToDevices.callCount, 1, 'mockPush.pushToDevices was called once')
      var args = mockPush.pushToDevices.args[0]
      t.equal(args.length, 4, 'mockPush.pushToDevices was passed four arguments')
      t.equal(args[0], uid.toString('hex'), 'first argument was the device uid')
      t.deepEqual(args[1], ['bogusid1', 'bogusid2'], 'second argument was the list of device ids')
      t.equal(args[2], 'devicesNotify', 'third argument was the devicesNotify reason')
      t.deepEqual(args[3], {
        data: new Buffer(JSON.stringify(pushPayload)),
        TTL: 60
      }, 'fourth argument was the push options')
    })
  })

  t.test('device driven notifications disabled', function (t) {
    config.deviceNotificationsEnabled = false
    mockRequest.payload = {
      to: 'all',
      excluded: ['bogusid'],
      TTL: 60,
      payload: pushPayload
    }

    return runTest(route, mockRequest, function () {
      t.fail('should have thrown')
    })
    .catch(function (err) {
      t.equal(err.output.statusCode, 503, 'correct status code is returned')
      t.equal(err.errno, error.ERRNO.FEATURE_NOT_ENABLED, 'correct errno is returned')
    })
  })

  t.test('throws error if customs blocked the request', function (t) {
    config.deviceNotificationsEnabled = true

    mockCustoms = {
      checkAuthenticated: sandbox.spy(function () {
        throw error.tooManyRequests(1)
      })
    }
    route = getRoute(makeRoutes({customs: mockCustoms}), '/account/devices/notify')

    return runTest(route, mockRequest, function (response) {
      t.fail('should have thrown')
    })
    .catch(function (err) {
      t.equal(mockCustoms.checkAuthenticated.callCount, 1, 'mockCustoms.checkAuthenticated was called once')
      t.equal(err.message, 'Client has sent too many requests')
    })
  })
})

test('/account/device/destroy', function (t) {
  var uid = uuid.v4('binary')
  var deviceId = crypto.randomBytes(16).toString('hex')
  var mockLog = mocks.spyLog()
  var mockDB = mocks.mockDB()
  var mockRequest = mocks.mockRequest({
    credentials: {
      uid: uid.toString('hex'),
    },
    payload: {
      id: deviceId
    }
  })
  var mockPush = mocks.mockPush()
  var accountRoutes = makeRoutes({
    db: mockDB,
    log: mockLog,
    push: mockPush
  })
  var route = getRoute(accountRoutes, '/account/device/destroy')

  return runTest(route, mockRequest, function () {
    t.equal(mockDB.deleteDevice.callCount, 1)

    t.equal(mockPush.notifyDeviceDisconnected.callCount, 1)
    t.equal(mockPush.notifyDeviceDisconnected.firstCall.args[0], mockRequest.auth.credentials.uid)
    t.equal(mockPush.notifyDeviceDisconnected.firstCall.args[1], deviceId)

    t.equal(mockLog.activityEvent.callCount, 1, 'log.activityEvent was called once')
    var args = mockLog.activityEvent.args[0]
    t.equal(args.length, 3, 'log.activityEvent was passed three arguments')
    t.equal(args[0], 'device.deleted', 'first argument was event name')
    t.equal(args[1], mockRequest, 'second argument was request object')
    t.deepEqual(args[2], { uid: uid.toString('hex'), device_id: deviceId }, 'third argument contained uid and deviceId')

    t.equal(mockLog.notifyAttachedServices.callCount, 1)
    args = mockLog.notifyAttachedServices.args[0]
    t.equal(args.length, 3)
    t.equal(args[0], 'device:delete')
    t.equal(args[1], mockRequest)
    var details = args[2]
    t.equal(details.uid, uid.toString('hex'))
    t.equal(details.id, deviceId)
    t.ok(Date.now() - details.timestamp < 100)
  })
})

test('/account/devices', function (t) {
  var mockRequest = mocks.mockRequest({
    credentials: {
      uid: crypto.randomBytes(16),
      tokenId: crypto.randomBytes(16)
    },
    payload: {}
  })
  var unnamedDevice = { sessionToken: crypto.randomBytes(16) }
  var mockDB = mocks.mockDB({
    devices: [
      { name: 'current session', type: 'mobile', sessionToken: mockRequest.auth.credentials.tokenId },
      { name: 'has no type', sessionToken: crypto.randomBytes(16) },
      { name: 'has device type', sessionToken: crypto.randomBytes(16), uaDeviceType: 'wibble' },
      unnamedDevice
    ]
  })
  var mockDevices = mocks.mockDevices()
  var accountRoutes = makeRoutes({
    db: mockDB,
    devices: mockDevices
  })
  var route = getRoute(accountRoutes, '/account/devices')

  return runTest(route, mockRequest, function (response) {
    t.ok(Array.isArray(response), 'response is array')
    t.equal(response.length, 4, 'response contains 4 items')

    t.equal(response[0].name, 'current session')
    t.equal(response[0].type, 'mobile')
    t.equal(response[0].sessionToken, undefined)
    t.equal(response[0].isCurrentDevice, true)

    t.equal(response[1].name, 'has no type')
    t.equal(response[1].type, 'desktop')
    t.equal(response[1].sessionToken, undefined)
    t.equal(response[1].isCurrentDevice, false)

    t.equal(response[2].name, 'has device type')
    t.equal(response[2].type, 'wibble')
    t.equal(response[2].isCurrentDevice, false)

    t.equal(response[3].name, null)

    t.equal(mockDB.devices.callCount, 1, 'db.devices was called once')
    t.equal(mockDB.devices.args[0].length, 1, 'db.devices was passed one argument')
    t.deepEqual(mockDB.devices.args[0][0], mockRequest.auth.credentials.uid, 'db.devices was passed uid')

    t.equal(mockDevices.synthesizeName.callCount, 1, 'mockDevices.synthesizeName was called once')
    t.equal(mockDevices.synthesizeName.args[0].length, 1, 'mockDevices.synthesizeName was passed one argument')
    t.equal(mockDevices.synthesizeName.args[0][0], unnamedDevice, 'mockDevices.synthesizeName was passed unnamed device')
  })
})

