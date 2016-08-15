/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var test = require('tap').test
var sinon = require('sinon')
var P = require('../../lib/promise')
var log = require('../../lib/log')
var mocks = require('../mocks')
var config = {}
var GeoProfile = require('../../lib/geoprofile')

function setupMockDB() {
  var mockDB = mocks.mockDB()
  mockDB.securityEvents = sinon.spy(function () {
    return P.resolve([
      {
        "name": "account.login",
        "createdAt": 1471269712790,
        "ipAddr": "192.168.0.1",
        "uid": "0",
        "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.11; rv:51.0) Gecko/20100101 Firefox/51.0",
        "lat": 25.52,
        "lon": -81.39
      }
    ])
  })

  return mockDB
}

test(
  'should initialize geo-profiling',
  function (t) {
    var mockDB = setupMockDB()
    var geoProfiler = new GeoProfile(config, log, mockDB)
    t.ok(geoProfiler)
    t.end()
  }
)

test(
  'should not flag request from previously seen user agent',
  function (t) {
    var mockDB = setupMockDB()
    var mockRequest = mocks.mockRequest({
      ipAddress: '192.168.0.1'
    })

    var geoProfiler = new GeoProfile(config, log, mockDB)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenAgent, true, 'seen agent')
        t.equal(result.isSuspicious, false, 'not suspicous request')
        t.end()
      })
  }
)

test(
  'should flag suspicous request from not previously seen user agent',
  function (t) {
    var mockDB = setupMockDB()
    var mockRequest = mocks.mockRequest({
      ipAddress: '192.168.0.1',
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.11; rv:51.0) Gecko/20100101 Firefox/50.0'
      }
    })

    var geoProfiler = new GeoProfile(config, log, mockDB)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenAgent, false, 'not seen agent')
        t.equal(result.isSuspicious, true, 'suspicious request')
        t.end()
      })
  }
)

test(
  'should not flag suspicious request from previously seen ip address',
  function (t) {
    var mockDB = setupMockDB()
    var mockRequest = mocks.mockRequest({
      ipAddress: '192.168.0.1'
    })

    var geoProfiler = new GeoProfile(config, log, mockDB)
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
    var mockRequest = mocks.mockRequest({
      ipAddress: '192.168.0.99'
    })


    var geoProfiler = new GeoProfile(config, log, mockDB)
    return geoProfiler.evalulateRequest({}, mockRequest)
      .then(function (result) {
        t.equal(result.seenIpAddress, false, 'not seen ip')
        t.equal(result.isSuspicious, true, 'suspicious request')
        t.end()
      })
  }
)