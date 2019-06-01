"use strict";

const net = require('net');
const regexpTld = require('./regexp-top-level-domain');
const url = require('url');

module.exports = {
    parseEnvVarAsList(env) {
        if (!env) {
            return [];
        }
        return env.split(',');
    },

    /**
     * Check whether the specified hostname is valid.
     *
     * @param hostname {string} Host name (excluding port) of requested resource.
     * @return {boolean} Whether the requested resource can be accessed.
     */
    isValidHostName(hostname) {
        return !!(
            regexpTld.test(hostname) ||
            net.isIPv4(hostname) ||
            net.isIPv6(hostname)
        );
    },

    /**
     * @param req_url {string} The requested URL (scheme is optional).
     * @return {object} URL parsed using url.parse
     */
    parseURL(req_url) {
        const match = req_url.match(/^(?:(https?:)?\/\/)?(([^\/?]+?)(?::(\d{0,5})(?=[\/?]|$))?)([\/?][\S\s]*|$)/i);
        //                              ^^^^^^^          ^^^^^^^^      ^^^^^^^                ^^^^^^^^^^^^
        //                            1:protocol       3:hostname     4:port                 5:path + query string
        //                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        //                                            2:host
        if (!match) {
            return null;
        }
        if (!match[1]) {
            // Scheme is omitted.
            if (req_url.lastIndexOf('//', 0) === -1) {
                // "//" is omitted.
                req_url = '//' + req_url;
            }
            req_url = (match[4] === '443' ? 'https:' : 'http:') + req_url;
        }
        return url.parse(req_url);
    }
};