/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('tap').test
var sinon = require('sinon')
var P = require('../../lib/promise')
var log = require('../../lib/log')
var mocks = require('../mocks')
var config = {
  geoProfile: {
    enabled: true,
    logOnly: false,
    acceptRadius: 100
  }
}
var GeoProfile = require('../../lib/geoprofile')

var seenIp = '8.8.8.8'
var notSeenIp = '8.8.8.9'
var farAwayIp = '50.89.249.195'
var seenUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.11; rv:51.0) Gecko/20100101 Firefox/51.0'
var notSeenUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.11; rv:51.0) Gecko/20100101 Firefox/50.0'

function setupMockDB() {
  var mockDB = mocks.mockDB()
  mockDB.securityEvents = sinon.spy(function () {
    return P.resolve([
      {
        'name': 'account.login',
        'createdAt': 1471269712790,
        'ipAddr': seenIp,
        'uid': '0',
        'userAgent': seenUserAgent,
        'lat': 37.386,
        'lon': -122.0838
      }
    ])
  })

  return mockDB
}

test(
  'should initialize geo-profiling',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    t.ok(geoProfiler)
    t.end()
  }
)

test(
  'should not flag suspicious request from previously seen ip address',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var mockRequest = mocks.mockRequest({
      ipAddress: seenIp
    })

    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenIpAddress, true, 'seen ip')
        t.equal(result.isSuspicious, false, 'not suspicious request')
        t.end()
      })
  }
)

test(
  'should flag suspicious request from not previously seen ip address',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var mockRequest = mocks.mockRequest({
      ipAddress: '123.123.112.123',
      headers: {
        'user-agent': seenUserAgent
      }
    })

    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenIpAddress, false, 'not seen ip')
        t.equal(result.isSuspicious, true, 'suspicious request')
        t.end()
      })
  }
)

test(
  'should not flag request from previously seen user agent',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var mockRequest = mocks.mockRequest({
      ipAddress: notSeenIp,
      headers: {
        'user-agent': seenUserAgent
      }
    })

    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenAgent, true, 'seen agent')
        t.equal(result.isSuspicious, false, 'not suspicious request')
        t.end()
      })
  }
)

test(
  'should flag suspicious request from not previously seen user agent',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var mockRequest = mocks.mockRequest({
      ipAddress: notSeenIp,
      headers: {
        'user-agent': notSeenUserAgent
      }
    })

    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenAgent, false, 'not seen agent')
        t.equal(result.isSuspicious, true, 'suspicious request')
        t.end()
      })
  }
)

test(
  'should not flag suspicious request from previously seen area',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var mockRequest = mocks.mockRequest({
      ipAddress: notSeenIp
    })

    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenArea, true, 'seen area')
        t.equal(result.isSuspicious, false, 'suspicious request')
        t.end()
      })
  }
)

test(
  'should flag suspicious request from not previously seen area',
  function (t) {
    var mockDB = setupMockDB()
    var mockGeo = mocks.mockGeo()
    var mockRequest = mocks.mockRequest({
      ipAddress: farAwayIp
    })

    var geoProfiler = new GeoProfile(config, log, mockDB, mockGeo)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenArea, false, 'not seen area')
        t.equal(result.isSuspicious, true, 'suspicious request')
        t.end()
      })
  }
)
