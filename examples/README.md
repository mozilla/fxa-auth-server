## Some API call examples

Files served in this folder are code samples that illustrates
what is required to make API calls to fxa-auth-server.

They should not be used for production code, but should be seen as
quick tools to make proof of concepts.

### How to use

Files in this folder are meant to be run through nodejs as a quick and
dirty test. All you have to do is edit to your setup and run!

    node signup.js

You should get something similar to...

    my kA: 25b19f8f007a...
    my kB: 8a2cf6de4116...
    my wrapKb: bb32dfad...
    my cert: eyJhbGciOi...
    done


### Things to know

#### Which FxA Client instance is used?

If you run fxa-auth-server along with fxa-content-server (which is
very likely) the fxa-js-client is loaded through `fxa-content-server/bower.json` as a dependency that is loaded from within the frontend assets in `app/bower_components/fxa-js-client/fxa-js-client.js`

