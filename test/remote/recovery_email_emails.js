/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
var TestServer = require('../test_server')
const Client = require('../client')()
var config = require('../../config').getProperties()

let server
let client
let email
const password = 'allyourbasearebelongtous'

describe('remote emails', function () {
  this.timeout(30000)

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
      'fails create when email is user primary email',
      () => {
        return client.createEmail(email)
          .then(assert.fail)
          .catch((err) => {
            assert.equal(err.errno, 139, 'email already exists errno')
            assert.equal(err.code, 400, 'email already exists code')
            assert.equal(err.message, 'Can not add secondary email that is same as primary', 'correct error message')
          })
      }
    )

    it(
      'fails create when email exists in user emails',
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
      'fails create when email exists in other user account',
      () => {
        const anotherUserEmail = server.uniqueEmail()
        const anotherUserSecondEmail = server.uniqueEmail()
        let anotherClient
        return Client.createAndVerify(config.publicUrl, anotherUserEmail, password, server.mailbox)
          .then((x) => {
            anotherClient = x
            assert.ok(client.authAt, 'authAt was set')
            return anotherClient.createEmail(anotherUserSecondEmail)
          })
          .then((res) => {
            assert.ok(res, 'ok response')
            return client.createEmail(anotherUserSecondEmail)
              .then(assert.fail)
          })
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

  describe('receives email confirmations on added email', () => {
    let secondEmail
    let thirdEmail
    beforeEach(() => {
      secondEmail = server.uniqueEmail()
      thirdEmail = server.uniqueEmail()
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

          // Create a third email but don't verify it. This should not appear in the cc-list
          return client.createEmail(thirdEmail)
        })
    })

    it(
      'receives sign-in confirmation email',
      () => {
        let emailCode
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
            assert.equal(emailData.cc.length, 1)
            assert.equal(emailData.cc[0].address, secondEmail)
          })
      }
    )

    it(
      'receives sign-in unblock email',
      () => {
        return client.sendUnblockCode(email)
          .then(() => {
            return server.mailbox.waitForEmail(email)
          })
          .then((emailData) => {
            const templateName = emailData['headers']['x-template-name']
            const code = emailData['headers']['x-unblock-code']
            assert.equal(templateName, 'unblockCodeEmail', 'email template name set')
            assert.ok(code, 'code set')
            assert.equal(emailData.cc.length, 1)
            assert.equal(emailData.cc[0].address, secondEmail)
          })
      }
    )
  })

  describe('receives email notifications on added email', () => {
    let secondEmail
    let thirdEmail
    beforeEach(() => {
      secondEmail = server.uniqueEmail()
      thirdEmail = server.uniqueEmail()
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

          // Create a third email that is unverified. User should receive notifications
          // on this email, even thought it is not been verified
          return client.createEmail(thirdEmail)
        })
    })

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
            assert.equal(emailData.cc.length, 2)
            assert.equal(emailData.cc[0].address, secondEmail)
            assert.equal(emailData.cc[1].address, thirdEmail)
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
            assert.equal(emailData.cc.length, 2)
            assert.equal(emailData.cc[0].address, secondEmail)
            assert.equal(emailData.cc[1].address, thirdEmail)
          })
      }
    )
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

describe('receives new device sign-in email', function () {
  this.timeout(30000)

  let server
  let email
  let client
  let secondEmail
  let thirdEmail

  before(() => {
    process.env.SIGNIN_CONFIRMATION_SKIP_FOR_NEW_ACCOUNTS = true
    return TestServer.start(config)
      .then(s => {
        server = s
        email = server.uniqueEmail()
        secondEmail = server.uniqueEmail()
        thirdEmail = server.uniqueEmail()
        return Client.createAndVerify(config.publicUrl, email, password, server.mailbox)
      })
      .then((x) => {
        client = x
        return client.createEmail(secondEmail)
      })
      .then(() => {
        return server.mailbox.waitForCode(secondEmail)
      })
      .then((code) => {
        return client.verifyEmail(code)
          .then(() => {
            // Clear add secondary email notification
            return server.mailbox.waitForEmail(email)
          })
      })
      .then(() => {
        // Create unverified email
        return client.createEmail(thirdEmail)
      })
  })

  it(
    'receives new device sign-in email',
    () => {
      return client.login({keys: true})
        .then(() => {
          return server.mailbox.waitForEmail(email)
        })
        .then((emailData) => {
          const templateName = emailData['headers']['x-template-name']
          assert.equal(templateName, 'newDeviceLoginEmail', 'email template name set')
          assert.equal(emailData.cc.length, 2)
          assert.equal(emailData.cc[0].address, secondEmail)
          assert.equal(emailData.cc[1].address, thirdEmail)
        })
    }
  )

  after(() => {
    delete process.env.SIGNIN_CONFIRMATION_SKIP_FOR_NEW_ACCOUNTS
    return TestServer.stop(server)
  })
})
