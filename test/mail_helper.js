/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-disable no-console */

'use strict'
const MailParser = require('mailparser').MailParser
const simplesmtp = require('simplesmtp')
const P = require('../lib/promise')

const config = require('../config').getProperties()

const TEMPLATES_WITH_NO_CODE = new Set([
  'passwordResetEmail'
])

// SMTP half

var users = {}

function emailName(emailAddress) {
  var utf8Address = Buffer.from(emailAddress, 'binary').toString('utf-8')
  return utf8Address.split('@')[0]
}

module.exports = (printLogs) => {
  printLogs = printLogs || process.env.MAIL_HELPER_LOGS
  const console = printLogs ? global.console : {
    log() {},
    error() {}
  }
  return new P((resolve, reject) => {
    const smtp = simplesmtp.createSimpleServer(
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
            var sc = mail.headers['x-signin-verify-code']
            var template = mail.headers['x-template-name']

            var smsLink
            if (/MockNexmo\.message\.sendSms/.test(mail.subject)) {
              const smsUrlMatch = /(https?:\/\/.*$)/.exec(mail.text)
              smsLink = smsUrlMatch && smsUrlMatch[1]
            }

            var name = emailName(mail.headers.to)
            if (vc) {
              console.log('\x1B[32m', link, '\x1B[39m')
            }
            else if (sc) {
              console.log('\x1B[32mToken code: ', sc, '\x1B[39m')
            }
            else if (rc) {
              console.log('\x1B[34m', link, '\x1B[39m')
            }
            else if (uc) {
              console.log('\x1B[36mUnblock code:', uc, '\x1B[39m')
              console.log('\x1B[36mReport link:', rul, '\x1B[39m')
            }
            else if (smsLink) {
              console.log('\x1B[36mSMS link:', smsLink, '\x1B[39m')
            }
            else if (TEMPLATES_WITH_NO_CODE.has(template)) {
              console.log(`Notification email: ${template}`)
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

            if (mail.headers.cc) {
              // Support for CC headers
              var ccName = emailName(mail.headers.cc)

              if (users[ccName]) {
                users[ccName].push(mail)
              } else {
                users[ccName] = [mail]
              }
            }
          }
        )
        req.pipe(mp)
        req.accept()
      }
    )
    smtp.listen(config.smtp.port, config.smtp.host)

    // HTTP half

    var hapi = require('hapi')
    var api = new hapi.Server({
        host: config.smtp.api.host,
        port: config.smtp.api.port
    })

    async function loop(email) {
      var mail = users[email]
      if (! mail) {
        return new Promise((res) => {
          setTimeout(() => {
            loop(email).then(res)
          }, 50)
        })
       }
      return users[email]
    }

    api.route(
      [
        {
          method: 'GET',
          path: '/mail/{email}',
          handler: async function (request, h) {
             const emailData = await loop(
               decodeURIComponent(request.params.email)
              )
             return emailData
          }
        },
        {
          method: 'DELETE',
          path: '/mail/{email}',
          handler: async function (request, h) {
            return delete users[decodeURIComponent(request.params.email)]
          }
        }
      ]
    )

    api.start().then(() => {
      console.log('mail_helper started...')

      resolve({
        close() {
          return new P((resolve, reject) => {
            let smtpClosed = false
            let apiClosed = false
            smtp.server.end(() => {
              smtpClosed = true
              if (apiClosed) {
                resolve()
              }
            })
            api.stop().then(() => {
              apiClosed = true
              if (smtpClosed) {
                resolve()
              }
            })
          })
        }
      })
    })
  })
}

if (require.main === module) {
  module.exports(true)
}
