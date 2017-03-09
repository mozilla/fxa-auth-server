/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

var Twilio = require('twilio')
var error = require('../error')

var TEMPLATE_NAMES = new Map([
  [ 1, 'installFirefox' ]
])

module.exports = function (log, translator, templates, smsConfig) {
  var twilio = Twilio(
    smsConfig.apiKey,
    smsConfig.apiSecret
  )

  return {
    send: function (phoneNumber, senderId, messageId, acceptLanguage) {
      log.trace({
        op: 'sms.send',
        senderId: senderId,
        messageId: messageId,
        acceptLanguage: acceptLanguage
      })

      var message = getMessage(messageId, acceptLanguage)

      return twilio.sendMessage({
        to: phoneNumber,
        from: senderId,
        body: message.trim()
      }).then(function (result) {
        if (! result.error_code) {
          log.info({
            op: 'sms.send.success',
            senderId: senderId,
            messageId: result.sid,
            acceptLanguage: acceptLanguage
          })
        } else {
          log.error({
            op: 'sms.send.error',
            errorCode: result.error_code,
            errorMessage: result.error_message
          })

          throw error.messageRejected(result.error_message, result.error_code)
        }
      }).catch(function (error) {
        log.error({
          op: 'sms.send.error',
          status: error.status,
          errorCode: error.code,
          errorMessage: error.message
        })

        throw error.messageRejected(error.message, error.status)
      })
    },

    balance: function () {
      log.trace({ op: 'sms.balance' })
      log.info({ op: 'sms.balance.success', balance: 42, isOk: true })

      return new Promise.resolve({ value: 42, isOk: true })
    }
  }

  function getMessage (messageId, acceptLanguage) {
    var templateName = TEMPLATE_NAMES.get(messageId)
    var template = templates['sms.' + templateName]

    if (! template) {
      log.error({ op: 'sms.getMessage.error', messageId: messageId, templateName: templateName })
      throw error.invalidMessageId()
    }

    return template({
      link: smsConfig[templateName + 'Link'],
      translator: translator.getTranslator(acceptLanguage)
    }).text
  }
}
