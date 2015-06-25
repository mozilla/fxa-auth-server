/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING

module.exports = function (log, isA, error, db) {

  var routes = [
    {
      method: 'POST',
      path: '/oauth/sessions/revoke',
      config: {
        auth: {
          strategy: 'oauthToken',
          scope: ['account']
        },
        validate: {
          payload: {
            id: isA.string().min(64).max(64).regex(HEX_STRING).required()
          }
        }
      },
      handler: function (request, reply) {
        var accessToken = request.auth.credentials
        return db.sessionToken(Buffer(request.payload.id, 'hex'))
          .then(
            function (token) {
              if (token.uid.toString('hex') !== accessToken.user) {
                throw error.invalidToken()
              }
              if (token.expired(Date.now())) {
                throw error.invalidToken()
              }
              return db.deleteSessionToken(token)
            }
          )
          .done(
            function () {
              reply({})
            },
            reply
          )
      }
    },
    {
      method: 'POST',
      path: '/oauth/keys/revoke',
      config: {
        auth: {
          strategy: 'oauthToken',
          scope: ['account']
        },
        validate: {
          payload: {
            id: isA.string().min(64).max(64).regex(HEX_STRING).required()
          }
        }
      },
      handler: function (request, reply) {
        var accessToken = request.auth.credentials
        return db.keyFetchToken(Buffer(request.payload.id, 'hex'))
          .then(
            function (token) {
              if (token.uid.toString('hex') !== accessToken.user) {
                throw error.invalidToken()
              }
              if (token.expired(Date.now())) {
                throw error.invalidToken()
              }
              return db.deleteKeyFetchToken(token)
            }
          )
          .done(
            function () {
              reply({})
            },
            reply
          )
      }
    }
  ]

  return routes
}
