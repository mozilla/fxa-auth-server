/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const Cloudwatch = require('aws-sdk/clients/cloudwatch')
const MockSns = require('../test/mock-sns')
const P = require('./promise')
const Sns = require('aws-sdk/clients/sns')

const SECONDS_PER_WEEK = 60 * 60 * 24 * 7
const MILLISECONDS_PER_HOUR = 1000 * 60 * 60

class MockCloudwatch {
  getMetricsStatistics () {
    return {
      promise () {
        return P.resolve({ Datapoints: [ { Sum: 0 } ] })
      }
    }
  }
}

module.exports = (log, config) => {
  const cloudwatch = initService(config, Cloudwatch, MockCloudwatch)
  const sns = initService(config, Sns, MockSns)

  const { minimumCreditThreshold: CREDIT_THRESHOLD } = config.sms

  let isOk = true

  setImmediate(pollCurrentSpend)

  return { isOk: () => isOk }

  function pollCurrentSpend () {
    let limit

    sns.getSMSAttributes({ attributes: [ 'MonthlySpendLimit' ] }).promise()
      .then(result => {
        limit = parseFloat(result.MonthlySpendLimit)
        if (isNaN(limit)) {
          throw new Error(`Invalid MonthlySpendLimit "${result.MonthlySpendLimit}"`)
        }

        const now = new Date()
        return cloudwatch.getMetricsStatistics({
          Namespace: 'AWS/SNS',
          MetricName: 'SMSMonthToDateSpentUSD',
          StartTime: startOfMonth(now).toISOString(),
          EndTime: now.toISOString(),
          Period: SECONDS_PER_WEEK,
          Statistics: [ 'Sum' ]
        }).promise()
      })
      .then(result => {
        const { Datapoints: data } = result

        if (! Array.isArray(data)) {
          throw new Error('Invalid Datapoints')
        }

        const current = data.reduce((sum, datum) => sum + parseFloat(datum.Sum), 0)

        if (isNaN(current)) {
          throw new Error('Invalid Datapoints')
        }

        isOk = current <= limit - CREDIT_THRESHOLD
      })
      .catch(err => {
        log.error({ op: 'sms.budget.err', err: err.message })

        // If we failed to query the data, assume current spend is fine
        isOk = true
      })
      .then(() => setTimeout(pollCurrentSpend, MILLISECONDS_PER_HOUR))
  }
}

function initService (config, Class, MockClass) {
  const options = {
    region: config.sms.apiRegion
  }

  if (config.sms.useMock) {
    return new MockClass(options, config)
  }

  return new Class(options)
}

function startOfMonth (date) {
  return new Date(`${date.getFullYear()}-${date.getMonth() + 1}-01Z`)
}
