/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var qs = require('querystring')
var hapi = require('hapi')
var config = require('../config').root()

var users = {}

var api = hapi.createServer(config.smtp.api.host, config.smtp.api.port)

function loop(email, cb) {
  var mail = users[email]
  if (!mail) {
    return setTimeout(loop.bind(null, email, cb), 50)
  }
  cb(mail)
}

api.route(
  [
    {
      method: 'GET',
      path: '/mail/{email}',
      handler: function (request, reply) {
        loop(
          request.params.email,
          function (emailData) {
            reply(emailData)
          }
        )
      }
    },
    {
      method: 'DELETE',
      path: '/mail/{email}',
      handler: function (request, reply) {
        delete users[request.params.email]
        reply()
      }
    },
    {
      method: 'POST',
      path: '/send',
      handler: function (request, reply) {
        var message = request.payload
        var name = message.email.split('@')[0]
        var email = { headers: {} }
        var query = {
          code: message.code
        }
        if (message.service) { query.service = message.service }
        if (message.redirectTo) { query.redirectTo = message.redirectTo }

        if (message.type === 'verifyEmail') {
          query.uid = message.uid
          email.headers['x-verify-code'] = message.code
        }
        else if (message.type === 'recoveryEmail') {
          query.token = message.token
          query.email = message.email
          email.headers['x-recovery-code'] = message.code
        }
        email.headers['x-link'] = 'http://127.0.0.1/v?' + qs.stringify(query)
        if (users[name]) {
          users[name].push(email)
        } else {
          users[name] = [email]
        }
        reply({})
      }
    }
  ]
)

api.start()
