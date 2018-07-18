const assert = require('assert');
const crypto = require('crypto');
const async = require('async');
const fs = require('fs');

const { scalityS3Client, awsS3Client } = require('./s3SDK');
const iamClient = require('./iamSDK');

const REPLICATION_TIMEOUT = 10000;

class ReplicationUtility {
    constructor(s3, azure, gcpStorage) {
        this.s3 = s3;
        this.azure = azure;
        this.gcpStorage = gcpStorage;
    }

    _compareObjectBody(body1, body2) {
        const digest1 = crypto.createHash('md5').update(body1).digest('hex');
        const digest2 = crypto.createHash('md5').update(body2).digest('hex');
        if (digest1 !== digest2) {
            // dump data for later investigation
            const filePrefix = `${process.env.CIRCLE_ARTIFACTS}/` +
                      `genericStaas_backbeat_md5_mismatch_body`;
            fs.writeFileSync(`${filePrefix}1.bin`, body1);
            fs.writeFileSync(`${filePrefix}2.bin`, body2);
            console.error('md5 mismatch: data dumped in ' +
                          `${filePrefix}{1,2}.bin`);
        }
        assert.strictEqual(digest1, digest2);
    }

    _deleteVersionList(versionList, bucketName, cb) {
        async.each(versionList, (versionInfo, next) =>
            this.deleteObject(bucketName, versionInfo.Key,
                versionInfo.VersionId, next), cb);
    }

    _deleteBlobList(blobList, containerName, cb) {
        async.each(blobList, (blob, next) =>
            this.deleteBlob(containerName, blob.name, undefined, next), cb);
    }

    _setS3Client(s3Client) {
        this.s3 = s3Client;
        return this;
    }

    deleteAllVersions(bucketName, keyPrefix, cb) {
        this.s3.listObjectVersions({ Bucket: bucketName }, (err, data) => {
            if (err) {
                return cb(err);
            }
            let versions = data.Versions;
            let deleteMarkers = data.DeleteMarkers;
            // If replicating to a multiple backend bucket, we only want to
            // remove versions that we have put with our tests.
            if (keyPrefix) {
                versions = versions.filter(version =>
                    version.Key.startsWith(keyPrefix));
                deleteMarkers = deleteMarkers.filter(marker =>
                    marker.Key.startsWith(keyPrefix));
            }
            return async.series([
                next => this._deleteVersionList(deleteMarkers, bucketName,
                    next),
                next => this._deleteVersionList(versions, bucketName, next),
            ], err => cb(err));
        });
    }

    deleteAllBlobs(containerName, keyPrefix, cb) {
        const options = { include: 'metadata' };
        this.azure.listBlobsSegmented(containerName, null, options,
            (err, result, response) => {
                if (err) {
                    return cb(err);
                }
                // Only delete the blobs put by the current test.
                const filteredEntries = result.entries.filter(entry =>
                    entry.name.startsWith(keyPrefix));
                return this._deleteBlobList(filteredEntries, containerName, cb);
            });
    }

    deleteAllFiles(bucketName, filePrefix, cb) {
        const bucket = this.gcpStorage.bucket(bucketName);
        bucket.deleteFiles({ prefix: filePrefix }, cb);
    }

    putObject(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            Body: content,
        }, cb);
    }

    putObjectWithContentType(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            ContentType: 'image/png',
            Body: content,
        }, cb);
    }

    putObjectWithUserMetadata(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            Metadata: { customKey: 'customValue' },
            Body: content,
        }, cb);
    }

    putObjectWithCacheControl(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            CacheControl: 'test-cache-control',
            Body: content,
        }, cb);
    }

    putObjectWithContentDisposition(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            ContentDisposition: 'test-content-disposition',
            Body: content,
        }, cb);
    }

    putObjectWithContentEncoding(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            ContentEncoding: 'test-content-encoding',
            Body: content,
        }, cb);
    }

    putObjectWithContentLanguage(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            ContentLanguage: 'test-content-language',
            Body: content,
        }, cb);
    }

    putObjectWithProperties(bucketName, objectName, content, cb) {
        this.s3.putObject({
            Bucket: bucketName,
            Key: objectName,
            Metadata: { 'customKey': 'customValue' },
            ContentType: 'image/png',
            CacheControl: 'test-cache-control',
            ContentDisposition: 'test-content-disposition',
            ContentEncoding: 'test-content-encoding',
            ContentLanguage: 'test-content-language',
            Body: content,
        }, cb);
    }

    copyObject(bucketName, copySource, objectName, cb) {
        this.s3.copyObject({
            Bucket: bucketName,
            CopySource: copySource,
            Key: objectName,
        }, cb);
    }

    genericCompleteMPU(bucketName, objectName, howManyParts, isExternalBackend,
        hasOptionalFields, cb) {
        let uploadId;
        let ETags = [];
        const partNumbers = Array.from(Array(howManyParts).keys());
        const initiateMPUParams = {
            Bucket: bucketName,
            Key: objectName,
        }
        if (hasOptionalFields) {
            Object.assign(initiateMPUParams, {
                Metadata: { 'customKey': 'customValue' },
                ContentType: 'image/png',
                CacheControl: 'test-cache-control',
                ContentDisposition: 'test-content-disposition',
                ContentEncoding: 'test-content-encoding',
                ContentLanguage: 'test-content-language',
            });
        }
        return async.waterfall([
            next => this.s3.createMultipartUpload(initiateMPUParams,
            (err, data) => {
                if (err) {
                    return next(err);
                }
                uploadId = data.UploadId;
                return next();
            }),
            next =>
                async.mapLimit(partNumbers, 10, (partNumber, callback) => {
                    const uploadPartParams = {
                        Bucket: bucketName,
                        Key: objectName,
                        PartNumber: partNumber + 1,
                        UploadId: uploadId,
                        Body: isExternalBackend ?
                            Buffer.alloc(1024 * 1024 * 5 + 1).fill(partNumber) :
                            `part ${partNumber} body`,
                    };

                    return this.s3.uploadPart(uploadPartParams,
                        (err, data) => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, data.ETag);
                        });
                }, (err, results) => {
                    if (err) {
                        return next(err);
                    }
                    ETags = results;
                    return next();
                }),
            next => {
                const params = {
                    Bucket: bucketName,
                    Key: objectName,
                    MultipartUpload: {
                        Parts: partNumbers.map(n => ({
                            ETag: ETags[n],
                            PartNumber: n + 1,
                        })),
                    },
                    UploadId: uploadId,
                };
                return this.s3.completeMultipartUpload(params, next);
            },
        ], err => {
            if (err) {
                return this.s3.abortMultipartUpload({
                    Bucket: bucketName,
                    Key: objectName,
                    UploadId: uploadId,
                }, () => cb(err));
            }
            return cb();
        });
    }

    completeMPU(bucketName, objectName, howManyParts, cb) {
        this.genericCompleteMPU(bucketName, objectName, howManyParts, false,
            undefined, cb);
    }

    completeMPUAWS(bucketName, objectName, howManyParts, cb) {
        this.genericCompleteMPU(bucketName, objectName, howManyParts, true,
            undefined, cb);
    }

    completeMPUAWSWithProperties(bucketName, objectName, howManyParts, cb) {
        this.genericCompleteMPU(bucketName, objectName, howManyParts, true,
            true, cb);
    }

    completeMPUWithPartCopy(bucketName, objectName, copySource, byteRange,
        howManyParts, cb) {
        let uploadId;
        let ETags = [];
        const partNumbers = Array.from(Array(howManyParts).keys());
        return async.waterfall([
            next => this.s3.createMultipartUpload({
                Bucket: bucketName,
                Key: objectName,
            }, (err, data) => {
                if (err) {
                    return next(err);
                }
                uploadId = data.UploadId;
                return next();
            }),
            next =>
                async.mapLimit(partNumbers, 10, (partNumber, callback) => {
                    const uploadPartCopyParams = {
                        Bucket: bucketName,
                        CopySource: copySource,
                        CopySourceRange: byteRange ?
                            `bytes=${byteRange}` : undefined,
                        Key: objectName,
                        PartNumber: partNumber + 1,
                        UploadId: uploadId,
                    };
                    return this.s3.uploadPartCopy(uploadPartCopyParams,
                        (err, data) => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, data.ETag);
                        });
                }, (err, results) => {
                    if (err) {
                        return next(err);
                    }
                    ETags = results;
                    return next();
                }),
            next => this.s3.completeMultipartUpload({
                Bucket: bucketName,
                Key: objectName,
                MultipartUpload: {
                    Parts: partNumbers.map(n => ({
                        ETag: ETags[n],
                        PartNumber: n + 1,
                    })),
                },
                UploadId: uploadId,
            }, next),
        ], err => {
            if (err) {
                return this.s3.abortMultipartUpload({
                    Bucket: bucketName,
                    Key: objectName,
                    UploadId: uploadId,
                }, () => cb(err));
            }
            return cb();
        });
    }

    getObject(bucketName, objName, cb) {
        this.s3.getObject({
            Bucket: bucketName,
            Key: objName,
        }, cb);
    }

    getBlobToText(containerName, blob, cb) {
        this.azure.getBlobToText(containerName, blob, cb);
    }

    getBlob(containerName, blob, cb) {
        const request = this.azure.createReadStream(containerName, blob);
        const data = [];
        let totalLength = 0;
        request.on('data', chunk => {
            totalLength += chunk.length;
            data.push(chunk);
        });
        request.on('end', () => {
            cb(null, Buffer.concat(data, totalLength))
        });
        request.on('error', err => cb(err));
    }

    download(bucketName, fileName, cb) {
        const bucket = this.gcpStorage.bucket(bucketName);
        const file = bucket.file(fileName);
        file.download(cb);
    }

    createBucket(bucketName, cb) {
        this.s3.createBucket({ Bucket: bucketName }, cb);
    }

    createVersionedBucket(bucketName, cb) {
        return async.series([
            next => this.s3.createBucket({ Bucket: bucketName }, next),
            next => this.s3.putBucketVersioning({
                Bucket: bucketName,
                VersioningConfiguration: {
                    Status: 'Enabled',
                },
            }, next),
        ], err => cb(err));
    }

    deleteVersionedBucket(bucketName, cb) {
        return async.series([
            next => this.deleteAllVersions(bucketName, undefined, next),
            next => this.s3.deleteBucket({ Bucket: bucketName }, next),
        ], err => cb(err));
    }

    createAndAttachReplicationPolicy(roleName, srcBucket, destBucket, cb) {
        const s3RoleTrustPolicy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Principal: {
                        Service: 'backbeat',
                    },
                    Action: 'sts:AssumeRole',
                },
            ],
        };

        const s3RolePermissionsPolicy = {
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Action: [
                        's3:GetObjectVersion',
                        's3:GetObjectVersionAcl',
                        's3:GetObjectVersionTagging',
                    ],
                    Resource: [
                        `arn:aws:s3:::${srcBucket}/*`,
                    ],
                },
                {
                    Effect: 'Allow',
                    Action: [
                        's3:ListBucket',
                        's3:GetReplicationConfiguration',
                    ],
                    Resource: [
                        `arn:aws:s3:::${srcBucket}`,
                    ],
                },
                {
                    Effect: 'Allow',
                    Action: [
                        's3:ReplicateObject',
                        's3:ReplicateDelete',
                        's3:ReplicateTags',
                    ],
                    Resource: `arn:aws:s3:::${destBucket}/*`,
                },
            ],
        };

        return async.series([
            next => iamClient.createRole({
                AssumeRolePolicyDocument: JSON.stringify(s3RoleTrustPolicy),
                RoleName: roleName,
            }, next),
            next => iamClient.createPolicy({
                PolicyDocument: JSON.stringify(s3RolePermissionsPolicy),
                PolicyName: `PolicyForReplication-${Date.now()}`,
            }, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            const policyArn = data[1].Policy.Arn;
            return iamClient.attachRolePolicy({
                PolicyArn: policyArn,
                RoleName: roleName,
            }, err => {
                if (err) {
                    return cb(err);
                }
                const roleARN = data[0].Role.Arn;
                return cb(null, policyArn, roleARN);
            });
        });
    }

    detachAndDeletePolicy(policyArn, roleName, cb) {
        async.series([
            next => iamClient.detachRolePolicy({
                PolicyArn: policyArn,
                RoleName: roleName,
            }, next),
            next => iamClient.deleteRole({ RoleName: roleName }, next),
            next => iamClient.deletePolicy({ PolicyArn: policyArn }, next),
        ], cb);
    }

    putBucketReplication(srcBucket, destBucket, roleArn, cb) {
        this.s3.putBucketReplication({
            Bucket: srcBucket,
            ReplicationConfiguration: {
                Role: `${roleArn},${roleArn}`,
                Rules: [
                    {
                        Prefix: '',
                        Destination: {
                            Bucket: `arn:aws:s3:::${destBucket}`,
                            StorageClass: 'zenko',
                        },
                        Status: 'Enabled',
                    },
                ],
            },
        }, cb);
    }

    putBucketReplicationMultipleBackend(srcBucket, destBucket, roleArn,
        storageClass, cb) {
        this.s3.putBucketReplication({
            Bucket: srcBucket,
            ReplicationConfiguration: {
                Role: roleArn, 
                Rules: [
                    {
                        Prefix: '',
                        Destination: {
                            Bucket: `arn:aws:s3:::${destBucket}`,
                            StorageClass: storageClass,
                        },
                        Status: 'Enabled',
                    },
                ],
            },
        }, cb);
    }

    getBucketReplication(bucketName, cb) {
        this.s3.getBucketReplication({ Bucket: bucketName }, cb);
    }

    getHeadObject(bucketName, key, cb) {
        this.s3.headObject({
            Bucket: bucketName,
            Key: key,
        }, cb);
    }

    getMetadata(bucketName, fileName, cb) {
        const bucket = this.gcpStorage.bucket(bucketName);
        const file = bucket.file(fileName);
        file.getMetadata(cb);
    }

    getObjectACL(bucketName, key, cb) {
        this.s3.getObjectAcl({
            Bucket: bucketName,
            Key: key,
        }, cb);
    }

    putObjectACL(bucketName, key, cb) {
        this.s3.putObjectAcl({
            Bucket: bucketName,
            Key: key,
            ACL: 'public-read',
        }, cb);
    }

    putObjectTagging(bucketName, key, versionId, cb) {
        this.s3.putObjectTagging({
            Bucket: bucketName,
            Key: key,
            VersionId: versionId,
            Tagging: {
                TagSet: [
                    {
                        Key: 'object-tag-key',
                        Value: 'object-tag-value',
                    },
                ],
            },
        }, cb);
    }

    deleteObjectTagging(bucketName, key, versionId, cb) {
        this.s3.deleteObjectTagging({
            Bucket: bucketName,
            Key: key,
            VersionId: versionId,
        }, cb);
    }

    getObjectTagging(bucketName, key, versionId, cb) {
        this.s3.getObjectTagging({
            Bucket: bucketName,
            Key: key,
            VersionId: versionId,
        }, cb);
    }

    deleteObject(bucketName, key, versionId, cb) {
        this.s3.deleteObject({
            Bucket: bucketName,
            Key: key,
            VersionId: versionId,
        }, cb);
    }

    deleteBlob(containerName, blob, options, cb) {
        this.azure.deleteBlob(containerName, blob, options, cb);
    }

    // Continue getting head object while the status is PENDING or PROCESSING.
    waitUntilReplicated(bucketName, key, versionId, cb) {
	console.log({ bucketName, key, versionId });
        let status;
        return async.doWhilst(callback =>
            this.s3.headObject({
                Bucket: bucketName,
                Key: key,
                VersionId: versionId,
            }, (err, data) => {
                if (err) {
                    return callback(err);
                }
		console.log(data);
                status = data.ReplicationStatus;
                if (status === 'PENDING' || status === 'PROCESSING') {
                    return setTimeout(callback, 2000);
                }
                return callback();
            }),
        () => (status === 'PENDING' || status === 'PROCESSING'), cb);
    }

    // Continue getting object while the object exists.
    waitUntilDeleted(bucketName, key, client, cb) {
        let objectExists;
        const method = client === 'azure' ? 'getBlobToText' : 'getObject';
        const expectedCode = client === 'azure' ? 'BlobNotFound' : 'NoSuchKey';
        return async.doWhilst(callback =>
            this[method](bucketName, key, err => {
                if (err && err.code !== expectedCode) {
                    return callback(err);
                }
                objectExists = err === null;
                if (!objectExists) {
                    return callback();
                }
                return setTimeout(callback, 2000);
            }),
        () => objectExists, cb);
    }

    compareObjects(srcBucket, destBucket, key, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getObject(srcBucket, key, next),
            next => this.getObject(destBucket, key, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            const srcData = data[1];
            const destData = data[2];
            assert.strictEqual(srcData.ReplicationStatus, 'COMPLETED');
            assert.strictEqual(destData.ReplicationStatus, 'REPLICA');
            delete srcData.ReplicationStatus;
            delete destData.ReplicationStatus;
            this._compareObjectBody(srcData.Body, destData.Body);
            delete srcData.Body;
            delete destData.Body;
            assert.deepStrictEqual(srcData, destData);
            return cb();
        });
    }

    compareObjectsAWS(srcBucket, destBucket, key, optionalField, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getObject(srcBucket, key, next),
            next => this._setS3Client(awsS3Client).getObject(destBucket, `${srcBucket}/${key}`,
                next),
        ], (err, data) => {
            this._setS3Client(scalityS3Client);
            if (err) {
                return cb(err);
            }
            const srcData = data[1];
            const destData = data[2];
            assert.strictEqual(srcData.ReplicationStatus, 'COMPLETED');
            assert.strictEqual(srcData.ETag, destData.ETag);
            assert.strictEqual(srcData.ContentLength,
                destData.ContentLength);
            this._compareObjectBody(srcData.Body, destData.Body);
            const srcUserMD = srcData.Metadata;
            assert.strictEqual(srcUserMD['aws-destination-version-id'],
                destData.VersionId);
            assert.strictEqual(srcUserMD['aws-destination-replication-status'],
                'COMPLETED');
            const destUserMD = destData.Metadata;
            assert.strictEqual(destUserMD['scal-version-id'],
                srcData.VersionId);
            assert.strictEqual(destUserMD['scal-replication-status'],
                'REPLICA');
            if (optionalField === 'Metadata') {
                assert.strictEqual(srcUserMD.customkey, 'customValue');
                assert.strictEqual(destUserMD.customkey, 'customValue');
            }
            if (optionalField && optionalField !== 'Metadata') {
                assert.strictEqual(srcData[optionalField],
                    destData[optionalField]);
            }
            return cb();
        });
    }

    compareObjectsAzure(srcBucket, containerName, key, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getObject(srcBucket, key, next),
            next => this.azure.getBlobProperties(containerName, key, next),
            next => this.getBlob(containerName, key, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            const srcData = data[1];
            const destProperties = data[2];
            const destPropResult = destProperties[0];
            const destPropResponse = destProperties[1];
            const destDataBuf = data[3];
            assert.strictEqual(srcData.ReplicationStatus, 'COMPLETED');
            // Azure does not have versioning so there is no version metadata
            // from Azure to set on the source.
            assert.strictEqual(
                srcData.Metadata['azurebackendreplication-replication-status'],
                'COMPLETED');
            assert.strictEqual(
                destPropResult.metadata['scal_replication_status'], 'REPLICA');
            assert.strictEqual(
                destPropResult.metadata['scal_version_id'], srcData.VersionId);
            assert.strictEqual(
                destPropResponse.headers['x-ms-meta-scal_replication_status'],
                'REPLICA');
            assert.strictEqual(
                destPropResponse.headers['x-ms-meta-scal_version_id'],
                srcData.VersionId);
            this._compareObjectBody(srcData.Body, destDataBuf);
            return cb();
        });
    }

    compareObjectsGCP(srcBucket, destBucket, key, cb) {
        return async.series({
            wait: next =>
                this.waitUntilReplicated(srcBucket, key, undefined, next),
            srcData: next => this.getObject(srcBucket, key, next),
            destMetadata: next => this.getMetadata(destBucket, key, next),
            destData: next => this.download(destBucket, key, next),
        }, (err, data) => {
            if (err) {
                return cb(err);
            }
            const { srcData, destMetadata, destData } = data;
            assert.strictEqual(srcData.ReplicationStatus, 'COMPLETED');
            assert.strictEqual(srcData.ContentLength, destMetadata[0].size);
            const srcUserMD = srcData.Metadata;
            const destUserMD = destMetadata[0].metadata
            assert.strictEqual(
                srcUserMD['gcpbackendreplication-replication-status'],
                'COMPLETED');
            assert.strictEqual(srcUserMD['gcpbackendreplication-version-id'],
                destMetadata[0].generation);
            assert.strictEqual(destUserMD['scal-replication-status'],
                'REPLICA');
            assert.strictEqual(destUserMD['scal-version-id'],
                srcData.VersionId);
            this._compareObjectBody(srcData.Body, destData);
            return cb();
        });
    }

    compareObjectsOneToMany(srcBucket, scalityDestBucket, awsDestBucket,
        containerName, key, optionalField, cb) {
        return async.series({
            wait: next =>
                this.waitUntilReplicated(srcBucket, key, undefined, next),
            srcData: next =>
                this.getObject(srcBucket, key, next),
            scalityDestData: next =>
                this.getObject(scalityDestBucket, key, next),
            awsDestData: next =>
                this._setS3Client(awsS3Client).getObject(awsDestBucket, key,
                    next),
            azureDestProperties: next =>
                this.azure.getBlobProperties(containerName, key, next),
            azureDestDataBuf: next => this.getBlob(containerName, key, next),
        }, (err, data) => {
            this._setS3Client(scalityS3Client);
            if (err) {
                return cb(err);
            }
            const { srcData, scalityDestData, awsDestData, azureDestProperties,
                azureDestDataBuf } = data;
            const azureDestPropResult = azureDestProperties[0];
            const azureDestPropResponse = azureDestProperties[1];
            assert.strictEqual(srcData.ReplicationStatus, 'COMPLETED');
            assert.strictEqual(srcData.ETag, scalityDestData.ETag);
            assert.strictEqual(srcData.ETag, awsDestData.ETag);
            assert.strictEqual(srcData.ContentLength,
                scalityDestData.ContentLength);
            assert.strictEqual(srcData.ContentLength,
                awsDestData.ContentLength);
            this._compareObjectBody(srcData.Body, scalityDestData.Body);
            this._compareObjectBody(srcData.Body, awsDestData.Body);
            this._compareObjectBody(srcData.Body, azureDestDataBuf);
            const srcUserMD = srcData.Metadata;
            assert.strictEqual(srcData.VersionId, scalityDestData.VersionId);
            assert.strictEqual(srcUserMD['us-east-2-version-id'],
                awsDestData.VersionId);
            assert.strictEqual(srcUserMD['us-east-2-replication-status'],
                'COMPLETED');
            assert.strictEqual(
                srcUserMD['azurebackendreplication-replication-status'],
                'COMPLETED');
            assert.strictEqual(
                azureDestPropResult.metadata['scal_replication_status'],
                'REPLICA');
            const scalityDestUserMD = scalityDestData.Metadata;
            const awsDestUserMD = awsDestData.Metadata;
            assert.strictEqual(awsDestUserMD['scal-version-id'],
                srcData.VersionId);
            assert.strictEqual(azureDestPropResult.metadata['scal_version_id'],
                srcData.VersionId);
            assert.strictEqual(awsDestUserMD['scal-replication-status'],
                'REPLICA');
            assert.strictEqual(azureDestPropResponse
                .headers['x-ms-meta-scal_replication_status'], 'REPLICA');
            assert.strictEqual(
                azureDestPropResponse.headers['x-ms-meta-scal_version_id'],
                srcData.VersionId);
            return cb();
        });
    }

    compareAzureObjectProperties(srcBucket, containerName, key, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getHeadObject(srcBucket, key, next),
            next => this.azure.getBlobProperties(containerName, key, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            const srcData = data[1];
            const destData = data[2];
            const destResult = destData[0];
            const destResponse = destData[1];
            const { contentSettings } = destResult;
            const { headers } = destResponse;
            let expectedVal = srcData.Metadata.customkey;
            assert.strictEqual(expectedVal,
                destResult.metadata['customkey']);
            assert.strictEqual(expectedVal,
                headers['x-ms-meta-customkey']);
            expectedVal = srcData.ContentType;
            assert.strictEqual(expectedVal, contentSettings.contentType);
            assert.strictEqual(expectedVal, headers['content-type']);
            expectedVal = srcData.CacheControl;
            assert.strictEqual(expectedVal, contentSettings.cacheControl);
            assert.strictEqual(expectedVal, headers['cache-control']);
            expectedVal = srcData.ContentEncoding;
            assert.strictEqual(expectedVal, contentSettings.contentEncoding);
            assert.strictEqual(expectedVal, headers['content-encoding']);
            expectedVal = srcData.ContentLanguage;
            assert.strictEqual(expectedVal, contentSettings.contentLanguage);
            assert.strictEqual(expectedVal, headers['content-language']);
            return cb();
        });
    };

    compareACLs(srcBucket, destBucket, key, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getObjectACL(srcBucket, key, next),
            next => this.getObjectACL(destBucket, key, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            assert.deepStrictEqual(data[1], data[2]);
            return cb();
        });
    }

    compareACLsAWS(srcBucket, destBucket, key, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getObjectACL(srcBucket, key, next),
            next => this._setS3Client(awsS3Client)
                .getObjectACL(destBucket, key, next),
        ], (err, data) => {
            this._setS3Client(scalityS3Client);
            if (err) {
                return cb(err);
            }
            assert.strictEqual(data[1].Grants[0].Permission,
                data[2].Grants[0].Permission);
            return cb();
        });
    }

    compareObjectTags(srcBucket, destBucket, key, cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, undefined, next),
            next => this.getObjectTagging(srcBucket, key, undefined, next),
            next => this.getObjectTagging(destBucket, key, undefined, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            assert.deepStrictEqual(data[1], data[2]);
            return cb();
        });
    }

    compareObjectTagsAWS(srcBucket, destBucket, key, scalityVersionId,
        AWSVersionId, cb) {
	console.log({ srcBucket, destBucket, key, scalityVersionId,
        AWSVersionId });
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, scalityVersionId,
                next),
            //next => this.getObjectTagging(srcBucket, key, scalityVersionId,
            //    next),
            //next => this._setS3Client(awsS3Client)
            //    .getObjectTagging(destBucket, `${srcBucket}/${key}`, AWSVersionId, next),
        ], (err, data) => {
            this._setS3Client(scalityS3Client);
            if (err) {
                return cb(err);
            }
            const srcData = data[1];
            const destData = data[2];
            // Version IDs will differ in the response, so just compare tag set.
            assert.deepStrictEqual(srcData.TagSet, destData.TagSet);
            return cb();
        });
    }

    compareObjectTagsAzure(srcBucket, destContainer, key, scalityVersionId,
        cb) {
        return async.series([
            next => this.waitUntilReplicated(srcBucket, key, scalityVersionId,
                next),
            next => this.getObjectTagging(srcBucket, key, scalityVersionId,
                next),
            next => this.azure.getBlobMetadata(destContainer, key, next),
        ], (err, data) => {
            if (err) {
                return cb(err);
            }
            const srcData = data[1];
            const destData = data[2];
            const destTagSet = [];
            const destTags = destData[0].metadata.tags;
            if (destTags) {
                const parsedTags = JSON.parse(destTags);
                Object.keys(parsedTags).forEach(key => destTagSet.push({
                    Key: key,
                    Value: parsedTags[key],
                }));
            }
            assert.deepStrictEqual(srcData.TagSet, destTagSet);
            return cb();
        });
    }

    assertNoObject(bucketName, key, cb) {
        this.getObject(bucketName, key, err => {
		// TODO: Assert error type without using arsenal node module
		console.log(err);
            return cb();
        });
    }

    assertObjectExists(bucketName, key, cb) {
        setTimeout(() =>
            this.getObject(bucketName, key, err => {
                assert(err === null);
                return cb();
            },
        REPLICATION_TIMEOUT));
    }

    // Continue getting bucket status while replication is not enabled
    waitUntilReplicationEnabled(bucketName, cb) {
        let replicationConfig;
        let replicationStatus;
        async.doWhilst(callback => setTimeout(() =>
            this.getBucketReplication(bucketName, (err, data) => {
                if (err &&
                    err.code === 'ReplicationConfigurationNotFoundError') {
                    replicationStatus = null;
                    return callback();
                }
                if (err) {
                    return callback(err);
                }
                replicationConfig = data.ReplicationConfiguration;
                replicationStatus = replicationConfig.Rules[0].Status;
                return callback();
            }), 2000), () => replicationStatus !== 'Enabled',
                       () => cb(null, replicationConfig));
    }
}

module.exports = ReplicationUtility;
