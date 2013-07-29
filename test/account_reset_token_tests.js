var test = require('tap').test
var crypto = require('crypto')
var P = require('p-promise')

var dbs = require('../kv')(
  {
    kvstore: {
      available_backends: ['memory'],
      backend: 'memory',
      cache: 'memory'
    }
  }
)

var mailer = {
  sendCode: function () { return P(null) }
}

var config = {
  domain: 'example.com',
  dev: {}
}
var models = require('../models')(config, dbs, mailer)
var AccountResetToken = models.tokens.AccountResetToken

test(
	'bundle / unbundle works',
	function (t) {
		function end() { t.end() }
		AccountResetToken.create('xxx')
			.then(
				function (x) {
					var wrapKb = crypto.randomBytes(32).toString('hex')
					var verifier = crypto.randomBytes(256).toString('hex')
					var b = x.bundle(wrapKb, verifier)
					var ub = x.unbundle(b)
					t.equal(ub.wrapKb, wrapKb)
					t.equal(ub.verifier, verifier)
					return x
				}
			)
			.then(
				function (x) {
					return x.del()
				}
			)
			.done(end, end)
	}
)
