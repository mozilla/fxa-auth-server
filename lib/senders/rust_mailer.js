const request = require('request')

function sendMail(emailConfig, cb) {
    const options = {
        url: 'http://127.0.0.1:8001/send',
        method: 'POST',
        json: true,
        body: {
            cc: emailConfig.cc,
            to: emailConfig.to,
            subject: emailConfig.subject,
            body: {
                text: emailConfig.text,
                html: emailConfig.html
            }
        }
    }

    request(options, function(err, res, body) {
        cb(err, { 
            messageId: body.messageId, 
            message: err ? err.message : body.message
        })
    })
}

function close() {

}

module.exports = {
    sendMail,
    close
}