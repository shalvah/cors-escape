# cors-escape
**CORS Escape** is a Node.js proxy which adds CORS headers to the proxied request. Inspired by [CORS-Anywhere](https://github.com/Rob--W/cors-anywhere)

- The url to proxy is taken from the path, validated and proxied. The protocol part of the proxied URI is optional, and defaults to "http". If port 443 is specified, the protocol defaults to "https".
- The HTTP method used in your request wiil be used in requesting the resource.
- All headers sent in your request will be passed along to the destination, except for the Origin header which is set to the same domain as the destination.
 - Redirects from the destination will be followed and the final response returned. This response will have an `x-cors-redirect-n` header ()where n starts at 1) for each redirect, containing the status code and URL redirected to. There wil also be an `x-final-url` header containing the final URL.

## Example

Request examples:

* `http://localhost:8080/http://google.com/` - Google.com with CORS headers
* `http://localhost:8080/google.com` - Same as previous.
* `http://localhost:8080/google.com:443` - Proxies `https://google.com/`
* `http://localhost:8080/` - Shows usage text, as defined in `libs/help.txt`
* `http://localhost:8080/favicon.ico` - Replies 404 Not found

## Documentation

### Client

To use the API, make the request to your desired URL as normal, but prefix the URL with the API URL (see the examples above).

A concise summary of the documentation is provided at [lib/help.js](lib/help.js).


### Server

The module exports `createServer(options)`, which creates a server that handles
proxy requests. The following options are supported:

* function `getProxyForUrl` - If set, specifies which intermediate proxy to use for a given URL.
  If the return value is void, a direct request is sent. The default implementation is
  [`proxy-from-env`](https://github.com/Rob--W/proxy-from-env), which respects the standard proxy
  environment variables (e.g. `https_proxy`, `no_proxy`, etc.).  
* array of strings `originBlacklist` - If set, requests whose origin is listed are blocked.  
  Example: `['https://bad.example.com', 'http://bad.example.com']`
* array of strings `originWhitelist` - If set, requests whose origin is not listed are blocked.  
  If this list is empty, all origins are allowed.
  Example: `['https://good.example.com', 'http://good.example.com']`
* function `checkRateLimit` - If set, it is called with the origin (string) of the request. If this
  function returns a non-empty string, the request is rejected and the string is send to the client.
* boolean `redirectSameOrigin` - If true, requests to URLs from the same origin will not be proxied but redirected.
  The primary purpose for this option is to save server resources by delegating the request to the client
  (since same-origin requests should always succeed, even without proxying).
* array of strings `requireHeaders` - If set, the request must include this header or the API will refuse to proxy.  
  Recommended if you want to prevent users from using the proxy for normal browsing.  
  Example: `['Origin', 'X-Requested-With']`.
* array of lowercase strings `removeHeaders` - Exclude certain headers from being included in the request.  
  Example: `["cookie"]`
* dictionary of lowercase strings `setHeaders` - Set headers for the request (overwrites existing ones).  
  Example: `{"x-powered-by": "CORS Escape"}`
* number `corsMaxAge` - If set, an Access-Control-Max-Age request header with this value (in seconds) will be added.  
  Example: `600` - Allow CORS preflight request to be cached by the browser for 10 minutes.
* string `helpFile` - Set the help file (shown at the homepage).  
  Example: `"myCustomHelpText.txt"`

For advanced users, the following options are also provided.

* `httpProxyOptions` - Under the hood, [http-proxy](https://github.com/nodejitsu/node-http-proxy)
  is used to proxy requests. Use this option if you really need to pass options
  to http-proxy. The documentation for these options can be found [here](https://github.com/nodejitsu/node-http-proxy#options).
* `httpsOptions` - If set, a `https.Server` will be created. The given options are passed to the
  [`https.createServer`](https://nodejs.org/api/https.html#https_https_createserver_options_requestlistener) method.

For even more advanced usage (building upon CORS Escape),
see the sample code in [test/test-examples.js](test/test-examples.js).

### Demo server

A public demo of CORS Escape is available at https://cors-escape-git-master.shalvah.now.sh. This server is
only provided so that you can easily and quickly try out CORS Escape. To ensure that the service
stays available to everyone, the number of requests per period is limited, except for requests from
some explicitly whitelisted origins.

If you expect lots of traffic, please host your own instance of CORS Escape, and make sure that
the CORS Escape server only whitelists your site to prevent others from using your instance of CORS Escape as an open proxy.

For instance, to run a CORS Escape server that accepts any request from some example.com sites on port 8080, use:
```
export PORT=8080
export CORSESCAPE_WHITELIST=https://example.com,http://example.com,http://example.com:8080
node server.js
```

## License
MIT