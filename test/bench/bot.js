var Client = require('../../client')

var config = {
	origin: 'http://127.0.0.1:9000',
	email: Math.random() + 'benchmark@example.com',
	password: 'password',
	duration: 120000
}

var key = {
  algorithm: 'RS',
  n: '4759385967235610503571494339196749614544606692567785790953934768202714280652973091341316862993582789079872007974809511698859885077002492642203267408776123',
  e: '65537'
}

function times(fn, n) {
	return function () {
		var args = arguments
		var p = fn.apply(null, args)
		for (var i = 1; i < n; i++) {
			p = p.then(
				function () {
					return fn.apply(null, args)
				}
			)
		}
		return p
	}
}

function session(c) {
	return c.login()
		.then(c.emailStatus.bind(c))
		.then(c.keys.bind(c))
		.then(c.devices.bind(c))
		.then(times(c.sign.bind(c, key, 10000), 10))
		//.then(c.changePassword.bind(c, 'newPassword'))
		.then(c.destroySession.bind(c))
}

function run(c) {
	return c.create()
	.then(times(session, 10))
	.then(
		function () {
			return c.destroyAccount()
		},
		function (err) {
			console.error("Error during run:", err.message)
			return c.destroyAccount()
		}
	)
}

var client = new Client(config.origin)
client.preVerified = true

client.setupCredentials(config.email, config.password)
	.then(
		function () {
			var begin = Date.now()

			function loop(ms) {
				run(client)
					.done(
						function () {
							if (Date.now() - begin < ms) {
								loop(ms)
							}
						},
						function (err) {
							console.error("Error during cleanup:", err.message)
						}
				 	)
			}

			loop(config.duration)
		}
	)
