import logging
import time

import pytest
import zenko_e2e.util as util

from ..fixtures import *

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(name)s %(levelname)s: %(message)s',
                    datefmt='%S')

def test_ts((aws_crr_bucket, aws_crr_target_bucket, testfile, objkey):
    util.mark_test('TRANSIENT SOURCE')
    aws_crr_bucket.put_object(
        Body=testfile,
        Key=objkey
    )
    print(aws_crr_bucket.name)
    time.sleep()
    assert util.check_object(
        objkey, testfile, aws_crr_bucket, aws_crr_target_bucket, timeout=30)
