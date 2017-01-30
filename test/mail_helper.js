/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-disable no-console */
var config = require('../config').getProperties()

// SMTP half

var MailParser = require('mailparser').MailParser
var users = {}

function emailName(emailAddress) {
  var utf8Address = Buffer.from(emailAddress, 'binary').toString('utf-8')
  return utf8Address.split('@')[0]
}

require('simplesmtp').createSimpleServer(
  {
    SMTPBanner: 'FXATEST'
  },
  function (req) {
    var mp = new MailParser({ defaultCharset: 'utf-8' })
    mp.on('end',
      function (mail) {
        var link = mail.headers['x-link']
        var rc = mail.headers['x-recovery-code']
        var rul = mail.headers['x-report-signin-link']
        var uc = mail.headers['x-unblock-code']
        var vc = mail.headers['x-verify-code']
        var name = emailName(mail.headers.to)
        if (vc) {
          console.log('\x1B[32m', link, '\x1B[39m')
        }
        else if (rc) {
          console.log('\x1B[34m', link, '\x1B[39m')
        }
        else if (uc) {
          console.log('\x1B[36mUnblock code:', uc, '\x1B[39m')
          console.log('\x1B[36mReport link:', rul, '\x1B[39m')

        }
        else {
          console.error('\x1B[31mNo verify code match\x1B[39m')
          console.error(mail)
        }
        if (users[name]) {
          users[name].push(mail)
        } else {
          users[name] = [mail]
        }
      }
    )
    req.pipe(mp)
    req.accept()
  }
).listen(config.smtp.port, config.smtp.host)

// HTTP half

var hapi = require('hapi')
var api = new hapi.Server()
api.connection({
  host: config.smtp.api.host,
  port: config.smtp.api.port
})

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
          decodeURIComponent(request.params.email),
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
        delete users[decodeURIComponent(request.params.email)]
        reply()
      }
    }
  ]
)

api.start(function () {
  console.log('mail_helper started...')
})
