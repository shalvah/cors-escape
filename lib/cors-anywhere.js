'use strict';
const debug = require('debug')('cors-escape');
const httpProxy = require('http-proxy');
const url = require('url');
const getProxyForUrl = require('proxy-from-env').getProxyForUrl;
const {showHomePage} = require('../routes/home');
const {isValidHostName, parseURL} = require('./helpers');

/**
 * Adds CORS headers to the response headers.
 *
 * @param headers {object} Response headers
 * @param request {ServerRequest}
 */
function withCORS(headers, request) {
    headers['access-control-allow-origin'] = '*';
    const corsMaxAge = request.corsEscapeRequestState.corsMaxAge;
    if (corsMaxAge) {
        headers['access-control-max-age'] = corsMaxAge;
    }
    if (request.headers['access-control-request-method']) {
        headers['access-control-allow-methods'] = request.headers['access-control-request-method'];
        delete request.headers['access-control-request-method'];
    }
    if (request.headers['access-control-request-headers']) {
        headers['access-control-allow-headers'] = request.headers['access-control-request-headers'];
        delete request.headers['access-control-request-headers'];
    }

    headers['access-control-expose-headers'] = Object.keys(headers).join(',');

    return headers;
}

/**
 * Performs the actual proxy request.
 *
 * @param req {ServerRequest} Incoming http request
 * @param res {ServerResponse} Outgoing (proxied) http request
 * @param proxy {HttpProxy}
 */
function proxyRequest(req, res, proxy) {
    const location = req.corsEscapeRequestState.location;
    req.url = location.path;

    const proxyOptions = {
        changeOrigin: false,
        prependPath: false,
        target: location,
        headers: {
            host: location.host,
        },
        // HACK: Get hold of the proxyReq object, because we need it later.
        // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L144
        buffer: {
            pipe: function (proxyReq) {
                const proxyReqOn = proxyReq.on;
                // Intercepts the handler that connects proxyRes to res.
                // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L146-L158
                proxyReq.on = function (eventName, listener) {
                    if (eventName !== 'response') {
                        return proxyReqOn.call(this, eventName, listener);
                    }
                    return proxyReqOn.call(this, 'response', function (proxyRes) {
                        if (onProxyResponse(proxy, proxyReq, proxyRes, req, res)) {
                            listener(proxyRes);
                        }
                    });
                };
                return req.pipe(proxyReq);
            },
        },
    };

    const proxyThroughUrl = req.corsEscapeRequestState.getProxyForUrl(location.href);
    if (proxyThroughUrl) {
        proxyOptions.target = proxyThroughUrl;
        proxyOptions.toProxy = true;
        // If a proxy URL was set, req.url must be an absolute URL. Then the request will not be sent
        // directly to the proxied URL, but through another proxy.
        req.url = location.href;
    }

    // Start proxying the request
    proxy.web(req, res, proxyOptions);
}

/**
 * This method modifies the response headers of the proxied response.
 * If a redirect is detected, the response is not sent to the client,
 * and a new request is initiated.
 *
 * client (req) -> CORS Escape -> (proxyReq) -> other server
 * client (res) <- CORS Escape <- (proxyRes) <- other server
 *
 * @param proxy {HttpProxy}
 * @param proxyReq {ClientRequest} The outgoing request to the other server.
 * @param proxyRes {ServerResponse} The response from the other server.
 * @param req {IncomingMessage} Incoming HTTP request, augmented with property corsEscapeRequestState
 * @param req.corsEscapeRequestState {object}
 * @param req.corsEscapeRequestState.location {object} See parseURL
 * @param req.corsEscapeRequestState.getProxyForUrl {function} See proxyRequest
 * @param req.corsEscapeRequestState.proxyBaseUrl {string} Base URL of the CORS API endpoint
 * @param req.corsEscapeRequestState.maxRedirects {number} Maximum number of redirects
 * @param req.corsEscapeRequestState.redirectCount_ {number} Internally used to count redirects
 * @param res {ServerResponse} Outgoing response to the client that wanted to proxy the HTTP request.
 *
 * @returns {boolean} true if http-proxy should continue to pipe proxyRes to res.
 */
function onProxyResponse(proxy, proxyReq, proxyRes, req, res) {
    const requestState = req.corsEscapeRequestState;

    const statusCode = proxyRes.statusCode;

    if (!requestState.redirectCount_) {
        res.setHeader('x-request-url', requestState.location.href);
    }
    // Handle redirects
    if ([301, 302, 303, 307, 308].includes(statusCode )) {
        let locationHeader = proxyRes.headers.location;
        if (locationHeader) {
            locationHeader = url.resolve(requestState.location.href, locationHeader);

            debug(`Request to ${requestState.location.href} redirecting with status ${statusCode} to ${locationHeader}`);

            if ([301, 302, 303].includes(statusCode )) {
                // Exclude 307 & 308, because they are rare, and require preserving the method + request body
                requestState.redirectCount_ = requestState.redirectCount_ + 1 || 1;
                if (requestState.redirectCount_ <= requestState.maxRedirects) {
                    // Handle redirects within the server, because some clients (e.g. Android Stock Browser)
                    // cancel redirects.
                    // Set header for debugging purposes. Do not try to parse it!
                    res.setHeader('X-CORS-Redirect-' + requestState.redirectCount_, statusCode + ' ' + locationHeader);

                    req.method = 'GET';
                    // Send original request headers too
                    req.headers = JSON.parse(JSON.stringify(proxyReq.headers || {}));
                    req.headers['content-length'] = '0';
                    delete req.headers['content-type'];
                    requestState.location = parseURL(locationHeader);

                    // Remove all listeners (=reset events to initial state)
                    req.removeAllListeners();

                    // Remove the error listener so that the ECONNRESET "error" that
                    // may occur after aborting a request does not propagate to res.
                    // https://github.com/nodejitsu/node-http-proxy/blob/v1.11.1/lib/http-proxy/passes/web-incoming.js#L134
                    proxyReq.removeAllListeners('error');
                    proxyReq.once('error', function catchAndIgnoreError() {
                    });
                    proxyReq.abort();

                    // Initiate a new proxy request.
                    proxyRequest(req, res, proxy);
                    return false;
                }
            }
            proxyRes.headers.location = requestState.proxyBaseUrl + '/' + locationHeader;
        }
    }

    proxyRes.headers['x-final-url'] = requestState.location.href;
    withCORS(proxyRes.headers, req);
    return true;
}

// Request handler factory
function getHandler(options, proxy) {
    const corsEscape = {
        getProxyForUrl, // Function that specifies the proxy to use
        maxRedirects: 5,                // Maximum number of redirects to be followed.
        originBlacklist: [],            // Requests from these origins will be blocked.
        originWhitelist: [],            // If non-empty, requests not from an origin in this list will be blocked.
        checkRateLimit: null,           // Function that may enforce a rate-limit by returning a non-empty string.
        redirectSameOrigin: false,      // Redirect the client to the requested URL for same-origin requests.
        requireHeaders: [],            // Require headers to be set
        removeHeaders: [],              // Strip these request headers.
        setHeaders: {},                 // Set these request headers.
        corsMaxAge: 0,                  // If set, an Access-Control-Max-Age header with this value (in seconds) will be added.
        spoofOrigin: true,             // if the 'Origin' header should be replaced with the target url
    };

    Object.assign(corsEscape, options);

    if (corsEscape.requireHeaders.length) {
        corsEscape.requireHeaders = corsEscape.requireHeaders.map((header) => header.toLowerCase());
    }
    const hasRequiredHeaders = (providedHeaders) => {
        return corsEscape.requireHeaders.length === 0
            || corsEscape.requireHeaders.some(function (headerName) {
                return providedHeaders[headerName] !== undefined;
            });
    };

    return function (req, res) {
        req.corsEscapeRequestState = {
            getProxyForUrl: corsEscape.getProxyForUrl,
            maxRedirects: corsEscape.maxRedirects,
            corsMaxAge: corsEscape.corsMaxAge,
        };

        const corsHeaders = withCORS({}, req);
        if (req.method === 'OPTIONS') {
            // Pre-flight request. Reply successfully:
            res.writeHead(200, corsHeaders);
            res.end();
            return;
        }

        debug(`Full URL: ${req.url}`);
        const query = require('querystring').parse(req.url.replace(/^\/(\?)?/, ''));
        const location = parseURL(query.url || req.url.slice(1));

        if (!location) {
            // Invalid API call. Show how to correctly use the API
            showHomePage(corsHeaders, res);
            return;
        }

        if (location.port > 65535) {
            // Port is higher than 65535
            res.writeHead(400, 'Invalid port', corsHeaders);
            res.end('Port number too large: ' + location.port);
            return;
        }

        if (!/^\/https?:/.test(req.url) && !isValidHostName(location.hostname)) {
            // Don't even try to proxy invalid hosts (such as /favicon.ico, /robots.txt)
            res.writeHead(404, 'Invalid host', corsHeaders);
            res.end('Invalid host: ' + location.hostname);
            return;
        }

        if (!hasRequiredHeaders(req.headers)) {
            res.writeHead(400, 'Header required', corsHeaders);
            res.end('Missing required request header. Must specify one of: ' + corsEscape.requireHeaders);
            return;
        }

        const origin = req.headers.origin || '';
        if (corsEscape.originBlacklist.includes(origin)) {
            res.writeHead(403, 'Forbidden', corsHeaders);
            res.end('The origin "' + origin + '" was blacklisted by the operator of this proxy.');
            return;
        }

        if (corsEscape.originWhitelist.includes(origin)) {
            res.writeHead(403, 'Forbidden', corsHeaders);
            res.end('The origin "' + origin + '" was not whitelisted by the operator of this proxy.');
            return;
        }

        const rateLimitMessage = corsEscape.checkRateLimit && corsEscape.checkRateLimit(origin);
        if (rateLimitMessage) {
            res.writeHead(429, 'Too Many Requests', corsHeaders);
            res.end('The origin "' + origin + '" has sent too many requests.\n' + rateLimitMessage);
            return;
        }

        if (corsEscape.redirectSameOrigin && origin && location.href[origin.length] === '/' &&
            location.href.lastIndexOf(origin, 0) === 0) {
            // Send a permanent redirect to offload the server. Badly coded clients should not waste our resources.
            corsHeaders.consty = 'origin';
            corsHeaders['cache-control'] = 'private';
            corsHeaders.location = location.href;
            res.writeHead(301, 'Please use a direct request', corsHeaders);
            res.end();
            return;
        }

        const isRequestedOverHttps = req.connection.encrypted || /^\s*https/.test(req.headers['x-forwarded-proto']);
        const proxyBaseUrl = (isRequestedOverHttps ? 'https://' : 'http://') + req.headers.host;

        corsEscape.removeHeaders.forEach(function (header) {
            delete req.headers[header];
        });

        Object.keys(corsEscape.setHeaders).forEach(function (header) {
            req.headers[header] = corsEscape.setHeaders[header];
        });

        if (options.spoofOrigin) {
            let targetUrl = url.parse(req.url.slice(1));
            req.headers.origin = targetUrl.protocol + "//" + targetUrl.hostname;
        }
        req.corsEscapeRequestState.location = location;
        req.corsEscapeRequestState.proxyBaseUrl = proxyBaseUrl;

        proxyRequest(req, res, proxy);
    };
}

// Create server with default and given values
// Creator still needs to call .listen()
const createServer = function createServer(options) {
    options = options || {};

    const httpProxyOptions = {
        xfwd: true,            // Append X-Forwarded-* headers
    };

    if (options.httpProxyOptions) {
        Object.assign(httpProxyOptions, options.httpProxyOptions);
    }

    const proxy = httpProxy.createServer(httpProxyOptions);
    const requestHandler = getHandler(options, proxy);
    let server;
    if (options.httpsOptions) {
        server = require('https').createServer(options.httpsOptions, requestHandler);
    } else {
        server = require('http').createServer(requestHandler);
    }

    // When the server fails, just show a 404 instead of Internal server error
    proxy.on('error', function proxyErrorHandler(err, req, res) {
        if (res.headersSent) {
            // This could happen when a protocol error occurs when an error occurs
            // after the headers have been received (and forwarded). Do not write
            // the headers because it would generate an error.
            return;
        }
        res.writeHead(404, {'Access-Control-Allow-Origin': '*'});
        res.end('Not found because of proxy error: ' + err);
    });

    return server;
};

module.exports = {
    createServer
};