"""Result delivery and timeout handling for a single company crawl.

Two defects from the live run are covered here:

* the worker was joined with a hardcoded 60 s budget and then abandoned;
* the result was read only *after* the worker exited, so any crawl producing
  more than the OS pipe buffer (~64 KB — Celonis 232 jobs, Helsing 160) blocked
  the child in ``queue.put`` while the parent sat in ``join``: the two
  deadlocked until the timeout.
"""

import os
import queue as queue_lib
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import cli
import config


class _FakeQueue:
    def __init__(self, result=None, raise_empty=False):
        self.result = result
        self.raise_empty = raise_empty
        self.get_timeouts = []
        self.get_calls = 0

    def get(self, timeout=None):
        self.get_calls += 1
        self.get_timeouts.append(timeout)
        if self.raise_empty or self.result is None:
            raise queue_lib.Empty
        return self.result

    def empty(self):
        return self.result is None


class _FakeWorker:
    def __init__(self, alive_after_join=False):
        self.started = False
        self.terminated = False
        self.join_timeouts = []
        self.alive = True
        self.alive_after_join = alive_after_join

    def start(self):
        self.started = True

    def join(self, timeout=None):
        self.join_timeouts.append(timeout)
        if not self.alive_after_join:
            self.alive = False

    def is_alive(self):
        return self.alive

    def terminate(self):
        self.terminated = True
        self.alive = False


class _FakeContext:
    def __init__(self, result_queue=None, worker=None):
        self.method = None
        self.worker = worker or _FakeWorker()
        self.result_queue = result_queue or _FakeQueue()

    def Process(self, *args, **kwargs):
        return self.worker

    def Queue(self, *args, **kwargs):
        return self.result_queue


def test_workers_use_a_spawn_context():
    # fork() from a threaded Flask request handler deadlocks the child on the
    # parent's locks: four concurrent crawl requests in the live run left two
    # hanging until the client gave up. spawn() starts a clean interpreter.
    assert cli._MP_CONTEXT.get_start_method() == 'spawn'


def test_worker_result_is_read_without_waiting_for_the_worker_to_exit(monkeypatch):
    result = {'search_id': 's1', 'company_id': 'c1', 'jobs': [{'title': 'x'}]}
    context = _FakeContext(result_queue=_FakeQueue(result), worker=_FakeWorker(alive_after_join=True))
    monkeypatch.setattr(cli, '_MP_CONTEXT', context)

    returned = cli.crawl_company_jobs('s1', 'c1', 'https://example.com/careers', 'Example', 'pm')

    assert returned == result
    # A large payload can only be delivered while the child is still writing,
    # so the result must be awaited on the queue, not after join().
    assert context.result_queue.get_calls == 1


def test_stuck_worker_is_terminated_and_reported(monkeypatch):
    context = _FakeContext(result_queue=_FakeQueue(raise_empty=True))
    monkeypatch.setattr(cli, '_MP_CONTEXT', context)

    result = cli.crawl_company_jobs('s1', 'c1', 'https://example.com/careers', 'Example', 'pm')

    assert context.worker.started
    assert context.worker.terminated, 'a timed-out crawl must not be left running in the background'
    assert result['jobs'] == []
    assert result['errors'], 'a timed-out crawl must report an error'


def test_worker_timeout_is_configurable_and_generous(monkeypatch):
    context = _FakeContext(result_queue=_FakeQueue({'jobs': []}))
    monkeypatch.setattr(cli, '_MP_CONTEXT', context)

    cli.crawl_company_jobs('s1', 'c1', 'https://example.com/careers', 'Example', 'pm')

    # Large ATS boards legitimately need minutes; 60 s cut real crawls short.
    assert context.result_queue.get_timeouts[0] == config.COMPANY_CRAWL_TIMEOUT
    assert config.COMPANY_CRAWL_TIMEOUT >= 120
