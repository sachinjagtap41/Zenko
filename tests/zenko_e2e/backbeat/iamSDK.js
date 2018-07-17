const IAM = require('aws-sdk').IAM;

module.exports = new IAM({
    accessKeyId: undefined, 
    secretAccessKey: undefined,
    sslEnabled: false,
    endpoint: 'http://localhost:8600',
    apiVersion: '2010-05-08',
    signatureVersion: 'v4',
    region: 'us-east-1',
});
