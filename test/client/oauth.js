/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EventEmitter = require('events').EventEmitter
var util = require('util')

var P = require('../../lib/promise')
var request = require('request')

var tokens = require('../../lib/tokens')({ trace: function() {}})

util.inherits(ClientOAuth, EventEmitter)
function ClientOAuth(origin) {
  EventEmitter.call(this)
  this.origin = origin
  this.baseURL = origin + '/v1/oauth'
  this.timeOffset = 0
  this.headers = {}
}

ClientOAuth.prototype.doRequest = function (method, url, accessToken, payload, headers) {
  var d = P.defer()
  if (typeof headers === 'undefined') {
    headers = {}
  }
  for (var k in this.headers) {
    if (!headers.hasOwnProperty(k)) {
      headers[k] = this.headers[k]
    }
  }
  if (accessToken && !headers.Authorization) {
    headers.Authorization = 'Bearer ' + accessToken
  }
  var options = {
    url: url,
    method: method,
    headers: headers,
    json: payload || true
  }
  this.emit('startRequest', options)
  request(options, function (err, res, body) {

    this.emit('endRequest', options, err, res)
    if (err || body.error || res.statusCode !== 200) {
      d.reject(err || body)
    }
    else {
      d.resolve(body)
    }
  }.bind(this))
  return d.promise
}

ClientOAuth.prototype.revokeSessionToken = function (accessToken, sessionTokenHex) {
  var url = this.baseURL + '/sessions/revoke'
  return tokens.SessionToken.fromHex(sessionTokenHex)
    .then(
      function (sessionToken) {
        return this.doRequest('POST', url, accessToken, { id: sessionToken.id })
      }.bind(this)
    )
}

ClientOAuth.prototype.revokeKeyFetchToken = function (accessToken, keyFetchTokenHex) {
  var url = this.baseURL + '/keys/revoke'
  return tokens.KeyFetchToken.fromHex(keyFetchTokenHex)
    .then(
      function (keyFetchToken) {
        return this.doRequest('POST', url, accessToken, { id: keyFetchToken.id })
      }.bind(this)
    )
}

module.exports = ClientOAuth
