/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
var TestServer = require('../test_server')
const Client = require('../client')()
var config = require('../../config').getProperties()

describe('remote emails', function () {
  this.timeout(30000)
  let server
  let client
  let email
  const password = 'allyourbasearebelongtous'

  before(() => {
    process.env.IP_PROFILING_ENABLED = false

    return TestServer.start(config)
      .then(s => {
        server = s
      })
  })

  beforeEach(() => {
    email = server.uniqueEmail()
    return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
      .then(
        function (x) {
          client = x
          assert.ok(client.authAt, 'authAt was set')
        }
      )
      .then(
        function () {
          return client.emailStatus()
        }
      )
      .then(
        function (status) {
          assert.equal(status.verified, true, 'account is verified')
        }
      )
  })

  describe('create and get additional email', () => {
    it(
      'can create',
      () => {
        const secondEmail = server.uniqueEmail()
        const thirdEmail = server.uniqueEmail()
        return client.accountEmails()
          .then((res) => {
            assert.equal(res.length, 1, 'returns number of emails')
            assert.equal(res[0].email, email, 'returns correct email')
            assert.equal(res[0].isPrimary, true, 'returns correct isPrimary')
            assert.equal(res[0].isVerified, true, 'returns correct isVerified')
            return client.createEmail(secondEmail)
          })
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 2, 'returns number of emails')
            assert.equal(res[1].email, secondEmail, 'returns correct email')
            assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
            assert.equal(res[1].isVerified, false, 'returns correct isVerified')
            return client.createEmail(thirdEmail)
          })
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 3, 'returns number of emails')
            assert.equal(res[2].email, thirdEmail, 'returns correct email')
            assert.equal(res[2].isPrimary, false, 'returns correct isPrimary')
            assert.equal(res[2].isVerified, false, 'returns correct isVerified')
          })
          .catch((err) => {
            assert.fail(err)
          })
      }
    )

    it(
      'fails create when email exists in user account',
      () => {
        const secondEmail = email
        return client.createEmail(secondEmail)
          .then(assert.fail)
          .catch((err) => {
            assert.equal(err.errno, 301, 'email already exists errno')
            assert.equal(err.code, 400, 'email already exists code')
          })
      }
    )

    it(
      'fails create when email exists in emails table',
      () => {
        const secondEmail = server.uniqueEmail()
        return client.createEmail(secondEmail)
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.createEmail(secondEmail)
          })
          .then(assert.fail)
          .catch((err) => {
            assert.equal(err.errno, 301, 'email already exists errno')
            assert.equal(err.code, 400, 'email already exists code')
            assert.equal(err.message, 'Email already exists', 'correct error message')
          })
      }
    )
  })

  describe('verify additional email', () => {
    let secondEmail
    beforeEach(() => {
      secondEmail = server.uniqueEmail()
      return client.createEmail(secondEmail)
        .then((res) => {
          assert.ok(res, 'ok response')
          return client.accountEmails()
        })
        .then((res) => {
          assert.equal(res.length, 2, 'returns number of emails')
          assert.equal(res[1].email, secondEmail, 'returns correct email')
          assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
          assert.equal(res[1].isVerified, false, 'returns correct isVerified')
        })
    })

    it(
      'can verify',
      () => {
        return server.mailbox.waitForEmail(secondEmail)
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            const emailCode = emailData['headers']['x-verify-code']
            assert.equal(templateName, 'verifySecondaryEmail', 'email template name set')
            assert.ok(emailCode, 'emailCode set')
            return client.verifyEmail(emailCode)
          })
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 2, 'returns number of emails')
            assert.equal(res[1].email, secondEmail, 'returns correct email')
            assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
            assert.equal(res[1].isVerified, true, 'returns correct isVerified')
          })
      }
    )

    it(
      'does not verify on random email code',
      () => {
        return server.mailbox.waitForEmail(secondEmail)
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            const emailCode = emailData['headers']['x-verify-code']
            assert.equal(templateName, 'verifySecondaryEmail', 'email template name set')
            assert.ok(emailCode, 'emailCode set')
            return client.verifyEmail('d092f3155ec8d534a7ee7f53b68e9e8b')
          })
          .then(assert.fail)
          .catch((err) => {
            assert.equal(err.errno, 105, 'correct error errno')
            assert.equal(err.code, 400, 'correct error code')
          })
      }
    )

    it(
      'can resend verify email code for added address',
      () => {
        var emailCode
        return server.mailbox.waitForEmail(secondEmail)
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            emailCode = emailData['headers']['x-verify-code']
            assert.equal(templateName, 'verifySecondaryEmail', 'email template name set')
            assert.ok(emailCode, 'emailCode set')
            client.options.email = secondEmail
            return client.requestVerifyEmail()
          })
          .then((res) => {
            assert.ok(res, 'ok response')
            return server.mailbox.waitForEmail(secondEmail)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            const resendEmailCode = emailData['headers']['x-verify-code']
            assert.equal(templateName, 'verifySecondaryEmail', 'email template name set')
            assert.equal(resendEmailCode, emailCode, 'emailCode matches')
            return client.verifyEmail(emailCode)
          })
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 2, 'returns number of emails')
            assert.equal(res[1].email, secondEmail, 'returns correct email')
            assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
            assert.equal(res[1].isVerified, true, 'returns correct isVerified')
          })

      }
    )
  })

  describe('delete additional email', () => {
    let secondEmail
    beforeEach(() => {
      secondEmail = server.uniqueEmail()
      return client.createEmail(secondEmail)
        .then((res) => {
          assert.ok(res, 'ok response')
          return client.accountEmails()
        })
        .then((res) => {
          assert.equal(res.length, 2, 'returns number of emails')
          assert.equal(res[1].email, secondEmail, 'returns correct email')
          assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
          assert.equal(res[1].isVerified, false, 'returns correct isVerified')
        })
    })

    it(
      'can delete',
      () => {
        return client.deleteEmail(secondEmail)
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 1, 'returns number of emails')
            assert.equal(res[0].email, email, 'returns correct email')
            assert.equal(res[0].isPrimary, true, 'returns correct isPrimary')
            assert.equal(res[0].isVerified, true, 'returns correct isVerified')
          })
      }
    )

    it(
      'silient fail on delete non-existent email',
      () => {
        return client.deleteEmail('fill@yourboots.com')
          .then((res) => {
            // User is attempting to delete an email that doesn't exist, make sure nothing blew up
            assert.ok(res, 'ok response')
          })
      }
    )

    it(
      'fail on delete primary account email',
      () => {
        return client.deleteEmail(email)
          .then(assert.fail)
          .catch((err) => {
            assert.equal(err.errno, 302, 'correct error errno')
            assert.equal(err.code, 400, 'correct error code')
            assert.equal(err.message, 'Can not delete primary email', 'correct error message')
          })
      }
    )
  })

  describe('receives email notifications and confirmations on added email', () => {
    let secondEmail
    beforeEach(() => {
      secondEmail = server.uniqueEmail()
      return client.createEmail(secondEmail)
        .then((res) => {
          assert.ok(res, 'ok response')
          return server.mailbox.waitForEmail(secondEmail)
        })
        .then((emailData) => {
          const templateName = emailData['headers']['x-template-name']
          const emailCode = emailData['headers']['x-verify-code']
          assert.equal(templateName, 'verifySecondaryEmail', 'email template name set')
          assert.ok(emailCode, 'emailCode set')
          return client.verifyEmail(emailCode)
        })
        .then((res) => {
          assert.ok(res, 'ok response')
          return client.accountEmails()
        })
        .then((res) => {
          assert.equal(res.length, 2, 'returns number of emails')
          assert.equal(res[1].email, secondEmail, 'returns correct email')
          assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
          assert.equal(res[1].isVerified, true, 'returns correct isVerified')
        })
    })

    it(
      'receives sign-in confirmation email',
      () => {
        let emailCode, secondEmailCode
        return client.login({keys: true})
          .then((res) => {
            assert.ok(res)
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            emailCode = emailData['headers']['x-verify-code']
            assert.equal(templateName, 'verifyLoginEmail', 'email template name set')
            assert.ok(emailCode, 'emailCode set')
            return server.mailbox.waitForEmail(secondEmail)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            secondEmailCode = emailData['headers']['x-verify-code']
            assert.equal(templateName, 'verifyLoginEmail', 'email template name set')
            assert.ok(secondEmailCode, 'emailCode set')
            assert.equal(secondEmailCode, emailCode, 'email coes match')
          })
      }
    )

    it(
      'receives change notification',
      () => {
        return client.changePassword('password1', undefined)
          .then((res) => {
            assert.ok(res)
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'passwordChangedEmail', 'email template name set')
            return server.mailbox.waitForEmail(secondEmail)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'passwordChangedEmail', 'email template name set')
          })

      }
    )
  })

  after(() => {
    return TestServer.stop(server)
  })
})
