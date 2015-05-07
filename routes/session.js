/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

module.exports = function (log, isA, error, db) {

  var routes = [
    {
      method: 'POST',
      path: '/session/destroy',
      config: {
        auth: {
          strategy: 'sessionToken'
        }
      },
      handler: function (request, reply) {
        log.begin('Session.destroy', request)
        var sessionToken = request.auth.credentials
        db.deleteSessionToken(sessionToken)
          .done(
            function () {
              reply({})
            },
            reply
          )
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
        reply({
          uid: sessionToken.uid.toString('hex'),
          ttl: sessionToken.ttl()
        })
      }
    }
  ]

  return routes
}
