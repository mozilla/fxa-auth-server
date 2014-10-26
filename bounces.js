/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var Sink = require('fxa-notifier-aws').Sink

module.exports = function (log) {

  return function start(config, db) {

    function accountDeleted(uid, email) {
      log.info({ op: 'accountDeleted', uid: uid.toString('hex'), email: email })
    }

    function gotError(email, err) {
      log.error({ op: 'databaseError', email: email, err: err })
    }

    function deleteAccountIfUnverified(record) {
      if (!record.emailVerified) {
        db.deleteAccount(record)
          .done(
            accountDeleted.bind(null, record.uid, record.email),
            gotError.bind(null, record.email)
          )
      }
    }

    function handleBounce(message) {
      var recipients = []
      if (message.bounce && message.bounce.bounceType === 'Permanent') {
        recipients = message.bounce.bouncedRecipients
      }
      else if (message.complaint && message.complaint.complaintFeedbackType === 'abuse') {
        recipients = message.complaint.complainedRecipients
      }
      for (var i = 0; i < recipients.length; i++) {
        var email = recipients[i].emailAddress
        log.info({ op: 'handleBounce', email: email, bounce: !!message.bounce })
        db.emailRecord(email)
          .done(
            deleteAccountIfUnverified,
            gotError.bind(null, email)
          )
      }
      message.del()
    }

    function queueError(err) {
      log.error({ op: 'queueError', err: err })
    }

    var bounceQueue = new Sink(config.region, config.bounceQueueUrl)
    bounceQueue.on('data', handleBounce)
    bounceQueue.on('error', queueError)
    bounceQueue.fetch()

    var complaintQueue = new Sink(config.region, config.complaintQueueUrl)
    complaintQueue.on('data', handleBounce)
    complaintQueue.on('error', queueError)
    complaintQueue.fetch()
  }
}
