const helpText = {};

function showHomePage(headers, response) {
    const helpFile = require('path').join(__dirname, '/../lib/help.txt');
    headers['content-type'] = 'text/plain';

    if (helpText[helpFile]) {
        response.writeHead(200, headers);
        response.end(helpText[helpFile]);
    } else {
        require('fs').readFile(helpFile, 'utf8', (err, data) => {
            if (err) {
                console.error(err);
                response.writeHead(500, headers);
                response.end();
            } else {
                // cCche contents of file
                helpText[helpFile] = data;
                showHomePage(headers, response); // Recursive call, but since data is a string, the recursion will end
            }
        });
    }
}

module.exports = {
    showHomePage
};