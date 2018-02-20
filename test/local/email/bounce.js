/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const ROOT_DIR = '../../..'

const assert = require("../../assert")
const bounces = require(`${ROOT_DIR}/lib/email/bounces`)
const error = require(`${ROOT_DIR}/lib/error`)
const { EventEmitter } = require('events')
const { mockLog } = require('../../mocks')
const P = require(`${ROOT_DIR}/lib/promise`)
const sinon = require('sinon')

const mockBounceQueue = new EventEmitter()
mockBounceQueue.start = function start() {}

function mockMessage(msg) {
  msg.del = sinon.spy()
  msg.headers = {}
  return msg
}

function mockedBounces(log, db) {
  return bounces(log, error)(mockBounceQueue, db)
}

describe('bounce messages', () => {
  let log, mockDB
  beforeEach(() => {
    log = mockLog()
    mockDB = {
      createEmailBounce: sinon.spy(() =>P.resolve({})),
      accountRecord: sinon.spy((email) => {
        return P.resolve({
          uid: '123456',
          email: email,
          emailVerified: false
        })
      }),
      deleteAccount: sinon.spy(() => P.resolve({}))
    }
  })

  afterEach(() => {
    mockBounceQueue.removeAllListeners()
  })

  it('should not log an error for headers', () => {
    return mockedBounces(log, {})
      .handleBounce(mockMessage({ junk: 'message' }))
      .then(() => assert.notCalled(log.error));
  })

  it('should log an error for missing headers', () => {
    const message = mockMessage({
      junk: 'message'
    })
    message.headers = undefined
    return mockedBounces(log, {})
      .handleBounce(message)
      .then(() => assert.calledOnce(log.error));
  })

  it('should ignore unknown message types', () => {
    return mockedBounces(log, {}).handleBounce(mockMessage({
      junk: 'message'
    })).then(() =>  {
      assert.notCalled(log.info)
      assert.notCalled(log.error)
      assert.calledOnce(log.warn)
      assert.equal(log.warn.args[0][0].op, 'emailHeaders.keys')
    });
  })

  it('should handle multiple recipients in turn', () => {
    const bounceType = 'Permanent'
    const mockMsg = mockMessage({
      bounce: {
        bounceType: bounceType,
        bouncedRecipients: [
          {emailAddress: 'test@example.com'},
          {emailAddress: 'foobar@example.com'}
        ]
      }
    })
    return mockedBounces(log, mockDB).handleBounce(mockMsg).then(() =>  {
      assert.calledTwice(mockDB.createEmailBounce)
      assert.calledTwice(mockDB.accountRecord)
      assert.calledTwice(mockDB.deleteAccount)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.equal(mockDB.accountRecord.args[1][0], 'foobar@example.com')
      assert.callCount(log.info, 6)
      assert.equal(log.info.args[5][0].op, 'accountDeleted')
      assert.equal(log.info.args[5][0].email, 'foobar@example.com')
      assert.calledOnce(mockMsg.del)
    });
  })

  it('should treat complaints like bounces', () => {
    const complaintType = 'abuse'
    return mockedBounces(log, mockDB).handleBounce(mockMessage({
      complaint: {
        userAgent: 'AnyCompany Feedback Loop (V0.01)',
        complaintFeedbackType: complaintType,
        complainedRecipients: [
          {emailAddress: 'test@example.com'},
          {emailAddress: 'foobar@example.com'}
        ]
      }
    })).then(() =>  {
      assert.calledTwice(mockDB.createEmailBounce)
      assert.equal(mockDB.createEmailBounce.args[0][0].bounceType, 'Complaint')
      assert.equal(mockDB.createEmailBounce.args[0][0].bounceSubType, complaintType)
      assert.calledTwice(mockDB.accountRecord)
      assert.calledTwice(mockDB.deleteAccount)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.equal(mockDB.accountRecord.args[1][0], 'foobar@example.com')
      assert.callCount(log.info, 6)
      assert.equal(log.info.args[0][0].op, 'emailEvent')
      assert.equal(log.info.args[0][0].domain, 'other')
      assert.equal(log.info.args[0][0].type, 'bounced')
      assert.equal(log.info.args[4][0].complaint, true)
      assert.equal(log.info.args[4][0].complaintFeedbackType, complaintType)
      assert.equal(log.info.args[4][0].complaintUserAgent, 'AnyCompany Feedback Loop (V0.01)')
    });
  })

  it('should not delete verified accounts on bounce', () => {
    mockDB.accountRecord = sinon.spy((email) => {
      return P.resolve({
        uid: '123456',
        email: email,
        emailVerified: (email === 'verified@example.com')
      })
    })

    return mockedBounces(log, mockDB).handleBounce(mockMessage({
      bounce: {
        bounceType: 'Permanent',
        // docs: http://docs.aws.amazon.com/ses/latest/DeveloperGuide/notification-contents.html#bounced-recipients
        bouncedRecipients: [
          { emailAddress: 'test@example.com', action: 'failed', status: '5.0.0', diagnosticCode: 'smtp; 550 user unknown' },
          { emailAddress: 'verified@example.com', status: '4.0.0' }
        ]
      }
    })).then(() =>  {
      assert.calledTwice(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.equal(mockDB.accountRecord.args[1][0], 'verified@example.com')
      assert.calledOnce(mockDB.deleteAccount)
      assert.equal(mockDB.deleteAccount.args[0][0].email, 'test@example.com')
      assert.callCount(log.info, 5)
      assert.equal(log.info.args[1][0].op, 'handleBounce')
      assert.equal(log.info.args[1][0].email, 'test@example.com')
      assert.equal(log.info.args[1][0].domain, 'other')
      assert.equal(log.info.args[1][0].status, '5.0.0')
      assert.equal(log.info.args[1][0].action, 'failed')
      assert.equal(log.info.args[1][0].diagnosticCode, 'smtp; 550 user unknown')
      assert.equal(log.info.args[2][0].op, 'accountDeleted')
      assert.equal(log.info.args[2][0].email, 'test@example.com')
      assert.equal(log.info.args[4][0].op, 'handleBounce')
      assert.equal(log.info.args[4][0].email, 'verified@example.com')
      assert.equal(log.info.args[4][0].status, '4.0.0')
    });
  })

  it('should log errors when looking up the email record', () => {
    mockDB.accountRecord = sinon.spy(() => P.reject(new error({})))
    const mockMsg = mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [
          {emailAddress: 'test@example.com'},
        ]
      }
    })
    return mockedBounces(log, mockDB).handleBounce(mockMsg).then(() =>  {
      assert.calledOnce(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.calledTwice(log.info)
      assert.equal(log.info.args[1][0].op, 'handleBounce')
      assert.equal(log.info.args[1][0].email, 'test@example.com')
      assert.calledTwice(log.error)
      assert.equal(log.error.args[1][0].op, 'databaseError')
      assert.equal(log.error.args[1][0].email, 'test@example.com')
      assert.calledOnce(mockMsg.del)
    });
  })

  it('should log errors when deleting the email record', () => {
    mockDB.deleteAccount = sinon.spy(() => P.reject(new error.unknownAccount('test@example.com')))
    const mockMsg = mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [
          {emailAddress: 'test@example.com'},
        ]
      }
    })
    return mockedBounces(log, mockDB).handleBounce(mockMsg).then(() =>  {
      assert.calledOnce(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.calledOnce(mockDB.deleteAccount)
      assert.equal(mockDB.deleteAccount.args[0][0].email, 'test@example.com')
      assert.calledTwice(log.info)
      assert.equal(log.info.args[1][0].op, 'handleBounce')
      assert.equal(log.info.args[1][0].email, 'test@example.com')
      assert.calledTwice(log.error)
      assert.equal(log.error.args[1][0].op, 'databaseError')
      assert.equal(log.error.args[1][0].email, 'test@example.com')
      assert.equal(log.error.args[1][0].err.errno, error.ERRNO.ACCOUNT_UNKNOWN)
      assert.calledOnce(mockMsg.del)
    });
  })

  it('should normalize quoted email addresses for lookup', () => {
    mockDB.accountRecord = sinon.spy((email) => {
      // Lookup only succeeds when using original, unquoted email addr.
      if (email !== 'test.@example.com') {
        return P.reject(new error.unknownAccount(email))
      }
      return P.resolve({
        uid: '123456',
        email: email,
        emailVerified: false
      })
    })
    return mockedBounces(log, mockDB).handleBounce(mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [
          // Bounce message has email addr in quoted form, since some
          // mail agents normalize it in this way.
          {emailAddress: '"test."@example.com'},
        ]
      }
    })).then(() =>  {
      assert.calledOnce(mockDB.createEmailBounce)
      assert.equal(mockDB.createEmailBounce.args[0][0].email, 'test.@example.com')
      assert.calledOnce(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test.@example.com')
      assert.calledOnce(mockDB.deleteAccount)
      assert.equal(mockDB.deleteAccount.args[0][0].email, 'test.@example.com')
    });
  })

  it('should handle multiple consecutive dots even if not quoted', () => {
    mockDB.accountRecord = sinon.spy((email) => {
      // Lookup only succeeds when using original, unquoted email addr.
      if (email !== 'test..me@example.com') {
        return P.reject(new error.unknownAccount(email))
      }
      return P.resolve({
        uid: '123456',
        email: email,
        emailVerified: false
      })
    })

    return mockedBounces(log, mockDB).handleBounce(mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [
          // Some mail agents incorrectly fail to quote addresses that
          // contain multiple consecutive dots.  Ensure we work around it.
          {emailAddress: 'test..me@example.com'},
        ]
      }
    })).then(() =>  {
      assert.calledOnce(mockDB.createEmailBounce)
      assert.equal(mockDB.createEmailBounce.args[0][0].email, 'test..me@example.com')
      assert.calledOnce(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test..me@example.com')
      assert.calledOnce(mockDB.deleteAccount)
      assert.equal(mockDB.deleteAccount.args[0][0].email, 'test..me@example.com')
    });
  })

  it('should log a warning if it receives an unparseable email address', () => {
    mockDB.accountRecord = sinon.spy(() => P.reject(new error.unknownAccount()))
    return mockedBounces(log, mockDB).handleBounce(mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [
          {emailAddress: 'how did this even happen?'},
        ]
      }
    })).then(() =>  {
      assert.notCalled(mockDB.createEmailBounce)
      assert.notCalled(mockDB.accountRecord)
      assert.notCalled(mockDB.deleteAccount)
      assert.calledTwice(log.warn)
      assert.equal(log.warn.args[1][0].op, 'handleBounce.addressParseFailure')
    });
  })

  it('should log email template name, language, and bounceType', () => {
    const mockMsg = mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [
          {emailAddress: 'test@example.com'}
        ]
      },
      mail: {
        headers: [
          {
            name: 'Content-Language',
            value: 'db-LB'
          },
          {
            name: 'X-Template-Name',
            value: 'verifyLoginEmail'
          }
        ]
      }
    })

    return mockedBounces(log, mockDB).handleBounce(mockMsg).then(() =>  {
      assert.calledOnce(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.calledOnce(mockDB.deleteAccount)
      assert.equal(mockDB.deleteAccount.args[0][0].email, 'test@example.com')
      assert.calledThrice(log.info)
      assert.equal(log.info.args[1][0].op, 'handleBounce')
      assert.equal(log.info.args[1][0].email, 'test@example.com')
      assert.equal(log.info.args[1][0].template, 'verifyLoginEmail')
      assert.equal(log.info.args[1][0].bounceType, 'Permanent')
      assert.equal(log.info.args[1][0].bounceSubType, 'General')
      assert.equal(log.info.args[1][0].lang, 'db-LB')
    });
  })

  it('should emit flow metrics', () => {
    const mockMsg = mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [
          {emailAddress: 'test@example.com'}
        ]
      },
      mail: {
        headers: [
          {
            name: 'X-Template-Name',
            value: 'verifyLoginEmail'
          },
          {
            name: 'X-Flow-Id',
            value: 'someFlowId'
          },
          {
            name: 'X-Flow-Begin-Time',
            value: '1234'
          },
          {
            name: 'Content-Language',
            value: 'en'
          }
        ]
      }
    })

    return mockedBounces(log, mockDB).handleBounce(mockMsg).then(function () {
      assert.calledOnce(mockDB.accountRecord)
      assert.equal(mockDB.accountRecord.args[0][0], 'test@example.com')
      assert.calledOnce(mockDB.deleteAccount)
      assert.equal(mockDB.deleteAccount.args[0][0].email, 'test@example.com')
      assert.calledOnce(log.flowEvent)
      assert.equal(log.flowEvent.args[0][0].event, 'email.verifyLoginEmail.bounced')
      assert.equal(log.flowEvent.args[0][0].flow_id, 'someFlowId')
      assert.equal(log.flowEvent.args[0][0].flow_time > 0, true)
      assert.equal(log.flowEvent.args[0][0].time > 0, true)
      assert.calledThrice(log.info)
      assert.equal(log.info.args[0][0].op, 'emailEvent')
      assert.equal(log.info.args[0][0].type, 'bounced')
      assert.equal(log.info.args[0][0].template, 'verifyLoginEmail')
      assert.equal(log.info.args[0][0].flow_id, 'someFlowId')
    });
  })

  it('should log email domain if popular one', () => {
    const mockMsg = mockMessage({
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [
          {emailAddress: 'test@aol.com'}
        ]
      },
      mail: {
        headers: [
          {
            name: 'X-Template-Name',
            value: 'verifyLoginEmail'
          },
          {
            name: 'X-Flow-Id',
            value: 'someFlowId'
          },
          {
            name: 'X-Flow-Begin-Time',
            value: '1234'
          },
          {
            name: 'Content-Language',
            value: 'en'
          }
        ]
      }
    })

    return mockedBounces(log, mockDB).handleBounce(mockMsg).then(function () {
      assert.calledOnce(log.flowEvent)
      assert.equal(log.flowEvent.args[0][0].event, 'email.verifyLoginEmail.bounced')
      assert.equal(log.flowEvent.args[0][0].flow_id, 'someFlowId')
      assert.equal(log.flowEvent.args[0][0].flow_time > 0, true)
      assert.equal(log.flowEvent.args[0][0].time > 0, true)
      assert.calledThrice(log.info)
      assert.equal(log.info.args[0][0].op, 'emailEvent')
      assert.equal(log.info.args[0][0].domain, 'aol.com')
      assert.equal(log.info.args[0][0].type, 'bounced')
      assert.equal(log.info.args[0][0].template, 'verifyLoginEmail')
      assert.equal(log.info.args[0][0].locale, 'en')
      assert.equal(log.info.args[0][0].flow_id, 'someFlowId')
      assert.equal(log.info.args[1][0].email, 'test@aol.com')
      assert.equal(log.info.args[1][0].domain, 'aol.com')
    });
  })
})
