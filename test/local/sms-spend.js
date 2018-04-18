/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require('insist')
const mocks = require('../mocks')
const P = require('../../lib/promise')
const proxyquire = require('proxyquire')
const sinon = require('sinon')

describe('sms-spend:', () => {
  let config, log, results, cloudwatch, sns, smsSpend

  beforeEach(() => {
    config = {
      smtp: {},
      sms: {
        apiRegion: 'foo',
        minimumCreditThreshold: 2
      }
    }
    log = mocks.mockLog()
    results = {
      getMetricsStatistics: { Datapoints: [ { Sum: 0 }, { Sum: 0 } ] },
      getSMSAttributes: { MonthlySpendLimit: config.sms.minimumCreditThreshold }
    }
    cloudwatch = {
      getMetricsStatistics: sinon.spy(() => ({
        promise: () => P.resolve(results.getMetricsStatistics)
      }))
    }
    sns = {
      getSMSAttributes: sinon.spy(() => ({
        promise: () => P.resolve(results.getSMSAttributes)
      }))
    }
    smsSpend = proxyquire('../../lib/sms-spend', {
      'aws-sdk/clients/cloudwatch': function () { return cloudwatch },
      'aws-sdk/clients/sns': function () { return sns }
    })
  })

  describe('initialise, useMock=false:', () => {
    let instance

    beforeEach(() => {
      config.sms.useMock = false
      instance = smsSpend(log, config)
    })

    it('returned the expected interface', () => {
      assert.equal(typeof instance.isOk, 'function')
      assert.equal(instance.isOk.length, 0)
    })

    it('did not call the AWS SDK', () => {
      assert.equal(sns.getSMSAttributes.callCount, 0)
      assert.equal(cloudwatch.getMetricsStatistics.callCount, 0)
    })

    it('isOk returns true', () => {
      assert.strictEqual(instance.isOk(), true)
    })

    describe('wait a tick:', () => {
      beforeEach(done => setImmediate(done))

      it('called sns.getSMSAttributes correctly', () => {
        assert.equal(sns.getSMSAttributes.callCount, 1)
        const args = sns.getSMSAttributes.args[0]
        assert.equal(args.length, 1)
        assert.deepEqual(args[0], { attributes: [ 'MonthlySpendLimit' ] })
      })

      it('called cloudwatch.getMetricsStatistics correctly', () => {
        assert.equal(cloudwatch.getMetricsStatistics.callCount, 1)
        const args = cloudwatch.getMetricsStatistics.args[0]
        assert.equal(args.length, 1)
        const now = new Date()
        assert.equal(args[0].Namespace, 'AWS/SNS')
        assert.equal(args[0].MetricName, 'SMSMonthToDateSpentUSD')
        assert.equal(args[0].StartTime, new Date(`${now.getFullYear()}-${now.getMonth() + 1}-01Z`).toISOString())
      })

      it('isOk returns true', () => {
        assert.strictEqual(instance.isOk(), true)
      })

      it('did not call log.error', () => {
        assert.equal(log.error.callCount, 0)
      })
    })

    describe('spend > threshold:', () => {
      beforeEach(() => {
        results.getMetricsStatistics.Datapoints[1].Sum = 1
      })

      it('isOk returns true', () => {
        assert.strictEqual(instance.isOk(), true)
      })

      describe('wait a tick:', () => {
        beforeEach(done => setImmediate(done))

        it('isOk returns false', () => {
          assert.strictEqual(instance.isOk(), false)
        })

        it('did not call log.error', () => {
          assert.equal(log.error.callCount, 0)
        })
      })
    })
  })

  describe('initialise, useMock=true:', () => {
    let instance

    beforeEach(() => {
      config.sms.useMock = true
      instance = smsSpend(log, config)
    })

    it('isOk returns true', () => {
      assert.strictEqual(instance.isOk(), true)
    })

    describe('wait a tick:', () => {
      beforeEach(done => setImmediate(done))

      it('isOk returns true', () => {
        assert.strictEqual(instance.isOk(), true)
      })

      it('did not call the AWS SDK', () => {
        assert.equal(sns.getSMSAttributes.callCount, 0)
        assert.equal(cloudwatch.getMetricsStatistics.callCount, 0)
      })

      it('did not call log.error', () => {
        assert.equal(log.error.callCount, 0)
      })
    })
  })
})
