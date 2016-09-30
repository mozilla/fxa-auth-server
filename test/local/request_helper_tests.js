/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const test = require('../ptaptest')
const requestHelper = require('../../lib/routes/utils/request_helper')

test(
  'interface is correct',
  t => {
    t.equal(typeof requestHelper, 'object', 'object type should be exported')
    t.equal(Object.keys(requestHelper).length, 2, 'object should have two properties')
    t.equal(typeof requestHelper.wantsKeys, 'function', 'wantsKeys should be function')
    t.equal(typeof requestHelper.shouldSendVerifyAccountEmail, 'function', 'shouldSendVerifyAccountEmail should be function')

    t.end()
  }
)

test(
  'wantsKeys',
  t => {
    t.equal(!! requestHelper.wantsKeys({}), false, 'should return falsey if request.query is not set')
    t.equal(requestHelper.wantsKeys({ query: {} }), false, 'should return false if query.keys is not set')
    t.equal(requestHelper.wantsKeys({ query: { keys: 'wibble' } }), false, 'should return false if keys is not true')
    t.equal(requestHelper.wantsKeys({ query: { keys: 'true' } }), true, 'should return true if keys is true')

    t.end()
  }
)

test(
  'shouldSendVerifyAccountEmail',
  t => {
    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: false,
    }, {
      query: {
        sendEmailIfUnverified: 'true'
      }
    }), true, 'should return true when request has no payload and account is not verified')

    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: true,
    }, {
      query: {
        sendEmailIfUnverified: 'true'
      }
    }), false, 'should return false when request has no payload and account is verified')

    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: false,
    }, {
      payload: {},
      query: {
        sendEmailIfUnverified: 'true'
      }
    }), true, 'should return true when payload has no metrics context and account is not verified')

    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: true,
    }, {
      payload: {},
      query: {
        sendEmailIfUnverified: 'true'
      }
    }), false, 'should return false when payload has no metrics context and account is verified')

    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: false,
    }, {
      payload: {
        metricsContext: {}
      },
      query: {
        sendEmailIfUnverified: 'true'
      }
    }), true, 'should return true when payload has metrics context and sendEmailIfUnverified is set and account is not verified')

    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: true,
    }, {
      payload: {
        metricsContext: {}
      },
      query: {
        sendEmailIfUnverified: 'true'
      }
    }), false, 'should return false when payload has metrics context and sendEmailIfUnverified is set and account is verified')

    t.equal(requestHelper.shouldSendVerifyAccountEmail({
      emailVerified: false,
    }, {
      payload: {
        metricsContext: {}
      },
      query: {}
    }), false, 'should return false when payload has metrics context and sendEmailIfUnverified is not set and account is not verified')

    t.end()
  }
)

