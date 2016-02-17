/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var AWS = require('aws-sdk')

var config = require('../config')
var reminderConfig = config.get('verificationReminder')

module.exports = function () {

  function VerificationReminder() {
    this.sqs = new AWS.SQS({ region : reminderConfig.queueRegion })
  }

  VerificationReminder.prototype.enqueue = function (message) {
    if (! message || ! message.email) {
      throw new Error('Verification reminder requires email')
    }

    message.createdAt = Date.now()

    var params = {
      MessageBody: JSON.stringify(message), /* required */
      QueueUrl: reminderConfig.queueUrl, /* required */
      DelaySeconds: 30
    };

    console.log('sending sqs', params);

    this.sqs.sendMessage(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log(data);           // successful response
    });

    // TODO
  }

  return VerificationReminder
}
