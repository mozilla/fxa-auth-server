/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const P = require('./promise')
const Poolee = require('poolee')

function parseUrl(url) {
  var match = /([a-zA-Z]+):\/\/(\S+)/.exec(url)
  if (match) {
    return {
      protocol: match[1],
      host: match[2]
    }
  }
  throw new Error('url is invalid: ' + url)
}

function Pool(url, options) {
  options = options || {}
  var parsedUrl = parseUrl(url)
  var protocol = require(parsedUrl.protocol)
  this.poolee = new Poolee(
    protocol,
    [parsedUrl.host],
    {
      timeout: options.timeout || 5000,
      maxPending: options.maxPending || 1000,
      keepAlive: true,
      maxRetries: 0
    }
  )
}

Pool.prototype.request = function (method, path, data, extraHeaders) {
  var d = P.defer()
  var headers = { 'Content-Type': 'application/json' }
  this.poolee.request(
    {
      method: method || 'GET',
      path: path,
      headers: extraHeaders ? Object.assign(headers, extraHeaders) : headers,
      data: data ? JSON.stringify(data) : undefined
    },
    handleResponse
  )
  return d.promise

  function handleResponse (err, res, body) {
    var parsedBody = safeParse(body)

    if (err) {
      return d.reject(err)
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      var error = new Error()
      if (! parsedBody) {
        error.message = body
      } else {
        Object.assign(error, parsedBody)
      }
      error.statusCode = res.statusCode
      return d.reject(error)
    }

    if (! body) {
      return d.resolve()
    }

    if (! parsedBody) {
      return d.reject(new Error('Invalid JSON'))
    }

    d.resolve(parsedBody)
  }
}

// extraHeaders is always optional.
Pool.prototype.post = function (path, data, extraHeaders) {
  return this.request('POST', path, data, extraHeaders)
}

Pool.prototype.put = function (path, data, extraHeaders) {
  return this.request('PUT', path, data, extraHeaders)
}

Pool.prototype.get = function (path, extraHeaders) {
  return this.request('GET', path, null, extraHeaders)
}

Pool.prototype.del = function (path, data, extraHeaders) {
  return this.request('DELETE', path, data, extraHeaders)
}

Pool.prototype.head = function (path, extraHeaders) {
  return this.request('HEAD', path, null, extraHeaders)
}

Pool.prototype.close = function () {
  /*/
    This is a hack to coax the server to close its existing connections
  /*/
  var socketCount = this.poolee.options.maxSockets || 20
  function noop() {}
  for (var i = 0; i < socketCount; i++) {
    this.poolee.request(
      {
        method: 'GET',
        path: '/',
        headers: {
          'Connection': 'close'
        }
      },
      noop
    )
  }
}

module.exports = Pool

function safeParse (json) {
  try {
    return JSON.parse(json)
  }
  catch (e) {
  }
}
