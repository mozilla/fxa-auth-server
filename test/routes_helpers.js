/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var mocks = require('./mocks')
var proxyquire = require('proxyquire')

var P = require('../lib/promise')
var uuid = require('uuid')
var crypto = require('crypto')
var isA = require('joi')
var error = require('../lib/error')

exports.getRoute = function (routes, path) {
  var route = null

  routes.some(function (r) {
    if (r.path === path) {
      route = r
      return true
    }
  })

  return route
}

exports.makeAccountRoutes = function (options, requireMocks) {
  options = options || {}

  var config = options.config || {}
  config.verifierVersion = config.verifierVersion || 0
  config.smtp = config.smtp ||  {}
  config.memcached = config.memcached || {
      address: '127.0.0.1:1121',
      idle: 500,
      lifetime: 30
    }
  config.i18n = {
    supportedLanguages: ['en'],
    defaultLanguage: 'en'
  }

  var log = options.log || mocks.mockLog()
  var Password = options.Password || require('../lib/crypto/password')(log, config)
  var db = options.db || mocks.mockDB()
  var isPreVerified = require('../lib/preverifier')(error, config)
  var customs = options.customs || {
      check: function () { return P.resolve(true) }
    }
  var checkPassword = options.checkPassword || require('../lib/routes/utils/password_check')(log, config, Password, customs, db)
  var push = options.push || require('../lib/push')(log, db)
  var metricsContext = options.metricsContext || log.metricsContext || require('../lib/metrics/context')(log, config)
  return proxyquire('../lib/routes/account', requireMocks || {})(
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
    metricsContext,
    options.devices || require('../lib/devices')(log, db, push)
  )
}
