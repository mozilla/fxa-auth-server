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

var DOMAIN = 'example.com'
var models = require('../models')(DOMAIN, dbs, mailer)
var KeyFetchToken = models.tokens.KeyFetchToken

test(
	'bundle / unbundle works',
	function (t) {
		function end() { t.end() }
		KeyFetchToken.create('xxx')
			.then(
				function (x) {
					var kA = crypto.randomBytes(32).toString('hex')
					var wrapKb = crypto.randomBytes(32).toString('hex')
					var b = x.bundle(kA, wrapKb)
					var ub = x.unbundle(b)
					t.equal(ub.kA, kA)
					t.equal(ub.wrapKb, wrapKb)
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
