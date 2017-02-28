/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var validators = require('./validators')
var HEX_STRING = validators.HEX_STRING

module.exports = function (log, isA, error, db) {
  var routes = [
    {
      method: 'POST',
      path: '/session/destroy',
      config: {
        auth: {
          strategy: 'sessionToken'
        },
        validate: {
          payload: {
            customSessionToken: isA.string().min(64).max(64).regex(HEX_STRING).optional()
          }
        }
      },
      handler: function (request, reply) {
        log.begin('Session.destroy', request)
        var sessionToken = request.auth.credentials
        var uid = request.auth.credentials.uid
        var uidHex = uid.toString('hex')

        if(request.payload.customSessionToken) {
          var customToken = request.payload.customSessionToken
          return db.sessionToken(customToken)
            .then(function (tokenData) {
              // NOTE: validate that the token belongs to the same user
              if (tokenData && uidHex === tokenData.uid.toString('hex')) {
                return db.deleteSessionToken({
                  id: customToken,
                  uid: uidHex
                })
                  .then(
                    function () {
                      reply({})
                    },
                    reply
                  )
              } else {
                throw error.invalidToken('Invalid session token')
              }
            })

        } else {
          return db.deleteSessionToken(sessionToken)
            .then(
              function () {
                reply({})
              },
              reply
            )
        }
      }
    },
    {
      method: 'GET',
      path: '/session/status',
      config: {
        auth: {
          strategy: 'sessionToken'
        }
      },
      handler: function (request, reply) {
        log.begin('Session.status', request)
        var sessionToken = request.auth.credentials
        reply({ uid: sessionToken.uid.toString('hex') })
      }
    }
  ]

  return routes
}
