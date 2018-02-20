/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const assert = require("../../assert")
const sinon = require('sinon')
const log = {
  activityEvent: sinon.spy(),
  amplitudeEvent: sinon.spy(),
  error: sinon.spy(),
  flowEvent: sinon.spy()
}
const events = require('../../../lib/metrics/events')(log, {
  oauth: {
    clientIds: {}
  }
})
const mocks = require('../../mocks')

describe('metrics/events', () => {
  afterEach(() => {
    log.activityEvent.reset()
    log.amplitudeEvent.reset()
    log.error.reset()
    log.flowEvent.reset()
  })

  it('interface is correct', () => {
    assert.equal(typeof events, 'object', 'events is object')
    assert.notEqual(events, null, 'events is not null')
    assert.equal(Object.keys(events).length, 2, 'events has 2 properties')

    assert.equal(typeof events.emit, 'function', 'events.emit is function')
    assert.equal(events.emit.length, 2, 'events.emit expects 2 arguments')

    assert.equal(typeof events.emitRouteFlowEvent, 'function', 'events.emitRouteFlowEvent is function')
    assert.equal(events.emitRouteFlowEvent.length, 1, 'events.emitRouteFlowEvent expects 1 argument')

    assert.notCalled(log.activityEvent)
    assert.notCalled(log.flowEvent)
  })

  it('.emit with missing event', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({ metricsContext })
    return events.emit.call(request, '', {})
      .then(() => {
      assert.calledOnce(log.error)
      assert.calledWithExactly(log.error, {
        op: 'metricsEvents.emit',
        missingEvent: true
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(metricsContext.gather)
      assert.notCalled(log.flowEvent)
      assert.notCalled(metricsContext.clear)
    });
  })

  it('.emit with activity event', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        'user-agent': 'foo'
      },
      metricsContext,
      query: {
        service: 'bar'
      }
    })
    const data = {
      uid: 'baz'
    }
    return events.emit.call(request, 'device.created', data)
      .then(() => {
      assert.calledOnce(log.activityEvent)
      assert.calledWithExactly(log.activityEvent, {
        event: 'device.created',
        userAgent: 'foo',
        service: 'bar',
        uid: 'baz'
      })

      assert.calledOnce(metricsContext.gather)
      assert.calledWithExactly(metricsContext.gather, {})

      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(log.flowEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    });
  })

  it('.emit with activity event and missing data', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      metricsContext,
      payload: {
        service: 'bar'
      }
    })
    return events.emit.call(request, 'device.created')
      .then(() => {
      assert.calledOnce(log.activityEvent)
      assert.calledWithExactly(log.activityEvent, {
        event: 'device.created',
        userAgent: 'test user-agent',
        service: 'bar'
      })

      assert.calledOnce(metricsContext.gather)

      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(log.flowEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    });
  })

  it('.emit with activity event and missing uid', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({ metricsContext })
    return events.emit.call(request, 'device.created', {})
      .then(() => {
      assert.calledOnce(log.activityEvent)
      assert.calledWithExactly(log.activityEvent, {
        event: 'device.created',
        service: undefined,
        userAgent: 'test user-agent'
      })

      assert.calledOnce(metricsContext.gather)

      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(log.flowEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    });
  })

  it('.emit with flow event', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      credentials: {
        uid: 'deadbeef'
      },
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000,
          flowCompleteSignal: 'account.signed',
          utmCampaign: 'utm campaign',
          utmContent: 'utm content',
          utmMedium: 'utm medium',
          utmSource: 'utm source',
          utmTerm: 'utm term'
        },
        service: 'baz'
      }
    })
    return events.emit.call(request, 'email.verification.sent')
      .then(() => {
      assert.calledOnce(metricsContext.gather)
      let args = metricsContext.gather.args[0]
      assert.equal(args.length, 1, 'metricsContext.gather was passed one argument')
      assert.equal(args[0].event, 'email.verification.sent', 'metricsContext.gather was passed event')
      assert.equal(args[0].locale, request.app.locale, 'metricsContext.gather was passed locale')
      assert.equal(args[0].userAgent, request.headers['user-agent'], 'metricsContext.gather was passed user agent')

      assert.calledOnce(log.flowEvent)
      assert.calledWithExactly(log.flowEvent, {
        event: 'email.verification.sent',
        flow_id: 'bar',
        flow_time: 1000,
        flowBeginTime: time - 1000,
        flowCompleteSignal: 'account.signed',
        flowType: undefined,
        locale: 'en-US',
        time,
        uid: 'deadbeef',
        userAgent: 'test user-agent',
        utm_campaign: 'utm campaign',
        utm_content: 'utm content',
        utm_medium: 'utm medium',
        utm_source: 'utm source',
        utm_term: 'utm term'
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with flow event and no session token', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = {
      app: {
        locale: 'en'
      },
      auth: null,
      clearMetricsContext: metricsContext.clear,
      gatherMetricsContext: metricsContext.gather,
      headers: {
        dnt: '1',
        'user-agent': 'foo'
      },
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000,
          flowCompleteSignal: 'account.signed'
        }
      }
    }
    return events.emit.call(request, 'email.verification.sent')
      .then(() => {
      assert.calledOnce(metricsContext.gather)

      assert.calledOnce(log.flowEvent)
      assert.calledWithExactly(log.flowEvent, {
        event: 'email.verification.sent',
        flow_id: 'bar',
        flow_time: 1000,
        flowBeginTime: time - 1000,
        flowCompleteSignal: 'account.signed',
        flowType: undefined,
        locale: 'en',
        time,
        userAgent: 'foo'
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with flow event and string uid', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000,
          flowCompleteSignal: 'account.signed'
        }
      }
    })
    return events.emit.call(request, 'email.verification.sent', { uid: 'deadbeef' })
      .then(() => {
      assert.calledOnce(metricsContext.gather)

      assert.calledOnce(log.flowEvent)
      assert.calledWithExactly(log.flowEvent, {
        event: 'email.verification.sent',
        flow_id: 'bar',
        flow_time: 1000,
        flowBeginTime: time - 1000,
        flowCompleteSignal: 'account.signed',
        flowType: undefined,
        locale: 'en-US',
        time,
        uid: 'deadbeef',
        userAgent: 'test user-agent'
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with flow event and buffer uid', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000,
          flowCompleteSignal: 'account.signed'
        }
      }
    })
    return events.emit.call(request, 'email.verification.sent', { uid: 'deadbeef' })
      .then(() => {
      assert.calledOnce(metricsContext.gather)

      assert.calledOnce(log.flowEvent)
      assert.calledWithExactly(log.flowEvent, {
        event: 'email.verification.sent',
        flow_id: 'bar',
        flow_time: 1000,
        flowBeginTime: time - 1000,
        flowCompleteSignal: 'account.signed',
        flowType: undefined,
        locale: 'en-US',
        time,
        uid: 'deadbeef',
        userAgent: 'test user-agent'
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with flow event and null uid', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000,
          flowCompleteSignal: 'account.signed'
        }
      }
    })
    return events.emit.call(request, 'email.verification.sent', { uid: null })
      .then(() => {
      assert.calledOnce(metricsContext.gather)

      assert.calledOnce(log.flowEvent)
      assert.calledWithExactly(log.flowEvent, {
        event: 'email.verification.sent',
        flow_id: 'bar',
        flow_time: 1000,
        flowBeginTime: time - 1000,
        flowCompleteSignal: 'account.signed',
        flowType: undefined,
        locale: 'en-US',
        time,
        userAgent: 'test user-agent'
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with flow event that matches complete signal', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      locale: 'fr',
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 2000,
          flowCompleteSignal: 'email.verification.sent',
          flowType: 'registration'
        }
      }
    })
    return events.emit.call(request, 'email.verification.sent', { locale: 'baz', uid: 'qux' })
      .then(() => {
        assert.calledOnce(metricsContext.gather)

        assert.calledTwice(log.flowEvent)
        assert.deepEqual(log.flowEvent.args[0][0], {
          event: 'email.verification.sent',
          flow_id: 'bar',
          flow_time: 2000,
          flowBeginTime: time - 2000,
          flowCompleteSignal: 'email.verification.sent',
          flowType: 'registration',
          locale: 'fr',
          time,
          uid: 'qux',
          userAgent: 'test user-agent'
        }, 'argument was event data first time')
        assert.deepEqual(log.flowEvent.args[1][0], {
          event: 'flow.complete',
          flow_id: 'bar',
          flow_time: 2000,
          flowBeginTime: time - 2000,
          flowCompleteSignal: 'email.verification.sent',
          flowType: 'registration',
          locale: 'fr',
          time,
          uid: 'qux',
          userAgent: 'test user-agent'
        }, 'argument was complete event data second time')

        assert.calledOnce(log.amplitudeEvent)
        assert.equal(log.amplitudeEvent.args[0].length, 1, 'log.amplitudeEvent was passed one argument')
        assert.equal(log.amplitudeEvent.args[0][0].event_type, 'fxa_reg - complete', 'log.amplitudeEvent was passed correct event_type')

        assert.calledOnce(metricsContext.clear)
        assert.equal(metricsContext.clear.args[0].length, 0, 'metricsContext.clear was passed no arguments')

        assert.notCalled(log.activityEvent)
        assert.notCalled(log.error)
      }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with flow event and missing headers', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = {
      clearMetricsContext: metricsContext.clear,
      gatherMetricsContext: metricsContext.gather,
      payload: {
        metricsContext: {
          flowId: 'foo',
          flowBeginTime: Date.now() - 1
        }
      }
    }
    return events.emit.call(request, 'email.verification.sent')
      .then(() => {
      assert.calledOnce(log.error)
      assert.calledWithExactly(log.error, {
        op: 'metricsEvents.emitFlowEvent',
        event: 'email.verification.sent',
        badRequest: true
      })

      assert.calledOnce(metricsContext.gather)

      assert.notCalled(log.activityEvent)
      assert.notCalled(log.amplitudeEvent)
      assert.notCalled(log.flowEvent)
      assert.notCalled(metricsContext.clear)
    });
  })

  it('.emit with flow event and missing flowId', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      metricsContext,
      payload: {
        metricsContext: {
          flowBeginTime: Date.now() - 1
        }
      }
    })
    return events.emit.call(request, 'email.verification.sent')
      .then(() => {
        assert.calledOnce(metricsContext.gather)

        assert.calledOnce(log.error)
        assert.deepEqual(log.error.args[0][0], {
          op: 'metricsEvents.emitFlowEvent',
          event: 'email.verification.sent',
          missingFlowId: true
        }, 'argument was correct')

        assert.notCalled(log.activityEvent)
        assert.notCalled(log.amplitudeEvent)
        assert.notCalled(log.flowEvent)
        assert.notCalled(metricsContext.clear)
      });
  })

  it('.emit with hybrid activity/flow event', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 42
        }
      }
    })
    const data = {
      uid: 'baz'
    }
    return events.emit.call(request, 'account.keyfetch', data)
      .then(() => {
        assert.calledOnce(log.activityEvent)
        assert.deepEqual(log.activityEvent.args[0][0], {
          event: 'account.keyfetch',
          userAgent: 'test user-agent',
          service: undefined,
          uid: 'baz'
        }, 'activity event data was correct')

        assert.calledOnce(metricsContext.gather)

        assert.calledOnce(log.flowEvent)
        assert.deepEqual(log.flowEvent.args[0][0], {
          time,
          event: 'account.keyfetch',
          flow_id: 'bar',
          flow_time: 42,
          flowBeginTime: time - 42,
          flowCompleteSignal: undefined,
          flowType: undefined,
          locale: 'en-US',
          uid: 'baz',
          userAgent: 'test user-agent'
        }, 'flow event data was correct')

        assert.notCalled(log.amplitudeEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emit with optional flow event and missing flowId', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      metricsContext,
      payload: {
        metricsContext: {
          flowBeginTime: Date.now() - 1
        }
      }
    })
    const data = {
      uid: 'bar'
    }
    return events.emit.call(request, 'account.keyfetch', data)
      .then(() => {
        assert.calledOnce(log.activityEvent)
        assert.calledOnce(metricsContext.gather)

        assert.notCalled(log.amplitudeEvent)
        assert.notCalled(log.flowEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      });
  })

  it('.emit with content-server account.signed event', () => {
    const flowBeginTime = Date.now() - 1
    const metricsContext = mocks.mockMetricsContext({
      gather: sinon.spy(() => ({
        device_id: 'foo',
        flow_id: 'bar',
        flowBeginTime
      }))
    })
    const request = mocks.mockRequest({
      metricsContext,
      query: {
        service: 'content-server'
      }
    })
    const data = {
      uid: 'baz'
    }
    return events.emit.call(request, 'account.signed', data)
      .then(() => {
        assert.calledOnce(log.activityEvent)

        assert.calledOnce(log.amplitudeEvent)
        assert.equal(log.amplitudeEvent.args[0].length, 1, 'log.amplitudeEvent was passed one argument')
        assert.equal(log.amplitudeEvent.args[0][0].event_type, 'fxa_activity - cert_signed', 'log.amplitudeEvent was passed correct event_type')
        assert.equal(log.amplitudeEvent.args[0][0].device_id, 'foo', 'log.amplitudeEvent was passed correct device_id')
        assert.equal(log.amplitudeEvent.args[0][0].session_id, flowBeginTime, 'log.amplitudeEvent was passed correct session_id')
        assert.deepEqual(log.amplitudeEvent.args[0][0].event_properties, {
          service: undefined,
          oauth_client_id: undefined
        }, 'log.amplitudeEvent was passed correct event properties')
        assert.deepEqual(log.amplitudeEvent.args[0][0].user_properties, {
          flow_id: 'bar',
          sync_device_count: 0,
          ua_browser: request.app.ua.browser,
          ua_version: request.app.ua.browserVersion
        }, 'log.amplitudeEvent was passed correct user properties')

        assert.calledOnce(metricsContext.gather)

        assert.notCalled(log.flowEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      });
  })

  it('.emit with sync account.signed event', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      metricsContext,
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: Date.now() - 1
        }
      },
      query: {
        service: 'sync'
      }
    })
    const data = {
      uid: 'baz'
    }
    return events.emit.call(request, 'account.signed', data)
      .then(() => {
        assert.calledOnce(log.amplitudeEvent)
        assert.equal(log.amplitudeEvent.args[0][0].event_properties.service, 'sync', 'log.amplitudeEvent was passed correct service')

        assert.calledOnce(log.activityEvent)
        assert.calledOnce(metricsContext.gather)
        assert.calledOnce(log.flowEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      });
  })

  it('.emitRouteFlowEvent with matching route and response.statusCode', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      path: '/v1/account/create',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000
        }
      },
      received: time - 42
    })
    return events.emitRouteFlowEvent.call(request, { statusCode: 200 })
      .then(() => {
      assert.calledOnce(metricsContext.gather)

      assert.calledTwice(log.flowEvent)

      assert.calledWithExactly(log.flowEvent, {
        event: 'route./account/create.200',
        flow_id: 'bar',
        flow_time: 1000,
        flowBeginTime: time - 1000,
        flowCompleteSignal: undefined,
        flowType: undefined,
        locale: 'en-US',
        time,
        userAgent: 'test user-agent'
      })
      assert.calledWithExactly(log.flowEvent, {
        event: 'route.performance./account/create',
        flow_id: 'bar',
        flow_time: 42,
        flowBeginTime: time - 1000,
        flowCompleteSignal: undefined,
        flowType: undefined,
        locale: 'en-US',
        time,
        userAgent: 'test user-agent'
      })

      assert.notCalled(log.activityEvent)
      assert.notCalled(metricsContext.clear)
      assert.notCalled(log.error)
    }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emitRouteFlowEvent with matching route and response.output.statusCode', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      path: '/v1/account/login',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000
        }
      }
    })
    return events.emitRouteFlowEvent.call(request, { output: { statusCode: 399 } })
      .then(() => {
        assert.calledOnce(metricsContext.gather)

        assert.calledOnce(log.flowEvent)
        assert.deepEqual(log.flowEvent.args[0][0], {
          event: 'route./account/login.399',
          flow_id: 'bar',
          flow_time: 1000,
          flowBeginTime: time - 1000,
          flowCompleteSignal: undefined,
          flowType: undefined,
          locale: 'en-US',
          time,
          userAgent: 'test user-agent'
        }, 'argument was event data')

        assert.notCalled(log.activityEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emitRouteFlowEvent with matching route and 400 statusCode', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      path: '/v1/recovery_email/resend_code',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000
        }
      }
    })
    return events.emitRouteFlowEvent.call(request, { statusCode: 400 })
      .then(() => {
        assert.calledOnce(metricsContext.gather)

        assert.calledOnce(log.flowEvent)
        assert.deepEqual(log.flowEvent.args[0][0], {
          event: 'route./recovery_email/resend_code.400.999',
          flow_id: 'bar',
          flow_time: 1000,
          flowBeginTime: time - 1000,
          flowCompleteSignal: undefined,
          flowType: undefined,
          locale: 'en-US',
          time,
          userAgent: 'test user-agent'
        }, 'argument was event data')

        assert.notCalled(log.activityEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emitRouteFlowEvent with matching route and 400 statusCode with errno', () => {
    const time = Date.now()
    sinon.stub(Date, 'now', () => time)
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      headers: {
        dnt: '1',
        'user-agent': 'test user-agent'
      },
      metricsContext,
      path: '/v1/account/destroy',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: time - 1000
        }
      }
    })
    return events.emitRouteFlowEvent.call(request, { statusCode: 400, errno: 42 })
      .then(() => {
        assert.calledOnce(metricsContext.gather)

        assert.calledOnce(log.flowEvent)
        assert.deepEqual(log.flowEvent.args[0][0], {
          event: 'route./account/destroy.400.42',
          flow_id: 'bar',
          flow_time: 1000,
          flowBeginTime: time - 1000,
          flowCompleteSignal: undefined,
          flowType: undefined,
          locale: 'en-US',
          time,
          userAgent: 'test user-agent'
        }, 'argument was event data')

        assert.notCalled(log.activityEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      }).finally(() => {
        Date.now.restore()
      });
  })

  it('.emitRouteFlowEvent with non-matching route', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      metricsContext,
      path: '/v1/account/devices',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: Date.now() - 1000
        }
      }
    })
    return events.emitRouteFlowEvent.call(request, { statusCode: 200 })
      .then(() => {
        assert.notCalled(metricsContext.gather)
        assert.notCalled(log.flowEvent)
        assert.notCalled(log.activityEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      });
  })

  it('.emitRouteFlowEvent with matching route and invalid metrics context', () => {
    const metricsContext = mocks.mockMetricsContext({ validate: sinon.spy(() => false) })
    const request = mocks.mockRequest({
      metricsContext,
      path: '/v1/account/destroy',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: Date.now()
        }
      }
    })
    return events.emitRouteFlowEvent.call(request, { statusCode: 400, errno: 107 })
      .then(() => {
        assert.calledOnce(metricsContext.validate)
        assert.equal(metricsContext.validate.args[0].length, 0, 'metricsContext.validate was passed no arguments')

        assert.notCalled(metricsContext.gather)
        assert.notCalled(log.flowEvent)
        assert.notCalled(log.activityEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      });
  })

  it('.emitRouteFlowEvent with missing parameter error but valid metrics context', () => {
    const metricsContext = mocks.mockMetricsContext()
    const request = mocks.mockRequest({
      metricsContext,
      path: '/v1/account/destroy',
      payload: {
        metricsContext: {
          flowId: 'bar',
          flowBeginTime: Date.now()
        }
      }
    })
    return events.emitRouteFlowEvent.call(request, { statusCode: 400, errno: 107 })
      .then(() => {
        assert.calledOnce(metricsContext.validate)
        assert.calledOnce(metricsContext.gather)
        assert.calledOnce(log.flowEvent)

        assert.notCalled(log.activityEvent)
        assert.notCalled(metricsContext.clear)
        assert.notCalled(log.error)
      });
  })
})
