import logging
import pytest

import requests

import zenko_e2e.util as util
import zenko_e2e.conf as conf

from ..fixtures import *

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(name)s %(levelname)s: %(message)s',
                    datefmt='%S')


@pytest.mark.conformance
def test_aws_1_1_pr(
        aws_crr_pr_bucket, aws_crr_pr_target_bucket, testfile, objkey):
    util.mark_test('AWS 1-1 REPLICATION PAUSE RESUME TEST')
    aws_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '1'
    )
    print(aws_crr_pr_bucket.name)
    assert util.check_object(objkey + '1', testfile, aws_crr_pr_bucket,
                             aws_crr_pr_target_bucket, timeout=30)
    pause_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/pause'
    requests.post(pause_url)
    # check reponse for Error
    aws_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '2'
    )
    assert util.check_object_dne(aws_crr_pr_bucket,
                                 aws_crr_pr_target_bucket)
    resume_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/resume'
    requests.post(resume_url)
    assert util.check_object(objkey + '2', testfile, aws_crr_pr_bucket,
                             aws_crr_pr_target_bucket, timeout=30)


@pytest.mark.conformance
def test_gcp_1_1_pr(
        gcp_crr_pr_bucket, gcp_crr_pr_target_bucket, testfile, objkey):
    util.mark_test('GCP 1-1 REPLICATION PAUSE RESUME TEST')
    gcp_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '1'
    )
    print(gcp_crr_pr_bucket.name)
    assert util.check_object(objkey + '1', testfile, gcp_crr_pr_bucket,
                             gcp_crr_pr_target_bucket, timeout=30)
    pause_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/pause'
    requests.post(pause_url)
    # check reponse for Error
    gcp_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '2'
    )
    assert util.check_object_dne(gcp_crr_pr_bucket,
                                 gcp_crr_pr_target_bucket)
    resume_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/resume'
    requests.post(resume_url)
    assert util.check_object(objkey + '2', testfile, gcp_crr_pr_bucket,
                             gcp_crr_pr_target_bucket, timeout=30)


@pytest.mark.conformance
def test_azure_1_1_pr(
        azure_crr_pr_bucket, azure_crr_pr_target_bucket, testfile, objkey):
    util.mark_test('AZURE 1-1 REPLICATION PAUSE RESUME TEST')
    azure_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '1'
    )
    print(azure_crr_pr_bucket.name)
    assert util.check_object(objkey + '1', testfile, azure_crr_pr_bucket,
                             azure_crr_pr_target_bucket, timeout=30)
    pause_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/pause'
    requests.post(pause_url)
    # check reponse for Error
    azure_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '2'
    )
    assert util.check_object_dne(azure_crr_pr_bucket,
                                 azure_crr_pr_target_bucket)
    resume_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/resume'
    requests.post(resume_url)
    assert util.check_object(objkey + '2', testfile, azure_crr_pr_bucket,
                             azure_crr_pr_target_bucket, timeout=30)


@pytest.mark.conformance
def test_wasabi_1_1_pr(
        wasabi_crr_pr_bucket, wasabi_crr_pr_target_bucket, testfile, objkey):
    util.mark_test('WASABI 1-1 REPLICATION PAUSE RESUME TEST')
    wasabi_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '1'
    )
    print(wasabi_crr_pr_bucket.name)
    assert util.check_object(objkey + '1', testfile, wasabi_crr_pr_bucket,
                             wasabi_crr_pr_target_bucket, timeout=30)
    pause_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/pause'
    requests.post(pause_url)
    # check reponse for Error
    wasabi_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '2'
    )
    assert util.check_object_dne(wasabi_crr_pr_bucket,
                                 wasabi_crr_pr_target_bucket)
    resume_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/resume'
    requests.post(resume_url)
    assert util.check_object(objkey + '2', testfile, wasabi_crr_pr_bucket,
                             wasabi_crr_pr_target_bucket, timeout=30)


@pytest.mark.conformance
def test_multi_1_M_pr(  # pylint: disable=invalid-name, too-many-arguments
        multi_crr_pr_bucket, aws_crr_pr_target_bucket,
        gcp_crr_pr_target_bucket, azure_crr_pr_target_bucket,
        wasabi_crr_pr_target_bucket, testfile, objkey):
    util.mark_test("MULTI 1-M REPLICATION PAUSE RESUME TEST")
    multi_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '1'
    )
    assert util.check_object(objkey + '1', testfile, multi_crr_pr_bucket,
                             aws_crr_pr_target_bucket,
                             gcp_crr_pr_target_bucket,
                             azure_crr_pr_target_bucket,
                             wasabi_crr_pr_target_bucket,
                             timeout=30)
    pause_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/pause'
    requests.post(pause_url)
    # check response for Error
    multi_crr_pr_bucket.put_object(
        Body=testfile,
        Key=objkey + '2'
    )
    assert util.check_object_dne(multi_crr_pr_bucket,
                                 aws_crr_pr_target_bucket,
                                 gcp_crr_pr_target_bucket,
                                 azure_crr_pr_target_bucket,
                                 wasabi_crr_pr_target_bucket)
    resume_url = conf.ZENKO_ENDPOINT + '/_/backbeat/api/crr/resume'
    requests.post(resume_url)
    assert util.check_object(objkey + '2', testfile, multi_crr_pr_bucket,
                             aws_crr_pr_target_bucket,
                             gcp_crr_pr_target_bucket,
                             azure_crr_pr_target_bucket,
                             wasabi_crr_pr_target_bucket,
                             timeout=30)
