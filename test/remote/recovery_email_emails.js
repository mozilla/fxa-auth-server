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
      .then(function (x) {
        client = x
        assert.ok(client.authAt, 'authAt was set')
      })
      .then(function () {
        return client.emailStatus()
      })
      .then(function (status) {
        assert.equal(status.verified, true, 'account is verified')
      })
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
            assert.equal(res[0].verified, true, 'returns correct verified')
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
            assert.equal(res[1].verified, false, 'returns correct verified')
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
            assert.equal(res[2].verified, false, 'returns correct verified')
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
            assert.equal(err.errno, 136, 'email already exists errno')
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
            assert.equal(err.errno, 136, 'email already exists errno')
            assert.equal(err.code, 400, 'email already exists code')
            assert.equal(err.message, 'Email already exists', 'correct error message')
          })
      }
    )

    it(
      'fails for unverified session',
      () => {
        const secondEmail = server.uniqueEmail()
        return client.login()
          .then(() => {
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 1, 'returns number of emails')
            assert.equal(res[0].email, email, 'returns correct email')
            assert.equal(res[0].isPrimary, true, 'returns correct isPrimary')
            assert.equal(res[0].verified, true, 'returns correct verified')
            return client.createEmail(secondEmail)
              .then(() => {
                assert.fail(new Error('Should not have created email'))
              })
          })
          .catch((err) => {
            assert.equal(err.code, 400, 'correct error code')
            assert.equal(err.errno, 138, 'correct error errno unverified session')
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
          assert.equal(res[1].verified, false, 'returns correct verified')
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
            assert.equal(res[1].verified, true, 'returns correct verified')
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'postVerifySecondaryEmail', 'email template name set')
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
            assert.equal(res[1].verified, true, 'returns correct verified')
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
          assert.equal(res[1].verified, false, 'returns correct verified')
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
            assert.equal(res[0].verified, true, 'returns correct verified')
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
            assert.equal(err.errno, 137, 'correct error errno')
            assert.equal(err.code, 400, 'correct error code')
            assert.equal(err.message, 'Can not delete primary email', 'correct error message')
          })
      }
    )

    it(
      'fails for unverified session',
      () => {
        return client.login()
          .then(() => {
            return client.accountEmails()
          })
          .then((res) => {
            assert.equal(res.length, 2, 'returns number of emails')
            assert.equal(res[1].email, secondEmail, 'returns correct email')
            assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
            assert.equal(res[1].verified, false, 'returns correct verified')
            return client.deleteEmail(secondEmail)
              .then(() => {
                assert.fail(new Error('Should not have deleted email'))
              })
          })
          .catch((err) => {
            assert.equal(err.code, 400, 'correct error code')
            assert.equal(err.errno, 138, 'correct error errno unverified session')
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
          assert.equal(res[1].verified, true, 'returns correct verified')
          return server.mailbox.waitForEmail(email)
        })
        .then((emailData) => {
          const templateName = emailData['headers']['x-template-name']
          assert.equal(templateName, 'postVerifySecondaryEmail', 'email template name set')
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
      'receives change password notification',
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

    it(
      'receives password reset notification',
      () => {
        return client.forgotPassword()
          .then(() => {
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            return emailData.headers['x-recovery-code']
          })
          .then((code) => {
            return resetPassword(client, code, 'password1', undefined, undefined)
          })
          .then((res) => {
            assert.ok(res)
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'passwordResetEmail', 'email template name set')
            return server.mailbox.waitForEmail(secondEmail)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'passwordResetEmail', 'email template name set')
          })
      }
    )

    it(
      'does not send to unverified secondary emails',
      () => {
        return client.deleteEmail(secondEmail)
          .then((res) => {
            assert.ok(res)
            return client.createEmail(secondEmail)
          })
          .then((res) => {
            assert.ok(res)
            return server.mailbox.waitForEmail(secondEmail)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'verifySecondaryEmail', 'email template name set')
            return client.accountEmails()
          })
          .then((res) => {
            assert.ok(res)
            assert.equal(res.length, 2, 'returns number of emails')
            assert.equal(res[1].email, secondEmail, 'returns correct email')
            assert.equal(res[1].isPrimary, false, 'returns correct isPrimary')
            assert.equal(res[1].verified, false, 'returns correct verified')
            return client.changePassword('password1', undefined)
          })
          .then((res) => {
            assert.ok(res)
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            assert.equal(templateName, 'passwordChangedEmail', 'email template name set')

            // TODO How to test that an email did not arrive?
            // return server.mailbox.waitForEmail(secondEmail, 3)
          })
      })
  })

  after(() => {
    return TestServer.stop(server)
  })

  function resetPassword(client, code, newPassword, headers, options) {
    return client.verifyPasswordResetCode(code, headers, options)
      .then(function () {
        return client.resetPassword(newPassword, {}, options)
      })
  }
})
