"""Inert bounded capture child receipt projection. No process or file operations."""
import hashlib
import json
import math
import re
from pathlib import PurePosixPath

CAP = 8192
KEYS = {'kind','argv','cwd','exitCode','waited','timeout','durationSeconds',
        'termAllocationSeconds','killGraceSeconds','termDeadline','killDeadline',
        'outputs','processClosure'}


def require(value, label):
    if not value:
        raise ValueError(label)


def path(value):
    require(type(value) is str and 0 < len(value) <= 2048,
            'bounded path')
    require(all(32 < ord(ch) < 127 for ch in value) and '\\' not in value,
            'literal path')
    parsed = PurePosixPath(value)
    require(parsed.is_absolute() and '..' not in parsed.parts
            and str(parsed) == value, 'canonical lexical path')
    return value


def number(value):
    require(type(value) in (int, float) and math.isfinite(value)
            and 0 <= value <= 1e12, 'bounded finite number')
    return value


def encode_receipt(receipt, identity, expected_argv, expected_cwd, artifact_root):
    require(type(receipt) is dict and set(receipt) == KEYS, 'receipt exact shape')
    require(type(identity) is dict and set(identity) == {'source','candidate','run','attempt'},
            'identity exact shape')
    for key in ('source', 'candidate'):
        require(type(identity[key]) is str
                and re.fullmatch('[0-9a-f]{40}', identity[key]) is not None,
                'identity source')
    require(type(identity['run']) is int and 0 < identity['run'] < 2**63
            and type(identity['attempt']) is int and identity['attempt'] == 1,
            'identity run attempt')
    require(type(expected_argv) is list and 1 <= len(expected_argv) <= 16
            and all(type(v) is str and 0 < len(v) <= 2048
                    and all(32 <= ord(ch) < 127 for ch in v) for v in expected_argv),
            'source-bound argv')
    require(type(receipt['argv']) is list and receipt['argv'] == expected_argv
            and all(type(v) is str for v in receipt['argv']), 'actual argv')
    cwd = path(expected_cwd)
    root = path(artifact_root)
    require(type(receipt['cwd']) is str and receipt['cwd'] == cwd, 'actual cwd')
    require(receipt['kind'] == 'ACTUAL_CHILD_WAIT'
            and type(receipt['kind']) is str, 'actual child kind')
    exit_code = receipt['exitCode']
    require(exit_code is None or (type(exit_code) is int
            and -(2**31) <= exit_code < 2**31), 'actual exit type')
    require(type(receipt['waited']) is bool and type(receipt['timeout']) is bool,
            'actual boolean fields')
    require(not receipt['waited'] or exit_code is not None, 'waited exit required')
    require(not receipt['waited'] or receipt['timeout'] or exit_code != 0,
            'failed child receipt required')
    require(type(receipt['termAllocationSeconds']) is int
            and receipt['termAllocationSeconds'] == 1920
            and type(receipt['killGraceSeconds']) is int
            and receipt['killGraceSeconds'] == 60, 'original allocations')
    duration = number(receipt['durationSeconds'])
    term = number(receipt['termDeadline'])
    kill = number(receipt['killDeadline'])
    require(term <= kill <= term + 60, 'actual deadline order')
    require(receipt['processClosure'] == 'UNKNOWN'
            and type(receipt['processClosure']) is str, 'closure UNKNOWN')
    outputs = receipt['outputs']
    require(type(outputs) is list and len(outputs) == 2, 'two actual output pins')
    selected = []
    for item, name in zip(outputs, ('producer.stdout.log', 'producer.stderr.log')):
        require(type(item) is dict and set(item) == {'path','bytes','sha256'},
                'output exact shape')
        require(type(item['path']) is str and item['path'] == root + '/' + name,
                'source-bound output path')
        require(type(item['bytes']) is int and 0 <= item['bytes'] <= 1073741824,
                'original output cap')
        require(type(item['sha256']) is str
                and re.fullmatch('[0-9a-f]{64}', item['sha256']) is not None,
                'output full SHA256')
        selected.append(dict(item))
    argv_raw = json.dumps(expected_argv, separators=(',', ':'), ensure_ascii=True).encode('ascii')
    value = {'schema':1, 'role':'capture-child-outcome', 'identity':dict(identity),
             'phase':'PRODUCER', 'argvSHA256':hashlib.sha256(argv_raw).hexdigest(),
             'cwd':cwd, 'exitCode':exit_code, 'waited':receipt['waited'],
             'timeout':receipt['timeout'], 'durationSeconds':duration,
             'termAllocationSeconds':1920, 'killGraceSeconds':60,
             'termDeadline':term, 'killDeadline':kill, 'outputs':selected,
             'processClosure':'UNKNOWN', 'numericPASS':False, 'releaseCleared':False,
             'qualification':'Actual outer child wait only; failing test and native descendants UNKNOWN.'}
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':'),
                      ensure_ascii=True, allow_nan=False) + '\n').encode('ascii')
    require(len(raw) <= CAP, 'child receipt publication cap')
    return raw


def emit(receipt, identity, expected_argv, expected_cwd, artifact_root, stream):
    raw = encode_receipt(receipt, identity, expected_argv, expected_cwd, artifact_root)
    text = raw.decode('ascii')
    written = stream.write(text)
    require(type(written) is int and written == len(text), 'complete stdout write')
    stream.flush()
    return {'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest()}
