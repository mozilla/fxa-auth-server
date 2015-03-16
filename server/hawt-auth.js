/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 *  An auth scheme for service-to-service backend requests, using JWTs
 *  and inspired by Hawk.  Requests are authenticated by icluding the JWT
 *  directly in the authorization header like so:
 *
 *    Authorization: Hawt [JWT]
 *
 *  To be accepted, the JWT must be signed by one of a configurable list
 *  of trusted JKUs, and must reference the relevant JKU in its header.
 *  The JWT claims must include the following meta-data about the request in
 *  order to guard against reply etc:
 *
 *    - iss:  hostname of the service issuing the request
 *    - aud:  must match publicly-visible domain of the target server
 *    - exp:  must be a timestamp within configurable freshness window
 *    - iat:  if present, must be a timestamp within configurable window
 *    - nce:  nonce; a random string unique to this request
 *    - qsh:  query hash; a digest of the request parameters (see below)
 *    - psh:  payload hash; an optional hash of the request payload (see below)
 *
 *  The payload hash is analogous to that used in Hawk, and is the base64
 *  encoded SHA256 digest of the concatenation of the following strings,
 *  each followed by a newline:
 *
 *     - "hawt.1.payload"
 *     - the content-type header, in lowercase, without parameters
 *     - the request payload prior to any content encoding
 *
 *  The query hash is analogous to the "mac" field used in Hawk, but is a raw
 *  hash rather than a HMAC and does not include any fields over which the JWT
 *  already provides authentication.  It is the base64 encoded SHA256 digest
 *  of the concatenation of the following strings, each followed by a newline:
 *
 *     - "hawt.1.query"
 *     - the nonce value from the JWT claims
 *     - the request method, in uppercase
 *     - the request path, including query string, without normalization
 *     - the payload hash, or an empty string if there's no payload hash
 *
 *  Notes and thoughts:
 *
 *     - do we need a `typ` claim, or is it unnecessary given `qsh`?
 *     - make sure we reject { alg: "none" } JWTs!
 */

var crypto = require('crypto')
var url = require('url')
var jws = require('jws')
var b64urltohex = require('browserid-crypto/lib/utils').b64urltohex
var P = require('../promise')

var boom = require('boom')

module.exports = function (error, config) {

  var jwks = require('../jwks')(error, config)

  function Hawt(server, options, next) {
    server.auth.scheme('hawt', function (server, options) {
      return {

        authenticate: function (request, reply) {
          var authz = request.headers.authorization
          if (!authz || authz.indexOf('Hawt ') !== 0) {
            // AFAICT, we must return an instance of boom.unauthorized here
            // to indicate "not our auth scheme" and allow other stragies to
            // handle the auth.  Returning some other error causes it to
            // fail out with a 401.
            return reply(boom.unauthorized(null, 'Hawt'))
          }
          var token = authz.split(' ')[1]
          decodeAndVerifyJWT(token)
          .then(
            function (claims) {
              return verifyQueryHash(request, claims)
            }
          )
          .then(
            function (claims) {
              return {
                credentials: {
                  jku: claims.jku,
                  issuer: claims.iss, // XXX TODO: how to verify issuer?
                },
                artifacts: {
                  queryHash: claims.qsh,
                  payloadHash: claims.psh || '',
                  audience: claims.aud,
                  method: request.method,
                  resource: request.url,
                  nonce: claims.nce,
                  exp: claims.exp,
                },
              }
            }
          )
          .done(
            function (result) {
              return reply.continue(result)
            },
            function (err) {
              return reply(err.code ? err : error.invalidToken())
            }
          )
        },

        payload: function (request, reply) {
          if (!request.auth.artifacts.payloadLoad) {
            return reply(boom.unauthorized(null, 'Hawt'))
          }
          throw new Error('TODO: payload verification not implemented yet')
        }

      }
    })
    next()
  }

  function decodeAndVerifyJWT(token) {
    var d = P.defer()
    var decoded = jws.decode(token)
    if (!decoded) {
      d.reject(error.invalidToken())
    } else {
      jwks.get(decoded.header.jku, decoded.header.kid)
        .then(
          function (key) {
            var parts = token.split('.')
            key.verify(parts[0] + '.' + parts[1], b64urltohex(parts[2]),
              function (err, result) {
                if (err) {
                  return d.reject(err)
                }
                if (!result) {
                  return d.reject(error.invalidSignature())
                }
                var claims = parseClaims(parts[1]) 
                var now = Math.floor(Date.now() / 1000)
                if (!claims.exp || claims.exp < now) {
                  return d.reject(error.invalidTimestamp())
                }
                if (claims.iat && claims.iat > now) {
                  return d.reject(error.invalidTimestamp())
                }
                if (claims.iat && claims.iat > claims.exp) {
                  return d.reject(error.invalidTimestamp())
                }
                if (!claims.aud || claims.aud !== config.domain) {
                  return d.reject('TODO: a new errno?')
                }
                if (!claims.nce) {
                  return d.reject(error.invalidNonce())
                }
                if (!claims.qsh) {
                  return d.reject(error.invalidSignature())
                }
                claims.jku = decoded.header.jku
                d.resolve(claims)
              }
            )
          }
        )
    }
    return d.promise
  }

  function parseClaims(str) {
    try { return JSON.parse(Buffer(str, 'base64')) } catch (e) { return {} }
  }

  function calculateQueryHash(request, claims) {
    var path = request.url || ''
    if (path && path[0] !== '/') {
      path = url.parse(path, false).path
    }
    var queryStr = 'hawt.1.query\n' +
                   claims.nonce + '\n' +
                   request.method.toUpperCase() + '\n' +
                   path + '\n' +
                   (claims.psh || '') + '\n'
    return getHash(queryStr)
  }

  function verifyQueryHash(request, claims) {
    var hash = calculateQueryHash(request, claims)
    // Note: no secrets, no need for constant-time comparison.
    if (hash !== claims.qsh) {
      throw error.invalidSignature()
    }
    return claims
  }

  function getHash(data) {
    var hasher = crypto.createHash('sha256')
    hasher.update(data)
    return hasher.digest('base64')
  }

  Hawt.attributes = {
    name: 'hawt'
  }

  Hawt._calculateQueryHash = calculateQueryHash

  return Hawt

}
