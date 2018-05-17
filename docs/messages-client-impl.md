# FxA messages implementation recipe

Welcome! If you’re reading this document, it means that you have volunteered (or have been volunteered) to implement a client implementation of the messages feature of Firefox Accounts.

First of all, what is this new feature?
Also referred as “Pushbox” (our back-end server implementation), FxA messages is a way to send durable data payloads between devices registered on the same Firefox Account.
The reasons we have started this project are stated [here](https://docs.google.com/document/d/1YT6gh125Tu03eM42Vb_LKjvgxc4qrGGZsty1_ajf2YM) (be careful, a lot of API specifications are outdated!).

As for now, FxA messages are only used as the new backbone of "Send Tab". However, some other teams have expressed interest in our platform to send data quickly between devices.

This document assumes that:

-   Your app has a “good-enough” client implementation of Firefox Accounts and [Device registration](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#post-accountdevice) (w/ FxA Push subscription) is working.
-   You have access to primitives to encrypt/decrypt push payloads in the process that will execute the FxA messages client implementation.

## High level view

Here's a high-level system view of what happens when a message is sent and received:
![High level view](https://user-images.githubusercontent.com/6424575/38573640-bad1cae0-3cc4-11e8-90d8-bf1b06d8b9bd.png)

## (A) Creating the durable payload

First, the sending device must create a durable push payload.
In its cleartext version, it is a simple JSON object that looks like this:

```js
{
  "topic": "sendtab",
  "data": {/*...*/}
}
```
- `topic` is a string enumeration that allows the recipient to identify what kind of message it is handling (in case it is retrieving every pending message). So far only the  `sendtab` topic is supported.
- `data` is the application level data. Technically it could be anything, but by convention it is a JSON Object.

We then encrypt the payload by JSON-Stringifying the payload then using the Push `aes128gcm` encryption algorithm. See the [Firefox Desktop implementation](https://bugzilla.mozilla.org/show_bug.cgi?id=1442128) or [Web Push Payload Encryption](https://developers.google.com/web/updates/2016/03/web-push-encryption).
The keys used are the ones of the recipient device. They are obtainable by calling the [GET /accounts/devices](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#get-accountdevices) endpoint (`pushPublicKey`/`pushAuthKey`).

The resulting encrypted durable payload is a *RFC 4648 base64url (no padding)* encoded string.

## (B) Sending the payload

Nothing special here, we use the `sessionToken` authenticated [POST /account/devices/messages](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#post-accountdevicesmessages) endpoint.
Note that we also specify the `topic` in the request body. The FxA server uses that field to filter messages (*e.g.* Firefox iOS only wants `sendtab`).

## (C) Storing the durable payload
There's nothing actionable from you on that part. However, you should remember for later that each stored message has an "offset", called `index`.

## (D) Push tickle
The other device receives a Push notification that looks like this:
```js
{
  "topic": "sendtab",
  "url": "<URL to retrieve the payload>"
}
```

`url` is the direct URL to retrieve the payload, without any consideration for any eventual other pending message.

You have two choices here:
- Use `url`, just like Firefox iOS does it, in order to guarantee that *1 push message* equals *1 payload retrieved*. However, it is a bit more work to catch out-of-band messages. If you choose that solution you can skip the next section, but pay special attention to the "Periodic polling" section.
- Do not use `url`, like Firefox Desktop, and treat push notifications as tickles: simply retrieve all pending messages.

## (E) Retrieving the durable payload

We use the `sessionToken` authenticated [GET /account/device/messages](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#get-accountdevicemessages) endpoint.
An `index` *searchParam* can be set: in that case, the server will return all messages that have been stored after the message who had that `index`.
You should persist the newly returned index locally, so you don't end-up fetching and replaying the same messages over and over again (messages are NOT deleted after a fetch!).

## (F) Decryption and handling

Decrypt the base64 payload using your own FxA push subscription encryption keys and trigger the appropriate actions!

## Periodic polling

You should call the [GET /account/device/messages](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#get-accountdevicemessages) endpoint periodically in your app (e.g. every 20 minutes/every sync) unconditionally to check for missed messages.

If you have decided to use the URL field in the part (D), storing the last `index` received is not a viable strategy because you may have missed messages.
Here's an algorithm you should use instead:

1. Every time a message is handled, append its index in a `handled_indexes` persisted variable.

2. Call [GET /account/device/messages](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#get-accountdevicemessages) periodically, with the query param `index=last_good_index` (you'll know what `last_good_index` refers to in a moment).

3. Filter the retrieved messages with `handled_indexes`: these are your missed messages, handle them.

4. Once all messages are decrypted and handled, empty `handled_indexes`, and set `last_good_index` to the last index you received in 2.

## Devices capabilities

FxA messages is not supported on every client implementation yet! So how do we know if it's safe to send messages to a particular device?
Enter `capabilities`: each device must self-report that it has the capability of handling messages when it registers (see [Device registration](https://github.com/mozilla/fxa-auth-server/blob/master/docs/api.md#post-accountdevice)).
When you have completed your *messages* implementation, you should make sure your client implementation of FxA reports that new capability and more importantly make sure **existing** device registrations are updated as well!
