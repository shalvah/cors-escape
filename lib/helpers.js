"use strict";

module.exports = {
    parseEnvVarAsList(env) {
        if (!env) {
            return [];
        }
        return env.split(',');
    }
};