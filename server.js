const debug = require('debug')('cors-escape');
const host = process.env.HOST || '0.0.0.0';
const port = process.env.PORT || 2000;

// Grab the blacklist from the environment so that we can update the blacklist without deploying
// again. CORS Escape is open by design, and this blacklist is not used, except for countering
// immediate abuse (e.g. denial of service). If you want to block all origins except for some,
// use originWhitelist instead.
const {parseEnvVarAsList} = require('./lib/helpers');
const originBlacklist = parseEnvVarAsList(process.env.CORSESCAPE_BLACKLIST);
const originWhitelist = parseEnvVarAsList(process.env.CORSESCAPE_WHITELIST);

debug('Blacklisting origins: ' + originBlacklist);
debug('Whitelisting origins: ' + originWhitelist);

// Set up rate-limiting to avoid abuse of the public server.
const checkRateLimit = require('./lib/rate-limit')(process.env.CORSESCAPE_RATELIMIT);

const corsProxy = require('./lib/cors-escape');
corsProxy.createServer({
    originBlacklist,
    originWhitelist,
    requireHeaders: ['origin'],
    checkRateLimit,
    removeHeaders: [
        // Strip Heroku-specific headers
        'x-heroku-queue-wait-time',
        'x-heroku-queue-depth',
        'x-heroku-dynos-in-use',
        'x-request-start',
    ],
    redirectSameOrigin: true,
    httpProxyOptions: {
        // Do not add X-Forwarded-For, etc. headers, because Heroku already adds it.
        xfwd: false,
    },
    spoofOrigin: true
}).listen(port, host, () => {
    console.log('Running CORS Escape on ' + host + ':' + port);
});
