const helpText = {};

function showHomePage(headers, response) {
    headers['content-type'] = 'text/plain';

    const helpText = require('../lib/help');
    response.writeHead(200, headers);
    response.end(helpText);
}

module.exports = {
    showHomePage
};