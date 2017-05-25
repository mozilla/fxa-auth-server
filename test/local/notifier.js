/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const ROOT_DIR = '../..'

const proxyquire = require('proxyquire')
const assert = require('insist')
const sinon = require('sinon')

describe('notifier', () => {
  const log = {
    error: sinon.spy(),
    trace: sinon.spy()
  }

  beforeEach(() => {
    log.error.reset()
    log.trace.reset()
  })

  it('works with sns configuration', () => {
    const config = {
      get: (key) => {
        if (key === 'snsTopicArn') {
          return 'arn:aws:sns:us-west-2:927034868275:foo'
        }
      }
    }

    const notifier = proxyquire(`${ROOT_DIR}/lib/notifier`, {
      '../config': config
    })(log)

    notifier.__sns.publish = sinon.spy((event, cb) => {
      cb(null, event)
    })

    const evt = {
      event: 'verified',
      data: { 'asdf': 42 }
    }

    notifier.send(evt)

    assert.deepEqual(log.trace.args[0][0], {
      op: 'Notifier.publish',
      data: {
        TopicArn: 'arn:aws:sns:us-west-2:927034868275:foo',
        Message: '{\"asdf\":42,\"event\":\"verified\"}'
      },
      success: true
    })
    assert.equal(log.error.called, false)
  })

  it('does not publish config events', () => {
    const config = {
      get: (key) => {
        if (key === 'snsTopicArn') {
          return 'arn:aws:sns:us-west-2:927034868275:foo'
        }
      }
    }

    const notifier = proxyquire(`${ROOT_DIR}/lib/notifier`, {
      '../config': config
    })(log)

    notifier.__sns.publish = sinon.spy((event, cb) => {
      cb(null, event)
    })

    const evt = {
      event: 'config',
      data: { 'something': 99 }
    }

    notifier.send(evt)

    assert.equal(log.trace.called, false)
    assert.equal(log.error.called, false)
  })

  it('works with disabled configuration', () => {
    const config = {
      get: (key) => {
        if (key === 'snsTopicArn') {
          return 'disabled'
        }
      }
    }
    const notifier = proxyquire(`${ROOT_DIR}/lib/notifier`, {
      '../config': config
    })(log)

    const evt = {
      event: 'verified',
      data: { 'somethingelse': 99 }
    }

    notifier.send(evt, () => {
      assert.deepEqual(log.trace.args[0][0], {
        op: 'Notifier.publish',
        data: {
          disabled: true
        },
        success: true
      })
      assert.equal(log.trace.args[0][0].data.disabled, true)
      assert.equal(log.error.called, false)
    })

  })

})
