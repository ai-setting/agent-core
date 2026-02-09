const fs = require('fs');
const path = require('path');

const logFile = process.env.LOG_FILE || 'test.log';
console.log('LOG_FILE:', logFile);
console.log('Dir:', path.dirname(logFile));

try {
    fs.appendFileSync(logFile, 'Test log entry\n');
    console.log('✓ Log written successfully');
} catch (err) {
    console.error('✗ Error:', err.message);
}
