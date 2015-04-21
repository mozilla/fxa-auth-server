/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var config = require('../config').root()

var hapi = require('hapi')
var api = new hapi.Server()
api.connection({
  host: config.oauth.host,
  port: config.oauth.port
})

api.route(
  [
    {
      method: 'POST',
      path: '/v1/verify',
      handler: function (request, reply) {
        var data = JSON.parse(Buffer(request.payload.token, 'hex'))
        return reply(data).code(data.code || 200)
      }
    }
  ]
)

api.start()
