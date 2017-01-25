/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var P = require('./promise')

module.exports = function (log) {

  return function start(deliveryQueue) {

    function getHeaderValue(headerName, message){
      var value = ''
      if (message.mail && message.mail.headers) {
        message.mail.headers.some(function (header) {
          if (header.name === headerName) {
            value = header.value
            return true
          }

          return false
        })
      }
      return value
    }


    function handleDelivery(message) {
      const currentTime = Date.now()

      var recipients = []
      if (message.delivery && message.notificationType === 'Delivery') {
        recipients = message.delivery.recipients
      }

      // SES can now send custom headers if enabled on topic.
      // Headers are stored as an array of name/value pairs.
      // Log the `X-Template-Name` header to help track the email template that bounced.
      // Ref: http://docs.aws.amazon.com/ses/latest/DeveloperGuide/notification-contents.html
      const templateName = getHeaderValue('X-Template-Name', message)

      return P.each(recipients, function (recipient) {

        var email = recipient
        var logData = {
          op: 'handleDelivery',
          email: email,
          processingTimeMillis: message.delivery.processingTimeMillis
        }

        // Template name corresponds directly with the email template that was used
        if (templateName) {
          logData.template = templateName
        }

        // Log flow metrics if `flowId` and `flowBeginTime` specified in headers
        const flowId = getHeaderValue('X-Flow-Id', message)
        const flowBeginTime = getHeaderValue('X-Flow-Begin-Time', message)
        const elapsedTime = currentTime - flowBeginTime

        if (flowId && flowBeginTime && (elapsedTime > 0)) {
          const eventName = `email.${templateName}.delivered`

          // Flow events have a specific event and structure that must be emitted.
          // Ref `gather` in https://github.com/mozilla/fxa-auth-server/blob/master/lib/metrics/context.js
          const flowEventInfo = {
            event: eventName,
            time: currentTime,
            flow_id: flowId,
            flow_time: elapsedTime
          }

          log.flowEvent(flowEventInfo)
        } else {
          log.error({ op: 'handleDelivery.flowEvent', templateName, flowId, flowBeginTime, currentTime })
        }

        log.info(logData)
        log.increment('account.email_delivered')
      }).then(
        function () {
          // We always delete the message, even if handling some addrs failed.
          message.del()
        }
      )
    }

    deliveryQueue.on('data', handleDelivery)
    deliveryQueue.start()

    return {
      deliveryQueue: deliveryQueue,
      handleDelivery: handleDelivery
    }
  }
}
